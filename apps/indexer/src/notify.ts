import { sql } from "ponder";

import "./lib/json.js"; // BigInt#toJSON patch

/**
 * Fire a Postgres NOTIFY in the same transaction as the surrounding handler's
 * writes. The API process holds a long-lived LISTEN connection that fans these
 * out to SSE subscribers; payloads are limited to ~8 KB by Postgres but every
 * shape we publish today is well under that.
 *
 * The channel name is namespaced `lcai:<name>` to avoid colliding with any
 * adapter / extension channels in shared Postgres environments.
 */
export type NotifyChannel =
  | "trade"
  | "token:new"
  | "token:graduated"
  | "token:update"
  | "status"
  | "metadata:pending";

type DbWithSql = { sql: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> } };

export async function notify(
  db: DbWithSql,
  channel: NotifyChannel,
  payload: unknown,
): Promise<void> {
  const fullChannel = `lcai:${channel}`;
  const json = JSON.stringify(payload);
  await db.sql.execute(sql`SELECT pg_notify(${fullChannel}, ${json})`);
}
