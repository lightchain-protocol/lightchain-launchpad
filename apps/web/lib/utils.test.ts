import { describe, expect, it } from "vitest";

import {
  applySlippage,
  clampDeadline,
  clampSlippage,
  DEADLINE_DEFAULT,
  DEADLINE_MAX,
  DEADLINE_MIN,
  deadlineFromNow,
  formatNative,
  isQuoteStale,
  priceImpactBps,
  QUOTE_MAX_AGE_MS,
  SLIPPAGE_DEFAULT,
  SLIPPAGE_MAX,
  SLIPPAGE_MIN,
} from "./utils";

describe("clampSlippage", () => {
  it("clamps above the maximum", () => {
    // 150% would make `10_000n - bps` negative and throw IntegerOutOfRangeError
    // when viem encodes minTokensOut as a uint256.
    expect(clampSlippage(150)).toBe(SLIPPAGE_MAX);
  });

  it("clamps below the minimum", () => {
    // 0 sets minOut to the exact quote, so any concurrent trade reverts it.
    expect(clampSlippage(0)).toBe(SLIPPAGE_MIN);
  });

  it("falls back to the default for NaN", () => {
    // Reachable from a corrupted persisted value; BigInt(NaN) throws RangeError.
    expect(clampSlippage(NaN)).toBe(SLIPPAGE_DEFAULT);
  });

  it("falls back to the default for a non-numeric persisted value", () => {
    expect(clampSlippage("abc")).toBe(SLIPPAGE_DEFAULT);
    expect(clampSlippage(undefined)).toBe(SLIPPAGE_DEFAULT);
    expect(clampSlippage(null)).toBe(SLIPPAGE_DEFAULT);
    expect(clampSlippage(Infinity)).toBe(SLIPPAGE_DEFAULT);
  });

  it("passes in-range values through untouched", () => {
    expect(clampSlippage(1)).toBe(1);
    expect(clampSlippage(0.5)).toBe(0.5);
    // the dialog's lowest preset is exactly SLIPPAGE_MIN — an off-by-one in the
    // clamp would silently break the first preset button
    expect(clampSlippage(0.1)).toBe(0.1);
  });
});

describe("clampDeadline", () => {
  it("clamps a cleared field up to the minimum", () => {
    // Number("") === 0 → deadline = now → every DEX swap reverts EXPIRED.
    expect(clampDeadline(0)).toBe(DEADLINE_MIN);
  });

  it("clamps above the maximum", () => {
    expect(clampDeadline(99999)).toBe(DEADLINE_MAX);
  });

  it("falls back to the default for NaN", () => {
    expect(clampDeadline(NaN)).toBe(DEADLINE_DEFAULT);
  });

  it("rounds to whole minutes", () => {
    expect(clampDeadline(20.4)).toBe(20);
    expect(clampDeadline(20.6)).toBe(21);
  });

  it("passes in-range values through untouched", () => {
    expect(clampDeadline(20)).toBe(20);
  });
});

describe("applySlippage", () => {
  it("never returns a negative amount for an out-of-range tolerance", () => {
    const out = applySlippage(1000n, "min", 150);
    expect(out > 0n).toBe(true);
    expect(out <= 1000n).toBe(true);
  });

  it("does not throw on a NaN tolerance", () => {
    expect(() => applySlippage(1000n, "min", NaN)).not.toThrow();
    expect(applySlippage(1000n, "min", NaN) > 0n).toBe(true);
  });

  it("floors an output on the min side", () => {
    expect(applySlippage(1000n, "min", 1)).toBe(990n);
  });

  it("ceils an input on the max side", () => {
    expect(applySlippage(1000n, "max", 1)).toBe(1010n);
  });

  it("clamps the tolerance before converting to bps", () => {
    // 150 clamps to SLIPPAGE_MAX (50) → bps 5000 → half the amount
    expect(applySlippage(1000n, "min", 150)).toBe(500n);
  });
});

describe("deadlineFromNow", () => {
  it("is strictly in the future even when the field was cleared", () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    expect(deadlineFromNow(0) > now).toBe(true);
  });

  it("adds the clamped minutes in seconds", () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const d = deadlineFromNow(20);
    expect(d >= now + 1200n).toBe(true);
    expect(d <= now + 1201n).toBe(true);
  });

  it("does not throw on a NaN deadline", () => {
    expect(() => deadlineFromNow(NaN)).not.toThrow();
  });
});

