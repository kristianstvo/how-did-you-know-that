// Dumb relay server (spec 05): rooms, message forwarding, nothing else.
// No game logic lives here — the host client's browser is authoritative.
import { randomBytes } from "node:crypto";
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
  /** null while the host's phone is away (locked screen, app switch, signal). */
  hostSocketId: string | null;
  /** Proves a reconnecting socket is the same host (the engine lives in its page). */
  hostKey: string;
  memberSocketIds: Set<string>; // includes host
  /** Messages for the host that arrived while it was away, delivered on resume. */
  pending: { event: string; payload: unknown }[];
  closeTimer: ReturnType<typeof setTimeout> | null;
}

/** How long a room waits for its host's phone to come back before closing. */
const HOST_GRACE_MS = Number(process.env.HOST_GRACE_MS ?? 90_000);
const PENDING_MAX = 500;

const rooms = new Map<string, Room>();
const socketRoom = new Map<string, string>(); // socketId -> room code

// Unambiguous alphabet (no O/0, I/1) for shout-across-the-room codes.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Deliver to the host, or hold it until the host's phone is back. */
function toHost(room: Room, event: string, payload: unknown): void {
  if (room.hostSocketId) io.to(room.hostSocketId).emit(event, payload);
  else if (room.pending.length < PENDING_MAX) room.pending.push({ event, payload });
}

function closeRoom(room: Room): void {
  io.to(room.code).emit("roomClosed");
  for (const id of room.memberSocketIds) socketRoom.delete(id);
  if (room.closeTimer) clearTimeout(room.closeTimer);
  rooms.delete(room.code);
}

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
  // Shared clock: every phone (host included) estimates its offset to this
  // server's clock so reveal beats land together across the room.
  socket.on("time", (cb: (serverNow: number) => void) => {
    if (typeof cb === "function") cb(Date.now());
  });

  socket.on("createRoom", (cb: (res: { code: string; hostKey: string }) => void) => {
    if (typeof cb !== "function") return;
    const code = newRoomCode();
    const hostKey = randomBytes(16).toString("hex");
    rooms.set(code, { code, hostSocketId: socket.id, hostKey, memberSocketIds: new Set([socket.id]), pending: [], closeTimer: null });
    socketRoom.set(socket.id, code);
    socket.join(code);
    cb({ code, hostKey });
  });

  // The host's phone is back on a new socket: hand it the room again, deliver
  // what it missed, and tell the class.
  socket.on("resumeRoom", ({ code, hostKey }: { code: string; hostKey: string }, cb?: (res: { ok: boolean }) => void) => {
    const room = rooms.get(String(code ?? "").toUpperCase());
    if (!room || !hostKey || room.hostKey !== hostKey) {
      cb?.({ ok: false });
      return;
    }
    if (room.closeTimer) clearTimeout(room.closeTimer);
    room.closeTimer = null;
    // v0.18: another tab or device took the room over (a duplicated tab carries
    // the saved key). The previous host socket stops hosting instead of running
    // a game nobody receives, and its eventual disconnect isn't "host away".
    const previous = room.hostSocketId;
    if (previous && previous !== socket.id) {
      io.to(previous).emit("hostReplaced");
      room.memberSocketIds.delete(previous);
      socketRoom.delete(previous);
      io.sockets.sockets.get(previous)?.leave(room.code);
    }
    room.hostSocketId = socket.id;
    room.memberSocketIds.add(socket.id);
    socketRoom.set(socket.id, room.code);
    socket.join(room.code);
    cb?.({ ok: true });
    for (const { event, payload } of room.pending.splice(0)) socket.emit(event, payload);
    socket.to(room.code).emit("hostBack");
  });

  socket.on("join", ({ code, name, avatar, token, watch }: { code: string; name: string; avatar?: string; token?: string; watch?: boolean }, cb?: (res: { ok: boolean; error?: string }) => void) => {
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
    toHost(room, "joinRequest", { socketId: socket.id, name: String(name ?? ""), avatar: String(avatar ?? ""), token: String(token ?? ""), watch: watch === true });
    if (!room.hostSocketId) socket.emit("hostAway");
  });

  socket.on("intent", (payload: unknown) => {
    const code = socketRoom.get(socket.id);
    const room = code ? rooms.get(code) : undefined;
    if (!room || socket.id === room.hostSocketId) return;
    toHost(room, "intent", { fromSocket: socket.id, payload });
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
      // Phones drop out all the time (screen lock, app switch, Wi-Fi to 4G).
      // The game lives in the host's page, so give it time to come back
      // before the session ends (spec 00, known limitation 2 — softened).
      room.hostSocketId = null;
      io.to(room.code).emit("hostAway");
      room.closeTimer = setTimeout(() => closeRoom(room), HOST_GRACE_MS);
    } else {
      toHost(room, "peerDisconnected", { socketId: socket.id });
    }
  });
});

httpServer.listen(PORT, () => {
  // The real port (PORT=0 asks the OS for a free one: the relay check does).
  const addr = httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : PORT;
  console.log(`How Did You Know That — relay listening on http://localhost:${port}`);
});
