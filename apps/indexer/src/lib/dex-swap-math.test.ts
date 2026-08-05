import { describe, expect, it } from "vitest";

import { parseDexSwapAmounts, type PairMeta } from "./dex-swap-math.js";

const WAD = 10n ** 18n;

const meta = (sourceIsToken0: boolean): PairMeta => ({
  token: "0x1111111111111111111111111111111111111111",
  weth: "0x2222222222222222222222222222222222222222",
  sourceIsToken0,
});

// Distinct values on each side throughout: an implementation that swapped the
// token and native sides must not be able to pass by coincidence.

describe("parseDexSwapAmounts — sourceIsToken0: true", () => {
  const m = meta(true);

  it("decodes a buy (native in as token1, token out as token0)", () => {
    const r = parseDexSwapAmounts(m, 0n, 3n * WAD, 7n * WAD, 0n);
    expect(r).not.toBeNull();
    expect(r!.isBuy).toBe(true);
    expect(r!.ethAmount).toBe(3n * WAD);
    expect(r!.tokenAmount).toBe(7n * WAD);
  });

  it("decodes a sell (token in as token0, native out as token1)", () => {
    const r = parseDexSwapAmounts(m, 7n * WAD, 0n, 0n, 3n * WAD);
    expect(r).not.toBeNull();
    expect(r!.isBuy).toBe(false);
    expect(r!.ethAmount).toBe(3n * WAD);
    expect(r!.tokenAmount).toBe(7n * WAD);
  });

  it("prices a buy as native per token", () => {
    // 1 native in, 2 tokens out → 0.5 native per token
    const r = parseDexSwapAmounts(m, 0n, 1n * WAD, 2n * WAD, 0n);
    expect(r!.priceX18).toBe(5n * 10n ** 17n);
  });

  it("prices a sell as native per token", () => {
    // 4 tokens in, 1 native out → 0.25 native per token
    const r = parseDexSwapAmounts(m, 4n * WAD, 0n, 0n, 1n * WAD);
    expect(r!.priceX18).toBe(25n * 10n ** 16n);
  });
});

describe("parseDexSwapAmounts — sourceIsToken0: false", () => {
  const m = meta(false);

  it("decodes a buy (native in as token0, token out as token1)", () => {
    const r = parseDexSwapAmounts(m, 3n * WAD, 0n, 0n, 7n * WAD);
    expect(r).not.toBeNull();
    expect(r!.isBuy).toBe(true);
    expect(r!.ethAmount).toBe(3n * WAD);
    expect(r!.tokenAmount).toBe(7n * WAD);
  });

  it("decodes a sell (token in as token1, native out as token0)", () => {
    const r = parseDexSwapAmounts(m, 0n, 7n * WAD, 3n * WAD, 0n);
    expect(r).not.toBeNull();
    expect(r!.isBuy).toBe(false);
    expect(r!.ethAmount).toBe(3n * WAD);
    expect(r!.tokenAmount).toBe(7n * WAD);
  });

  it("prices a buy as native per token", () => {
    const r = parseDexSwapAmounts(m, 1n * WAD, 0n, 0n, 2n * WAD);
    expect(r!.priceX18).toBe(5n * 10n ** 17n);
  });

  it("prices a sell as native per token", () => {
    const r = parseDexSwapAmounts(m, 0n, 4n * WAD, 1n * WAD, 0n);
    expect(r!.priceX18).toBe(25n * 10n ** 16n);
  });
});

describe("parseDexSwapAmounts — orientation is not symmetric", () => {
  it("reads the same event differently for each orientation", () => {
    // amount0In = 3, amount1Out = 7. With sourceIsToken0 the source token went
    // IN (a sell of 3); with token1 the source token came OUT (a buy of 7).
    const asToken0 = parseDexSwapAmounts(meta(true), 3n * WAD, 0n, 0n, 7n * WAD);
    const asToken1 = parseDexSwapAmounts(meta(false), 3n * WAD, 0n, 0n, 7n * WAD);
    expect(asToken0!.isBuy).toBe(false);
    expect(asToken1!.isBuy).toBe(true);
    expect(asToken0!.tokenAmount).toBe(3n * WAD);
    expect(asToken1!.tokenAmount).toBe(7n * WAD);
    expect(asToken0!.priceX18).not.toBe(asToken1!.priceX18);
  });
});

describe("parseDexSwapAmounts — non-trades", () => {
  it("returns null when all amounts are zero", () => {
    expect(parseDexSwapAmounts(meta(true), 0n, 0n, 0n, 0n)).toBeNull();
    expect(parseDexSwapAmounts(meta(false), 0n, 0n, 0n, 0n)).toBeNull();
  });

  it("returns null when the token amount is zero", () => {
    // native in, no token out
    expect(parseDexSwapAmounts(meta(true), 0n, 1n * WAD, 0n, 0n)).toBeNull();
    expect(parseDexSwapAmounts(meta(false), 1n * WAD, 0n, 0n, 0n)).toBeNull();
  });

  it("truncates the price rather than rounding", () => {
    // 1 wei native for 3 wei of token → 1e18/3 floored
    const r = parseDexSwapAmounts(meta(true), 0n, 1n, 3n, 0n);
    expect(r!.priceX18).toBe(WAD / 3n);
    expect(r!.priceX18 * 3n < WAD).toBe(true);
  });
});
