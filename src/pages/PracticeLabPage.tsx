import React, { useEffect, useState } from "react";
import { api } from "../api.ts";
import { ExerciseCard } from "../components/ExerciseCard.tsx";
import { runPythonScratchpad } from "../lib/pyodideRunner.ts";
import type { ExerciseView } from "../types.ts";

interface PracticeLabPageProps {
  initialExerciseId?: string | null;
  onProgressUpdated: () => void;
  onAskMentor: (context: {
    exerciseId?: string;
    lessonId?: string;
    codeSnippet?: string;
    errorOutput?: string;
    title: string;
  }) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  all: "Hamısı",
  python: "Python & Logic",
  "predict-output": "Predict the Output",
  debug: "Debug This Code",
  "explain-code": "Read & Explain Code",
  math: "Math (Vectors/Matrices/Calculus/Bayes)",
  "ml-metric": "ML Metrics Calculation",
  data: "Data Analysis & Leakage",
  "llm-architecture": "LLM / RAG Architecture",
  production: "Production & MLOps",
  concept: "Concept Reasoning",
};

const DEFAULT_PY_SANDBOX = `# Python 3.12 Sandbox (Pyodide WASM — lokal brauzerdə icra olunur)
import math, statistics

scores = [0.82, 0.85, 0.79, 0.88, 0.84]
mean = statistics.mean(scores)
std = statistics.stdev(scores)
se = std / math.sqrt(len(scores))
print(f"Mean={mean:.4f}, Std={std:.4f}, 95% CI=[{mean-1.96*se:.4f}, {mean+1.96*se:.4f}]")
`;

const DEFAULT_SQL_SETUP = `CREATE TABLE prediction_logs (
  id INTEGER PRIMARY KEY,
  model_version TEXT,
  latency_ms INTEGER
);
CREATE TABLE feedback (
  prediction_id INTEGER,
  thumbs_down INTEGER
);
INSERT INTO prediction_logs VALUES
  (1, 'v1', 120), (2, 'v1', 150), (3, 'v2', 90), (4, 'v2', 420);
INSERT INTO feedback VALUES (2, 1), (4, 1);
`;

const DEFAULT_SQL_QUERY = `SELECT p.model_version,
       COUNT(p.id) AS total_preds,
       COALESCE(SUM(f.thumbs_down), 0) AS thumbs_down,
       ROUND(AVG(p.latency_ms), 1) AS avg_latency_ms
FROM prediction_logs p
LEFT JOIN feedback f ON p.id = f.prediction_id
GROUP BY p.model_version
ORDER BY p.model_version;`;

