import { sql } from "ponder";

import "./lib/json.js"; // BigInt#toJSON patch
import { boundNotifyPayload } from "./lib/notify-payload.js";

/**
 * Fire a Postgres NOTIFY in the same transaction as the surrounding handler's
 * writes. The API process holds a long-lived LISTEN connection that fans these
 * out to SSE subscribers.
 *
 * Postgres rejects a payload of 8000 bytes or more, and because this runs inside
 * the handler's transaction that error would abort the write and take the
 * indexer process down with it. `name`, `symbol` and `metadataURI` are unbounded
 * on-chain strings that reach these payloads verbatim, so every payload goes
 * through `boundNotifyPayload`, which degrades an oversized one to a routing
 * stub and never throws.
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
  const json = boundNotifyPayload(channel, payload);
  await db.sql.execute(sql`SELECT pg_notify(${fullChannel}, ${json})`);
}
