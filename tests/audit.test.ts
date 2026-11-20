import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { loadContent } from "../server/content/loader.ts";
import { resetDbForTests } from "../server/db.ts";
import { runSandboxedSql } from "../server/sqlSandbox.ts";

const store = loadContent();

describe("Final Audit: AI Mentor Providers, SQL Sandbox DoS Isolation & On-Disk Backup Recovery", () => {
  let mockServer: http.Server;
  let mockBaseUrl: string;
  let lastRequest: {
    url: string;
    headers: http.IncomingHttpHeaders;
    body: Record<string, unknown>;
  } | null = null;
  let mockMode: "ok" | "401" | "429" | "timeout" = "ok";

  let prevSecretsPath: string | undefined;
  let prevAiProvider: string | undefined;
  let prevTimeout: string | undefined;
  let tmpDir: string;
  let tmpSecretsFile: string;

  beforeAll(async () => {
    mockServer = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        lastRequest = { url: req.url || "", headers: req.headers, body: parsed };

        if (mockMode === "timeout") {
          setTimeout(() => {
            if (!res.writableEnded) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ choices: [{ message: { content: "late" } }] }));
            }
          }, 1500);
          return;
        }
        if (mockMode === "401") {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid API key" }));
          return;
        }
        if (mockMode === "429") {
          res.writeHead(429, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Rate limit exceeded" }));
          return;
        }

        // Route-specific realistic responses
        if ((req.url || "").includes(":generateContent")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: "Gemini cavabı: Attention riyaziyyatı..." }] } }],
              usageMetadata: {
                promptTokenCount: 400,
                candidatesTokenCount: 100,
                totalTokenCount: 500,
              },
            }),
          );
          return;
        }
        if ((req.url || "").endsWith("/messages")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              content: [{ type: "text", text: "Anthropic cavabı: Pipeline leakage yoxlaması..." }],
              usage: { input_tokens: 600, output_tokens: 200 },
            }),
          );
          return;
        }
        // OpenAI & Ollama compatible /chat/completions
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: "OpenAI/Ollama cavabı: Sokratik sual..." } }],
            usage: { prompt_tokens: 500, completion_tokens: 150, total_tokens: 650 },
          }),
        );
      });
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = mockServer.address();
    if (!addr || typeof addr === "string") throw new Error("Failed to bind mock provider server");
    mockBaseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiea-audit-"));
    tmpSecretsFile = path.join(tmpDir, "local-secrets.json");
    prevSecretsPath = process.env.SECRETS_PATH;
    prevAiProvider = process.env.AI_PROVIDER;
    prevTimeout = process.env.AI_TIMEOUT_MS;
    process.env.SECRETS_PATH = tmpSecretsFile;
    delete process.env.AI_PROVIDER;
    process.env.AI_TIMEOUT_MS = "5000";
    mockMode = "ok";
    lastRequest = null;
    resetDbForTests(":memory:");
  });

  afterEach(() => {
    resetDbForTests(":memory:");
    if (prevSecretsPath === undefined) delete process.env.SECRETS_PATH;
    else process.env.SECRETS_PATH = prevSecretsPath;
    if (prevAiProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = prevAiProvider;
    if (prevTimeout === undefined) delete process.env.AI_TIMEOUT_MS;
    else process.env.AI_TIMEOUT_MS = prevTimeout;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("tests OpenAI, Anthropic, Gemini (header auth, no URL key leak), and Ollama providers with token & cost tracking", async () => {
    const app = createApp(store);

    // Seed a real mistake + note so we verify learner history reaches live provider context
    await app.request("/api/exercises/ex-pyfn-predict-aliasing/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: "[50, 7]", usedHint: false }),
    });

    // 1. OpenAI
    await app.request("/api/mentor/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "openai",
        model: "gpt-4o-mini",
        baseUrl: mockBaseUrl,
        apiKey: "sk-openai-audit-key-1111",
      }),
    });
    const rOpenAi = await (
      await app.request("/api/mentor/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "lesson-help",
          message: "Aliasing niyə baş verdi?",
          context: { lessonId: "py-functions-contracts" },
        }),
      })
    ).json();
    expect(rOpenAi.mode).toBe("live-ai");
    expect(rOpenAi.providerName).toBe("openai");
    expect(rOpenAi.usage.totalTokens).toBe(650);
    expect(rOpenAi.usage.estimatedCostUsd).toBeGreaterThan(0);
    expect(lastRequest?.headers.authorization).toBe("Bearer sk-openai-audit-key-1111");
    // System prompt must contain actual recent mistake history!
    const sysMsg = (lastRequest?.body.messages as Array<{ content: string }>)[0].content;
    expect(sysMsg).toContain("ex-pyfn-predict-aliasing");

    // 2. Security check: switching provider to Gemini WITHOUT entering a new key MUST NOT reuse OpenAI key!
    const swCfg = await (
      await app.request("/api/mentor/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "gemini",
          model: "gemini-2.5-flash",
          baseUrl: mockBaseUrl,
        }),
      })
    ).json();
    expect(swCfg.hasStoredKey).toBe(false);
    expect(swCfg.configured).toBe(false);

    // 3. Gemini with its own key — key MUST be in x-goog-api-key header, NEVER in URL query string
    const gemKey = "AIza-gemini-audit-key-2222";
    await app.request("/api/mentor/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "gemini",
        model: "gemini-2.5-flash",
        baseUrl: mockBaseUrl,
        apiKey: gemKey,
      }),
    });
    const rGem = await (
      await app.request("/api/mentor/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat",
          message: "Self-attention izah et",
          context: { lessonId: "py-functions-contracts" },
        }),
      })
    ).json();
    expect(rGem.mode).toBe("live-ai");
    expect(rGem.usage.totalTokens).toBe(500);
    expect(lastRequest?.url).not.toContain(gemKey);
    expect(lastRequest?.url).not.toContain("key=");
    expect(lastRequest?.headers["x-goog-api-key"]).toBe(gemKey);
    // Multi-turn history from earlier OpenAI exchange in same lesson thread must be sent!
    expect((lastRequest?.body.contents as unknown[]).length).toBeGreaterThanOrEqual(3);

    // 4. Anthropic
    await app.request("/api/mentor/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "anthropic",
        model: "claude-3-5-sonnet-latest",
        baseUrl: mockBaseUrl,
        apiKey: "sk-ant-audit-key-3333",
      }),
    });
    const rAnt = await (
      await app.request("/api/mentor/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chat", message: "Data leakage izah et" }),
      })
    ).json();
    expect(rAnt.mode).toBe("live-ai");
    expect(rAnt.usage.inputTokens).toBe(600);
    expect(rAnt.usage.outputTokens).toBe(200);
    expect(lastRequest?.headers["x-api-key"]).toBe("sk-ant-audit-key-3333");

    // 5. Ollama (local, $0 cost)
    await app.request("/api/mentor/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "ollama",
        model: "llama3.1",
        baseUrl: mockBaseUrl,
      }),
    });
    const rOll = await (
      await app.request("/api/mentor/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chat", message: "Docker izah et" }),
      })
    ).json();
    expect(rOll.mode).toBe("live-ai");
    expect(rOll.providerName).toBe("ollama");
    expect(rOll.usage.estimatedCostUsd).toBe(0);
  });

  it("handles 401 invalid key, 429 rate limit, and timeouts gracefully with sanitized offline Demo fallback", async () => {
    const app = createApp(store);
    const badKey = "sk-invalid-secret-999999";
    await app.request("/api/mentor/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "openai",
        model: "gpt-4o-mini",
        baseUrl: mockBaseUrl,
        apiKey: badKey,
      }),
    });

    // 401 Invalid Key
    mockMode = "401";
    const r401 = await (
      await app.request("/api/mentor/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chat", message: "Test 401" }),
      })
    ).json();
    expect(r401.mode).toBe("demo-no-key");
    expect(r401.fallbackError).toContain("401");
    expect(JSON.stringify(r401)).not.toContain(badKey);

    // 429 Rate Limit
    mockMode = "429";
    const r429 = await (
      await app.request("/api/mentor/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chat", message: "Test 429" }),
      })
    ).json();
    expect(r429.mode).toBe("demo-no-key");
    expect(r429.fallbackError).toContain("429");

    // Timeout abort
    mockMode = "timeout";
    process.env.AI_TIMEOUT_MS = "500";
    const rTimeout = await (
      await app.request("/api/mentor/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chat", message: "Test timeout" }),
      })
    ).json();
    expect(rTimeout.mode).toBe("demo-no-key");
    expect(rTimeout.fallbackError).toContain("Timeout");
  });

  it("terminates infinite recursive SQL CTEs inside worker_threads without freezing the server", async () => {
    const t0 = Date.now();
    const res = await runSandboxedSql(
      "",
      "WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM cnt) SELECT COUNT(*) FROM cnt;",
      600,
    );
    const elapsed = Date.now() - t0;
    expect(res.ok).toBe(false);
    expect(res.timedOut).toBe(true);
    expect(res.error).toContain("vaxt limitini");
    expect(elapsed).toBeLessThan(2500);
  });

  it("protects file-backed SQLite data with automatic pre-reset safety backups and full recovery including profile settings", async () => {
    const diskDbPath = path.join(tmpDir, "academy-disk.sqlite");
    resetDbForTests(diskDbPath);
    const app = createApp(store);

    // Check DB integrity via /api/health
    const health = await (await app.request("/api/health")).json();
    expect(health.ok).toBe(true);
    expect(health.dbIntegrity).toEqual({ ok: true, detail: "ok" });

    // Customize all profile fields including the 3 newer columns + create personal records
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Elvin",
        dailyGoalMinutes: 60,
        explanationLevel: "advanced",
        socraticMode: false,
        theme: "light",
      }),
    });
    await app.request("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lessonId: "sw-linux-cli-shell-systems",
        tags: "linux,chmod",
        content: "chmod 600 for all secrets",
      }),
    });
    await app.request("/api/flashcards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ front: "KV-Cache Formula", back: "2*L*n_kv*d_head*S*B*b", tags: "llm" }),
    });

    // Create a manual backup and confirm metadata (reason, sizeBytes, createdAt)
    const manRes = await (await app.request("/api/backups/create", { method: "POST" })).json();
    expect(manRes.ok).toBe(true);
    expect(manRes.reason).toBe("manual");

    // Accidental Reset -> MUST auto-create a pre-reset safety backup on disk!
    const resetRes = await (await app.request("/api/reset", { method: "POST" })).json();
    expect(resetRes.ok).toBe(true);
    expect(resetRes.safetySnapshot).toMatch(/^backup-pre-reset-.*\.json$/);

    // Confirm data is wiped after reset
    const afterReset = await (await app.request("/api/flashcards")).json();
    expect(afterReset.cards.length).toBe(0);

    // Confirm safety backup and manual backup are listed via GET /api/backups with reason & size
    const bList = await (await app.request("/api/backups")).json();
    const preResetEntry = bList.backups.find(
      (b: { filename: string }) => b.filename === resetRes.safetySnapshot,
    );
    expect(preResetEntry).toBeDefined();
    expect(preResetEntry.reason).toBe("pre-reset");
    expect(preResetEntry.sizeBytes).toBeGreaterThan(100);
    expect(bList.backups.some((b: { reason: string }) => b.reason === "manual")).toBe(true);

    // Path traversal attempt must be blocked
    const badRestore = await app.request("/api/backups/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "../academy-disk.sqlite" }),
    });
    expect(badRestore.status).toBe(400);

    // Restore from the automatic pre-reset safety backup!
    const restoreRes = await app.request("/api/backups/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: resetRes.safetySnapshot }),
    });
    expect(restoreRes.status).toBe(200);

    // Verify COMPLETE restoration including dailyGoalMinutes, explanationLevel, socraticMode, notes & flashcards!
    const boot = await (await app.request("/api/bootstrap")).json();
    expect(boot.profile.name).toBe("Elvin");
    expect(boot.profile.dailyGoalMinutes).toBe(60);
    expect(boot.profile.explanationLevel).toBe("advanced");
    expect(boot.profile.socraticMode).toBe(false);
    expect(boot.profile.theme).toBe("light");
    expect(boot.notes.some((n: { content: string }) => n.content.includes("chmod 600"))).toBe(true);
    const fcAfter = await (await app.request("/api/flashcards")).json();
    expect(fcAfter.cards.some((c: { front: string }) => c.front === "KV-Cache Formula")).toBe(true);
  });
});
