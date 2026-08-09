import { PinataSDK } from "pinata";

import { config } from "../config.js";
import { tokenMetadataJsonSchema, type TokenMetadataJson } from "./metadata-schema.js";
import { metadataFetchUrls, parseIpfsUri } from "./untrusted-input.js";

export { parseIpfsUri };

const pinata = config.PINATA_JWT
  ? new PinataSDK({ pinataJwt: config.PINATA_JWT, pinataGateway: config.PINATA_GATEWAY })
  : null;

export const pinningEnabled = pinata !== null;

export class PinningDisabledError extends Error {
  constructor() {
    super("IPFS pinning is not configured (set PINATA_JWT)");
  }
}

/** Pin a file buffer; returns the CID. */
export async function pinFile(buffer: Buffer, filename: string, contentType: string): Promise<string> {
  if (!pinata) throw new PinningDisabledError();
  const file = new File([buffer], filename, { type: contentType });
  const res = await pinata.upload.public.file(file);
  return res.cid;
}

/** Pin a JSON object; returns the CID. (`name` is best-effort metadata.) */
export async function pinJson(obj: unknown, name: string): Promise<string> {
  if (!pinata) throw new PinningDisabledError();
  const builder = pinata.upload.public.json(obj as Record<string, unknown>);
  const withName = (builder as unknown as { name?: (n: string) => typeof builder }).name;
  const res = await (typeof withName === "function" ? withName.call(builder, name) : builder);
  return res.cid;
}

/** Best-effort: ensure a CID stays pinned (re-pin to our account). Never throws. */
export async function repinCid(cid: string): Promise<void> {
  if (!pinata) return;
  try {
    // pin by CID — supported by the Pinata v2 SDK
    await (pinata.upload.public as unknown as { cid: (c: string) => Promise<unknown> }).cid(cid);
  } catch {
    /* ignore — gateway fetch still works for unpinned-but-reachable CIDs */
  }
}

/** Build the URLs the resolver may fetch for a metadata URI: configured IPFS gateways only. */
export function httpCandidates(uri: string): string[] {
  return metadataFetchUrls(uri, config.IPFS_GATEWAYS);
}

const MAX_JSON_BYTES = 64 * 1024;
export const FETCH_TIMEOUT_MS = 5_000;

/** Read at most `max` bytes, aborting the stream rather than buffering past it. */
async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      throw new Error("metadata too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchWithCaps(url: string): Promise<unknown> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > MAX_JSON_BYTES) throw new Error("metadata too large");
    return JSON.parse(await readCapped(res, MAX_JSON_BYTES));
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch + validate the token metadata JSON referenced by `uri`. Throws on failure. */
export async function fetchTokenMetadata(uri: string): Promise<TokenMetadataJson> {
  const urls = httpCandidates(uri);
  if (urls.length === 0) throw new Error(`unsupported metadata URI: ${uri}`);
  let lastErr: unknown;
  for (const url of urls) {
    try {
      const raw = await fetchWithCaps(url);
      return tokenMetadataJsonSchema.parse(raw);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("metadata fetch failed");
}

/** Resolve an ipfs:// image/banner reference to a gateway HTTP URL for display. */
export function toDisplayUrl(uri: string | undefined | null): string | null {
  if (!uri) return null;
  const ipfs = parseIpfsUri(uri);
  if (ipfs) {
    const g = config.IPFS_GATEWAYS[0]?.replace(/\/$/, "") ?? "https://ipfs.io/ipfs";
    return `${g}/${ipfs.cid}${ipfs.path}`;
  }
  return /^https:\/\//i.test(uri) ? uri : null;
}
