// Runs every proof: the protocol-leak check and the relay host-dropout check
// (tsx), then the Playwright suites.
// Playwright 1.52's TypeScript ESM loader hangs on this "type": "module"
// project under Node 24, so it is disabled here (cross-platform).
import { spawnSync } from "node:child_process";

const run = (args, env = {}) =>
  spawnSync("npx", args, { stdio: "inherit", shell: true, env: { ...process.env, ...env } }).status ?? 1;

let code = run(["tsx", "sim/protocol-check.ts"]);
code ||= run(["tsx", "sim/relay-check.ts"]);
code ||= run(["playwright", "test", ...process.argv.slice(2)], { PW_DISABLE_TS_ESM: "1" });
process.exit(code);
