// Client networking (spec 05). Two roles share one relay:
// - Host: runs HostEngine locally, forwards its broadcasts through the relay.
// - Player: sends intents, consumes state/secret events.
// Every phone syncs to the relay server's clock first (clock.ts) so reveal
// beats land together; the host engine stamps all times on that clock.
import { io, type Socket } from "socket.io-client";
import { createEventLogger, EVENT_LOG_VERSION, type MatchEvent } from "../../shared/eventlog";
import type { Intent, JoinedMsg, JoinRejectedMsg, PublicState, SecretState } from "../../shared/protocol";
import { maintainClock, serverNow, syncClock } from "./clock";
import { HostEngine, type Transport } from "./engine";

/** online · reconnecting (this phone lost the relay) · hostAway (the host's
 *  phone dropped out; the relay holds the room while it comes back). */
export type NetStatus = "online" | "reconnecting" | "hostAway";

export interface SessionEvents {
  onState(state: PublicState): void;
  onSecret(secret: SecretState): void;
  onClosed(reason: string): void;
  onNet?(status: NetStatus): void;
  /** The id this phone plays as, on every (re)join: it changes if the seat
   *  was cleared or a hallway place lapsed while the phone was away. */
  onSelf?(id: string): void;
}

export interface HostSession {
  kind: "host";
  engine: HostEngine;
  code: string;
  selfId: string;
  /** Match event log (same format the simulator writes) for playtest analysis. */
  eventLog(): string;
}

export interface PlayerSession {
  kind: "player";
  code: string;
  selfId: string;
  sendIntent(intent: Intent): void;
}

function connectSocket(): Socket {
  // Dev: Vite proxies /socket.io to :3000. Prod: same origin serves both.
  // WebSocket only: HTTP long-polling first would inflate the clock-sync RTT.
  return io({ transports: ["websocket"] });
}

/** Phones come back from a locked screen or another app with a socket that
 *  may be dead without knowing it. On return: reconnect now (not after the
 *  backoff), or ping and replace the socket if the ping goes unanswered. */
function reviveOnReturn(socket: Socket): void {
  const revive = () => {
    if (document.visibilityState !== "visible") return;
    if (!socket.connected) {
      socket.connect();
      return;
    }
    socket.timeout(3000).emit("time", (err: Error | null) => {
      if (err) {
        socket.disconnect();
        socket.connect();
      }
    });
  };
  document.addEventListener("visibilitychange", revive);
  window.addEventListener("pageshow", revive);
  window.addEventListener("online", revive);
  // Test hook (local dev only): drop this phone's connection like a lost signal.
  if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
    Object.assign(window.__hdykt ?? {}, { dropSocket: () => socket.io.engine?.close() });
  }
}

function waitConnected(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", () => reject(new Error("Can't reach the game server.")));
  });
}

export async function createHostSession(
  hostName: string,
  hostAvatar: string,
  events: SessionEvents,
  options: { forceCheaterName?: string } = {},
): Promise<HostSession> {
  const socket = connectSocket();
  try {
    await waitConnected(socket);
  } catch (e) {
    socket.disconnect();
    throw e;
  }
  await syncClock(socket);
  maintainClock(socket);
  const { code, hostKey } = await new Promise<{ code: string; hostKey: string }>((resolve) => socket.emit("createRoom", resolve));

  const log: MatchEvent[] = [];
  const logState = createEventLogger((e) => log.push(e));
  const transport: Transport = {
    toAll: (event, payload) => socket.emit("toAll", { event, payload }),
    toPlayer: (socketId, event, payload) => socket.emit("toPlayer", { socketId, event, payload }),
    local: (event, payload) => {
      if (event === "state") {
        const state = (payload as { state: PublicState }).state;
        logState(state, serverNow());
        events.onState(state);
      }
      if (event === "secret") events.onSecret((payload as { secret: SecretState }).secret);
    },
  };
  const engine = new HostEngine(code, hostName, hostAvatar, transport, undefined, {
    now: serverNow,
    forceCheaterName: options.forceCheaterName,
  });
  socket.on("joinRequest", ({ socketId, name, avatar, token }: { socketId: string; name: string; avatar: string; token?: string }) =>
    engine.handleJoinRequest(socketId, name, avatar, token ?? ""));
  socket.on("intent", ({ fromSocket, payload }: { fromSocket: string; payload: Intent }) => engine.handleIntent(fromSocket, payload));
  socket.on("peerDisconnected", ({ socketId }: { socketId: string }) => engine.handlePeerDisconnected(socketId));
  // The whole game lives in this page, so a dropped connection is NOT the end:
  // the relay holds the room (HOST_GRACE_MS) while this phone reconnects and
  // takes it back, then everyone gets the current state again.
  let closed = false;
  socket.on("disconnect", (reason) => {
    if (!closed && reason !== "io client disconnect") events.onNet?.("reconnecting");
  });
  socket.on("connect", () => {
    if (closed) return;
    socket.emit("resumeRoom", { code, hostKey }, (res: { ok: boolean }) => {
      if (res?.ok) {
        engine.resync();
        events.onNet?.("online");
      } else {
        closed = true;
        socket.disconnect();
        events.onClosed("Your phone was away too long, so the classroom closed.");
      }
    });
  });
  reviveOnReturn(socket);
  // Push the initial snapshot to the host UI.
  events.onState(engine.publicState());
  return {
    kind: "host",
    engine,
    code,
    selfId: engine.hostPlayer.id,
    eventLog: () =>
      [JSON.stringify({ type: "logHeader", version: EVENT_LOG_VERSION, room: code, exportedAt: new Date().toISOString() }), ...log.map((e) => JSON.stringify(e))].join("\n") + "\n",
  };
}

