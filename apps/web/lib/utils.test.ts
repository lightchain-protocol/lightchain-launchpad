import { describe, expect, it } from "vitest";

import {
  applySlippage,
  clampDeadline,
  clampSlippage,
  DEADLINE_DEFAULT,
  DEADLINE_MAX,
  DEADLINE_MIN,
  deadlineFromNow,
  formatPrice,
  formatUsd,
  formatUsdPrice,
  isQuoteStale,
  lcaiUsdPrice,
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

// describe("minimum received (the number the transaction is guaranteed to honour)", () => {
//   // The whole point of plan 010: the enforced floor is applySlippage applied to
//   // the amount the UI displayed, so it must equal that amount reduced by
//   // exactly the tolerance and nothing else.
//   it("reduces the displayed amount by exactly the tolerance", () => {
//     expect(applySlippage(1_000_000n, "min", 2.5)).toBe(975_000n);
//   });

//   // A user who sets 0% is asking for "no slippage at all", which would make
//   // every trade revert on any concurrent activity. clampSlippage floors it at
//   // SLIPPAGE_MIN (0.1%), so the floor is 99.9%, not 100%. Deliberate.
//   it("clamps a zero tolerance up to SLIPPAGE_MIN rather than enforcing the exact quote", () => {
//     expect(clampSlippage(0)).toBe(SLIPPAGE_MIN);
//     expect(applySlippage(1_000_000n, "min", 0)).toBe(999_000n);
//   });

//   it("floors at half the displayed amount at the maximum tolerance", () => {
//     expect(applySlippage(1_000_000n, "min", SLIPPAGE_MAX)).toBe(500_000n);
//   });

//   // Exact-tokens paths anchor a maximum cost instead of a minimum output.
//   it("caps the displayed cost by exactly the tolerance on the max side", () => {
//     expect(applySlippage(1_000_000n, "max", 2.5)).toBe(1_025_000n);
//   });
// });

// describe("priceImpactBps", () => {
//   const SPOT = 10n ** 15n; // 0.001 native per token, 1e18-scaled
//   const ONE_TOKEN_UNIT = 10n ** 18n;

//   it("is zero for a trade that executes at spot", () => {
//     expect(priceImpactBps(SPOT, ONE_TOKEN_UNIT, SPOT)).toBe(0);
//   });

//   it("reports a curve-moving buy as its full deviation", () => {
//     // execution price 10% above spot → 1000 bps
//     expect(priceImpactBps(11n * 10n ** 14n, ONE_TOKEN_UNIT, SPOT)).toBe(1000);
//   });

//   it("is symmetric for a sell that executes below spot", () => {
//     expect(priceImpactBps(9n * 10n ** 14n, ONE_TOKEN_UNIT, SPOT)).toBe(1000);
//   });

//   it("returns undefined rather than dividing by zero", () => {
//     expect(priceImpactBps(SPOT, 0n, SPOT)).toBeUndefined();
//     expect(priceImpactBps(SPOT, ONE_TOKEN_UNIT, 0n)).toBeUndefined();
//   });
// });

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

describe("lcaiUsdPrice", () => {
  const LCAI = "0x9ca8530ca349c966fe9ef903df17a75b8a778927";
  const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const OTHER = "0x1111111111111111111111111111111111111111";

  // sqrt(1e-6) * 2**96 — a pool quoting 1e-6 of token1 per token0.
  const SQRT_1E_MINUS_6 = 79228162514264337593543950n;
  // sqrt(1e6) * 2**96 — the same price with the tokens the other way round.
  const SQRT_1E6 = 79228162514264337593543950336000n;

  const base = { lcai: LCAI, weth: WETH, ethUsd: 3000 };

  it("prices LCAI when it is token0", () => {
    // 1e-6 ETH per LCAI at $3000/ETH = $0.003
    expect(lcaiUsdPrice({ ...base, sqrtPriceX96: SQRT_1E_MINUS_6, token0: LCAI, token1: WETH })).toBeCloseTo(0.003, 12);
  });

  // The orientation is read from the pool, not assumed. If this inverted, every
  // "$" on the site would be off by ~10^9 and still look like a plausible number.
  it("inverts when LCAI is token1, giving the same price", () => {
    expect(lcaiUsdPrice({ ...base, sqrtPriceX96: SQRT_1E6, token0: WETH, token1: LCAI })).toBeCloseTo(0.003, 12);
  });

  it("matches addresses case-insensitively", () => {
    // Pools return checksummed addresses; config stores LCAI lowercased.
    expect(
      lcaiUsdPrice({
        ...base,
        sqrtPriceX96: SQRT_1E_MINUS_6,
        token0: LCAI.toUpperCase().replace("0X", "0x"),
        token1: WETH.toLowerCase(),
      })
    ).toBeCloseTo(0.003, 12);
  });

  it("refuses a pool that is not the LCAI/WETH pair", () => {
    expect(lcaiUsdPrice({ ...base, sqrtPriceX96: SQRT_1E_MINUS_6, token0: LCAI, token1: OTHER })).toBeUndefined();
    expect(lcaiUsdPrice({ ...base, sqrtPriceX96: SQRT_1E_MINUS_6, token0: OTHER, token1: WETH })).toBeUndefined();
  });

  it("refuses an uninitialised pool", () => {
    expect(lcaiUsdPrice({ ...base, sqrtPriceX96: 0n, token0: LCAI, token1: WETH })).toBeUndefined();
  });

  // Chainlink's `answer` is an int256 and reads 0 or negative when the feed is
  // unhealthy; that must not become a $0 market cap.
  it("refuses a non-positive ETH/USD answer", () => {
    const args = { sqrtPriceX96: SQRT_1E_MINUS_6, token0: LCAI, token1: WETH, lcai: LCAI, weth: WETH };
    expect(lcaiUsdPrice({ ...args, ethUsd: 0 })).toBeUndefined();
    expect(lcaiUsdPrice({ ...args, ethUsd: -1 })).toBeUndefined();
    expect(lcaiUsdPrice({ ...args, ethUsd: NaN })).toBeUndefined();
  });
});

describe("formatUsd", () => {
  // The reason this helper exists: an unknown price renders as an em dash, not
  // as a number derived from a placeholder rate.
  it("renders an em dash while the price is unknown", () => {
    expect(formatUsd(1234, undefined)).toBe("—");
    expect(formatUsd(1234, NaN)).toBe("—");
  });

  it("renders an em dash for a non-finite amount", () => {
    expect(formatUsd(NaN, 2)).toBe("—");
  });

  it("multiplies the native amount by the price", () => {
    expect(formatUsd(1000, 0.003)).toBe("$3");
  });

  it("passes formatting options through", () => {
    expect(formatUsd(1_000_000, 2, { notation: "compact" })).toBe("$2M");
  });

  it("defaults compact notation to 2 fraction digits, not the general 4-digit default", () => {
    // 500123.456 * 0.024691358 ≈ 12348.7273 -- would render as the
    // needlessly precise "$12.3487K" under the general 4-digit default.
    expect(formatUsd(500123.456, 0.024691358, { notation: "compact" })).toBe("$12.35K");
  });

  it("still respects an explicit maximumFractionDigits override in compact mode", () => {
    expect(formatUsd(500123.456, 0.024691358, { notation: "compact", maximumFractionDigits: 4 })).toBe(
      "$12.3487K",
    );
  });
});

describe("formatPrice", () => {
  it("collapses a long zero run into a subscript count", () => {
    // 7 zeros after the point, then the significant digits.
    expect(formatPrice(0.0000000495)).toBe("0.0₇495");
  });

  it("subscripts a multi-digit zero count", () => {
    expect(formatPrice(1.2e-13)).toBe("0.0₁₂12");
  });

  it("leaves short zero runs as plain decimals", () => {
    // 3 zeros is still readable; collapsing it would be noise.
    expect(formatPrice(0.0001234)).toBe("0.0001234");
    expect(formatPrice(0.00123456)).toBe("0.001235");
  });

  it("switches to the subscript form at exactly 4 zeros", () => {
    expect(formatPrice(0.00001)).toBe("0.0₄1");
  });

  // toExponential rounds first, so 9.99e-8 becomes 1.00e-7 and the zero count
  // has to follow it. Multiplying by a power of ten would report 6 zeros and
  // print a value that does not exist.
  it("carries the exponent when rounding rolls over", () => {
    expect(formatPrice(9.999e-8, 3)).toBe("0.0₆1");
  });

  it("keeps significant digits, not decimal places", () => {
    expect(formatPrice(1.23456)).toBe("1.235");
    // 2 digits of 4.95e-8. It rounds down because the double nearest
    // 0.0000000495 is fractionally below it — the same reason this notation
    // exists rather than trusting the tail of a float.
    expect(formatPrice(0.0000000495, 2)).toBe("0.0₇49");
  });

  it("handles zero, negatives and non-finite values", () => {
    expect(formatPrice(0)).toBe("0");
    expect(formatPrice(-0.0000000495)).toBe("-0.0₇495");
    expect(formatPrice(NaN)).toBe("—");
    expect(formatPrice(Infinity)).toBe("—");
  });

  it("does not blow past Intl's 20 fraction-digit ceiling", () => {
    expect(() => formatPrice(1e21, 18)).not.toThrow();
  });
});

describe("formatUsdPrice", () => {
  it("uses the subscript form for a sub-cent price", () => {
    // 0.0000165 LCAI at $0.003 = $0.0000000495
    expect(formatUsdPrice(0.0000165, 0.003)).toBe("$0.0₇495");
  });

  it("renders an em dash while the price is unknown", () => {
    expect(formatUsdPrice(0.0000165, undefined)).toBe("—");
  });
});
