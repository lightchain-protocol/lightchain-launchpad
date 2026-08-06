/**
 * Pure OHLCV bucket math — no `ponder:*` virtual-module imports, so this is
 * directly unit-testable. `candles.ts` drives these against the DB.
 *
 * Buckets are only ever updated forward, so an error here corrupts chart
 * history permanently and silently.
 */

export const CANDLE_INTERVALS = [60, 300, 900, 3600, 14400, 86400] as const;

export interface CandleState {
  high: bigint;
  low: bigint;
  close: bigint;
  volume: bigint;
  trades: number;
}

/** Floor `ts` (unix seconds) to the start of its `interval`-second bucket. */
export function bucketStartFor(ts: bigint, interval: number): bigint {
  const iv = BigInt(interval);
  return (ts / iv) * iv;
}

/** The row written when a trade opens a fresh bucket. */
export function newCandle(priceX18: bigint, ethAmount: bigint): CandleState & { open: bigint } {
  return {
    open: priceX18,
    high: priceX18,
    low: priceX18,
    close: priceX18,
    volume: ethAmount,
    trades: 1,
  };
}

/** Merge a trade into an existing bucket. `open` is never touched. */
export function mergeCandle(
  row: CandleState,
  priceX18: bigint,
  ethAmount: bigint,
): CandleState {
  return {
    high: row.high > priceX18 ? row.high : priceX18,
    low: row.low < priceX18 ? row.low : priceX18,
    close: priceX18,
    volume: row.volume + ethAmount,
    trades: row.trades + 1,
  };
}
