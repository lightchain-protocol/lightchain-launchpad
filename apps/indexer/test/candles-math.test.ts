import { describe, expect, it } from "vitest";

import {
  bucketStartFor,
  CANDLE_INTERVALS,
  mergeCandle,
  newCandle,
  type CandleState,
} from "../src/lib/candles-math.js";

const PRICE = 100n;
const VOL = 5n;

describe("CANDLE_INTERVALS", () => {
  // Exact, not `>= 6`: adding an interval should be a conscious change that
  // makes this fail.
  it("is the standard set, in ascending order", () => {
    expect([...CANDLE_INTERVALS]).toEqual([60, 300, 900, 3600, 14400, 86400]);
  });
});

describe("bucketStartFor", () => {
  const ts = 1_700_000_123n;

  it("floors to the interval and never exceeds the timestamp", () => {
    for (const interval of CANDLE_INTERVALS) {
      const b = bucketStartFor(ts, interval);
      expect(b).toBe((ts / BigInt(interval)) * BigInt(interval));
      expect(b <= ts).toBe(true);
      expect(b % BigInt(interval)).toBe(0n);
    }
  });

  it("leaves an exact boundary untouched", () => {
    expect(bucketStartFor(86_400n * 19_675n, 86400)).toBe(86_400n * 19_675n);
    expect(bucketStartFor(60n * 5n, 60)).toBe(300n);
  });

  it("floors the second before a boundary into the previous bucket", () => {
    expect(bucketStartFor(119n, 60)).toBe(60n);
    expect(bucketStartFor(120n, 60)).toBe(120n);
  });
});

describe("newCandle", () => {
  it("opens all four prices at the trade price", () => {
    const c = newCandle(PRICE, VOL);
    expect(c.open).toBe(PRICE);
    expect(c.high).toBe(PRICE);
    expect(c.low).toBe(PRICE);
    expect(c.close).toBe(PRICE);
    expect(c.volume).toBe(VOL);
    expect(c.trades).toBe(1);
  });
});

describe("mergeCandle", () => {
  const existing: CandleState = { high: 100n, low: 50n, close: 80n, volume: 10n, trades: 3 };

  it("raises the high when the new price is above it", () => {
    expect(mergeCandle(existing, 150n, VOL).high).toBe(150n);
  });

  it("keeps the high when the new price is below it", () => {
    expect(mergeCandle(existing, 90n, VOL).high).toBe(100n);
  });

  it("lowers the low when the new price is below it", () => {
    expect(mergeCandle(existing, 10n, VOL).low).toBe(10n);
  });

  it("keeps the low when the new price is above it", () => {
    expect(mergeCandle(existing, 90n, VOL).low).toBe(50n);
  });

  it("always overwrites close with the latest price", () => {
    expect(mergeCandle(existing, 150n, VOL).close).toBe(150n);
    expect(mergeCandle(existing, 10n, VOL).close).toBe(10n);
    expect(mergeCandle(existing, 80n, VOL).close).toBe(80n);
  });

  it("accumulates volume and trade count", () => {
    const m = mergeCandle(existing, 90n, VOL);
    expect(m.volume).toBe(existing.volume + VOL);
    expect(m.trades).toBe(existing.trades + 1);
  });

  it("does not mutate the existing row", () => {
    const before = { ...existing };
    mergeCandle(existing, 999n, 999n);
    expect(existing).toEqual(before);
  });
});
