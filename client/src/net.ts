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

export interface SessionEvents {
  onState(state: PublicState): void;
  onSecret(secret: SecretState): void;
  onClosed(reason: string): void;
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
  const code = await new Promise<string>((resolve) => socket.emit("createRoom", ({ code }: { code: string }) => resolve(code)));

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
  socket.on("disconnect", () => events.onClosed("Lost connection to the relay."));
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
  const tokenKey = `hdykt-seat:${code}:${name.trim().toLowerCase()}`;
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
      // Secret first, so the first render of a (re)joined screen is correct.
      events.onSecret(msg.secret);
      events.onState(msg.state);
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
    doJoin();
  });
}
