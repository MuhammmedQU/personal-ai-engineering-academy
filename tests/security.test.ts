import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { loadContent } from "../server/content/loader.ts";
import { getDb, resetDbForTests } from "../server/db.ts";

const store = loadContent();
const app = () => createApp(store);
const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

describe("Security & input validation", () => {
  beforeEach(() => {
    resetDbForTests(":memory:");
  });

  it("rejects cross-site state-changing requests (CSRF) even without preflight", async () => {
    const a = app();
    for (const url of ["/api/reset", "/api/mentor/ask", "/api/diagnostic/submit"]) {
      const res = await a.request(url, {
        method: "POST",
        headers: { Origin: "https://evil.example", "Content-Type": "text/plain" },
        body: "{}",
      });
      expect(res.status, url).toBe(403);
    }
    // and nothing was reset / created
    const res = await a.request("/api/reset", { method: "POST", headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });

  it("allows same-origin and local dev origins", async () => {
    const a = app();
    for (const origin of ["http://localhost:5173", "http://localhost:3001", "http://127.0.0.1:3001"]) {
      const res = await a.request("/api/settings", { ...json({ weeklyHours: 9 }), method: "PUT", headers: { "Content-Type": "application/json", Origin: origin } });
      expect(res.status, origin).toBe(200);
    }
  });

  it("does not send permissive CORS headers to foreign origins", async () => {
    const res = await app().request("/api/bootstrap", { headers: { Origin: "https://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(res.headers.get("access-control-allow-origin")).not.toBe("https://evil.example");
  });

  it("rejects DNS-rebinding style Host headers", async () => {
    const res = await app().request("http://evil.example:3001/api/bootstrap");
    expect(res.status).toBe(403);
  });

  it("malformed JSON gives 400 JSON error, not a 500/stack trace", async () => {
    const res = await app().request("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/at .*\.ts/);
  });

  it("oversized request bodies are rejected", async () => {
    const res = await app().request("/api/notes", json({ lessonId: "py-functions-contracts", content: "x".repeat(2_000_000) }));
    expect(res.status).toBe(413);
  });

  it("validates field types and lengths", async () => {
    const a = app();
    expect((await a.request("/api/notes", json({ lessonId: "py-functions-contracts", content: 123 }))).status).toBe(400);
    expect((await a.request("/api/notes", json({ lessonId: "py-functions-contracts", content: "x".repeat(6000) }))).status).toBe(400);
    expect((await a.request("/api/notes", json({ lessonId: "does-not-exist", content: "hi" }))).status).toBe(404);
    expect((await a.request("/api/diagnostic/submit", json({ goalId: "x", weeklyHours: "abc", selfRatings: [], answers: 5 }))).status).toBe(400);
    expect((await a.request("/api/mentor/ask", json({ action: "hack", message: "hi" }))).status).toBe(400);
    expect((await a.request("/api/mentor/ask", json({ action: "chat", message: "x".repeat(20000) }))).status).toBe(400);
  });

  it("unknown lesson / section / exercise ids do not create junk rows", async () => {
    const a = app();
    const r1 = await a.request("/api/lessons/nope/section", json({ sectionId: "s", mark: "understood" }));
    expect(r1.status).toBe(404);
    const r2 = await a.request("/api/lessons/py-functions-contracts/section", json({ sectionId: "not-a-section", mark: "understood" }));
    expect(r2.status).toBe(400);
    const r3 = await a.request("/api/exercises/nope/submit", json({ answer: "x" }));
    expect(r3.status).toBe(404);
    const n = (getDb().prepare("SELECT COUNT(*) c FROM lesson_progress").get() as { c: number }).c;
    expect(n).toBe(0);
  });

  it("SQL-injection-looking input is stored/handled as plain data", async () => {
    const a = app();
    const evil = "'); DROP TABLE notes; --";
    const res = await a.request("/api/notes", json({ lessonId: "py-functions-contracts", content: evil }));
    expect(res.status).toBe(200);
    const row = getDb().prepare("SELECT content FROM notes").get() as { content: string };
    expect(row.content).toBe(evil);
    const res2 = await a.request("/api/mentor/history?contextType=x' OR '1'='1&contextId=--");
    expect(res2.status).toBe(200);
  });

  it("import restores everything export contains (round trip)", async () => {
    const a = app();
    await a.request("/api/lessons/py-functions-contracts", {});
    await a.request("/api/exercises/ex-pyfn-predict-aliasing/submit", json({ answer: "[0.5, 7]" }));
    await a.request("/api/notes", json({ lessonId: "py-functions-contracts", content: "keep me" }));
    await a.request("/api/bookmarks", json({ targetType: "lesson", targetId: "py-functions-contracts", label: "bm" }));
    const tid = store.projects.get("tabular-ml-prediction")!.milestones[0].id;
    await a.request(`/api/projects/tabular-ml-prediction/milestones/${tid}`, json({ checkedTasks: [0], notes: "n", evidence: "", markComplete: false }));
    const exported = await (await a.request("/api/export")).json();

    await a.request("/api/reset", { method: "POST" });
    expect((getDb().prepare("SELECT COUNT(*) c FROM exercise_attempts").get() as { c: number }).c).toBe(0);

    const imp = await a.request("/api/import", json(exported));
    expect(imp.status).toBe(200);
    const again = await (await a.request("/api/export")).json();
    for (const t of ["exercise_attempts", "notes", "bookmarks", "skill_mastery", "lesson_progress", "project_progress", "study_sessions", "quiz_attempts", "diagnostic_attempts"]) {
      expect(again[t].length, t).toBe(exported[t].length);
    }
  });

  it("import rejects garbage and leaves existing data intact", async () => {
    const a = app();
    await a.request("/api/notes", json({ lessonId: "py-functions-contracts", content: "survivor" }));
    const bad = await a.request("/api/import", json({ version: 1, notes: [{ lesson_id: null, content: null }], exercise_attempts: "nope" }));
    expect(bad.status).toBe(400);
    const row = getDb().prepare("SELECT content FROM notes").get() as { content: string } | undefined;
    expect(row?.content).toBe("survivor");
  });
});
