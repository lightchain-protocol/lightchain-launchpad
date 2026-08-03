/**
 * Single long-lived Postgres connection that LISTENs on `lcai:*` channels and
 * fans incoming NOTIFY payloads into the realtime registry, which broadcasts
 * to socket.io rooms.
 *
 * Uses `postgres-js` built-in `sql.listen(channel, cb)`. The library handles
 * connection recovery; when the underlying socket drops, postgres-js will
 * re-establish and the subscription resumes.
 */
import postgres from "postgres";

import { registry } from "./registry.js";
import type { MetadataResolver } from "./metadata-resolver.js";

export interface ListenerHandle {
  close(): Promise<void>;
}

type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

const CHANNELS = [
  "lcai:trade",
  "lcai:token:new",
  "lcai:token:graduated",
  "lcai:token:update",
  "lcai:status",
  "lcai:metadata:pending",
] as const;

function dispatch(channel: string, payloadRaw: string, log: Logger, resolver: MetadataResolver | undefined): void {
  let payload: unknown;
  try {
    payload = JSON.parse(payloadRaw);
  } catch (err) {
    log.warn({ err, channel }, "ignored malformed notify payload");
    return;
  }

  switch (channel) {
    case "lcai:trade": {
      const p = payload as { token?: string };
      if (!p?.token) return;
      const token = p.token.toLowerCase();
      registry.emit(`token:${token}`, "trade", payload);
      registry.emit("trades:all", "trade", payload);
      return;
    }
    case "lcai:token:new":
      registry.emit("tokens:new", "token:new", payload);
      return;
    case "lcai:token:graduated": {
      const p = payload as { token?: string };
      if (p?.token) registry.emit(`token:${p.token.toLowerCase()}`, "token:graduated", payload);
      registry.emit("tokens:graduated", "token:graduated", payload);
      return;
    }
    case "lcai:token:update": {
      const p = payload as { address?: string };
      if (p?.address) registry.emit(`token:${p.address.toLowerCase()}`, "token:update", payload);
      return;
    }
    case "lcai:status":
      registry.emit("status", "status", payload);
      return;
    case "lcai:metadata:pending": {
      const p = payload as { token?: string };
      if (p?.token && resolver) void resolver.resolveNow(p.token);
      return;
    }
    default:
      return;
  }
}

export async function startPgListener(
  connectionString: string,
  log: Logger,
  resolver?: MetadataResolver,
): Promise<ListenerHandle> {
  // `max:1` pins LISTEN to a single dedicated connection so the subscription
  // doesn't move between pooled connections.
  const sql = postgres(connectionString, { max: 1 });

  const handles = await Promise.all(
    CHANNELS.map((ch) => sql.listen(ch, (payloadRaw: string) => dispatch(ch, payloadRaw, log, resolver))),
  );

  log.info({ channels: CHANNELS }, "pg listener attached");

  return {
    async close(): Promise<void> {
      for (const h of handles) {
        try {
          await h.unlisten();
        } catch {
          /* ignore */
        }
      }
      try {
        await sql.end({ timeout: 5 });
      } catch {
        /* ignore */
      }
    },
  };
}
