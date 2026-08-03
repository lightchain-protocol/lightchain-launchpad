import { z } from "zod";

const httpsUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || /^https:\/\/[^\s]+$/i.test(v), "must be an https URL")
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const ipfsOrHttps = z
  .string()
  .trim()
  .max(300)
  .refine((v) => /^(ipfs:\/\/|https:\/\/)/i.test(v), "must be an ipfs:// or https:// URI");

const tags = z.array(z.string().trim().min(1).max(24)).max(5).optional();

/** Form fields accepted by `POST /v1/metadata` (the image arrives as the multipart file). */
export const uploadFormSchema = z.object({
  name: z.string().trim().min(1).max(64),
  symbol: z.string().trim().min(1).max(16),
  description: z.string().trim().min(1).max(2000),
  website: httpsUrl,
  twitter: httpsUrl,
  telegram: httpsUrl,
  discord: httpsUrl,
  tags: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .transform((v) => (typeof v === "string" ? v.split(",") : v))
    .pipe(tags),
});
export type UploadForm = z.infer<typeof uploadFormSchema>;

/** Canonical token metadata JSON we pin and that the on-chain `metadataURI` points to. */
export const tokenMetadataJsonSchema = z.object({
  name: z.string().trim().max(64).optional(),
  symbol: z.string().trim().max(16).optional(),
  description: z.string().trim().max(4000).optional(),
  image: ipfsOrHttps.optional(),
  banner: ipfsOrHttps.optional(),
  website: httpsUrl,
  twitter: httpsUrl,
  telegram: httpsUrl,
  discord: z.string().trim().max(300).optional(),
  tags: tags,
});
export type TokenMetadataJson = z.infer<typeof tokenMetadataJsonSchema>;

export function buildCanonicalMetadata(form: UploadForm, imageCid: string): TokenMetadataJson {
  return {
    name: form.name,
    symbol: form.symbol,
    description: form.description,
    image: `ipfs://${imageCid}`,
    website: form.website,
    twitter: form.twitter,
    telegram: form.telegram,
    discord: form.discord,
    tags: form.tags,
  };
}
