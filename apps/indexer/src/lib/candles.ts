import { sql } from "ponder";
import { candle as candles } from "ponder:schema";

export const CANDLE_INTERVALS = [60, 300, 900, 3600, 14400, 86400] as const;

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
    const iv = BigInt(interval);
    const bucketStart = (ts / iv) * iv;
    await db
      .insert(candles)
      .values({
        token,
        interval,
        bucketStart,
        open: priceX18,
        high: priceX18,
        low: priceX18,
        close: priceX18,
        volume: ethAmount,
        trades: 1,
      })
      .onConflictDoUpdate((row) => ({
        high: row.high > priceX18 ? row.high : priceX18,
        low: row.low < priceX18 ? row.low : priceX18,
        close: priceX18,
        volume: row.volume + ethAmount,
        trades: row.trades + 1,
      }));
  }
}
