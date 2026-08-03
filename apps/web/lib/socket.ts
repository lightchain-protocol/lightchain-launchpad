import { io, Socket } from "socket.io-client";

/**
 * Singleton socket.io-client against the Fastify+socket.io backend.
 * The backend exposes rooms — see `backend/packages/api/src/realtime/ws.ts`:
 *   - `token:<address>`     per-token (trade, token:update, token:graduated)
 *   - `trades:all`          every trade across every token
 *   - `tokens:new`          new launches
 *   - `tokens:graduated`    graduations
 *   - `status`              indexer sync ticks
 *
 * Reads `NEXT_PUBLIC_WEBSCOKET_URL` (typo preserved across the codebase),
 * falling back to `NEXT_PUBLIC_API_URL` with the `/v1` path suffix trimmed so
 * the socket.io transport hits the http server root.
 */
let socket: Socket | null = null;

/** REST is under /v1; socket.io is on the server root (default namespace only). */
function normalizeSocketOrigin(url: string): string {
  return url
    .replace(/^ws:/i, "http:")
    .replace(/^wss:/i, "https:")
    .replace(/\/v1\/?$/, "")
    .replace(/\/+$/, "");
}

function defaultUrl(): string | undefined {
  const wsUrl = process.env.NEXT_PUBLIC_WEBSCOKET_URL;
  if (wsUrl) return normalizeSocketOrigin(wsUrl);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) return undefined;
  return normalizeSocketOrigin(apiUrl);
}

export const getSocket = (): Socket => {
  if (!socket) {
    socket = io(defaultUrl(), {
      transports: ["websocket"],
      autoConnect: true,
    });
  }
  return socket;
};
