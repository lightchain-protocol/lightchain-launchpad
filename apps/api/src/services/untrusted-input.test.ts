import { describe, expect, it } from "vitest";

import { metadataFetchUrls, parseTrustProxy, sniffImageType } from "./untrusted-input.js";
import { tokenMetadataJsonSchema } from "./metadata-schema.js";

const GW = ["https://gateway.pinata.cloud/ipfs/", "https://ipfs.io/ipfs/"] as const;

const pad = (head: number[] | Buffer, to = 16) =>
  Buffer.concat([Buffer.isBuffer(head) ? head : Buffer.from(head), Buffer.alloc(to)]);

describe("metadataFetchUrls", () => {
  it("maps a bare CID onto every configured gateway", () => {
    expect(metadataFetchUrls("ipfs://QmAbc123", GW)).to.deep.equal([
      "https://gateway.pinata.cloud/ipfs/QmAbc123",
      "https://ipfs.io/ipfs/QmAbc123",
    ]);
  });

  it("appends the path to every gateway", () => {
    expect(metadataFetchUrls("ipfs://QmAbc123/meta.json", GW)).to.deep.equal([
      "https://gateway.pinata.cloud/ipfs/QmAbc123/meta.json",
      "https://ipfs.io/ipfs/QmAbc123/meta.json",
    ]);
  });

  it("normalises a gateway configured without a trailing slash", () => {
    expect(metadataFetchUrls("ipfs://QmAbc123", ["https://ipfs.io/ipfs"])).to.deep.equal([
      "https://ipfs.io/ipfs/QmAbc123",
    ]);
  });

  it("SSRF regression: refuses to fetch the cloud metadata endpoint", () => {
    expect(metadataFetchUrls("https://169.254.169.254/latest/meta-data/", GW)).to.deep.equal([]);
  });

  it("refuses a plain http:// host", () => {
    expect(metadataFetchUrls("http://evil.internal/x", GW)).to.deep.equal([]);
  });

  it("refuses empty and unparseable URIs", () => {
    expect(metadataFetchUrls("", GW)).to.deep.equal([]);
    expect(metadataFetchUrls("not-a-uri", GW)).to.deep.equal([]);
  });

  it("origin invariant: every candidate starts with a configured gateway", () => {
    // If someone rewrites the builder with `new URL(...)`, relative resolution
    // lets this escape to a different origin and this test fails.
    const out = metadataFetchUrls("ipfs://http://evil.internal/x", GW);
    expect(out.length).toBeGreaterThan(0);
    for (const u of out) {
      expect(u.startsWith(GW[0]) || u.startsWith(GW[1]), u).toBe(true);
    }
  });
});

describe("sniffImageType", () => {
  it("recognises JPEG", () => {
    expect(sniffImageType(pad([0xff, 0xd8, 0xff]))).to.equal("image/jpeg");
  });

  it("recognises PNG", () => {
    expect(sniffImageType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).to.equal("image/png");
  });

  it("recognises GIF87a and GIF89a", () => {
    expect(sniffImageType(pad(Buffer.from("GIF87a", "latin1")))).to.equal("image/gif");
    expect(sniffImageType(pad(Buffer.from("GIF89a", "latin1")))).to.equal("image/gif");
  });

  it("recognises WEBP", () => {
    const webp = Buffer.concat([
      Buffer.from("RIFF", "latin1"),
      Buffer.from([0x10, 0x00, 0x00, 0x00]),
      Buffer.from("WEBP", "latin1"),
      Buffer.alloc(16),
    ]);
    expect(sniffImageType(webp)).to.equal("image/webp");
  });

  it("rejects a RIFF container that is not WEBP", () => {
    const wave = Buffer.concat([
      Buffer.from("RIFF", "latin1"),
      Buffer.from([0x10, 0x00, 0x00, 0x00]),
      Buffer.from("WAVE", "latin1"),
      Buffer.alloc(16),
    ]);
    expect(sniffImageType(wave)).to.equal(null);
  });

  it("rejects an SVG/HTML payload", () => {
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).to.equal(null);
  });

  it("rejects a ZIP payload", () => {
    expect(sniffImageType(pad([0x50, 0x4b, 0x03, 0x04]))).to.equal(null);
  });

  it("rejects a valid signature truncated below 12 bytes", () => {
    const short = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(3),
    ]);
    expect(short.length).to.equal(11);
    expect(sniffImageType(short)).to.equal(null);
  });

  it("rejects an empty buffer", () => {
    expect(sniffImageType(Buffer.alloc(0))).to.equal(null);
  });
});

describe("parseTrustProxy", () => {
  it("defaults to false for absent, empty and false-ish values", () => {
    expect(parseTrustProxy(undefined)).to.equal(false);
    expect(parseTrustProxy("")).to.equal(false);
    expect(parseTrustProxy("false")).to.equal(false);
    expect(parseTrustProxy("FALSE")).to.equal(false);
    expect(parseTrustProxy("  false  ")).to.equal(false);
  });

  it("parses true", () => {
    expect(parseTrustProxy("true")).to.equal(true);
  });

  it("parses a hop count as a number", () => {
    expect(parseTrustProxy("1")).to.equal(1);
    expect(parseTrustProxy("0")).to.equal(0);
  });

  it("passes an IP/CIDR allowlist through unchanged", () => {
    expect(parseTrustProxy("10.0.0.0/8,127.0.0.1")).to.equal("10.0.0.0/8,127.0.0.1");
  });
});

describe("tokenMetadataJsonSchema discord", () => {
  it("rejects a javascript: URL", () => {
    expect(tokenMetadataJsonSchema.safeParse({ discord: "javascript:alert(1)" }).success).to.equal(false);
  });

  it("accepts an https discord invite", () => {
    const r = tokenMetadataJsonSchema.safeParse({ discord: "https://discord.gg/abc" });
    expect(r.success).to.equal(true);
    expect(r.success && r.data.discord).to.equal("https://discord.gg/abc");
  });

  it("leaves discord undefined when absent", () => {
    const r = tokenMetadataJsonSchema.safeParse({});
    expect(r.success).to.equal(true);
    expect(r.success && r.data.discord).to.equal(undefined);
  });
});
