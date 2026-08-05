import { describe, expect, it } from "vitest";

import {
  applySlippage,
  clampDeadline,
  clampSlippage,
  DEADLINE_DEFAULT,
  DEADLINE_MAX,
  DEADLINE_MIN,
  deadlineFromNow,
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
