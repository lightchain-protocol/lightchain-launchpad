import "dotenv/config";
import { z } from "zod";

import { parseTrustProxy } from "./services/untrusted-input.js";

const csv = (def: string) =>
  z.string().default(def).transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default("0.0.0.0"),
  PUBLIC_URL: z.string().url().default("http://localhost:3001"),
  CORS_ORIGIN: z.string().default("*"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  // Fastify `trustProxy`. Default false — correct when the API is exposed
  // directly. `req.ip` is the rate-limit key, so trusting a client-supplied
  // X-Forwarded-For means there is effectively no rate limit at all. Set this
  // ONLY when a proxy you control always OVERWRITES that header.
  //   false | true | <hop count, e.g. 1> | <IP/CIDR list, e.g. "10.0.0.0/8,127.0.0.1">
  TRUST_PROXY: z.string().default("false").transform(parseTrustProxy),

  RPC_URL: z.string().url().default("http://127.0.0.1:8545"),

  // The Launchpad proxy address. Used for the holders view: every launched token
  // mints its initial supply to the launchpad and the launchpad holds the unsold
  // for-sale supply until graduation, so it must be excluded from "top holders".
  // Falls back to LAUNCHPAD_ADDRESS (the indexer's env var, kept for
  // backward-compat).
  LAUNCHPAD_ADDRESS: z
    .string()
    .default(process.env.LAUNCHPAD_ADDRESS ?? "0x0000000000000000000000000000000000000000"),

  PINATA_JWT: z.string().default(""),
  PINATA_GATEWAY: z.string().default("gateway.pinata.cloud"),
  IPFS_GATEWAYS: csv("https://gateway.pinata.cloud/ipfs/,https://ipfs.io/ipfs/"),

  MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(4 * 1024 * 1024),
  RATE_LIMIT_GLOBAL_PER_MIN: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_UPLOAD_PER_MIN: z.coerce.number().int().positive().default(10),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:\n", JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;

export const isTest = config.NODE_ENV === "test";
export const isProd = config.NODE_ENV === "production";