/** sessionStorage key of this phone's seat token for a room + name. */
export const seatTokenKey = (code: string, name: string): string => `hdykt-seat:${code}:${name.trim().toLowerCase()}`;

/** Does this phone hold a seat in that room (it was playing there)? */
export function hasSeat(code: string, name: string): boolean {
  try {
    return !!sessionStorage.getItem(seatTokenKey(code, name));
  } catch {
    return false;
  }
}

export async function joinAsPlayer(code: string, name: string, avatar: string, events: SessionEvents): Promise<PlayerSession> {
  const socket = connectSocket();
  try {
    await waitConnected(socket);
  } catch (e) {
    socket.disconnect();
    throw e;
  }
  await syncClock(socket);
  maintainClock(socket);

  // Seat token: proves on a reconnect that this phone owns the seat (the host
  // won't hand a mid-match seat — and its secret — to a bare name).
  const tokenKey = seatTokenKey(code, name);
  const readToken = () => {
    try {
      return sessionStorage.getItem(tokenKey) ?? "";
    } catch {
      return "";
    }
  };
  return new Promise((resolve, reject) => {
    let joined = false;
    const fail = (msg: string) => {
      socket.disconnect();
      reject(new Error(msg));
    };
    const doJoin = () => {
      socket.emit("join", { code, name, avatar, token: readToken() }, (res: { ok: boolean; error?: string }) => {
        if (!res.ok && !joined) fail(res.error ?? "Couldn't join.");
      });
    };
    // Reconnects re-join with the same name, which restores the held seat and
    // current state (spec 05).
    socket.on("connect", doJoin);
    socket.on("joined", (msg: JoinedMsg) => {
      try {
        sessionStorage.setItem(tokenKey, msg.token);
      } catch {
        /* storage unavailable: name-only rejoin between matches still works */
      }
      // Id and secret first, so the first render of a (re)joined screen is correct.
      events.onSelf?.(msg.playerId);
      events.onSecret(msg.secret);
      events.onState(msg.state);
      events.onNet?.("online");
      if (!joined) {
        joined = true;
        resolve({
          kind: "player",
          code,
          selfId: msg.playerId,
          sendIntent: (intent: Intent) => socket.emit("intent", intent),
        });
      }
    });
    socket.on("joinRejected", (msg: JoinRejectedMsg) => {
      if (!joined) fail(msg.reason);
    });
    socket.on("state", ({ state }: { state: PublicState }) => events.onState(state));
    socket.on("secret", ({ secret }: { secret: SecretState }) => events.onSecret(secret));
    socket.on("roomClosed", () => {
      socket.disconnect();
      events.onClosed("The host left — session over.");
    });
    socket.on("disconnect", (reason) => {
      if (joined && reason !== "io client disconnect") events.onNet?.("reconnecting");
    });
    socket.on("hostAway", () => {
      if (joined) events.onNet?.("hostAway");
    });
    // The host's phone is back: ask for our seat again (anything sent while it
    // was away may be gone), which also brings the current state.
    socket.on("hostBack", () => {
      if (joined) doJoin();
    });
    reviveOnReturn(socket);
    doJoin();
  });
}
