/**
 * Content QA for `code` exercises: runs each exercise's `solution` and
 * `starter_code` against its `tests` using system Python (`python -I -c ...`).
 *
 * Security note: This ONLY executes curated repository content during content
 * validation / tests — never learner-submitted code. Learner code executes
 * exclusively in the browser inside a sandboxed Pyodide Web Worker.
 */
import { spawnSync } from "node:child_process";
import type { CodeExercise } from "./schema.ts";

const HARNESS = `
import json, sys, io, contextlib
payload = json.loads(sys.stdin.read())
results = []
ns = {"__name__": "__learner__"}
buf = io.StringIO()
try:
    with contextlib.redirect_stdout(buf):
        exec(compile(payload["code"], "<learner>", "exec"), ns)
    load_error = None
except Exception as e:
    load_error = f"{type(e).__name__}: {e}"
for t in payload["tests"]:
    if load_error:
        results.append({"name": t["name"], "passed": False, "error": load_error})
        continue
    local_ns = dict(ns)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            exec(compile(t["code"], "<test>", "exec"), local_ns)
        results.append({"name": t["name"], "passed": True, "error": None})
    except AssertionError as e:
        results.append({"name": t["name"], "passed": False, "error": f"AssertionError: {e}"})
    except Exception as e:
        results.append({"name": t["name"], "passed": False, "error": f"{type(e).__name__}: {e}"})
print(json.dumps(results))
`;

export interface TestCaseResult {
  name: string;
  passed: boolean;
  error: string | null;
}

export interface CodeCheckResult {
  exerciseId: string;
  ok: boolean;
  problems: string[];
}

export function runPythonTests(code: string, tests: Array<{ name: string; code: string }>): TestCaseResult[] {
  const proc = spawnSync("python", ["-I", "-c", HARNESS], {
    input: JSON.stringify({ code, tests }),
    encoding: "utf-8",
    timeout: 15_000,
  });
  if (proc.error) {
    throw proc.error;
  }
  if (proc.status !== 0) {
    throw new Error((proc.stderr || "").trim() || `python exited with status ${proc.status}`);
  }
  const lines = (proc.stdout || "").trim().split(/\r?\n/);
  return JSON.parse(lines[lines.length - 1]) as TestCaseResult[];
}

export function checkCodeExercise(ex: CodeExercise): CodeCheckResult {
  const problems: string[] = [];
  try {
    const solResults = runPythonTests(ex.solution, ex.tests);
    const failed = solResults.filter((r) => !r.passed);
    if (failed.length > 0) {
      problems.push(
        "solution fails: " + failed.map((r) => `${r.name} -> ${r.error}`).join("; "),
      );
    }
  } catch (e) {
    problems.push(`solution crashed: ${(e as Error).message}`);
  }

  try {
    const starterResults = runPythonTests(ex.starter_code, ex.tests);
    if (starterResults.every((r) => r.passed)) {
      problems.push("starter_code already passes every test (exercise is trivial)");
    }
  } catch (e) {
    problems.push(`starter crashed harness: ${(e as Error).message}`);
  }

  return { exerciseId: ex.id, ok: problems.length === 0, problems };
}
