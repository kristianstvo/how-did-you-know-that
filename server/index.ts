// Dumb relay server (spec 05): rooms, message forwarding, nothing else.
// No game logic lives here — the host client's browser is authoritative.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import { ROOM_CODE_LEN } from "../shared/protocol.ts";

const PORT = Number(process.env.PORT ?? 3000);
const CLIENT_DIST = fileURLToPath(new URL("../client/dist", import.meta.url));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const httpServer = createServer(async (req, res) => {
  // Static file serving for the built client; SPA fallback to index.html.
  try {
    const urlPath = (req.url ?? "/").split("?")[0].split("#")[0];
    let filePath = normalize(join(CLIENT_DIST, urlPath === "/" ? "index.html" : urlPath));
    if (!filePath.startsWith(normalize(CLIENT_DIST))) {
      res.writeHead(403).end();
      return;
    }
    try {
      const s = await stat(filePath);
      if (s.isDirectory()) filePath = join(filePath, "index.html");
    } catch {
      filePath = join(CLIENT_DIST, "index.html");
    }
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Client build not found. Run: npm run build");
  }
});

const io = new Server(httpServer, { cors: { origin: "*" } });

interface Room {
  code: string;
  hostSocketId: string;
  memberSocketIds: Set<string>; // includes host
}

const rooms = new Map<string, Room>();
const socketRoom = new Map<string, string>(); // socketId -> room code

// Unambiguous alphabet (no O/0, I/1) for shout-across-the-room codes.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newRoomCode(): string {
  for (;;) {
    let code = "";
    for (let i = 0; i < ROOM_CODE_LEN; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
}

io.on("connection", (socket: Socket) => {
  socket.on("createRoom", (cb: (res: { code: string }) => void) => {
    if (typeof cb !== "function") return;
    const code = newRoomCode();
    rooms.set(code, { code, hostSocketId: socket.id, memberSocketIds: new Set([socket.id]) });
    socketRoom.set(socket.id, code);
    socket.join(code);
    cb({ code });
  });

  socket.on("join", ({ code, name, avatar }: { code: string; name: string; avatar?: string }, cb?: (res: { ok: boolean; error?: string }) => void) => {
    const room = rooms.get(String(code ?? "").toUpperCase());
    if (!room) {
      cb?.({ ok: false, error: "Room not found. Check the code." });
      return;
    }
    room.memberSocketIds.add(socket.id);
    socketRoom.set(socket.id, room.code);
    socket.join(room.code);
    cb?.({ ok: true });
    // Host validates the join (duplicate names, capacity, rejoin) and replies
    // via toPlayer with "joined" or "joinRejected".
    io.to(room.hostSocketId).emit("joinRequest", { socketId: socket.id, name: String(name ?? ""), avatar: String(avatar ?? "") });
  });

  socket.on("intent", (payload: unknown) => {
    const code = socketRoom.get(socket.id);
    const room = code ? rooms.get(code) : undefined;
    if (!room || socket.id === room.hostSocketId) return;
    io.to(room.hostSocketId).emit("intent", { fromSocket: socket.id, payload });
  });

  // Host-only forwarding primitives.
  socket.on("toAll", ({ event, payload }: { event: string; payload: unknown }) => {
    const code = socketRoom.get(socket.id);
    const room = code ? rooms.get(code) : undefined;
    if (!room || socket.id !== room.hostSocketId) return;
    socket.to(room.code).emit(event, payload);
  });

  socket.on("toPlayer", ({ socketId, event, payload }: { socketId: string; event: string; payload: unknown }) => {
    const code = socketRoom.get(socket.id);
    const room = code ? rooms.get(code) : undefined;
    if (!room || socket.id !== room.hostSocketId) return;
    if (!room.memberSocketIds.has(socketId)) return;
    io.to(socketId).emit(event, payload);
  });

  socket.on("disconnect", () => {
    const code = socketRoom.get(socket.id);
    socketRoom.delete(socket.id);
    const room = code ? rooms.get(code) : undefined;
    if (!room) return;
    room.memberSocketIds.delete(socket.id);
    if (socket.id === room.hostSocketId) {
      // Host disconnect kills the session (spec 00, known limitation 2).
      io.to(room.code).emit("roomClosed");
      rooms.delete(room.code);
    } else {
      io.to(room.hostSocketId).emit("peerDisconnected", { socketId: socket.id });
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`How Did You Know That — relay listening on http://localhost:${PORT}`);
});
