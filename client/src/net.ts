// Client networking (spec 05). Two roles share one relay:
// - Host: runs HostEngine locally, forwards its broadcasts through the relay.
// - Player: sends intents, consumes state/secret events.
import { io, type Socket } from "socket.io-client";
import type { Intent, JoinedMsg, JoinRejectedMsg, PublicState, SecretState } from "../../shared/protocol";
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
}

export interface PlayerSession {
  kind: "player";
  code: string;
  selfId: string;
  sendIntent(intent: Intent): void;
}

function connectSocket(): Socket {
  // Dev: Vite proxies /socket.io to :3000. Prod: same origin serves both.
  return io({ transports: ["websocket", "polling"] });
}

export function createHostSession(hostName: string, hostAvatar: string, events: SessionEvents): Promise<HostSession> {
  return new Promise((resolve, reject) => {
    const socket = connectSocket();
    const fail = (msg: string) => {
      socket.disconnect();
      reject(new Error(msg));
    };
    socket.once("connect_error", () => fail("Can't reach the game server."));
    socket.once("connect", () => {
      socket.emit("createRoom", ({ code }: { code: string }) => {
        const transport: Transport = {
          toAll: (event, payload) => socket.emit("toAll", { event, payload }),
          toPlayer: (socketId, event, payload) => socket.emit("toPlayer", { socketId, event, payload }),
          local: (event, payload) => {
            if (event === "state") events.onState((payload as { state: PublicState }).state);
            if (event === "secret") events.onSecret((payload as { secret: SecretState }).secret);
          },
        };
        const engine = new HostEngine(code, hostName, hostAvatar, transport);
        socket.on("joinRequest", ({ socketId, name, avatar }: { socketId: string; name: string; avatar: string }) =>
          engine.handleJoinRequest(socketId, name, avatar));
        socket.on("intent", ({ fromSocket, payload }: { fromSocket: string; payload: Intent }) => engine.handleIntent(fromSocket, payload));
        socket.on("peerDisconnected", ({ socketId }: { socketId: string }) => engine.handlePeerDisconnected(socketId));
        socket.on("disconnect", () => events.onClosed("Lost connection to the relay."));
        resolve({ kind: "host", engine, code, selfId: engine.hostPlayer.id });
        // Push the initial snapshot to the host UI.
        events.onState(engine.publicState());
      });
    });
  });
}

export function joinAsPlayer(code: string, name: string, avatar: string, events: SessionEvents): Promise<PlayerSession> {
  return new Promise((resolve, reject) => {
    const socket = connectSocket();
    let joined = false;
    const fail = (msg: string) => {
      socket.disconnect();
      reject(new Error(msg));
    };
    socket.once("connect_error", () => fail("Can't reach the game server."));

    const doJoin = () => {
      socket.emit("join", { code, name, avatar }, (res: { ok: boolean; error?: string }) => {
        if (!res.ok && !joined) fail(res.error ?? "Couldn't join.");
      });
    };

    socket.on("connect", () => {
      // First connect joins; reconnects re-join with the same name, which
      // restores the held seat and current state (spec 05).
      doJoin();
    });

    socket.on("joined", (msg: JoinedMsg) => {
      events.onState(msg.state);
      events.onSecret(msg.secret);
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
  });
}