describe("formatNative", () => {
  it("appends the chain symbol", () => {
    expect(formatNative(1234.5, "LCAI").endsWith(" LCAI")).toBe(true);
  });

  it("never renders a dollar sign", () => {
    expect(formatNative(1234.5, "LCAI")).not.toContain("$");
  });

  it("renders zero rather than an empty string", () => {
    expect(formatNative(0, "LCAI")).toBe("0 LCAI");
  });

  it("survives a missing amount", () => {
    expect(formatNative(undefined, "LCAI")).toBe("0 LCAI");
  });

  it("passes Intl options through", () => {
    const compact = formatNative(1_500_000, "LCAI", { notation: "compact" });
    expect(compact).not.toBe(formatNative(1_500_000, "LCAI"));
    expect(compact).not.toContain("$");
  });
});

describe("minimum received (the number the transaction is guaranteed to honour)", () => {
  // The whole point of plan 010: the enforced floor is applySlippage applied to
  // the amount the UI displayed, so it must equal that amount reduced by
  // exactly the tolerance and nothing else.
  it("reduces the displayed amount by exactly the tolerance", () => {
    expect(applySlippage(1_000_000n, "min", 2.5)).toBe(975_000n);
  });

  // A user who sets 0% is asking for "no slippage at all", which would make
  // every trade revert on any concurrent activity. clampSlippage floors it at
  // SLIPPAGE_MIN (0.1%), so the floor is 99.9%, not 100%. Deliberate.
  it("clamps a zero tolerance up to SLIPPAGE_MIN rather than enforcing the exact quote", () => {
    expect(clampSlippage(0)).toBe(SLIPPAGE_MIN);
    expect(applySlippage(1_000_000n, "min", 0)).toBe(999_000n);
  });

  it("floors at half the displayed amount at the maximum tolerance", () => {
    expect(applySlippage(1_000_000n, "min", SLIPPAGE_MAX)).toBe(500_000n);
  });

  // Exact-tokens paths anchor a maximum cost instead of a minimum output.
  it("caps the displayed cost by exactly the tolerance on the max side", () => {
    expect(applySlippage(1_000_000n, "max", 2.5)).toBe(1_025_000n);
  });
});

describe("priceImpactBps", () => {
  const SPOT = 10n ** 15n; // 0.001 native per token, 1e18-scaled
  const ONE_TOKEN_UNIT = 10n ** 18n;

  it("is zero for a trade that executes at spot", () => {
    expect(priceImpactBps(SPOT, ONE_TOKEN_UNIT, SPOT)).toBe(0);
  });

  it("reports a curve-moving buy as its full deviation", () => {
    // execution price 10% above spot → 1000 bps
    expect(priceImpactBps(11n * 10n ** 14n, ONE_TOKEN_UNIT, SPOT)).toBe(1000);
  });

  it("is symmetric for a sell that executes below spot", () => {
    expect(priceImpactBps(9n * 10n ** 14n, ONE_TOKEN_UNIT, SPOT)).toBe(1000);
  });

  it("returns undefined rather than dividing by zero", () => {
    expect(priceImpactBps(SPOT, 0n, SPOT)).toBeUndefined();
    expect(priceImpactBps(SPOT, ONE_TOKEN_UNIT, 0n)).toBeUndefined();
  });
});

describe("isQuoteStale", () => {
  // Fixed clock: a real Date.now() would make the boundary case flaky.
  const NOW = 1_800_000_000_000;

  it("rejects a quote older than the threshold", () => {
    expect(isQuoteStale(NOW - QUOTE_MAX_AGE_MS - 1, NOW)).toBe(true);
  });

  it("accepts a quote exactly at the threshold", () => {
    expect(isQuoteStale(NOW - QUOTE_MAX_AGE_MS, NOW)).toBe(false);
  });

  // TanStack Query reports dataUpdatedAt === 0 before the first success; that
  // must never count as a fresh quote.
  it("treats a never-fetched quote as stale", () => {
    expect(isQuoteStale(0, NOW)).toBe(true);
  });
});
