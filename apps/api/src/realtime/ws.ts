/**
 * Fastify plugin that attaches a socket.io Server to the underlying http
 * server and hooks it into the realtime `registry`. Clients connect with a
 * standard socket.io client and join one or more rooms by emitting
 * `subscribe`; the indexer-driven pg-listener fans NOTIFYs into those rooms.
 *
 * Room scheme (must match `pg-listener.ts`):
 *   - `token:<address>`     trade / token:update / token:graduated for one token
 *   - `trades:all`          every trade across every token
 *   - `tokens:new`          new launches
 *   - `tokens:graduated`    graduations
 *   - `status`              indexer sync ticks
 */
import type { FastifyPluginAsync } from "fastify";
import { Server as IOServer } from "socket.io";

import { config } from "../config.js";
import { registry } from "./registry.js";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

const STATIC_ROOMS = new Set(["trades:all", "tokens:new", "tokens:graduated", "status"]);

function isValidRoom(room: unknown): room is string {
  if (typeof room !== "string") return false;
  if (STATIC_ROOMS.has(room)) return true;
  if (room.startsWith("token:")) return ADDRESS_RE.test(room.slice("token:".length));
  return false;
}

function normalizeRooms(input: unknown): string[] {
  const list = Array.isArray(input) ? input : [input];
  const out: string[] = [];
  for (const r of list) {
    if (!isValidRoom(r)) continue;
    out.push(r.startsWith("token:") ? `token:${r.slice("token:".length).toLowerCase()}` : r);
  }
  return out;
}

const corsOrigin = (): true | string[] =>
  config.CORS_ORIGIN === "*" ? true : config.CORS_ORIGIN.split(",").map((s) => s.trim());

const plugin: FastifyPluginAsync = async (app) => {
  const io = new IOServer(app.server, {
    cors: { origin: corsOrigin(), credentials: true },
    serveClient: false,
  });

  registry.attach(io);

  io.on("connection", (socket) => {
    app.log.debug({ id: socket.id }, "ws client connected");

    socket.on("subscribe", (raw: unknown, ack?: (resp: { joined: string[] }) => void) => {
      const rooms = normalizeRooms(raw);
      for (const r of rooms) void socket.join(r);
      if (typeof ack === "function") ack({ joined: rooms });
    });

    socket.on("unsubscribe", (raw: unknown, ack?: (resp: { left: string[] }) => void) => {
      const rooms = normalizeRooms(raw);
      for (const r of rooms) void socket.leave(r);
      if (typeof ack === "function") ack({ left: rooms });
    });

    socket.on("disconnect", (reason) => {
      app.log.debug({ id: socket.id, reason }, "ws client disconnected");
    });
  });

  app.addHook("onClose", async () => {
    registry.detach();
    await io.close();
  });
};

export default plugin;
