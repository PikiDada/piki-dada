import { io, Socket } from "socket.io-client";
import { useAuthStore } from "./auth-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  const { accessToken } = useAuthStore.getState();
  console.log("🔌 Initializing Socket.IO connection to:", API_URL);
  console.log("🔌 Access token:", accessToken ? "✓ present" : "✗ missing");

  socket = io(API_URL, { auth: { token: accessToken } });

  socket.on("connect", () => {
    console.log("🔌 Socket.IO connected! ID:", socket?.id);
  });

  socket.on("connect_error", (err) => {
    console.error("🔌 Socket.IO connection error:", err);
  });

  socket.on("disconnect", (reason) => {
    console.log("🔌 Socket.IO disconnected:", reason);
  });

  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
