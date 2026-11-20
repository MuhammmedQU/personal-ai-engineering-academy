/**
 * Isolated in-memory SQLite SQL Sandbox with worker-thread timeout protection.
 *
 * Security & reliability guarantees:
 * 1. Runs exclusively on a fresh `:memory:` SQLite database (never touches
 *    the learner's real `data/academy.sqlite`).
 * 2. Blocks filesystem/extension escape keywords (`ATTACH`, `DETACH`,
 *    `LOAD_EXTENSION`, `PRAGMA writable_schema`, `PRAGMA temp_store_directory`).
 * 3. Caps database memory via `PRAGMA max_page_count = 1024` (~4 MiB).
 * 4. Runs inside a short-lived `node:worker_threads` Worker with a hard wall-clock
 *    timeout (`timeoutMs`, default 3000ms) so infinite `WITH RECURSIVE` CTEs or
 *    runaway cross-joins are forcefully terminated without freezing the API server.
 */
import { Worker } from "node:worker_threads";

export interface SqlSandboxResult {
  ok: boolean;
  error?: string;
  timedOut?: boolean;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  totalRows?: number;
  truncated?: boolean;
  elapsedMs?: number;
}

const FORBIDDEN_SQL_RE =
  /\b(ATTACH|DETACH|LOAD_EXTENSION|PRAGMA\s+(writable_schema|temp_store_directory|legacy_file_format))\b/i;

export function hasForbiddenSql(setupSql: string, querySql: string): boolean {
  return FORBIDDEN_SQL_RE.test(`${setupSql}\n${querySql}`);
}

const WORKER_SCRIPT = `
const { parentPort, workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");

const { setupSql, querySql } = workerData;
const mem = new DatabaseSync(":memory:");
try {
  mem.exec("PRAGMA max_page_count = 1024;");
  const t0 = performance.now();
  if (setupSql && setupSql.trim()) {
    mem.exec(setupSql);
  }
  const stmt = mem.prepare(querySql);
  const isSelect = /^\\s*(SELECT|WITH|PRAGMA|EXPLAIN)\\b/i.test(querySql);
  if (isSelect) {
    const allRows = stmt.all();
    const limited = allRows.slice(0, 200);
    const columns = limited.length > 0 ? Object.keys(limited[0]) : [];
    parentPort.postMessage({
      ok: true,
      columns,
      rows: limited,
      totalRows: allRows.length,
      truncated: allRows.length > 200,
      elapsedMs: Math.round((performance.now() - t0) * 100) / 100,
    });
  } else {
    const info = stmt.run();
    parentPort.postMessage({
      ok: true,
      columns: ["changes", "lastInsertRowid"],
      rows: [{ changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) }],
      totalRows: 1,
      truncated: false,
      elapsedMs: Math.round((performance.now() - t0) * 100) / 100,
    });
  }
} catch (e) {
  parentPort.postMessage({
    ok: false,
    error: e && e.message ? String(e.message) : String(e),
    columns: [],
    rows: [],
  });
} finally {
  try { mem.close(); } catch {}
}
`;

export async function runSandboxedSql(
  setupSql: string,
  querySql: string,
  timeoutMs = Number(process.env.SQL_SANDBOX_TIMEOUT_MS) || 3000,
): Promise<SqlSandboxResult> {
  return new Promise((resolve) => {
    let settled = false;
    const worker = new Worker(WORKER_SCRIPT, {
      eval: true,
      workerData: { setupSql, querySql },
    });

    const finish = (res: SqlSandboxResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };

    const timer = setTimeout(() => {
      worker.terminate().catch(() => {});
      finish({
        ok: false,
        timedOut: true,
        error: `SQL sorğusu vaxt limitini (${timeoutMs} ms) aşdı və təhlükəsiz dayandırıldı — sonsuz RECURSIVE CTE və ya həddən artıq böyük JOIN yoxla.`,
        columns: [],
        rows: [],
      });
    }, timeoutMs);

    worker.on("message", (msg: SqlSandboxResult) => {
      worker.terminate().catch(() => {});
      finish(msg);
    });

    worker.on("error", (err: Error) => {
      worker.terminate().catch(() => {});
      finish({
        ok: false,
        error: err.message || "SQL sandbox worker error",
        columns: [],
        rows: [],
      });
    });

    worker.on("exit", (code) => {
      if (!settled && code !== 0) {
        finish({
          ok: false,
          error: `SQL sandbox worker exited with code ${code}`,
          columns: [],
          rows: [],
        });
      }
    });
  });
}
