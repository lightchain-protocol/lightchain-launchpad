import type { FastifyPluginAsync } from "fastify";

import { config } from "../config.js";
import { uploadFormSchema, buildCanonicalMetadata } from "../services/metadata-schema.js";
import { pinFile, pinJson, pinningEnabled, PinningDisabledError } from "../services/ipfs.js";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const plugin: FastifyPluginAsync = async (app) => {
  // POST /v1/metadata — pin an image + build & pin the canonical token metadata JSON.
  // This is the ONLY client→backend write: it produces an ipfs:// CID; the
  // authoritative record (the CID, on-chain via createToken) is never trusted from a client.
  app.post(
    "/metadata",
    {
      config: {
        rateLimit: { max: config.RATE_LIMIT_UPLOAD_PER_MIN, timeWindow: "1 minute" },
      },
      schema: {
        tags: ["metadata"],
        summary: "Pin a token image + metadata JSON to IPFS; returns the ipfs:// URI to pass to createToken()",
        consumes: ["multipart/form-data"],
      },
    },
    async (req, reply) => {
      if (!pinningEnabled) return reply.code(503).send({ error: "IPFS pinning is not configured" });

      // collect multipart fields + the single image file
      const fields: Record<string, string | string[]> = {};
      let image: { buffer: Buffer; filename: string; mimetype: string } | undefined;
      const parts = req.parts({ limits: { fileSize: config.MAX_IMAGE_BYTES, files: 1 } });
      for await (const part of parts) {
        if (part.type === "file") {
          if (!ALLOWED_IMAGE_TYPES.has(part.mimetype)) {
            return reply.code(415).send({ error: `unsupported image type: ${part.mimetype}` });
          }
          const buffer = await part.toBuffer();
          if ((part as { file?: { truncated?: boolean } }).file?.truncated) {
            return reply.code(413).send({ error: "image too large" });
          }
          image = { buffer, filename: part.filename || "image", mimetype: part.mimetype };
        } else {
          const v = part.value as string;
          const existing = fields[part.fieldname];
          if (existing === undefined) fields[part.fieldname] = v;
          else if (Array.isArray(existing)) existing.push(v);
          else fields[part.fieldname] = [existing, v];
        }
      }

      if (!image) return reply.code(400).send({ error: "missing image file (multipart field 'image' or 'file')" });

      const parsed = uploadFormSchema.safeParse(fields);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid form fields", details: parsed.error.flatten().fieldErrors });
      }

      try {
        const imageCid = await pinFile(image.buffer, image.filename, image.mimetype);
        const metadata = buildCanonicalMetadata(parsed.data, imageCid);
        const jsonCid = await pinJson(metadata, `${parsed.data.symbol}-metadata.json`);
        return { uri: `ipfs://${jsonCid}`, imageUri: `ipfs://${imageCid}`, metadata };
      } catch (err) {
        if (err instanceof PinningDisabledError) return reply.code(503).send({ error: err.message });
        req.log.error({ err }, "pinning failed");
        return reply.code(502).send({ error: "pinning failed" });
      }
    },
  );
};

export default plugin;
