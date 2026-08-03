import "./lib/json.js"; // BigInt#toJSON patch — must run before any serialization

import { config } from "./config.js";
import { closeDb } from "./db/client.js";
import { buildServer } from "./server.js";
import { startPgListener, type ListenerHandle } from "./realtime/pg-listener.js";
import { MetadataResolver } from "./realtime/metadata-resolver.js";

async function main(): Promise<void> {
  const app = await buildServer();

  // In-process metadata resolver. Single replica per deploy; uses FOR UPDATE
  // SKIP LOCKED so it's safe even if more than one instance ever runs.
  // Constructed before the listener so it can be wired as the
  // `lcai:metadata:pending` handler — fresh launches resolve in tens of ms
  // instead of waiting for the next sweep.
  const resolver = new MetadataResolver(app.log);
  resolver.start();

  // Long-lived LISTEN client — receives `lcai:*` notifications from the indexer,
  // fans realtime events into the socket.io registry, and wakes the resolver on
  // `lcai:metadata:pending`.
  const listener: ListenerHandle = await startPgListener(config.DATABASE_URL, app.log, resolver);

  await app.listen({ port: config.PORT, host: config.HOST });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    resolver.stop();
    await listener.close().catch(() => undefined);
    await app.close().catch(() => undefined);
    await closeDb().catch(() => undefined);
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
