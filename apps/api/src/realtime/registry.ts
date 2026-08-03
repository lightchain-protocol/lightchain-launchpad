/**
 * Realtime fan-out for WebSocket subscribers. The pg-listener calls
 * `registry.emit(room, event, payload)` when it receives a NOTIFY from the
 * indexer; the socket.io plugin (`realtime/ws.ts`) attaches the `io` instance
 * on boot, and from then on emits are delivered to every client that has
 * joined the room.
 *
 * Room names match the socket.io channel scheme the frontend uses:
 *   - `token:<address>`     (per-token events)
 *   - `trades:all`          (global trade feed)
 *   - `tokens:new`          (new launches)
 *   - `tokens:graduated`    (graduations)
 *   - `status`              (indexer sync ticks)
 *
 * Emits that arrive before the io server is attached are dropped — the
 * pg-listener only starts after the http server is up, so this is only a
 * concern in tests.
 */
import type { Server as IOServer } from "socket.io";

export class RealtimeRegistry {
  private io: IOServer | null = null;

  attach(io: IOServer): void {
    this.io = io;
  }

  detach(): void {
    this.io = null;
  }

  emit(room: string, event: string, data: unknown): void {
    if (!this.io) return;
    this.io.to(room).emit(event, data);
  }

  /**
   * Number of sockets currently joined to `room`, or the total number of
   * connected sockets when `room` is omitted.
   */
  async size(room?: string): Promise<number> {
    if (!this.io) return 0;
    if (room) {
      const sockets = await this.io.in(room).fetchSockets();
      return sockets.length;
    }
    return this.io.sockets.sockets.size;
  }
}

export const registry = new RealtimeRegistry();
