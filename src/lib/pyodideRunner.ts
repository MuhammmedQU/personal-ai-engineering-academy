/**
 * Browser-side Python sandbox powered by Pyodide inside a Web Worker.
 *
 * Security & Reliability:
 * - Learner code runs strictly inside a browser Web Worker (WASM sandbox),
 *   never on the Node backend.
 * - Supports both structured test-case grading (`runPythonInBrowser`) and
 *   interactive scratchpad execution with custom stdin (`runPythonScratchpad`).
 * - Hard timeout kills runaway infinite loops (`while True:`) and recreates
 *   a clean worker automatically.
 * - Loads Pyodide locally from `/pyodide/pyodide.mjs` (100% offline).
 */

export interface PyodideTestResult {
  name: string;
  passed: boolean;
  error: string | null;
}

export interface PyodideRunOutput {
  stdout: string;
  stderr?: string;
  loadError: string | null;
  testResults: PyodideTestResult[];
}

const WORKER_SOURCE = `
let pyodideReadyPromise = null;

async function getPyodideInstance(origin) {
  if (!pyodideReadyPromise) {
    const mod = await import(origin + "/pyodide/pyodide.mjs");
    pyodideReadyPromise = mod.loadPyodide({
      indexURL: origin + "/pyodide/",
    });
  }
  return pyodideReadyPromise;
}

const HARNESS_PY = \`
import json, io, sys, contextlib, traceback

def _run_suite(payload_json):
    payload = json.loads(payload_json)
    results = []
    ns = {"__name__": "__learner__"}
    out_buf = io.StringIO()
    err_buf = io.StringIO()
    stdin_text = payload.get("stdin") or ""
    old_stdin = sys.stdin
    sys.stdin = io.StringIO(stdin_text)
    try:
        with contextlib.redirect_stdout(out_buf), contextlib.redirect_stderr(err_buf):
            exec(compile(payload["code"], "<learner>", "exec"), ns)
        load_error = None
    except Exception as e:
        load_error = f"{type(e).__name__}: {e}"
        err_buf.write(traceback.format_exc(limit=3))
    finally:
        sys.stdin = old_stdin
    for t in payload.get("tests", []):
        if load_error:
            results.append({"name": t["name"], "passed": False, "error": load_error})
            continue
        local_ns = dict(ns)
        try:
            with contextlib.redirect_stdout(out_buf), contextlib.redirect_stderr(err_buf):
                exec(compile(t["code"], "<test>", "exec"), local_ns)
            results.append({"name": t["name"], "passed": True, "error": None})
        except AssertionError as e:
            results.append({"name": t["name"], "passed": False, "error": f"AssertionError: {e}"})
        except Exception as e:
            results.append({"name": t["name"], "passed": False, "error": f"{type(e).__name__}: {e}"})
    return json.dumps({
        "stdout": out_buf.getvalue(),
        "stderr": err_buf.getvalue(),
        "loadError": load_error,
        "testResults": results,
    })
\`;

self.onmessage = async (event) => {
  const { id, origin, code, tests, stdin } = event.data;
  try {
    const pyodide = await getPyodideInstance(origin);
    pyodide.runPython(HARNESS_PY);
    const fn = pyodide.globals.get("_run_suite");
    const rawJson = fn(JSON.stringify({ code, tests: tests || [], stdin: stdin || "" }));
    fn.destroy();
    self.postMessage({ id, ok: true, result: JSON.parse(rawJson) });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  }
};
`;

let activeWorker: Worker | null = null;
let reqSeq = 1;

function ensureWorker(): Worker {
  if (!activeWorker) {
    const blob = new Blob([WORKER_SOURCE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    activeWorker = new Worker(url, { type: "module" });
  }
  return activeWorker;
}

function killWorker(): void {
  if (activeWorker) {
    try {
      activeWorker.terminate();
    } catch {
      // ignore
    }
    activeWorker = null;
  }
}

export async function runPythonInBrowser(
  code: string,
  tests: Array<{ name: string; code: string }>,
  timeoutMs = 15_000,
  stdin = "",
): Promise<PyodideRunOutput> {
  const worker = ensureWorker();
  const id = reqSeq++;
  const origin = window.location.origin;

  return new Promise<PyodideRunOutput>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      killWorker();
      reject(
        new Error(
          "İcra vaxtı limiti (15 saniyə) aşdı — kodda sonsuz dövr (infinite loop) ola bilər. Worker dayandırıldı.",
        ),
      );
    }, timeoutMs);

    const onMessage = (ev: MessageEvent) => {
      if (!ev.data || ev.data.id !== id) return;
      window.clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      if (ev.data.ok) {
        resolve(ev.data.result as PyodideRunOutput);
      } else {
        reject(new Error(ev.data.error || "Pyodide execution failed"));
      }
    };

    worker.addEventListener("message", onMessage);
    worker.postMessage({ id, origin, code, tests, stdin });
  });
}

export async function runPythonScratchpad(
  code: string,
  stdin = "",
  timeoutMs = 15_000,
): Promise<PyodideRunOutput> {
  return runPythonInBrowser(code, [], timeoutMs, stdin);
}
