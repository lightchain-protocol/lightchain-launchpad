/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useRef } from "react";

import { getSocket } from "@/lib/socket";

/**
 * Subscribe to a single event from the socket.io server. Use
 * `useRealtimeRoom` to join one or more rooms first; events bubble up to all
 * sockets that have joined the room.
 */
export function useSocketIOEvent<T>(
  eventCallback: (data: T) => void,
  { eventName }: { eventName: string },
  deps: readonly unknown[],
) {
  const socket = getSocket();
  const callbackRef = useRef(eventCallback);
  callbackRef.current = eventCallback;

  useEffect(() => {
    const handler = (data: T) => callbackRef.current(data);
    socket.on(eventName, handler);
    return () => {
      socket.off(eventName, handler);
    };
  }, [eventName, socket, ...deps]);

  return socket;
}

/**
 * Join one or more socket.io rooms for the lifetime of the component.
 * Re-runs when the room set changes (string identity in the deps array).
 * The backend exposes:
 *   - `token:<address>`     per-token events (trade, token:update, token:graduated)
 *   - `trades:all`          global trade feed
 *   - `tokens:new`          new launches
 *   - `tokens:graduated`    graduations
 *   - `status`              indexer sync ticks
 */
export function useRealtimeRoom(rooms: string | string[]) {
  const socket = getSocket();
  const list = Array.isArray(rooms) ? rooms : [rooms];
  const key = list.join("|");

  useEffect(() => {
    if (list.length === 0) return;
    const join = () => socket.emit("subscribe", list);
    join();
    socket.on("connect", join);
    return () => {
      socket.off("connect", join);
      socket.emit("unsubscribe", list);
    };
  }, [key, socket]);

  return socket;
}
