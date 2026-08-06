import { candle as candles } from "ponder:schema";

// The bucket + merge math lives in a sibling with no `ponder:*` imports so it
// can be unit-tested; re-exported here so existing import sites are unchanged.
export { CANDLE_INTERVALS } from "./candles-math.js";
import { bucketStartFor, CANDLE_INTERVALS, mergeCandle, newCandle } from "./candles-math.js";

type Db = {
  insert: (table: typeof candles) => {
    values: (row: {
      token: `0x${string}`;
      interval: number;
      bucketStart: bigint;
      open: bigint;
      high: bigint;
      low: bigint;
      close: bigint;
      volume: bigint;
      trades: number;
    }) => {
      onConflictDoUpdate: (fn: (row: {
        high: bigint;
        low: bigint;
        close: bigint;
        volume: bigint;
        trades: number;
      }) => {
        high: bigint;
        low: bigint;
        close: bigint;
        volume: bigint;
        trades: number;
      }) => Promise<unknown>;
    };
  };
};

export async function upsertCandles(
  db: Db,
  token: `0x${string}`,
  priceX18: bigint,
  ethAmount: bigint,
  ts: bigint,
): Promise<void> {
  for (const interval of CANDLE_INTERVALS) {
    await db
      .insert(candles)
      .values({
        token,
        interval,
        bucketStart: bucketStartFor(ts, interval),
        ...newCandle(priceX18, ethAmount),
      })
      .onConflictDoUpdate((row) => mergeCandle(row, priceX18, ethAmount));
  }
}
