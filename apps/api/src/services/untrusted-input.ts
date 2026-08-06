/**
 * Pure validators for the API's untrusted-input surface: the on-chain
 * `metadataURI` the resolver fetches, the image bytes clients upload, and how
 * much of an inbound request we are willing to believe.
 *
 * MUST stay import-free. `../config.js` calls `process.exit(1)` when
 * DATABASE_URL is absent and CI runs `pnpm test` with no `.env`, so anything a
 * test imports must not reach it. That is also why `parseIpfsUri` lives here
 * rather than in `./ipfs.js`.
 */

/** Parse `ipfs://<cid>[/path]` into `[cid, path]`. Returns null for non-ipfs URIs. */
export function parseIpfsUri(uri: string): { cid: string; path: string } | null {
  const m = /^ipfs:\/\/([^/]+)(\/.*)?$/i.exec(uri.trim());
  if (!m) return null;
  return { cid: m[1]!, path: m[2] ?? "" };
}

/**
 * The only URLs the metadata resolver is allowed to fetch: the configured IPFS
 * gateways, with the CID and path appended. Anything that is not an `ipfs://`
 * URI yields no candidates at all — an attacker-chosen `https://` host is not
 * a fetch target (SSRF).
 *
 * The host is unspoofable *because* this is string concatenation: the scheme
 * and authority are fixed by the gateway prefix, and URL parsing stops reading
 * the authority at the first `/`, so every attacker byte lands in the path.
 * Do NOT "improve" this into `new URL(cid + path, gatewayBase)` — relative
 * resolution lets a CID like `http:` with path `//evil.internal` escape to a
 * different origin entirely.
 */
export function metadataFetchUrls(uri: string, gateways: readonly string[]): string[] {
  const ipfs = parseIpfsUri(uri);
  if (!ipfs) return [];
  return gateways.map((g) => `${g.replace(/\/$/, "")}/${ipfs.cid}${ipfs.path}`);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Sniff an image type from the leading bytes. Returns one of the four types
 * `POST /v1/metadata` accepts, or null. Buffers shorter than 12 bytes are
 * always null — that is the WEBP signature length, and nothing that short is a
 * real image.
 */
export function sniffImageType(buf: Buffer): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(PNG_SIG)) return "image/png";
  const head6 = buf.subarray(0, 6).toString("latin1");
  if (head6 === "GIF87a" || head6 === "GIF89a") return "image/gif";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") {
    return "image/webp";
  }
  return null;
}

/**
 * Parse the `TRUST_PROXY` env var into a Fastify `trustProxy` value.
 * `""`/`"false"` → false (safe default: use the socket address).
 * `"true"` → true. A bare integer → that many proxy hops. Anything else is
 * handed to Fastify as an IP/CIDR allowlist (`proxy-addr` validates it and
 * throws loudly at boot if it is nonsense).
 */
export function parseTrustProxy(raw: string | undefined): boolean | number | string {
  const t = (raw ?? "").trim();
  if (t === "" || t.toLowerCase() === "false") return false;
  if (t.toLowerCase() === "true") return true;
  return /^\d+$/.test(t) ? Number(t) : t;
}
