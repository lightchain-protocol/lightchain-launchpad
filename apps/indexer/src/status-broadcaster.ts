/**
 * Periodic status broadcaster: reads the indexer's highest committed block,
 * compares against the RPC head, and `pg_notify`s `lcai:status` so the API's
 * SSE subscribers can show a "syncing…" indicator.
 *
 * Runs in the indexer process (alongside Ponder) because (a) we already have
 * Postgres + the RPC URL here, and (b) the indexer is the only process that
 * knows when it's caught up.
 */
import postgres from "postgres";
import { createPublicClient, http } from "viem";

const DATABASE_URL = process.env.DATABASE_URL!;
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const INTERVAL_MS = Number(process.env.STATUS_BROADCAST_MS ?? "5000");

let started = false;

interface StatusPayload {
  indexedBlock: string;
  headBlock: string | null;
  lag: number | null;
  isSynced: boolean | null;
  chainId: number | null;
}

export function startStatusBroadcaster(): void {
  if (started) return;
  started = true;

  const sql = postgres(DATABASE_URL, { max: 1 });
  const client = createPublicClient({ transport: http(RPC_URL) });

  const tick = async (): Promise<void> => {
    try {
      const indexedRows = await sql<{ b: string | null }[]>`
        select greatest(
          coalesce((select max(created_at_block) from tokens), 0),
          coalesce((select max(block_number)   from trades),  0),
          coalesce((select max(block_number)   from graduations), 0)
        ) as b
      `.catch(() => [] as { b: string | null }[]);
      const indexed = BigInt(indexedRows[0]?.b ?? 0);

      let head: bigint | null = null;
      let chainId: number | null = null;
      try {
        head = await client.getBlockNumber();
        chainId = await client.getChainId();
      } catch {
        /* RPC unreachable — report indexed-only */
      }

      const lag = head != null ? Number(head - indexed) : null;
      const payload: StatusPayload = {
        indexedBlock: indexed.toString(),
        headBlock: head?.toString() ?? null,
        lag,
        isSynced: lag != null ? lag <= 2 : null,
        chainId,
      };

      await sql`select pg_notify('lcai:status', ${JSON.stringify(payload)})`;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[status-broadcaster] tick failed:", err);
    }
  };

  // Fire one immediately, then on interval.
  void tick();
  setInterval(() => void tick(), INTERVAL_MS);
}
