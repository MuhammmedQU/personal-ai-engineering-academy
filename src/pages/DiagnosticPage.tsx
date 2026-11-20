import React, { useEffect, useState } from "react";
import { api } from "../api.ts";
import { MarkdownView } from "../components/MarkdownView.tsx";
import type { DiagnosticSummary, ExerciseView } from "../types.ts";

interface DiagnosticPageProps {
  initialName: string;
  initialGoalId: string;
  initialWeeklyHours: number;
  existingSummary: DiagnosticSummary | null;
  onComplete: () => void;
  onOpenLesson: (lessonId: string) => void;
  onOpenProject: (projectId: string) => void;
}

const RATING_LABELS = [
  { value: 0, label: "Bilmirəm / Heç işləməmişəm" },
  { value: 1, label: "Başlanğıc (nümunəyə baxaraq)" },
  { value: 2, label: "Tanışam (əsasları bilirəm)" },
  { value: 3, label: "Müstəqil tətbiq edirəm" },
];

export function DiagnosticPage({
  initialName,
  initialGoalId,
  initialWeeklyHours,
  existingSummary,
  onComplete,
  onOpenLesson,
  onOpenProject,
}: DiagnosticPageProps) {
  const [loading, setLoading] = useState(true);
  const [areas, setAreas] = useState<
    Array<{
      id: string;
      title: string;
      description: string;
      self_rating_prompt: string;
      related_modules: string[];
    }>
  >([]);
  const [goals, setGoals] = useState<Array<{ id: string; label: string; focus_modules: string[] }>>(
    [],
  );
  const [checks, setChecks] = useState<Array<{ area: string; question: ExerciseView }>>([]);

  // Multi-step screen state (max 8 questions per screen!)
  // Step 0: Goals, weekly time & self-rating (7 areas)
  // Step 1: Practical verification Part 1 (first 7 checks)
  // Step 2: Practical verification Part 2 (remaining checks)
  // Step 3: Diagnostic Report & Study Plan
  const [step, setStep] = useState<number>(existingSummary ? 3 : 0);
  const [name, setName] = useState<string>(initialName);
  const [goalId, setGoalId] = useState<string>(initialGoalId);
  const [weeklyHours, setWeeklyHours] = useState<number>(initialWeeklyHours);
  const [selfRatings, setSelfRatings] = useState<Record<string, number>>({});
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<DiagnosticSummary | null>(existingSummary);
  const [checkResults, setCheckResults] = useState<
    Record<string, { passed: boolean; skipped: boolean; feedback: string; explanation: string }> | null
  >(null);

  useEffect(() => {
    api
      .getDiagnostic()
      .then((data) => {
        setAreas(data.areas);
        setGoals(data.goals);
        setChecks(data.checks);
        const initRatings: Record<string, number> = {};
        for (const a of data.areas) initRatings[a.id] = 1;
        setSelfRatings(initRatings);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="panel">Diaqnostika sualları yüklənir...</div>;
  }

  const part1Checks = checks.slice(0, 7);
  const part2Checks = checks.slice(7);

  const handleSubmitDiagnostic = async () => {
    setSubmitting(true);
    try {
      const res = await api.submitDiagnostic({
        name,
        goalId,
        weeklyHours,
        selfRatings,
        answers,
      });
      setSummary(res.summary);
      setCheckResults(res.results);
      setStep(3);
      onComplete();
    } finally {
      setSubmitting(false);
    }
  };

  const renderCheckQuestion = (chk: { area: string; question: ExerciseView }, idx: number) => {
    const q = chk.question;
    const areaTitle = areas.find((a) => a.id === chk.area)?.title ?? chk.area;
    const currentAns = answers[q.id];
    const isDontKnow = currentAns === "dont_know";

    return (
      <div key={q.id} className="diag-question-card">
        <div className="diag-q-header">
          <span className="badge badge-category">{areaTitle}</span>
          <span className="diag-q-num">Sual #{idx + 1}</span>
        </div>
        <h4>{q.title}</h4>
        <MarkdownView content={q.prompt} />

        {q.type === "mcq" && (
          <div className="exercise-options">
            {q.options?.map((opt) => (
              <label
                key={opt.id}
                className={`option-label ${currentAns === opt.id ? "option-selected" : ""}`}
              >
                <input
                  type="radio"
                  name={`diag-${q.id}`}
                  checked={currentAns === opt.id}
                  onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: opt.id }))}
                />
                <span>{opt.text}</span>
              </label>
            ))}
          </div>
        )}

        {(q.type === "numeric" || q.type === "text") && (
          <div className="exercise-input-row">
            <input
              type="text"
              className="input-field"
              placeholder={
                q.type === "numeric" ? "Ədədi cavab yaz..." : "Cavabı yaz (məs. (32, 10) və ya 2)..."
              }
              value={isDontKnow ? "" : String(currentAns ?? "")}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
            />
          </div>
        )}

        <div className="diag-dont-know-row">
          <label className="option-label dont-know-option">
            <input
              type="checkbox"
              checked={isDontKnow}
              onChange={(e) =>
                setAnswers((prev) => ({
                  ...prev,
                  [q.id]: e.target.checked ? "dont_know" : "",
                }))
              }
            />
            <span>Bilmirəm (təxmin etmədən keç — mövzu tədris planına əlavə olunsun)</span>
          </label>
        </div>
      </div>
    );
  };

  return (
    <div className="diagnostic-page">
      <div className="page-header">
        <div>
          <h1>İlkin Diaqnostika və Fərdi Tədris Planı</h1>
          <p className="subtitle">
            Məqsədimiz səni imtahan etmək deyil — real başlanğıc nöqtəni tapmaqdır. Özünü-qiymətləndirmə təkbaşına mastery sayılmır; qısa praktik suallarla yoxlanılır. &ldquo;Bilmirəm&rdquo; seçmək tam normaldır.
          </p>
        </div>
        <div className="step-pills">
          <span className={`step-pill ${step === 0 ? "active" : ""}`}>1. Hədəf & Özünü-qiymətləndirmə</span>
          <span className={`step-pill ${step === 1 ? "active" : ""}`}>2. Praktik Yoxlama (I)</span>
          <span className={`step-pill ${step === 2 ? "active" : ""}`}>3. Praktik Yoxlama (II)</span>
          <span className={`step-pill ${step === 3 ? "active" : ""}`}>4. Nəticə & Plan</span>
        </div>
      </div>

      {step === 0 && (
        <div className="panel">
          <h2>Addım 1/3: Hədəfin, Vaxtın və Sahələr üzrə Tanışlığın (7 sual)</h2>
          <div className="form-grid-3">
            <div className="form-group">
              <label>Adın</label>
              <input
                type="text"
                className="input-field"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Əsas öyrənmə hədəfin</label>
              <select
                className="input-field"
                value={goalId}
                onChange={(e) => setGoalId(e.target.value)}
              >
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Həftəlik ayıra biləcəyin vaxt (saat)</label>
              <input
                type="number"
                min={2}
                max={40}
                className="input-field"
                value={weeklyHours}
                onChange={(e) => setWeeklyHours(Number(e.target.value) || 8)}
              />
            </div>
          </div>

          <hr className="divider" />
          <h3>Sahələr üzrə özünü-qiymətləndirmə (maksimum 7 sahə)</h3>
          <div className="diag-areas-list">
            {areas.map((a) => (
              <div key={a.id} className="diag-area-row">
                <div className="diag-area-info">
                  <strong>{a.title}</strong>
                  <p>{a.self_rating_prompt}</p>
                </div>
                <div className="diag-rating-choices">
                  {RATING_LABELS.map((rl) => (
                    <label
                      key={rl.value}
                      className={`rating-chip ${
                        (selfRatings[a.id] ?? 1) === rl.value ? "rating-chip-active" : ""
                      }`}
                    >
                      <input
                        type="radio"
                        name={`rate-${a.id}`}
                        checked={(selfRatings[a.id] ?? 1) === rl.value}
                        onChange={() =>
                          setSelfRatings((prev) => ({ ...prev, [a.id]: rl.value }))
                        }
                      />
                      <span>{rl.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="wizard-actions">
            <button type="button" className="btn btn-primary" onClick={() => setStep(1)}>
              Növbəti: Praktik Yoxlama (1/2) →
            </button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="panel">
          <h2>Addım 2/3: Qısa Praktik Yoxlama — Hissə 1 ({part1Checks.length} sual)</h2>
          <p className="subtitle">
            Əmin olmadığın sualda təxmin etmək əvəzinə &ldquo;Bilmirəm&rdquo; işarələyə bilərsən.
          </p>
          <div className="diag-questions-grid">
            {part1Checks.map((chk, idx) => renderCheckQuestion(chk, idx))}
          </div>
          <div className="wizard-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setStep(0)}>
              ← Geri
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setStep(2)}>
              Növbəti: Praktik Yoxlama (2/2) →
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="panel">
          <h2>Addım 3/3: Qısa Praktik Yoxlama — Hissə 2 ({part2Checks.length} sual)</h2>
          <div className="diag-questions-grid">
            {part2Checks.map((chk, idx) =>
              renderCheckQuestion(chk, part1Checks.length + idx),
            )}
          </div>
          <div className="wizard-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>
              ← Geri
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={submitting}
              onClick={handleSubmitDiagnostic}
            >
              {submitting ? "Qiymətləndirilir..." : "Diaqnostikanı Tamamla və Planı Yarat"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && summary && (
        <div className="diag-report">
          <div className="panel">
            <div className="panel-header-row">
              <div>
                <h2>Diaqnostika Nəticəsi və Çevik Tədris Planı</h2>
                <p className="subtitle">
                  Qeyd: Bu plan sabit müddətə &ldquo;işə düzəlmə zəmanəti&rdquo; deyil — sənin həftəlik {summary.weeklyHours} saat büdcənə və göstərdiyin faktiki nəticələrə uyğunlaşan yol xəritəsidir.
                </p>
              </div>
              <button type="button" className="btn btn-secondary" onClick={() => setStep(0)}>
                Diaqnostikanı yenidən keç
              </button>
            </div>

            <div className="cards-grid-3">
              <div className="stat-card stat-strong">
                <h3>Güclü Sahələr ({summary.strongAreas.length})</h3>
                {summary.strongAreas.length === 0 ? (
                  <p className="muted">Hələ tam təsdiqlənmiş sahə yoxdur — dərslərdə praktik sübut toplandıqca bura dolacaq.</p>
                ) : (
                  <ul>
                    {summary.strongAreas.map((a) => (
                      <li key={a.areaId}>
                        <strong>{a.title}</strong> ({a.checksCorrect}/{a.checksTotal}) — {a.note}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="stat-card stat-partial">
                <h3>Qismən / Təkrar Lazım Olanlar ({summary.partialAreas.length})</h3>
                {summary.partialAreas.length === 0 ? (
                  <p className="muted">Yoxdur</p>
                ) : (
                  <ul>
                    {summary.partialAreas.map((a) => (
                      <li key={a.areaId}>
                        <strong>{a.title}</strong> ({a.checksCorrect}/{a.checksTotal}) — {a.note}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="stat-card stat-missing">
                <h3>Yeni Öyrəniləcək Sahələr ({summary.missingAreas.length})</h3>
                {summary.missingAreas.length === 0 ? (
                  <p className="muted">Yoxdur</p>
                ) : (
                  <ul>
                    {summary.missingAreas.map((a) => (
                      <li key={a.areaId}>
                        <strong>{a.title}</strong> ({a.checksCorrect}/{a.checksTotal}) — {a.note}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <div className="panel">
            <h3>İlk 3 Konkret Addım (İndi başla)</h3>
            <div className="cards-grid-3">
              {summary.firstThreeActions.map((act, i) => (
                <div key={i} className="action-card">
                  <span className="badge badge-type">Addım #{i + 1}</span>
                  <h4>{act.title}</h4>
                  <p>{act.reason}</p>
                  {act.type === "lesson" ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => onOpenLesson(act.id)}
                    >
                      Dərsə keç →
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onOpenProject(act.id)}
                    >
                      Layihəni aç →
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {checkResults && (
            <div className="panel">
              <h3>Praktik Yoxlama Suallarının İcmalı</h3>
              <div className="diag-results-list">
                {checks.map((chk) => {
                  const r = checkResults[chk.question.id];
                  if (!r) return null;
                  return (
                    <div
                      key={chk.question.id}
                      className={`diag-result-item ${
                        r.passed ? "res-pass" : r.skipped ? "res-skip" : "res-fail"
                      }`}
                    >
                      <div>
                        <strong>{chk.question.title}:</strong>{" "}
                        <span>
                          {r.passed ? "✓ Doğru" : r.skipped ? "○ Bilmirəm seçildi" : "✗ Səhv"}
                        </span>{" "}
                        — {r.feedback}
                      </div>
                      <small className="muted">{r.explanation}</small>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="panel">
            <h3>Asılılıqlara Uyğun Tədris Planı (Həftəlik {summary.weeklyHours} saat üçün təxmini aralıq)</h3>
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Mərhələ</th>
                    <th>Modul</th>
                    <th>Track</th>
                    <th>Status</th>
                    <th>Təxmini həcm</th>
                    <th>Səbəb</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.studyPlan.map((sp) => (
                    <tr key={sp.moduleId}>
                      <td>#{sp.phase}</td>
                      <td>
                        <strong>{sp.moduleTitle}</strong>
                      </td>
                      <td>{sp.trackTitle}</td>
                      <td>
                        <span
                          className={`badge ${
                            sp.status === "authored" ? "badge-success" : "badge-muted"
                          }`}
                        >
                          {sp.status === "authored"
                            ? `${sp.lessonIds.length} tam dərs`
                            : "Roadmap (planned)"}
                        </span>
                      </td>
                      <td>
                        {sp.effortHours[0]}–{sp.effortHours[1]} saat (~{sp.estimatedWeeksRange[0]}–
                        {sp.estimatedWeeksRange[1]} həftə)
                      </td>
                      <td>{sp.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
