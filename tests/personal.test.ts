import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { loadContent } from "../server/content/loader.ts";
import { resetDbForTests } from "../server/db.ts";

const store = loadContent();

describe("Personal AI Engineering University Features & Security", () => {
  let prevSecretsPath: string | undefined;
  let prevAiProvider: string | undefined;
  let tmpSecretsFile: string;

  beforeEach(() => {
    resetDbForTests(":memory:");
    prevSecretsPath = process.env.SECRETS_PATH;
    prevAiProvider = process.env.AI_PROVIDER;
    tmpSecretsFile = path.join(
      os.tmpdir(),
      `aiea-secrets-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    process.env.SECRETS_PATH = tmpSecretsFile;
  });

  afterEach(() => {
    if (prevSecretsPath === undefined) delete process.env.SECRETS_PATH;
    else process.env.SECRETS_PATH = prevSecretsPath;
    if (prevAiProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = prevAiProvider;
    if (fs.existsSync(tmpSecretsFile)) fs.rmSync(tmpSecretsFile, { force: true });
  });

  it("stores AI provider API key write-only on disk and never leaks the raw key in any HTTP response", async () => {
    delete process.env.AI_PROVIDER;
    const app = createApp(store);
    const fakeKey = "sk-test-secret-key-9876543210-superprivate";

    const putRes = await app.request("/api/mentor/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: fakeKey,
      }),
    });
    expect(putRes.status).toBe(200);
    const putText = await putRes.text();
    expect(putText).not.toContain(fakeKey);
    const putJson = JSON.parse(putText);
    expect(putJson.provider).toBe("openai");
    expect(putJson.hasStoredKey).toBe(true);
    expect(putJson.maskedKey).toBe("***vate");
    expect(putJson.configured).toBe(true);

    // GET /api/mentor/config and /api/bootstrap must never expose the raw secret
    const getText = await (await app.request("/api/mentor/config")).text();
    expect(getText).not.toContain(fakeKey);
    expect(JSON.parse(getText).maskedKey).toBe("***vate");

    const bootText = await (await app.request("/api/bootstrap")).text();
    expect(bootText).not.toContain(fakeKey);

    // Clearing the key works cleanly
    const clearRes = await app.request("/api/mentor/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "demo", clearKey: true }),
    });
    expect(clearRes.status).toBe(200);
    const cleared = await clearRes.json();
    expect(cleared.hasStoredKey).toBe(false);
    expect(cleared.maskedKey).toBeNull();
    expect(cleared.configured).toBe(false);
  });

  it("executes real SQL queries in an isolated in-memory SQLite sandbox and blocks ATTACH/LOAD_EXTENSION", async () => {
    const app = createApp(store);

    const okRes = await app.request("/api/lab/sql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        setupSql: `
          CREATE TABLE models (id INTEGER PRIMARY KEY, name TEXT);
          CREATE TABLE runs (id INTEGER PRIMARY KEY, model_id INTEGER, latency_ms INTEGER);
          INSERT INTO models VALUES (1, 'llama'), (2, 'mistral');
          INSERT INTO runs VALUES (1, 1, 120), (2, 1, 180), (3, 2, 90);
        `,
        querySql: `
          SELECT m.name, COUNT(r.id) AS run_cnt, AVG(r.latency_ms) AS avg_ms
          FROM models m
          LEFT JOIN runs r ON m.id = r.model_id
          GROUP BY m.name
          ORDER BY m.name;
        `,
      }),
    });
    expect(okRes.status).toBe(200);
    const okJson = await okRes.json();
    expect(okJson.ok).toBe(true);
    expect(okJson.columns).toEqual(["name", "run_cnt", "avg_ms"]);
    expect(okJson.rows).toEqual([
      { name: "llama", run_cnt: 2, avg_ms: 150 },
      { name: "mistral", run_cnt: 1, avg_ms: 90 },
    ]);

    // Dangerous filesystem escape attempt MUST be blocked with 400
    const badRes = await app.request("/api/lab/sql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        setupSql: "",
        querySql: "ATTACH DATABASE 'data/academy.sqlite' AS hostdb;",
      }),
    });
    expect(badRes.status).toBe(400);
  });

  it("saves, updates, lists, and deletes Coding Lab code drafts", async () => {
    const app = createApp(store);

    const createRes = await app.request("/api/lab/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Cosine similarity test",
        language: "python",
        code: "print(1 + 1)",
        stdin: "42",
        lastOutput: "2",
      }),
    });
    expect(createRes.status).toBe(200);
    const { draft } = await createRes.json();
    expect(draft.title).toBe("Cosine similarity test");
    expect(draft.stdin).toBe("42");

    const listJson = await (await app.request("/api/lab/drafts")).json();
    expect(listJson.drafts.length).toBe(1);

    const delRes = await app.request(`/api/lab/drafts/${draft.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);
    const listAfter = await (await app.request("/api/lab/drafts")).json();
    expect(listAfter.drafts.length).toBe(0);
  });

  it("auto-seeds flashcards from started lessons and schedules SM-2 intervals on review", async () => {
    const app = createApp(store);

    // Open a lesson -> starts lesson_progress
    await app.request("/api/lessons/py-functions-contracts");

    const fc1 = await (await app.request("/api/flashcards")).json();
    expect(fc1.cards.length).toBeGreaterThanOrEqual(3);
    expect(fc1.dueCount).toBe(fc1.cards.length);

    // Create custom flashcard
    const customRes = await app.request("/api/flashcards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        front: "Why scale dot-product by 1/sqrt(d_k)?",
        back: "Prevents softmax saturation and vanishing gradients when d_k is large.",
        tags: "transformers,math",
      }),
    });
    expect(customRes.status).toBe(200);
    const { card } = await customRes.json();

    // Review with Easy (4) -> repetitions=1, interval=3 days, future next_review_at
    const rev1 = await (
      await app.request(`/api/flashcards/${card.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quality: 4 }),
      })
    ).json();
    expect(rev1.card.repetitions).toBe(1);
    expect(rev1.card.interval_days).toBe(3);
    expect(new Date(rev1.card.next_review_at).getTime()).toBeGreaterThan(Date.now());

    // Review with Again (1) -> resets repetitions to 0 and interval to 1
    const rev2 = await (
      await app.request(`/api/flashcards/${card.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quality: 1 }),
      })
    ).json();
    expect(rev2.card.repetitions).toBe(0);
    expect(rev2.card.interval_days).toBe(1);
  });

  it("records mistakes in Mistake Notebook, saves reflections, and marks resolved after passing", async () => {
    const app = createApp(store);

    // Submit a wrong answer
    await app.request("/api/exercises/ex-pyfn-predict-aliasing/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: "[50, 7]", usedHint: false }),
    });

    const m1 = await (await app.request("/api/mistakes")).json();
    expect(m1.mistakes.length).toBe(1);
    expect(m1.mistakes[0].exerciseId).toBe("ex-pyfn-predict-aliasing");
    expect(m1.mistakes[0].resolved).toBe(false);

    // Save takeaway reflection
    const reflRes = await app.request("/api/mistakes/ex-pyfn-predict-aliasing/reflection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        takeaway: "Python lists are mutable references; always copy before modifying.",
        resolved: false,
      }),
    });
    expect(reflRes.status).toBe(200);

    // Now pass the exercise
    await app.request("/api/exercises/ex-pyfn-predict-aliasing/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: "[0.5, 7]", usedHint: false }),
    });

    const m2 = await (await app.request("/api/mistakes")).json();
    expect(m2.mistakes[0].takeaway).toContain("mutable references");
    expect(m2.mistakes[0].resolved).toBe(true);
  });

  it("supports snippets, PDF/paper resources, and global search across all learning materials", async () => {
    const app = createApp(store);

    await app.request("/api/knowledge/snippets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "PyTorch Deterministic Seed Helper",
        language: "python",
        tags: "pytorch,seed",
        code: "import random\nrandom.seed(42)",
        notes: "Always pin seed before training runs.",
      }),
    });

    await app.request("/api/knowledge/resources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "paper",
        title: "LoRA: Low-Rank Adaptation of Large Language Models",
        urlOrPath: "https://arxiv.org/abs/2106.09685",
        tags: "lora,finetuning",
        summary: "Freeze base weights and inject low-rank A and B adapter matrices.",
      }),
    });

    const kn = await (await app.request("/api/knowledge")).json();
    expect(kn.snippets.length).toBe(1);
    expect(kn.resources.length).toBe(1);
    expect(kn.glossary.length).toBeGreaterThanOrEqual(100);

    const search = await (await app.request("/api/search?q=LoRA")).json();
    expect(search.results.length).toBeGreaterThanOrEqual(2);
    expect(search.results.some((r: { type: string }) => r.type === "lesson")).toBe(true);
    expect(search.results.some((r: { type: string }) => r.type === "resource")).toBe(true);
  });

  it("tracks Study Planner tasks, 30-day heatmap, streaks, and smart recommendations", async () => {
    const app = createApp(store);

    const p1 = await (await app.request("/api/planner")).json();
    expect(p1.last30Days.length).toBe(30);
    expect(p1.recommendations.length).toBeGreaterThanOrEqual(1);

    const createTask = await (
      await app.request("/api/planner/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Solve Attention coding exercise unaided",
          category: "exercise",
          estimatedMinutes: 30,
          priority: 1,
        }),
      })
    ).json();
    expect(createTask.task.completed).toBe(0);

    const doneTask = await (
      await app.request(`/api/planner/tasks/${createTask.task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true }),
      })
    ).json();
    expect(doneTask.task.completed).toBe(1);

    const p2 = await (await app.request("/api/planner")).json();
    expect(p2.todayMinutes).toBeGreaterThanOrEqual(30);
    expect(p2.streakDays).toBeGreaterThanOrEqual(1);
  });

  it("attaches learner project files and persists Senior Engineer AI Code Review findings", async () => {
    process.env.AI_PROVIDER = "demo";
    const app = createApp(store);

    const attach = await (
      await app.request("/api/projects/pdf-knowledge-assistant/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "retriever.py",
          language: "python",
          content: `API_KEY = "sk-123456"\ndef add_doc(doc, cache=[]):\n    try:\n        return eval(doc)\n    except:\n        pass\n`,
        }),
      })
    ).json();
    expect(attach.file.filename).toBe("retriever.py");

    const revRes = await app.request(
      `/api/projects/pdf-knowledge-assistant/files/${attach.file.id}/review`,
      { method: "POST" },
    );
    expect(revRes.status).toBe(200);
    const revJson = await revRes.json();
    expect(revJson.review.reply).toContain("eval");
    expect(revJson.review.reply).toContain("Mutable default");
    expect(revJson.review.reply).toContain("Bare `except:`");

    // Review must persist in SQLite
    const list = await (await app.request("/api/projects/pdf-knowledge-assistant/files")).json();
    expect(list.files[0].ai_review).toContain("eval");
  });

  it("supports adaptive Mentor actions (generate-exercise, explain-mistake) and full backup export/import round-trip", async () => {
    process.env.AI_PROVIDER = "demo";
    const app = createApp(store);

    const genRes = await app.request("/api/mentor/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "generate-exercise",
        message: "Mənə Transformer attention mövzusunda praktiki tapşırıq yarat",
        context: {
          lessonId: "dl-transformers-attention",
          explanationLevel: "advanced",
          socraticMode: true,
        },
      }),
    });
    expect(genRes.status).toBe(200);
    const genJson = await genRes.json();
    expect(genJson.explanationLevel).toBe("advanced");
    expect(genJson.reply.length).toBeGreaterThan(40);

    // Seed personal tables, export, reset, import, verify restoration
    await app.request("/api/flashcards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ front: "BackupCardFront", back: "BackupCardBack", tags: "test" }),
    });
    await app.request("/api/knowledge/snippets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "BackupSnippet", language: "python", code: "x = 1" }),
    });
    await app.request("/api/planner/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "BackupTask", category: "custom", estimatedMinutes: 20 }),
    });

    const exported = await (await app.request("/api/export")).json();
    expect(exported.flashcards.length).toBe(1);
    expect(exported.code_snippets.length).toBe(1);
    expect(exported.study_tasks.length).toBe(1);

    await app.request("/api/reset", { method: "POST" });
    expect((await (await app.request("/api/flashcards")).json()).cards.length).toBe(0);

    const impRes = await app.request("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exported),
    });
    expect(impRes.status).toBe(200);

    const fcAfter = await (await app.request("/api/flashcards")).json();
    expect(fcAfter.cards.some((c: { front: string }) => c.front === "BackupCardFront")).toBe(true);
    const knAfter = await (await app.request("/api/knowledge")).json();
    expect(knAfter.snippets.some((s: { title: string }) => s.title === "BackupSnippet")).toBe(true);
    const plAfter = await (await app.request("/api/planner")).json();
    expect(plAfter.tasks.some((t: { title: string }) => t.title === "BackupTask")).toBe(true);
  });
});
