/**
 * HTTP Server entrypoint for AI Engineering Academy.
 */
import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { getStore, REPO_ROOT } from "./content/loader.ts";
import { getDb } from "./db.ts";

// Load .env if present
const envPath = path.join(REPO_ROOT, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = val;
      }
    }
  }
}

const port = Number(process.env.PORT || 3001);
const store = getStore();
getDb();

const app = createApp(store);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `[AI Engineering Academy] API & Content Server listening on http://localhost:${info.port} ` +
      `(tracks=${store.tracks.length}, lessons=${store.lessons.size}, exercises=${store.exercises.size}, projects=${store.projects.size})`,
  );
});
