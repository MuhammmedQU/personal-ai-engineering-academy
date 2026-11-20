// Real-process persistence test: starts the actual server, writes progress, kills it,
// restarts it on the same SQLite file and verifies the data survived.
// Usage: node tests/e2e/persistence.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `aiea-persist-${Date.now()}.sqlite`);
const port = 3187;
const base = `http://localhost:${port}`;

function startServer() {
  const env = { ...process.env, PORT: String(port), DB_PATH: dbPath, AI_PROVIDER: "demo" };
  const p = spawn("node", ["server/index.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server start timeout")), 15000);
    p.stdout.on("data", (d) => {
      if (String(d).includes("listening")) {
        clearTimeout(t);
        resolve(p);
      }
    });
    p.stderr.on("data", (d) => process.stderr.write(d));
    p.on("exit", (c) => reject(new Error("server exited early " + c)));
  });
}
const j = async (url, init) => (await fetch(base + url, init)).json();
const post = (url, body) =>
  j(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`);
  if (!ok) failures++;
};

const killProc = (p) =>
  new Promise((r) => {
    p.removeAllListeners("exit");
    p.on("exit", () => r());
    p.kill();
    setTimeout(r, 2000);
  });

let srv = await startServer();
const b0 = await j("/api/bootstrap");
check("fresh DB is not onboarded", b0.profile.onboarded === false);
check("fresh DB has zero demonstrated skills", b0.dashboard.skillsMap.strong.length === 0);
check("fresh DB has zero completed lessons", b0.dashboard.completedLessonsTotal === 0);

await post("/api/diagnostic/submit", {
  name: "Persist", goalId: "llm-apps", weeklyHours: 6,
  selfRatings: { python: 2 }, answers: { "diag-py-dict-get": "2" },
});
await post("/api/lessons/py-functions-contracts/section", { sectionId: "contract-idea", mark: "understood" });
await post("/api/exercises/ex-pyfn-predict-aliasing/submit", { answer: "[0.5, 7]" });
await post("/api/notes", { lessonId: "py-functions-contracts", sectionId: "contract-idea", content: "persist-note" });
await post("/api/bookmarks", { targetType: "lesson", targetId: "py-functions-contracts", label: "persist-bm" });
await post("/api/settings".replace("/api/settings", "/api/settings"), {}).catch(() => {});
await fetch(base + "/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme: "light", weeklyHours: 12 }) });

await killProc(srv);
check("db file exists on disk after shutdown", fs.existsSync(dbPath));

srv = await startServer();
const b1 = await j("/api/bootstrap");
check("onboarded survives restart", b1.profile.onboarded === true && b1.profile.name === "Persist");
check("goal survives restart", b1.profile.goalId === "llm-apps");
check("theme/weeklyHours survive restart", b1.profile.theme === "light" && b1.profile.weeklyHours === 12);
check("section progress survives restart", b1.lessonProgress["py-functions-contracts"]?.understoodSections.includes("contract-idea"));
check("note survives restart", b1.notes.some((n) => n.content === "persist-note"));
check("bookmark survives restart", b1.bookmarks.some((b) => b.label === "persist-bm"));
const sk = b1.skills.find((s) => s.id === "py-functions");
check("skill mastery survives restart", sk && sk.mastery.attemptsCount >= 1, JSON.stringify(sk?.mastery));
await killProc(srv);

for (const f of [dbPath, dbPath + "-wal", dbPath + "-shm"]) if (fs.existsSync(f)) fs.rmSync(f);
console.log(failures === 0 ? "\nALL PERSISTENCE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
