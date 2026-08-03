import { PinataSDK } from "pinata";

import { config } from "../config.js";
import { tokenMetadataJsonSchema, type TokenMetadataJson } from "./metadata-schema.js";

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

/** Parse `ipfs://<cid>[/path]` into `[cid, path]`. Returns null for non-ipfs URIs. */
export function parseIpfsUri(uri: string): { cid: string; path: string } | null {
  const m = /^ipfs:\/\/([^/]+)(\/.*)?$/i.exec(uri.trim());
  if (!m) return null;
  return { cid: m[1]!, path: m[2] ?? "" };
}

/** Build candidate HTTP URLs for a metadata URI, gateways-first for ipfs:// */
export function httpCandidates(uri: string): string[] {
  const t = uri.trim();
  const ipfs = parseIpfsUri(t);
  if (ipfs) {
    return config.IPFS_GATEWAYS.map((g) => `${g.replace(/\/$/, "")}/${ipfs.cid}${ipfs.path}`);
  }
  if (/^https:\/\//i.test(t)) return [t];
  return [];
}

const MAX_JSON_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 5_000;

async function fetchWithCaps(url: string): Promise<unknown> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > MAX_JSON_BYTES) throw new Error("metadata too large");
    const text = await res.text();
    if (text.length > MAX_JSON_BYTES) throw new Error("metadata too large");
    return JSON.parse(text);
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
