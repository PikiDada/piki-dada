import { io, Socket } from "socket.io-client";
import { useAuthStore } from "./auth-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  const { accessToken } = useAuthStore.getState();
  socket = io(API_URL, { auth: { token: accessToken } });
  socket.on("connect_error", (err) => {
    console.error("Socket.IO connection error:", err.message);
  });
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
