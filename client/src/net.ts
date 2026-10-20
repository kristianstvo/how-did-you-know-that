// Client networking (spec 05). Two roles share one relay:
// - Host: runs HostEngine locally, forwards its broadcasts through the relay.
// - Player: sends intents, consumes state/secret events.
// Every phone syncs to the relay server's clock first (clock.ts) so reveal
// beats land together; the host engine stamps all times on that clock.
import { io, type Socket } from "socket.io-client";
import { createEventLogger, EVENT_LOG_VERSION, type MatchEvent } from "../../shared/eventlog";
import type { Intent, JoinedMsg, JoinRejectedMsg, PublicState, SecretState } from "../../shared/protocol";
import { maintainClock, serverNow, syncClock } from "./clock";
import { HostEngine, type EngineSnapshot, type Transport } from "./engine";
import { deckState, restoreDeck, type DeckState } from "./providers";

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

function connectSocket(timeout?: number): Socket {
  // Dev: Vite proxies /socket.io to :3000. Prod: same origin serves both.
  // WebSocket only: HTTP long-polling first would inflate the clock-sync RTT.
  return io({ transports: ["websocket"], ...(timeout ? { timeout } : {}) });
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

/** Connect to the relay and sync this phone's clock to it. */
async function connectSynced(maintain = true, timeout?: number): Promise<Socket> {
  const socket = connectSocket(timeout);
  try {
    await waitConnected(socket);
  } catch (e) {
    socket.disconnect();
    throw e;
  }
  await syncClock(socket);
  if (maintain) maintainClock(socket);
  return socket;
}

// ---- v0.14: the host's tab can reload without ending the class ----

const HOST_SAVE = "hdykt-host";
/** Off once the host leaves on purpose, so a last pagehide can't write it back. */
let hostSaving = false;
/** Older than this, the relay has long closed the room: don't even try. */
const HOST_SAVE_MAX_AGE_MS = 30 * 60_000;

/** What this tab needs to take its classroom back after a reload. */
export interface HostSave {
  code: string;
  hostKey: string;
  savedAt: number;
  snap: EngineSnapshot;
  /** v0.18: questions already used this session (no repeats after a reload). */
  deck?: DeckState;
}

/** v0.18: the relay says the room is gone (only this forgets the save; a
 *  flaky connection is worth another try while the relay holds the room). */
export class RoomGoneError extends Error {}

export function loadHostSave(): HostSave | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(HOST_SAVE) ?? "null") as HostSave | null;
    if (!s || s.snap?.v !== 1 || !s.code || !s.hostKey) return null;
    if (Date.now() - s.savedAt > HOST_SAVE_MAX_AGE_MS) {
      clearHostSave();
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function clearHostSave(): void {
  hostSaving = false;
  try {
    sessionStorage.removeItem(HOST_SAVE);
  } catch {
    /* storage unavailable */
  }
}

export async function createHostSession(
  hostName: string,
  hostAvatar: string,
  events: SessionEvents,
  options: { forceCheaterName?: string } = {},
): Promise<HostSession> {
  const socket = await connectSynced();
  const host = hostWiring(socket, events);
  const res = await new Promise<{ code: string; hostKey: string } | { error: string }>((resolve) => socket.emit("createRoom", resolve));
  if ("error" in res) {
    socket.disconnect(); // v0.21: the school is full (the relay caps open classrooms)
    throw new Error(res.error);
  }
  const { code, hostKey } = res;
  return host.start(
    code,
    hostKey,
    (transport) => new HostEngine(code, hostName, hostAvatar, transport, undefined, { now: serverNow, forceCheaterName: options.forceCheaterName }),
  );
}

/** v0.14: this tab hosted a room and its page reloaded (pull to refresh, a
 *  crash, or the browser threw the tab away). Take the room back with the
 *  saved key and carry on from the saved engine: the class only sees "the
 *  teacher's phone dropped out" for a moment. */
export async function resumeHostSession(save: HostSave, events: SessionEvents): Promise<HostSession> {
  // A short connect timeout: a reload on flaky Wi-Fi retries every few
  // seconds instead of waiting out socket.io's default 20s per try.
  const socket = await connectSynced(false, 6000);
  const host = hostWiring(socket, events);
  const ok = await new Promise<boolean | null>((resolve) =>
    socket.timeout(5000).emit("resumeRoom", { code: save.code, hostKey: save.hostKey }, (err: Error | null, res?: { ok: boolean }) => resolve(err ? null : !!res?.ok)),
  );
  if (ok !== true) {
    socket.disconnect();
    if (ok === false) throw new RoomGoneError("Your classroom closed while this page was away.");
    throw new Error("No answer from the game server.");
  }
  maintainClock(socket);
  restoreDeck(save.deck);
  const session = host.start(save.code, save.hostKey, (transport) => HostEngine.restore(save.snap, transport, undefined, { now: serverNow }));
  session.engine.resync(); // every phone (this one too) gets the current state and its secret
  return session;
}

/** Everything a host socket does, for a new room or one taken back. Relay
 *  events that arrive before the engine exists wait for it: a resumed room
 *  delivers what it held for us right after the ack. */
function hostWiring(socket: Socket, events: SessionEvents) {
  let engine: HostEngine | null = null;
  const early: ((e: HostEngine) => void)[] = [];
  const run = (fn: (e: HostEngine) => void) => (engine ? fn(engine) : early.push(fn));
  socket.on("joinRequest", ({ socketId, name, avatar, token, watch }: { socketId: string; name: string; avatar: string; token?: string; watch?: boolean }) =>
    run((e) => e.handleJoinRequest(socketId, name, avatar, token ?? "", watch === true)),
  );
  socket.on("intent", ({ fromSocket, payload }: { fromSocket: string; payload: Intent }) => run((e) => e.handleIntent(fromSocket, payload)));
  socket.on("peerDisconnected", ({ socketId }: { socketId: string }) => run((e) => e.handlePeerDisconnected(socketId)));

  return {
    start(code: string, hostKey: string, makeEngine: (transport: Transport) => HostEngine): HostSession {
      const log: MatchEvent[] = [];
      const logState = createEventLogger((e) => log.push(e));
      // Once this session stops hosting (the room closed, or another tab took
      // it over) it never saves again: a stale game must not overwrite the save
      // of a newer room (v0.18).
      let closed = false;
      // v0.14: saved on every change, so a reload carries on from exactly here.
      const save = () => {
        if (!engine || !hostSaving || closed) return;
        try {
          const data: HostSave = { code, hostKey, savedAt: Date.now(), snap: engine.snapshot(), deck: deckState() };
          sessionStorage.setItem(HOST_SAVE, JSON.stringify(data));
        } catch {
          /* storage full or blocked: a reload just can't take the room back */
        }
      };
      const transport: Transport = {
        toAll: (event, payload) => socket.emit("toAll", { event, payload }),
        toPlayer: (socketId, event, payload) => socket.emit("toPlayer", { socketId, event, payload }),
        local: (event, payload) => {
          if (event === "state") {
            const state = (payload as { state: PublicState }).state;
            save();
            logState(state, serverNow());
            events.onState(state);
          }
          if (event === "secret") events.onSecret((payload as { secret: SecretState }).secret);
        },
      };
      const e = makeEngine(transport);
      engine = e;
      hostSaving = true;
      for (const fn of early.splice(0)) fn(e);
      save();
      window.addEventListener("pagehide", save);
      // The whole game lives in this page, so a dropped connection is NOT the end:
      // the relay holds the room (HOST_GRACE_MS) while this phone reconnects and
      // takes it back, then everyone gets the current state again.
      const stopHosting = (why: string) => {
        if (closed) return;
        closed = true;
        e.stop();
        socket.disconnect();
        events.onClosed(why);
      };
      socket.on("disconnect", (reason) => {
        if (!closed && reason !== "io client disconnect") events.onNet?.("reconnecting");
      });
      socket.on("connect", () => {
        if (closed) return;
        socket.emit("resumeRoom", { code, hostKey }, (res: { ok: boolean }) => {
          if (res?.ok) {
            e.resync();
            events.onNet?.("online");
          } else stopHosting("Your phone was away too long, so the classroom closed.");
        });
      });
      // v0.18: another tab or device took the room over with this page's key
      // (a duplicated tab carries the save): this page stops hosting.
      socket.on("hostReplaced", () => stopHosting("This classroom moved to another tab or device."));
      reviveOnReturn(socket);
      // Push the initial snapshot to the host UI.
      events.onState(e.publicState());
      return {
        kind: "host",
        engine: e,
        code,
        selfId: e.hostPlayer.id,
        eventLog: () =>
          [JSON.stringify({ type: "logHeader", version: EVENT_LOG_VERSION, room: code, exportedAt: new Date().toISOString() }), ...log.map((x) => JSON.stringify(x))].join("\n") + "\n",
      };
    },
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

/** Join a classroom as a player, or (v0.16, `watch`) as a big screen that
 *  only shows the public state: no seat, no token, never in the class. */
export async function joinAsPlayer(code: string, name: string, avatar: string, events: SessionEvents, opts: { watch?: boolean } = {}): Promise<PlayerSession> {
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
      socket.emit("join", { code, name, avatar, token: opts.watch ? "" : readToken(), watch: !!opts.watch }, (res: { ok: boolean; error?: string }) => {
        if (!res.ok && !joined) fail(res.error ?? "Couldn't join.");
      });
    };
    // Reconnects re-join with the same name, which restores the held seat and
    // current state (spec 05).
    socket.on("connect", doJoin);
    socket.on("joined", (msg: JoinedMsg) => {
      try {
        if (!opts.watch) sessionStorage.setItem(tokenKey, msg.token);
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
