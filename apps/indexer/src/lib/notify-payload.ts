/**
 * Size guard for `pg_notify` payloads. No `ponder:*` imports, so it is directly
 * unit-testable.
 *
 * PostgreSQL rejects a NOTIFY payload of 8000 bytes or more with
 * `payload string too long`. The notify runs inside the same transaction as the
 * handler's row writes, so that error aborts the transaction, surfaces as an
 * indexing-function error, and Ponder exits the process. Since `name`, `symbol`
 * and `metadataURI` are unbounded on-chain strings copied verbatim into the
 * realtime DTOs, a single hostile launch can take the indexer down.
 *
 * The realtime payload is only an optimisation — the row is already committed —
 * so an oversized message degrades to a routing stub instead of being dropped or
 * throwing. Clients that receive `truncated: true` should refetch over REST.
 */

/** Postgres' hard limit is 8000; leave room for the channel name and framing. */
export const NOTIFY_MAX_BYTES = 7500;

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/**
 * The smallest payload that still routes. `apps/api/src/realtime/pg-listener.ts`
 * picks a socket.io room by reading one key per channel — `token` for
 * `trade` / `token:graduated` / `metadata:pending`, `address` for `token:update`
 * — and silently drops a payload that is missing it. `token:new` and `status`
 * are forwarded whole and read no key, but `token:new` keeps a nested address so
 * a client can still identify the launch.
 */
function degrade(channel: string, payload: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { truncated: true };
  const p = asRecord(payload);
  if (!p) return out;

  if (channel === "token:new") {
    const address = str(asRecord(p.token)?.address);
    if (address) out.token = { address };
    return out;
  }

  const token = str(p.token);
  const address = str(p.address);
  if (token) out.token = token;
  if (address) out.address = address;
  return out;
}

/**
 * JSON for `pg_notify`, guaranteed to be at most `NOTIFY_MAX_BYTES` bytes.
 *
 * Never throws: a payload `JSON.stringify` rejects (circular reference, a BigInt
 * without the `lib/json.ts` patch applied) degrades like an oversized one. A
 * throw here would kill the indexer, which is the whole failure being fixed.
 */
export function boundNotifyPayload(channel: string, payload: unknown): string {
  let json: string | undefined;
  try {
    json = JSON.stringify(payload);
  } catch {
    json = undefined;
  }

  // `undefined` payloads, and values whose toJSON returns undefined, stringify
  // to `undefined` rather than a string.
  if (json !== undefined && Buffer.byteLength(json, "utf8") <= NOTIFY_MAX_BYTES) {
    return json;
  }

  const stub = JSON.stringify(degrade(channel, payload));
  // Addresses are 42 chars, so the stub cannot realistically exceed the cap —
  // but never hand pg_notify something unbounded on the strength of "cannot".
  return Buffer.byteLength(stub, "utf8") <= NOTIFY_MAX_BYTES ? stub : '{"truncated":true}';
}
