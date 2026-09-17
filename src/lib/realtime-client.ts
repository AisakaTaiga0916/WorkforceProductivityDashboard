"use client";

import { io, type Socket } from "socket.io-client";

let socketSingleton: Socket | null = null;

export function getRealtimeSocket() {
  if (socketSingleton) return socketSingleton;
  socketSingleton = io({
    path: "/socket.io",
    transports: ["websocket", "polling"],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 8_000,
    withCredentials: true,
  });
  return socketSingleton;
}
