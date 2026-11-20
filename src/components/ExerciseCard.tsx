import React, { useState } from "react";
import { api } from "../api.ts";
import { runPythonInBrowser, type PyodideTestResult } from "../lib/pyodideRunner.ts";
import type { ExerciseView } from "../types.ts";
import { MarkdownView } from "./MarkdownView.tsx";

interface ExerciseCardProps {
  exercise: ExerciseView;
  lessonId?: string | null;
  priorAttempts?: Array<{
    id: number;
    passed: boolean;
    usedHint: boolean;
    revealedSolution: boolean;
    answer: unknown;
    feedback: string;
    createdAt: string;
  }>;
  onAttemptComplete?: () => void;
  onAskMentor?: (context: {
    exerciseId: string;
    lessonId?: string;
    codeSnippet?: string;
    title: string;
  }) => void;
}

export function ExerciseCard({
  exercise,
  lessonId,
  priorAttempts = [],
  onAttemptComplete,
  onAskMentor,
}: ExerciseCardProps) {
  const alreadyPassedUnaided = priorAttempts.some((a) => a.passed && !a.revealedSolution);

  // Per-type state
  const [mcqChoice, setMcqChoice] = useState<string>("");
  const [multiChoices, setMultiChoices] = useState<string[]>([]);
  const [numericVal, setNumericVal] = useState<string>("");
  const [textVal, setTextVal] = useState<string>("");
  const [orderItems, setOrderItems] = useState<Array<{ id: string; text: string }>>(
    () => exercise.items ?? [],
  );
  const [codeVal, setCodeVal] = useState<string>(() => exercise.starter_code ?? "");
  const [explainVal, setExplainVal] = useState<string>("");
  const [checkedRubric, setCheckedRubric] = useState<number[]>([]);

  // Hints & Solution reveal
  const [revealedHintsCount, setRevealedHintsCount] = useState<number>(0);
  const [revealedSolution, setRevealedSolution] = useState<{
    solution: unknown;
    explanation: string;
  } | null>(null);

  // Execution & grading feedback
  const [runningCode, setRunningCode] = useState<boolean>(false);
  const [pyStdout, setPyStdout] = useState<string>("");
  const [pyResults, setPyResults] = useState<PyodideTestResult[] | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [result, setResult] = useState<{
    passed: boolean;
    feedback: string;
    explanation?: string;
    optionFeedback?: Record<string, string>;
    modelAnswer?: string;
  } | null>(null);

  const usedHint = revealedHintsCount > 0;
  const didRevealSolution = revealedSolution !== null;

  const moveOrderItem = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= orderItems.length) return;
    const copy = [...orderItems];
    [copy[idx], copy[target]] = [copy[target], copy[idx]];
    setOrderItems(copy);
  };

  const toggleMulti = (id: string) => {
    setMultiChoices((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleRubric = (idx: number) => {
    setCheckedRubric((prev) =>
      prev.includes(idx) ? prev.filter((x) => x !== idx) : [...prev, idx],
    );
  };

  const handleRunAndSubmitCode = async () => {
    setRunningCode(true);
    setResult(null);
    try {
      const pyOut = await runPythonInBrowser(codeVal, exercise.tests ?? []);
      setPyStdout(pyOut.stdout);
      setPyResults(pyOut.testResults);

      const res = await api.submitExercise(exercise.id, {
        answer: { code: codeVal, testResults: pyOut.testResults },
        usedHint,
        revealedSolution: didRevealSolution,
      });
      setResult(res.grade);
      onAttemptComplete?.();
    } catch (err) {
      setResult({
        passed: false,
        feedback: (err as Error).message,
      });
    } finally {
      setRunningCode(false);
    }
  };

  const handleSubmitNonCode = async () => {
    setSubmitting(true);
    try {
      let answerPayload: unknown = null;
      switch (exercise.type) {
        case "mcq":
          answerPayload = mcqChoice;
          break;
        case "multi":
          answerPayload = multiChoices;
          break;
        case "numeric":
          answerPayload = numericVal;
          break;
        case "text":
          answerPayload = textVal;
          break;
        case "order":
          answerPayload = orderItems.map((i) => i.id);
          break;
        case "explain":
          answerPayload = { text: explainVal, checkedRubric };
          break;
      }
      const res = await api.submitExercise(exercise.id, {
        answer: answerPayload,
        usedHint,
        revealedSolution: didRevealSolution,
      });
      setResult(res.grade);
      onAttemptComplete?.();
    } catch (err) {
      setResult({
        passed: false,
        feedback: (err as Error).message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevealSolution = async () => {
    const res = await api.revealExercise(exercise.id);
    setRevealedSolution(res);
    onAttemptComplete?.();
  };

  return (
    <div className={`exercise-card ${result?.passed || alreadyPassedUnaided ? "exercise-passed" : ""}`}>
      <div className="exercise-header">
        <div>
          <div className="exercise-badges">
            <span className="badge badge-category">{exercise.category}</span>
            <span className="badge badge-type">{exercise.type.toUpperCase()}</span>
            <span className="badge badge-diff">Çətinlik: {exercise.difficulty}/3</span>
            {(alreadyPassedUnaided || (result?.passed && !didRevealSolution)) && (
              <span className="badge badge-success">Həll edilib</span>
            )}
          </div>
          <h3 className="exercise-title">{exercise.title}</h3>
        </div>
        {onAskMentor && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              onAskMentor({
                exerciseId: exercise.id,
                lessonId: lessonId ?? undefined,
                codeSnippet: exercise.type === "code" ? codeVal : undefined,
                title: exercise.title,
              })
            }
          >
            Mentordan ipucu istə
          </button>
        )}
      </div>

      <div className="exercise-prompt">
        <MarkdownView content={exercise.prompt} />
      </div>

      {/* ---- Type-specific workspace ---- */}
      {exercise.type === "mcq" && (
        <div className="exercise-options">
          {exercise.options?.map((opt) => (
            <label
              key={opt.id}
              className={`option-label ${mcqChoice === opt.id ? "option-selected" : ""}`}
            >
              <input
                type="radio"
                name={`mcq-${exercise.id}`}
                value={opt.id}
                checked={mcqChoice === opt.id}
                onChange={() => setMcqChoice(opt.id)}
              />
              <span>{opt.text}</span>
            </label>
          ))}
        </div>
      )}

      {exercise.type === "multi" && (
        <div className="exercise-options">
          {exercise.options?.map((opt) => (
            <label
              key={opt.id}
              className={`option-label ${multiChoices.includes(opt.id) ? "option-selected" : ""}`}
            >
              <input
                type="checkbox"
                checked={multiChoices.includes(opt.id)}
                onChange={() => toggleMulti(opt.id)}
              />
              <span>{opt.text}</span>
              {result?.optionFeedback?.[opt.id] && (
                <small className="option-inline-feedback">
                  — {result.optionFeedback[opt.id]}
                </small>
              )}
            </label>
          ))}
        </div>
      )}

      {exercise.type === "numeric" && (
        <div className="exercise-input-row">
          <input
            type="text"
            inputMode="decimal"
            className="input-field"
            placeholder="Ədədi cavab daxil et (məs. 0.75)"
            value={numericVal}
            onChange={(e) => setNumericVal(e.target.value)}
          />
          {exercise.unit && <span className="unit-label">{exercise.unit}</span>}
        </div>
      )}

      {exercise.type === "text" && (
        <div className="exercise-input-row">
          <input
            type="text"
            className="input-field font-mono"
            placeholder="Gözlənilən output və ya qısa cavab..."
            value={textVal}
            onChange={(e) => setTextVal(e.target.value)}
          />
        </div>
      )}

      {exercise.type === "order" && (
        <div className="order-list">
          {orderItems.map((item, idx) => (
            <div key={item.id} className="order-item">
              <span className="order-index">{idx + 1}.</span>
              <span className="order-text">{item.text}</span>
              <div className="order-controls">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  disabled={idx === 0}
                  onClick={() => moveOrderItem(idx, -1)}
                  aria-label="Yuxarı"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  disabled={idx === orderItems.length - 1}
                  onClick={() => moveOrderItem(idx, 1)}
                  aria-label="Aşağı"
                >
                  ↓
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {exercise.type === "code" && (
        <div className="code-workspace">
          <div className="code-editor-header">
            <span>Python 3.12 (Pyodide WebAssembly Sandbox — lokal brauzerdə icra olunur)</span>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => setCodeVal(exercise.starter_code ?? "")}
            >
              Starter koda sıfırla
            </button>
          </div>
          <textarea
            className="code-textarea"
            aria-label="Python kod redaktoru"
            rows={Math.max(8, (codeVal.match(/\n/g)?.length ?? 6) + 2)}
            value={codeVal}
            onChange={(e) => setCodeVal(e.target.value)}
            spellCheck={false}
          />
          {pyResults && (
            <div className="test-results-box">
              <div className="test-results-title">Test Nəticələri:</div>
              {pyResults.map((tr, i) => (
                <div
                  key={i}
                  className={`test-result-row ${tr.passed ? "test-pass" : "test-fail"}`}
                >
                  <span>{tr.passed ? "✓ KEÇDİ" : "✗ UĞURSUZ"}</span>
                  <strong>{tr.name}</strong>
                  {tr.error && <code className="test-error-msg">{tr.error}</code>}
                </div>
              ))}
              {pyStdout && (
                <div className="stdout-box">
                  <div className="stdout-label">stdout:</div>
                  <pre>{pyStdout}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {exercise.type === "explain" && (
        <div className="explain-workspace">
          <textarea
            className="input-textarea"
            rows={4}
            placeholder="İzahını öz sözlərinlə bura yaz (səbəb, risk və düzəliş)..."
            value={explainVal}
            onChange={(e) => setExplainVal(e.target.value)}
          />
          {exercise.rubric && (
            <div className="rubric-checklist">
              <div className="rubric-title">
                Özünü-yoxlama meyarları (yazdığın izahda qarşıladığın bəndləri işarələ):
              </div>
              {exercise.rubric.map((r, idx) => (
                <label key={idx} className="option-label">
                  <input
                    type="checkbox"
                    checked={checkedRubric.includes(idx)}
                    onChange={() => toggleRubric(idx)}
                  />
                  <span>{r}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- Staged Hints ---- */}
      {exercise.hints.length > 0 && revealedHintsCount > 0 && (
        <div className="hints-box">
          <strong>Mərhələli İpucu ({revealedHintsCount}/{exercise.hints.length}):</strong>
          <ol>
            {exercise.hints.slice(0, revealedHintsCount).map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ol>
        </div>
      )}

      {/* ---- Action Bar ---- */}
      <div className="exercise-actions">
        {exercise.type === "code" ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={runningCode}
            onClick={handleRunAndSubmitCode}
          >
            {runningCode ? "Python (Pyodide) işə salınır..." : "Run & Test (Pyodide)"}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={submitting}
            onClick={handleSubmitNonCode}
          >
            {submitting ? "Yoxlanılır..." : "Cavabı Yoxla"}
          </button>
        )}

        {exercise.hints.length > revealedHintsCount && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setRevealedHintsCount((c) => c + 1)}
          >
            İpucu göstər ({revealedHintsCount + 1}/{exercise.hints.length})
          </button>
        )}

        {!revealedSolution && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleRevealSolution}
            title="Həlli açdıqda bu cəhd Demonstrated sübutu kimi sayılmır"
          >
            Həlli göstər
          </button>
        )}
      </div>

      {/* ---- Feedback Box ---- */}
      {result && (
        <div className={`feedback-box ${result.passed ? "feedback-pass" : "feedback-fail"}`}>
          <div className="feedback-headline">
            <strong>{result.passed ? "Doğrudur!" : "Yenidən cəhd et:"}</strong> {result.feedback}
          </div>
          {result.explanation && (
            <div className="feedback-explanation">
              <strong>Niyə?</strong>
              <MarkdownView content={result.explanation} />
            </div>
          )}
          {result.modelAnswer && (
            <div className="feedback-model-answer">
              <strong>Nümunə Mühəndis Cavabı:</strong>
              <MarkdownView content={result.modelAnswer} />
            </div>
          )}
        </div>
      )}

      {/* ---- Revealed Solution Box ---- */}
      {revealedSolution && (
        <div className="revealed-solution-box">
          <div className="revealed-header">
            <strong>İstinad Həlli</strong>
            <small>
              (Qeyd: həll açıldığı üçün bu cəhd &ldquo;Demonstrated&rdquo; bacarıq sübutu kimi sayılmır — anladıqdan sonra özün yenidən yaz)
            </small>
          </div>
          {typeof revealedSolution.solution === "string" ? (
            <pre className="solution-code">
              <code>{revealedSolution.solution}</code>
            </pre>
          ) : (
            <pre className="solution-code">
              <code>{JSON.stringify(revealedSolution.solution, null, 2)}</code>
            </pre>
          )}
          <div className="feedback-explanation">
            <MarkdownView content={revealedSolution.explanation} />
          </div>
        </div>
      )}
    </div>
  );
}
