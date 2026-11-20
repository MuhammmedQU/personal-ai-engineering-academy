/**
 * Unified local development launcher (`npm run dev`).
 * Starts the Hono API server on port 3001 and Vite dev server on port 5173.
 */
import { spawn } from "node:child_process";

const procs = [
  spawn("node", ["server/index.ts"], { stdio: "inherit", shell: false }),
  spawn("node", ["node_modules/vite/bin/vite.js", "--port", "5173"], {
    stdio: "inherit",
    shell: false,
  }),
];

function shutdown() {
  for (const p of procs) {
    try {
      p.kill();
    } catch {
      // ignore
    }
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