export function PracticeLabPage({
  initialExerciseId,
  onProgressUpdated,
  onAskMentor,
}: PracticeLabPageProps) {
  const [labMode, setLabMode] = useState<"exercises" | "python-sandbox" | "sql-sandbox">("exercises");

  // Guided exercises state
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<
    Array<{
      exercise: ExerciseView;
      sourceKind: "lesson" | "practice";
      lessonId: string | null;
      lessonTitle: string | null;
      topic: string | null;
      stats: {
        attempts: number;
        passedUnaided: boolean;
        fails: number;
        recurringMistake: boolean;
        lastAttemptAt: string | null;
      };
    }>
  >([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "unsolved" | "recurring" | "solved"
  >("all");
  const [selectedId, setSelectedId] = useState<string | null>(initialExerciseId ?? null);

  // Saved drafts
  const [drafts, setDrafts] = useState<
    Array<{
      id: number;
      draft_key: string;
      title: string;
      language: "python" | "sql";
      code: string;
      stdin: string;
      last_output: string;
      updated_at: string;
    }>
  >([]);

  // Python scratchpad state
  const [pyTitle, setPyTitle] = useState("Python Experiment #1");
  const [pyCode, setPyCode] = useState(DEFAULT_PY_SANDBOX);
  const [pyStdin, setPyStdin] = useState("");
  const [pyOutput, setPyOutput] = useState("");
  const [pyError, setPyError] = useState<string | null>(null);
  const [pyRunning, setPyRunning] = useState(false);

  // SQL sandbox state
  const [sqlTitle, setSqlTitle] = useState("LEFT JOIN Analytics Query");
  const [sqlSetup, setSqlSetup] = useState(DEFAULT_SQL_SETUP);
  const [sqlQuery, setSqlQuery] = useState(DEFAULT_SQL_QUERY);
  const [sqlResult, setSqlResult] = useState<{
    ok: boolean;
    error?: string;
    columns: string[];
    rows: Array<Record<string, unknown>>;
    elapsedMs?: number;
  } | null>(null);
  const [sqlRunning, setSqlRunning] = useState(false);
  const [draftMsg, setDraftMsg] = useState<string | null>(null);

  const loadPractice = async () => {
    setLoading(true);
    try {
      const [res, dr] = await Promise.all([api.getPractice(), api.getLabDrafts()]);
      setItems(res.exercises);
      setDrafts(dr.drafts);
      if (!selectedId && res.exercises.length > 0) {
        setSelectedId(initialExerciseId ?? res.exercises[0].exercise.id);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPractice();
  }, []);

  useEffect(() => {
    if (initialExerciseId) {
      setSelectedId(initialExerciseId);
      setLabMode("exercises");
    }
  }, [initialExerciseId]);

  const handleRunPythonSandbox = async () => {
    setPyRunning(true);
    setPyError(null);
    try {
      const res = await runPythonScratchpad(pyCode, pyStdin);
      setPyOutput(res.stdout || "(stdout boşdur)");
      if (res.loadError) {
        setPyError(res.stderr || res.loadError);
      }
    } catch (e) {
      setPyError((e as Error).message);
    } finally {
      setPyRunning(false);
    }
  };

  const handleFormatPython = () => {
    // Normalize tabs to 4 spaces & strip trailing whitespace
    const cleaned = pyCode
      .replace(/\t/g, "    ")
      .split(/\r?\n/)
      .map((line) => line.replace(/[ \t]+$/g, ""))
      .join("\n")
      .trimEnd() + "\n";
    setPyCode(cleaned);
  };

  const handleSaveDraft = async (lang: "python" | "sql") => {
    setDraftMsg(null);
    await api.saveLabDraft({
      title: lang === "python" ? pyTitle.trim() || "Python Draft" : sqlTitle.trim() || "SQL Draft",
      language: lang,
      code: lang === "python" ? pyCode : sqlQuery,
      stdin: lang === "python" ? pyStdin : sqlSetup,
      lastOutput: lang === "python" ? pyOutput : JSON.stringify(sqlResult?.rows ?? []),
    });
    const dr = await api.getLabDrafts();
    setDrafts(dr.drafts);
    setDraftMsg("Kod qaralaması SQLite bazasında saxlanıldı.");
  };

  const handleRunSql = async () => {
    setSqlRunning(true);
    try {
      const res = await api.runSqlSandbox({ setupSql: sqlSetup, querySql: sqlQuery });
      setSqlResult(res);
    } catch (e) {
      setSqlResult({
        ok: false,
        error: (e as Error).message,
        columns: [],
        rows: [],
      });
    } finally {
      setSqlRunning(false);
    }
  };

  if (loading) {
    return <div className="panel">Practice Lab tapşırıqları yüklənir...</div>;
  }

  const filtered = items.filter((it) => {
    if (categoryFilter !== "all" && it.exercise.category !== categoryFilter) {
      return false;
    }
    if (statusFilter === "unsolved" && it.stats.passedUnaided) return false;
    if (statusFilter === "solved" && !it.stats.passedUnaided) return false;
    if (statusFilter === "recurring" && !it.stats.recurringMistake) return false;
    return true;
  });

  const activeItem =
    filtered.find((it) => it.exercise.id === selectedId) ??
    items.find((it) => it.exercise.id === selectedId) ??
    filtered[0] ??
    null;

  const solvedCount = items.filter((i) => i.stats.passedUnaided).length;
  const recurringCount = items.filter((i) => i.stats.recurringMistake).length;

  return (
    <div className="practice-lab-page">
      <div className="page-header">
        <div>
          <h1>Coding & Practice Laboratory ({items.length} Tapşırıq + Python/SQL Sandbox)</h1>
          <p className="subtitle">
            Testli AI/ML tapşırıqları, `stdin`/`stdout` dəstəkli lokal Python 3.12 (Pyodide WASM) laboratoriyası, yaddaşdaxili SQLite SQL meydançası və saxlanılmış kod qaralamaları.
          </p>
        </div>
        <div className="step-pills">
          <span className="badge badge-success">Həll edilib: {solvedCount}/{items.length}</span>
          {recurringCount > 0 && (
            <span className="badge badge-danger">Təkrarlanan səhv: {recurringCount}</span>
          )}
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="lesson-mode-tabs">
        <button
          type="button"
          className={`mode-tab ${labMode === "exercises" ? "active" : ""}`}
          onClick={() => setLabMode("exercises")}
        >
          1. İnteraktiv Tapşırıqlar ({items.length})
        </button>
        <button
          type="button"
          className={`mode-tab ${labMode === "python-sandbox" ? "active" : ""}`}
          onClick={() => setLabMode("python-sandbox")}
        >
          2. Python 3.12 Sandbox (Pyodide + Stdin)
        </button>
        <button
          type="button"
          className={`mode-tab ${labMode === "sql-sandbox" ? "active" : ""}`}
          onClick={() => setLabMode("sql-sandbox")}
        >
          3. SQL Sandbox (Isolated SQLite)
        </button>
      </div>

      {/* MODE 1: Guided Exercises */}
      {labMode === "exercises" && (
        <>
          <div className="panel filter-panel">
            <div className="filter-bar">
              {Object.entries(CATEGORY_LABELS).map(([cat, label]) => (
                <button
                  key={cat}
                  type="button"
                  className={`filter-chip ${categoryFilter === cat ? "active" : ""}`}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="filter-bar">
              <button
                type="button"
                className={`filter-chip ${statusFilter === "all" ? "active" : ""}`}
                onClick={() => setStatusFilter("all")}
              >
                Bütün statuslar ({items.length})
              </button>
              <button
                type="button"
                className={`filter-chip ${statusFilter === "unsolved" ? "active" : ""}`}
                onClick={() => setStatusFilter("unsolved")}
              >
                Həll edilməyənlər ({items.length - solvedCount})
              </button>
              <button
                type="button"
                className={`filter-chip ${statusFilter === "recurring" ? "active" : ""}`}
                onClick={() => setStatusFilter("recurring")}
              >
                Təkrarlanan səhvlər ({recurringCount})
              </button>
              <button
                type="button"
                className={`filter-chip ${statusFilter === "solved" ? "active" : ""}`}
                onClick={() => setStatusFilter("solved")}
              >
                Tamamlananlar ({solvedCount})
              </button>
            </div>
          </div>

          <div className="practice-workspace-grid">
            <aside className="practice-list-sidebar panel">
              <h4>Tapşırıqlar ({filtered.length})</h4>
              {filtered.length === 0 ? (
                <p className="muted">Bu filtr üzrə tapşırıq yoxdur.</p>
              ) : (
                <div className="section-nav-list">
                  {filtered.map((it) => (
                    <button
                      key={it.exercise.id}
                      type="button"
                      className={`section-nav-item ${
                        activeItem?.exercise.id === it.exercise.id ? "active" : ""
                      }`}
                      onClick={() => setSelectedId(it.exercise.id)}
                    >
                      <div className="sec-nav-text">
                        <span className="sec-nav-title">{it.exercise.title}</span>
                        <small className="sec-nav-kind">
                          {it.exercise.category} · {it.exercise.type.toUpperCase()} ·{" "}
                          {it.stats.attempts} cəhd
                        </small>
                      </div>
                      {it.stats.passedUnaided ? (
                        <span className="sec-status-badge sec-ok">✓</span>
                      ) : it.stats.recurringMistake ? (
                        <span className="sec-status-badge sec-warn">!</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </aside>

            <main className="practice-main-col">
              {activeItem ? (
                <ExerciseCard
                  key={activeItem.exercise.id}
                  exercise={activeItem.exercise}
                  lessonId={activeItem.lessonId}
                  onAttemptComplete={async () => {
                    await loadPractice();
                    onProgressUpdated();
                  }}
                  onAskMentor={onAskMentor}
                />
              ) : (
                <div className="panel">Tapşırıq seçin.</div>
              )}
            </main>
          </div>
        </>
      )}

      {/* MODE 2: Python 3.12 Sandbox */}
      {labMode === "python-sandbox" && (
        <div className="practice-workspace-grid">
          <aside className="panel">
            <h4>Saxlanılmış Python Qaralamaları ({drafts.filter((d) => d.language === "python").length})</h4>
            {drafts.filter((d) => d.language === "python").length === 0 ? (
              <p className="muted">Hələ saxlanılmış Python qaralaması yoxdur.</p>
            ) : (
              <div className="section-nav-list">
                {drafts
                  .filter((d) => d.language === "python")
                  .map((d) => (
                    <div key={d.id} className="mistake-row">
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => {
                          setPyTitle(d.title);
                          setPyCode(d.code);
                          setPyStdin(d.stdin);
                          setPyOutput(d.last_output);
                        }}
                      >
                        {d.title}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={async () => {
                          await api.deleteLabDraft(d.id);
                          const dr = await api.getLabDrafts();
                          setDrafts(dr.drafts);
                        }}
                      >
                        Sil
                      </button>
                    </div>
                  ))}
              </div>
            )}
            <hr className="divider" />
            <small className="muted">
              <strong>Runtime sərhədi:</strong> Brauzer sandbox-ı təhlükəsiz WebAssembly daxilində <strong>Python 3.12 standart kitabxanasını</strong> (`math`, `statistics`, `json`, `re`, `sqlite3`, `collections`, `itertools`) işlədir. PyTorch, CUDA, scikit-learn, DuckDB və Docker layihələri lokal layihə mühitində icra edilir (bələdçi: <code>docs/LOCAL_ML_ENVIRONMENT.md</code>).
            </small>
          </aside>

          <main className="panel">
            <div className="panel-header-row">
              <input
                type="text"
                className="input-field"
                style={{ maxWidth: 320 }}
                value={pyTitle}
                onChange={(e) => setPyTitle(e.target.value)}
                placeholder="Skriptin adı..."
              />
              <div className="exercise-actions" style={{ marginTop: 0 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={handleFormatPython}>
                  Formatla (4 space)
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleSaveDraft("python")}
                >
                  Qaralamanı Saxla
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={pyRunning}
                  onClick={handleRunPythonSandbox}
                >
                  {pyRunning ? "İcra olunur..." : "▶ Run Python (Pyodide)"}
                </button>
              </div>
            </div>

            <textarea
              className="code-textarea"
              aria-label="Python sandbox kod redaktoru"
              rows={12}
              value={pyCode}
              onChange={(e) => setPyCode(e.target.value)}
              spellCheck={false}
            />

            <div className="form-group" style={{ marginTop: "0.75rem" }}>
              <label>Standard Input (`stdin` — `input()` funksiyası üçün)</label>
              <textarea
                className="input-textarea font-mono"
                rows={2}
                placeholder="Hər input() sətri üçün bir sətir yaz..."
                value={pyStdin}
                onChange={(e) => setPyStdin(e.target.value)}
              />
            </div>

            {draftMsg && <div className="feedback-box feedback-pass">{draftMsg}</div>}

            {pyOutput && (
              <div className="stdout-box" style={{ marginTop: "0.75rem" }}>
                <strong>Output (stdout):</strong>
                <pre className="solution-code">{pyOutput}</pre>
              </div>
            )}

            {pyError && (
              <div className="feedback-box feedback-fail">
                <div className="panel-header-row">
                  <strong>Xəta (Traceback):</strong>
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() =>
                      onAskMentor({
                        codeSnippet: pyCode,
                        errorOutput: pyError,
                        title: `Python Sandbox Xətası: ${pyTitle}`,
                      })
                    }
                  >
                    AI Mentordan xətanı izah etməsini istə →
                  </button>
                </div>
                <pre className="solution-code">{pyError}</pre>
              </div>
            )}
          </main>
        </div>
      )}

      {/* MODE 3: Isolated In-Memory SQLite SQL Sandbox */}
      {labMode === "sql-sandbox" && (
        <div className="practice-workspace-grid">
          <aside className="panel">
            <h4>Saxlanılmış SQL Sorğuları ({drafts.filter((d) => d.language === "sql").length})</h4>
            {drafts.filter((d) => d.language === "sql").length === 0 ? (
              <p className="muted">Hələ saxlanılmış SQL sorğusu yoxdur.</p>
            ) : (
              <div className="section-nav-list">
                {drafts
                  .filter((d) => d.language === "sql")
                  .map((d) => (
                    <div key={d.id} className="mistake-row">
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => {
                          setSqlTitle(d.title);
                          setSqlQuery(d.code);
                          setSqlSetup(d.stdin);
                        }}
                      >
                        {d.title}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={async () => {
                          await api.deleteLabDraft(d.id);
                          const dr = await api.getLabDrafts();
                          setDrafts(dr.drafts);
                        }}
                      >
                        Sil
                      </button>
                    </div>
                  ))}
              </div>
            )}
            <hr className="divider" />
            <small className="muted">
              Hər icrada təmiz, izolyasiya olunmuş `:memory:` SQLite verilənlər bazası yaradılır — sənin əsas öyrənmə bazana heç vaxt toxunmur.
            </small>
          </aside>

          <main className="panel">
            <div className="panel-header-row">
              <input
                type="text"
                className="input-field"
                aria-label="SQL sorğusunun adı"
                style={{ maxWidth: 320 }}
                value={sqlTitle}
                onChange={(e) => setSqlTitle(e.target.value)}
              />
              <div className="exercise-actions" style={{ marginTop: 0 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleSaveDraft("sql")}
                >
                  SQL-i Saxla
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={sqlRunning}
                  onClick={handleRunSql}
                >
                  {sqlRunning ? "İcra olunur..." : "▶ Run SQL Query"}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label>Sxem və Nümunə Data (Setup SQL — CREATE TABLE / INSERT)</label>
              <textarea
                className="code-textarea"
                rows={6}
                value={sqlSetup}
                onChange={(e) => setSqlSetup(e.target.value)}
                spellCheck={false}
              />
            </div>

            <div className="form-group">
              <label>Analitik Sorğu (SELECT / JOIN / GROUP BY / EXPLAIN QUERY PLAN)</label>
              <textarea
                className="code-textarea"
                rows={6}
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                spellCheck={false}
              />
            </div>

            {draftMsg && <div className="feedback-box feedback-pass">{draftMsg}</div>}

            {sqlResult && (
              <div style={{ marginTop: "0.75rem" }}>
                {!sqlResult.ok ? (
                  <div className="feedback-box feedback-fail">
                    <strong>SQL Xətası:</strong> {sqlResult.error}
                  </div>
                ) : (
                  <div className="test-results-box">
                    <div className="panel-header-row">
                      <strong>Nəticə ({sqlResult.rows.length} sətir)</strong>
                      <span className="badge badge-muted">{sqlResult.elapsedMs} ms</span>
                    </div>
                    <div className="table-responsive">
                      <table className="data-table">
                        <thead>
                          <tr>
                            {sqlResult.columns.map((col) => (
                              <th key={col}>{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sqlResult.rows.map((row, idx) => (
                            <tr key={idx}>
                              {sqlResult.columns.map((col) => (
                                <td key={col}>{String(row[col] ?? "NULL")}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
