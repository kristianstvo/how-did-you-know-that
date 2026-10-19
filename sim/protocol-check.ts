// PROTOCOL LEAKS — things other phones could observe without seeing a screen.
// (1) Every secret packet serializes to the same length, so the cheater's
//     can't be picked out by size on the wire (spec 05).
// (2) A seat can't be taken over mid-match by typing its name (that would
//     hand a stranger its secret); the seat's own phone gets back in with its
//     token, even before the relay notices the old socket died.
// Usage: npx tsx sim/protocol-check.ts   (exit code 1 on failure)
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { HostEngine, type Transport } from "../client/src/engine";
import { localOnlySource } from "../client/src/providers";

const lengths = new Set<number>();
let count = 0;
for (const f of readdirSync("client/public/fixtures").filter((x) => x.endsWith(".json"))) {
  const tape = JSON.parse(readFileSync(`client/public/fixtures/${f}`, "utf8")) as { secrets: { secret: unknown }[] };
  for (const s of tape.secrets) {
    lengths.add(JSON.stringify({ secret: s.secret }).length);
    count++;
  }
}
assert.ok(count > 50, "fixtures should contain secret packets");
assert.equal(lengths.size, 1, `secret packets must all be one length, saw ${[...lengths].join(", ")}`);
console.log(`✓ ${count} recorded secret packets, all ${[...lengths][0]} bytes`);

const sent: { to: string; event: string; payload: { token?: string } }[] = [];
const transport: Transport = {
  toAll: () => {},
  toPlayer: (to, event, payload) => sent.push({ to, event, payload: payload as { token?: string } }),
  local: () => {},
};
const engine = new HostEngine("TEST1", "Host", "🎒", transport, localOnlySource, { beatLeadMs: 0 });
engine.handleJoinRequest("sockA", "Maya", "📚");
engine.handleJoinRequest("sockB", "Leo", "✏️");
const mayaToken = sent.find((m) => m.to === "sockA" && m.event === "joined")!.payload.token!;
assert.ok(mayaToken.length > 10, "joined carries a seat token");
// Every phase's secrets have one length too (not just the recorded ones).
assert.equal(new Set(engine.secretLengths()).size, 1);

await engine.startMatch();
assert.equal(engine.phase, "role");
assert.equal(new Set(engine.secretLengths()).size, 1, "role-phase secrets are one length");
engine.handlePeerDisconnected("sockA"); // Maya's phone drops mid-match

engine.handleJoinRequest("sockEvil", "maya", "📚"); // a stranger types her name
assert.equal(sent.find((m) => m.to === "sockEvil")?.event, "joinRejected", "bare name can't take a mid-match seat");
engine.handleJoinRequest("sockA2", "Maya", "📚", mayaToken); // her own phone
assert.equal(sent.find((m) => m.to === "sockA2")?.event, "joined", "the seat token rejoins");
engine.handleJoinRequest("sockA3", "Maya", "📚", mayaToken); // ghost-seat race: old socket still 'connected'
assert.equal(sent.find((m) => m.to === "sockA3")?.event, "joined", "the token wins the reconnect race");
console.log("✓ mid-match seats need their token; the token always gets its phone back in");
process.exit(0);
