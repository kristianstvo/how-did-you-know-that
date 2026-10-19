// End-to-end proofs for the reveal redesign (08-reveal-direction.md §6):
// parity, sync, performance and accessibility. Uses the local Edge install.
// Run: npm run test:e2e   (builds the client, starts the server if needed)
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 240_000,
  workers: 1, // perf and sync numbers must not compete for the CPU
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
  use: {
    baseURL: "http://localhost:3000",
    channel: "msedge",
    headless: true,
    viewport: { width: 380, height: 800 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  webServer: {
    command: "npx tsx server/index.ts",
    port: 3000,
    reuseExistingServer: true,
  },
});
