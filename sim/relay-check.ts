// Relay check: the host-dropout rules, against a real relay process with a
// short grace period (no browser). Run: npx tsx sim/relay-check.ts
//   1. While the host is away, players are told (hostAway) and their
//      messages for the host are held, not lost.
//   2. Only the host's key takes the room back; then the held messages arrive
//      in order and the class is told (hostBack).
//   3. A host that never comes back: the room closes after the grace period.
import { spawn, spawnSync } from "node:child_process";
import { io, type Socket } from "socket.io-client";

const GRACE = 1500;
let URL = "";
const server = spawn("npx tsx server/index.ts", { shell: true, env: { ...process.env, PORT: "0", HOST_GRACE_MS: String(GRACE) }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("relay did not start")), 20000);
  server.stdout!.on("data", (d: Buffer) => {
    const port = /localhost:(\d+)/.exec(d.toString())?.[1];
    if (port) {
      URL = `http://localhost:${port}`;
      clearTimeout(t);
      resolve();
    }
  });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const connect = () =>
  new Promise<Socket>((resolve, reject) => {
    const s = io(URL, { transports: ["websocket"], reconnection: false });
    s.once("connect", () => resolve(s));
    s.once("connect_error", reject);
  });
/** Everything a socket receives, in order. */
const record = (s: Socket) => {
  const got: { event: string; payload: unknown }[] = [];
  s.onAny((event, payload) => got.push({ event, payload }));
  return got;
};
const emitAck = <T>(s: Socket, event: string, payload?: unknown) =>
  new Promise<T>((resolve) => (payload === undefined ? s.emit(event, resolve) : s.emit(event, payload, resolve)));

let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures++;
};

try {
  // ---- Scenario A: the host drops out and comes back ----
  const host = await connect();
  const { code, hostKey } = await emitAck<{ code: string; hostKey: string }>(host, "createRoom");
  const player = await connect();
  const pGot = record(player);
  await emitAck(player, "join", { code, name: "Bea", avatar: "🎒", token: "" });
  await sleep(100);

  host.disconnect(); // the host's phone locks
  await sleep(200);
  check(pGot.some((m) => m.event === "hostAway"), "players are told the host's phone dropped out");
  check(!pGot.some((m) => m.event === "roomClosed"), "the room stays open while the host is away");

  player.emit("intent", { kind: "answer", questionIdx: 0, optionIdx: 2, clientElapsedMs: 4100 });
  player.emit("intent", { kind: "answer", questionIdx: 0, optionIdx: 3, clientElapsedMs: 4200 });
  await sleep(100);

  const thief = await connect();
  const stolen = await emitAck<{ ok: boolean }>(thief, "resumeRoom", { code, hostKey: "not-the-key" });
  check(!stolen.ok, "a stranger without the host's key cannot take the room");

  const back = await connect();
  const hGot = record(back);
  const resumed = await emitAck<{ ok: boolean }>(back, "resumeRoom", { code, hostKey });
  await sleep(200);
  check(resumed.ok, "the host's phone takes the room back with its key");
  const intents = hGot.filter((m) => m.event === "intent").map((m) => (m.payload as { payload: { optionIdx: number } }).payload.optionIdx);
  check(intents.join(",") === "2,3", `messages sent while the host was away arrive, in order (got ${intents.join(",") || "none"})`);
  check(pGot.some((m) => m.event === "hostBack"), "players are told the host is back");
  await sleep(GRACE + 300);
  check(!pGot.some((m) => m.event === "roomClosed"), "the grace timer is cancelled once the host is back");
  for (const s of [back, player, thief]) s.disconnect();

  // ---- Scenario B: the host never comes back ----
  const host2 = await connect();
  const room2 = await emitAck<{ code: string; hostKey: string }>(host2, "createRoom");
  const p2 = await connect();
  const p2Got = record(p2);
  await emitAck(p2, "join", { code: room2.code, name: "Cy", avatar: "📚", token: "" });
  host2.disconnect();
  await sleep(GRACE / 2);
  check(!p2Got.some((m) => m.event === "roomClosed"), "still open halfway through the grace period");
  await sleep(GRACE / 2 + 400);
  check(p2Got.some((m) => m.event === "roomClosed"), `the room closes when the host stays away past the grace period (${GRACE}ms here)`);
  const late = await connect();
  const lateTry = await emitAck<{ ok: boolean }>(late, "resumeRoom", room2);
  check(!lateTry.ok, "a host coming back after the room closed is told so");
  for (const s of [p2, late]) s.disconnect();
} finally {
  // Kill the whole tree (shell → npx → node) and wait for it, or a stray relay
  // keeps running after this check exits.
  if (process.platform === "win32" && server.pid) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill();
}
process.exit(failures ? 1 : 0);
