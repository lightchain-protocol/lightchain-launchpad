import { describe, expect, it } from "vitest";

import { boundNotifyPayload, NOTIFY_MAX_BYTES } from "./notify-payload.js";

const TOKEN = "0x1111111111111111111111111111111111111111";
const bytes = (s: string) => Buffer.byteLength(s, "utf8");

/** A token DTO whose attacker-controlled `name` blows the payload past the cap. */
const poisonTokenDTO = (name: string) => ({
  address: TOKEN,
  creator: "0x2222222222222222222222222222222222222222",
  name,
  symbol: "MEME",
  metadataUri: "ipfs://cid",
});

describe("boundNotifyPayload", () => {
  it("passes a small payload through byte-identically", () => {
    const payload = { token: TOKEN, trade: { id: "0xabc-0" } };
    expect(boundNotifyPayload("trade", payload)).to.equal(JSON.stringify(payload));
  });

  it("degrades an oversized payload to under the cap", () => {
    const out = boundNotifyPayload("trade", { token: TOKEN, blob: "A".repeat(20_000) });
    expect(bytes(out)).toBeLessThanOrEqual(NOTIFY_MAX_BYTES);
    expect(JSON.parse(out).truncated).to.equal(true);
  });

  it("keeps `token` on a degraded trade payload so the API can still route it", () => {
    const out = JSON.parse(
      boundNotifyPayload("trade", { token: TOKEN, tokenDTO: poisonTokenDTO("A".repeat(20_000)) }),
    );
    expect(out.token).to.equal(TOKEN);
    expect(out.truncated).to.equal(true);
  });

  it("keeps `address` on a degraded token:update payload", () => {
    const out = JSON.parse(
      boundNotifyPayload("token:update", { address: TOKEN, blob: "A".repeat(20_000) }),
    );
    expect(out.address).to.equal(TOKEN);
  });

  it("keeps `token` on degraded token:graduated and metadata:pending payloads", () => {
    for (const channel of ["token:graduated", "metadata:pending"]) {
      const out = JSON.parse(boundNotifyPayload(channel, { token: TOKEN, blob: "A".repeat(20_000) }));
      expect(out.token, channel).to.equal(TOKEN);
    }
  });

  it("keeps a nested address on a degraded token:new payload", () => {
    const out = JSON.parse(
      boundNotifyPayload("token:new", { token: poisonTokenDTO("A".repeat(20_000)) }),
    );
    expect(out.token).to.deep.equal({ address: TOKEN });
    expect(out.truncated).to.equal(true);
  });

  it("measures UTF-8 bytes, not UTF-16 code units", () => {
    // 2 code units but 4 bytes each: under the cap by .length, over it by bytes.
    const name = "\u{1F600}".repeat(2600);
    const payload = { token: TOKEN, name };
    const raw = JSON.stringify(payload);
    expect(raw.length).toBeLessThan(NOTIFY_MAX_BYTES); // a naive .length check would pass this
    expect(bytes(raw)).toBeGreaterThan(NOTIFY_MAX_BYTES);

    const out = boundNotifyPayload("trade", payload);
    expect(bytes(out)).toBeLessThanOrEqual(NOTIFY_MAX_BYTES);
    expect(JSON.parse(out).truncated).to.equal(true);
  });

  it("never throws on a payload JSON.stringify rejects", () => {
    const circular: Record<string, unknown> = { token: TOKEN };
    circular.self = circular;
    expect(() => boundNotifyPayload("trade", circular)).to.not.throw();
    const out = JSON.parse(boundNotifyPayload("trade", circular));
    expect(out.token).to.equal(TOKEN);
    expect(out.truncated).to.equal(true);
  });

  it("never throws on undefined or primitive payloads", () => {
    expect(() => boundNotifyPayload("status", undefined)).to.not.throw();
    expect(JSON.parse(boundNotifyPayload("status", undefined)).truncated).to.equal(true);
    expect(boundNotifyPayload("status", { lag: 0 })).to.equal('{"lag":0}');
  });

  it("survives a realistic 9k-character token name on launch", () => {
    const out = JSON.parse(
      boundNotifyPayload("token:new", { token: poisonTokenDTO("A".repeat(9_000)) }),
    );
    expect(out.token).to.deep.equal({ address: TOKEN });
  });
});
