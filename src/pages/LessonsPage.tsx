import React, { useEffect, useState } from "react";
import { api } from "../api.ts";
import { ExerciseCard } from "../components/ExerciseCard.tsx";
import { MarkdownView } from "../components/MarkdownView.tsx";
import type { BookmarkItem, LessonView, NoteItem, TrackView } from "../types.ts";

interface LessonsPageProps {
  tracks: TrackView[];
  activeLessonId: string | null;
  initialSectionId?: string | null;
  onSelectLesson: (lessonId: string, sectionId?: string | null) => void;
  onProgressUpdated: () => void;
  onAskMentor: (context: {
    lessonId?: string;
    sectionId?: string;
    exerciseId?: string;
    codeSnippet?: string;
    title: string;
  }) => void;
}

const SECTION_KIND_LABELS: Record<string, string> = {
  explanation: "İzah (Concept)",
  analogy: "Mental Model / Analogiya",
  diagram: "Vizual Diaqram",
  worked_example: "Rəqəmlərlə Nümunə",
  code: "Kod Təhlili",
  mistakes: "Səhvlər & Debugging",
  tradeoffs: "Mühəndislik Trade-offs",
  deep_dive: "Dərinləşmə",
};

export function LessonsPage({
  tracks,
  activeLessonId,
  initialSectionId,
  onSelectLesson,
  onProgressUpdated,
  onAskMentor,
}: LessonsPageProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lessonData, setLessonData] = useState<{
    lesson: LessonView;
    prereqLessons: Array<{ id: string; title: string }>;
    nextLesson: { id: string; title: string } | null;
    progress: {
      status: string;
      lastSectionId: string | null;
      understoodSections: string[];
      unclearSections: string[];
    };
    exerciseAttempts: Record<
      string,
      Array<{
        id: number;
        passed: boolean;
        usedHint: boolean;
        revealedSolution: boolean;
        answer: unknown;
        feedback: string;
        createdAt: string;
      }>
    >;
    quizAttempts: Array<{
      id: number;
      score: number;
      passed: boolean;
      details: Record<string, { passed: boolean; feedback: string; explanation: string }>;
      createdAt: string;
    }>;
    notes: NoteItem[];
    bookmarks: BookmarkItem[];
  } | null>(null);

  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"sections" | "quiz" | "exercises" | "notes">(
    "sections",
  );
  const [showGlossary, setShowGlossary] = useState<boolean>(true);

  // Quiz state
  const [quizAnswers, setQuizAnswers] = useState<Record<string, unknown>>({});
  const [quizSubmitting, setQuizSubmitting] = useState(false);
  const [quizResult, setQuizResult] = useState<{
    score: number;
    correct: number;
    total: number;
    passThreshold: number;
    passed: boolean;
    details: Record<string, { passed: boolean; feedback: string; explanation: string }>;
    lessonCompleted: boolean;
  } | null>(null);

  // Note state
  const [noteInput, setNoteInput] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const loadLesson = async (id: string) => {
    setLoading(true);
    setError(null);
    setQuizResult(null);
    setQuizAnswers({});
    try {
      const data = await api.getLesson(id);
      setLessonData(data);
      const targetSec =
        initialSectionId && data.lesson.sections.some((s) => s.id === initialSectionId)
          ? initialSectionId
          : data.progress.lastSectionId &&
              data.lesson.sections.some((s) => s.id === data.progress.lastSectionId)
            ? data.progress.lastSectionId
            : data.lesson.sections[0]?.id ?? null;
      setActiveSectionId(targetSec);
      onProgressUpdated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeLessonId) {
      loadLesson(activeLessonId);
    }
  }, [activeLessonId]);

  const handleSelectSection = async (secId: string) => {
    setActiveSectionId(secId);
    if (!lessonData) return;
    const res = await api.updateLessonSection(lessonData.lesson.id, { sectionId: secId });
    setLessonData((prev) =>
      prev
        ? {
            ...prev,
            progress: {
              ...prev.progress,
              lastSectionId: res.lastSectionId,
              understoodSections: res.understoodSections,
              unclearSections: res.unclearSections,
            },
          }
        : prev,
    );
  };

  const handleMarkSection = async (secId: string, mark: "understood" | "unclear" | "clear") => {
    if (!lessonData) return;
    const res = await api.updateLessonSection(lessonData.lesson.id, {
      sectionId: secId,
      mark,
    });
    setLessonData((prev) =>
      prev
        ? {
            ...prev,
            progress: {
              ...prev.progress,
              lastSectionId: res.lastSectionId,
              understoodSections: res.understoodSections,
              unclearSections: res.unclearSections,
            },
          }
        : prev,
    );
    onProgressUpdated();
  };

  const handleToggleBookmark = async () => {
    if (!lessonData) return;
    await api.toggleBookmark({
      targetType: "lesson",
      targetId: lessonData.lesson.id,
      sectionId: activeSectionId,
      label: `${lessonData.lesson.title}${activeSectionId ? ` (${activeSectionId})` : ""}`,
    });
    const updated = await api.getLesson(lessonData.lesson.id);
    setLessonData(updated);
    onProgressUpdated();
  };

  const handleSaveNote = async () => {
    if (!lessonData || !noteInput.trim()) return;
    setSavingNote(true);
    try {
      await api.saveNote({
        lessonId: lessonData.lesson.id,
        sectionId: activeSectionId,
        content: noteInput.trim(),
      });
      setNoteInput("");
      const updated = await api.getLesson(lessonData.lesson.id);
      setLessonData(updated);
      onProgressUpdated();
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteNote = async (id: number) => {
    if (!lessonData) return;
    await api.deleteNote(id);
    const updated = await api.getLesson(lessonData.lesson.id);
    setLessonData(updated);
    onProgressUpdated();
  };

  const handleSubmitQuiz = async () => {
    if (!lessonData) return;
    setQuizSubmitting(true);
    try {
      const res = await api.submitQuiz(lessonData.lesson.id, quizAnswers);
      setQuizResult(res);
      const updated = await api.getLesson(lessonData.lesson.id);
      setLessonData(updated);
      onProgressUpdated();
    } finally {
      setQuizSubmitting(false);
    }
  };

  const allLessonsFlat = tracks.flatMap((t) =>
    t.modules.flatMap((m) =>
      m.lessonSummaries.map((ls) => ({
        ...ls,
        trackCode: t.code,
        trackTitle: t.title,
        moduleTitle: m.title,
      })),
    ),
  );

  if (!activeLessonId) {
    return (
      <div className="lessons-catalog-page">
        <div className="page-header">
          <div>
            <h1>Dərslər Kataloqu ({allLessonsFlat.length} Tam İnteraktiv Dərs)</h1>
            <p className="subtitle">
              Hər bir dərs nəzəriyyə, İngilis-Azərbaycan texniki lüğəti, analogiya, diaqram, kiçik rəqəmli nümunə, kod təhlili, tipik səhvlər, mühəndislik trade-off-ları, quiz və praktik kod tapşırıqlarından ibarətdir.
            </p>
          </div>
        </div>
        <div className="lessons-catalog-grid">
          {allLessonsFlat.map((ls) => (
            <div key={ls.id} className="lesson-catalog-card panel">
              <div className="exercise-badges">
                <span className="badge badge-category">
                  Track {ls.trackCode}: {ls.moduleTitle}
                </span>
                <span className="badge badge-type">{ls.level}</span>
                <span className="badge badge-diff">
                  {ls.estimated_minutes[0]}–{ls.estimated_minutes[1]} dəq
                </span>
                <span
                  className={`badge ${
                    ls.status === "completed"
                      ? "badge-success"
                      : ls.status === "in_progress"
                        ? "badge-type"
                        : "badge-muted"
                  }`}
                >
                  {ls.status === "completed"
                    ? "✓ Tamamlanıb"
                    : ls.status === "in_progress"
                      ? "Davam edir"
                      : "Başlanmayıb"}
                </span>
              </div>
              <h3>{ls.title}</h3>
              <p className="muted">{ls.summary}</p>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => onSelectLesson(ls.id)}
              >
                Dərsi Aç →
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (loading || !lessonData) {
    return (
      <div className="panel">
        {error ? (
          <div>
            <p className="text-danger">Xəta: {error}</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onSelectLesson("")}
            >
              ← Dərslər siyahısına qayıt
            </button>
          </div>
        ) : (
          "Dərs yüklənir..."
        )}
      </div>
    );
  }

  const { lesson, prereqLessons, nextLesson, progress, exerciseAttempts, quizAttempts, notes, bookmarks } =
    lessonData;
  const currentSection =
    lesson.sections.find((s) => s.id === activeSectionId) ?? lesson.sections[0];
  const currentSectionIndex = lesson.sections.findIndex((s) => s.id === currentSection?.id);
  const isUnderstood = currentSection
    ? progress.understoodSections.includes(currentSection.id)
    : false;
  const isUnclear = currentSection
    ? progress.unclearSections.includes(currentSection.id)
    : false;
  const isBookmarked = bookmarks.length > 0;

  return (
    <div className="lesson-player-page">
      {/* Top Breadcrumb & Actions */}
      <div className="lesson-topbar">
        <div className="lesson-breadcrumbs">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onSelectLesson("")}
          >
            ← Bütün Dərslər
          </button>
          <span className="badge badge-category">{lesson.track}</span>
          <span className="badge badge-type">{lesson.level}</span>
          <span className="badge badge-diff">
            {lesson.estimated_minutes[0]}–{lesson.estimated_minutes[1]} dəq
          </span>
          <span
            className={`badge ${
              progress.status === "completed" ? "badge-success" : "badge-muted"
            }`}
          >
            {progress.status === "completed"
              ? "✓ Tamamlanıb (Quiz + Tapşırıq təsdiqlənib)"
              : "Oxunur / Məşqdə"}
          </span>
        </div>
        <div className="lesson-top-actions">
          <button
            type="button"
            className={`btn btn-sm ${isBookmarked ? "btn-primary" : "btn-secondary"}`}
            onClick={handleToggleBookmark}
          >
            {isBookmarked ? "★ Əlfəcinləndi" : "☆ Əlfəcinə əlavə et"}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() =>
              onAskMentor({
                lessonId: lesson.id,
                sectionId: currentSection?.id,
                title: `${lesson.title} — ${currentSection?.title ?? ""}`,
              })
            }
          >
            AI Mentordan soruş
          </button>
        </div>
      </div>

      {/* Lesson Header, Objectives & Why it matters */}
      <div className="panel lesson-hero-panel">
        <h1>{lesson.title}</h1>
        <p className="lesson-summary-lead">{lesson.summary}</p>

        <div className="cards-grid-2">
          <div className="objectives-box">
            <h3>Öyrənmə Hədəfləri (Learning Objectives)</h3>
            <ul>
              {lesson.objectives.map((obj, i) => (
                <li key={i}>{obj}</li>
              ))}
            </ul>
          </div>
          <div className="why-matters-box">
            <h3>Niyə Bu Konsept Vacibdir?</h3>
            <MarkdownView content={lesson.why_it_matters} />
          </div>
        </div>

        {/* Prerequisites & Next lesson links */}
        <div className="lesson-prereq-bar">
          <div>
            <strong>İlkin şərt dərslər:</strong>{" "}
            {prereqLessons.length === 0 ? (
              <span className="muted">Yoxdur (birbaşa başlaya bilərsən)</span>
            ) : (
              prereqLessons.map((pl) => (
                <button
                  key={pl.id}
                  type="button"
                  className="link-btn"
                  onClick={() => onSelectLesson(pl.id)}
                >
                  {pl.title}
                </button>
              ))
            )}
          </div>
          {nextLesson && (
            <div>
              <strong>Növbəti dərs:</strong>{" "}
              <button
                type="button"
                className="link-btn"
                onClick={() => onSelectLesson(nextLesson.id)}
              >
                {nextLesson.title} →
              </button>
            </div>
          )}
        </div>

        {/* English Technical Terms Glossary */}
        <div className="glossary-box">
          <div className="panel-header-row">
            <h4>İngilis Texniki Terminlər və Azərbaycan Dilində Tərifləri ({lesson.terms.length})</h4>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => setShowGlossary((v) => !v)}
            >
              {showGlossary ? "Gizlət" : "Göstər"}
            </button>
          </div>
          {showGlossary && (
            <div className="terms-grid">
              {lesson.terms.map((t, i) => (
                <div key={i} className="term-card">
                  <strong className="term-en">{t.term}</strong>
                  <p className="term-az">{t.definition}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Mode Tabs: Sections | Quiz | Exercises | Notes & Mastery */}
      <div className="lesson-mode-tabs">
        <button
          type="button"
          className={`mode-tab ${activeTab === "sections" ? "active" : ""}`}
          onClick={() => setActiveTab("sections")}
        >
          1. Dərs Bölmələri ({progress.understoodSections.length}/{lesson.sections.length} anlaşıldı)
        </button>
        <button
          type="button"
          className={`mode-tab ${activeTab === "quiz" ? "active" : ""}`}
          onClick={() => setActiveTab("quiz")}
        >
          2. Anlama Yoxlaması / Quiz ({lesson.quiz.questions.length} sual)
          {quizAttempts.some((q) => q.passed) && " ✓"}
        </button>
        <button
          type="button"
          className={`mode-tab ${activeTab === "exercises" ? "active" : ""}`}
          onClick={() => setActiveTab("exercises")}
        >
          3. Praktik Tapşırıqlar ({lesson.exercises.length})
        </button>
        <button
          type="button"
          className={`mode-tab ${activeTab === "notes" ? "active" : ""}`}
          onClick={() => setActiveTab("notes")}
        >
          4. Qeydlərim & Mənimsəmə ({notes.length})
        </button>
      </div>

      {/* TAB 1: Progressive Disclosure Lesson Sections */}
      {activeTab === "sections" && currentSection && (
        <div className="lesson-workspace-grid">
          <aside className="section-sidebar panel">
            <h4>Bölmələr (Progressive Disclosure)</h4>
            <div className="section-nav-list">
              {lesson.sections.map((sec, idx) => {
                const und = progress.understoodSections.includes(sec.id);
                const unc = progress.unclearSections.includes(sec.id);
                return (
                  <button
                    key={sec.id}
                    type="button"
                    className={`section-nav-item ${
                      sec.id === currentSection.id ? "active" : ""
                    }`}
                    onClick={() => handleSelectSection(sec.id)}
                  >
                    <span className="sec-num">{idx + 1}.</span>
                    <div className="sec-nav-text">
                      <span className="sec-nav-title">{sec.title}</span>
                      <small className="sec-nav-kind">
                        {SECTION_KIND_LABELS[sec.kind] ?? sec.kind}
                      </small>
                    </div>
                    {und && <span className="sec-status-badge sec-ok">✓</span>}
                    {unc && <span className="sec-status-badge sec-warn">?</span>}
                  </button>
                );
              })}
            </div>

            <div className="mastery-sidebar-box">
              <h5>Mastery Criteria</h5>
              <ul>
                {lesson.mastery_criteria.map((mc, i) => (
                  <li key={i}>{mc}</li>
                ))}
              </ul>
            </div>
          </aside>

          <main className="section-content-panel panel">
            <div className="section-header-bar">
              <div>
                <span className="badge badge-type">
                  Bölmə {currentSectionIndex + 1}/{lesson.sections.length}:{" "}
                  {SECTION_KIND_LABELS[currentSection.kind] ?? currentSection.kind}
                </span>
                <h2>{currentSection.title}</h2>
              </div>
              <div className="section-understanding-controls">
                <button
                  type="button"
                  className={`btn btn-sm ${isUnderstood ? "btn-success" : "btn-secondary"}`}
                  onClick={() =>
                    handleMarkSection(
                      currentSection.id,
                      isUnderstood ? "clear" : "understood",
                    )
                  }
                >
                  {isUnderstood ? "✓ Başa düşdüm" : "Başa düşdüm kimi işarələ"}
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${isUnclear ? "btn-warning" : "btn-secondary"}`}
                  onClick={() =>
                    handleMarkSection(currentSection.id, isUnclear ? "clear" : "unclear")
                  }
                >
                  {isUnclear ? "? Qarışıqdır (İşarələnib)" : "? Qarışıqdır"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    onAskMentor({
                      lessonId: lesson.id,
                      sectionId: currentSection.id,
                      title: `${lesson.title} -> ${currentSection.title}`,
                    })
                  }
                >
                  Bu bölməni Mentordan soruş
                </button>
              </div>
            </div>

            <div className="section-markdown-container">
              <MarkdownView content={currentSection.body} />
            </div>

            {/* Quick Section Note Input */}
            <div className="quick-note-bar">
              <input
                type="text"
                className="input-field"
                placeholder={`"${currentSection.title}" bölməsi üzrə qısa qeyd əlavə et...`}
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={savingNote || !noteInput.trim()}
                onClick={handleSaveNote}
              >
                Qeydi saxla
              </button>
            </div>

            {/* Section Pager */}
            <div className="section-pager">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={currentSectionIndex <= 0}
                onClick={() =>
                  currentSectionIndex > 0 &&
                  handleSelectSection(lesson.sections[currentSectionIndex - 1].id)
                }
              >
                ← Əvvəlki bölmə
              </button>

              {currentSectionIndex < lesson.sections.length - 1 ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    handleSelectSection(lesson.sections[currentSectionIndex + 1].id)
                  }
                >
                  Növbəti bölmə: {lesson.sections[currentSectionIndex + 1].title} →
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setActiveTab("quiz")}
                >
                  Bölmələr bitdi — Quiz-ə keç →
                </button>
              )}
            </div>
          </main>
        </div>
      )}

      {/* TAB 2: Comprehension Check (Quiz) */}
      {activeTab === "quiz" && (
        <div className="panel">
          <div className="panel-header-row">
            <div>
              <h2>Qısa Anlama Yoxlaması (Comprehension Check)</h2>
              <p className="subtitle">
                Keçid həddi: {Math.round(lesson.quiz.pass_threshold * 100)}%. Hər sualın cavabı səbəbi ilə birlikdə izah olunur.
              </p>
            </div>
            {quizAttempts.length > 0 && (
              <span className="badge badge-type">
                Son nəticə: {Math.round(quizAttempts[0].score * 100)}% (
                {quizAttempts[0].passed ? "Keçdi" : "Keçmədi"})
              </span>
            )}
          </div>

          <div className="quiz-questions-list">
            {lesson.quiz.questions.map((q, idx) => {
              const ans = quizAnswers[q.id];
              const det = quizResult?.details[q.id];
              return (
                <div key={q.id} className="quiz-question-card">
                  <div className="exercise-badges">
                    <span className="badge badge-type">Sual #{idx + 1}</span>
                    <span className="badge badge-category">{q.category}</span>
                  </div>
                  <h3>{q.title}</h3>
                  <MarkdownView content={q.prompt} />

                  {q.type === "mcq" && (
                    <div className="exercise-options">
                      {q.options?.map((opt) => (
                        <label
                          key={opt.id}
                          className={`option-label ${ans === opt.id ? "option-selected" : ""}`}
                        >
                          <input
                            type="radio"
                            name={`quiz-${q.id}`}
                            checked={ans === opt.id}
                            onChange={() =>
                              setQuizAnswers((prev) => ({ ...prev, [q.id]: opt.id }))
                            }
                          />
                          <span>{opt.text}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  {q.type === "multi" && (
                    <div className="exercise-options">
                      {q.options?.map((opt) => {
                        const arr = Array.isArray(ans) ? (ans as string[]) : [];
                        const checked = arr.includes(opt.id);
                        return (
                          <label
                            key={opt.id}
                            className={`option-label ${checked ? "option-selected" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const next = checked
                                  ? arr.filter((x) => x !== opt.id)
                                  : [...arr, opt.id];
                                setQuizAnswers((prev) => ({ ...prev, [q.id]: next }));
                              }}
                            />
                            <span>{opt.text}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {(q.type === "numeric" || q.type === "text") && (
                    <div className="exercise-input-row">
                      <input
                        type="text"
                        className="input-field font-mono"
                        placeholder={
                          q.type === "numeric" ? "Ədədi cavab..." : "Output və ya qısa cavab..."
                        }
                        value={String(ans ?? "")}
                        onChange={(e) =>
                          setQuizAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                        }
                      />
                    </div>
                  )}

                  {q.type === "order" && (
                    <div className="order-list">
                      {((ans as Array<{ id: string; text: string }>) ?? q.items ?? []).map(
                        (item, i, arr) => (
                          <div key={item.id} className="order-item">
                            <span className="order-index">{i + 1}.</span>
                            <span className="order-text">{item.text}</span>
                            <div className="order-controls">
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs"
                                disabled={i === 0}
                                onClick={() => {
                                  const copy = [...arr];
                                  [copy[i - 1], copy[i]] = [copy[i], copy[i - 1]];
                                  setQuizAnswers((prev) => ({ ...prev, [q.id]: copy }));
                                }}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs"
                                disabled={i === arr.length - 1}
                                onClick={() => {
                                  const copy = [...arr];
                                  [copy[i + 1], copy[i]] = [copy[i], copy[i + 1]];
                                  setQuizAnswers((prev) => ({ ...prev, [q.id]: copy }));
                                }}
                              >
                                ↓
                              </button>
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  )}

                  {det && (
                    <div
                      className={`feedback-box ${
                        det.passed ? "feedback-pass" : "feedback-fail"
                      }`}
                    >
                      <strong>{det.passed ? "✓ Doğru:" : "✗ Səhv:"}</strong> {det.feedback}
                      <div className="feedback-explanation">
                        <MarkdownView content={det.explanation} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="wizard-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={quizSubmitting}
              onClick={() => {
                // Convert order object arrays to ID arrays if needed
                const normalized: Record<string, unknown> = {};
                for (const q of lesson.quiz.questions) {
                  const val = quizAnswers[q.id];
                  if (q.type === "order") {
                    const arr = (val as Array<{ id: string }>) ?? q.items ?? [];
                    normalized[q.id] = arr.map((x) => (typeof x === "string" ? x : x.id));
                  } else {
                    normalized[q.id] = val;
                  }
                }
                setQuizSubmitting(true);
                api
                  .submitQuiz(lesson.id, normalized)
                  .then(async (res) => {
                    setQuizResult(res);
                    const updated = await api.getLesson(lesson.id);
                    setLessonData(updated);
                    onProgressUpdated();
                  })
                  .finally(() => setQuizSubmitting(false));
              }}
            >
              {quizSubmitting ? "Yoxlanılır..." : "Quiz Cavablarını Təsdiqlə"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setActiveTab("exercises")}
            >
              Praktik Tapşırıqlara Keç →
            </button>
          </div>

          {quizResult && (
            <div
              className={`feedback-box ${
                quizResult.passed ? "feedback-pass" : "feedback-fail"
              }`}
            >
              <strong>
                Nəticə: {quizResult.correct}/{quizResult.total} (
                {Math.round(quizResult.score * 100)}%) —{" "}
                {quizResult.passed
                  ? "Təbriklər! İndi praktik tapşırığı həll edib dərsi tamamla."
                  : "Keçid həddinə çatmaq üçün izahları oxuyub yenidən cəhd et."}
              </strong>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Hands-On Exercises */}
      {activeTab === "exercises" && (
        <div className="lesson-exercises-section">
          <div className="panel">
            <h2>Praktik Tapşırıqlar (Hands-on Exercises)</h2>
            <p className="subtitle">
              Bacarığın &ldquo;Demonstrated&rdquo; statusuna keçməsi üçün tapşırıqları ipucu və hazır həll açmadan həll etməyə çalış. Kod tapşırıqları brauzerində real Python (Pyodide) ilə test olunur.
            </p>
          </div>
          {lesson.exercises.map((ex) => (
            <ExerciseCard
              key={ex.id}
              exercise={ex}
              lessonId={lesson.id}
              priorAttempts={exerciseAttempts[ex.id] ?? []}
              onAttemptComplete={async () => {
                const updated = await api.getLesson(lesson.id);
                setLessonData(updated);
                onProgressUpdated();
              }}
              onAskMentor={onAskMentor}
            />
          ))}
          {nextLesson && (
            <div className="panel next-lesson-cta">
              <div>
                <strong>Növbəti addım:</strong> {nextLesson.title}
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onSelectLesson(nextLesson.id)}
              >
                Növbəti dərsə keç →
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: Notes, References & Mastery Criteria */}
      {activeTab === "notes" && (
        <div className="cards-grid-2">
          <div className="panel">
            <h3>Bu Dərs üzrə Qeydlərim ({notes.length})</h3>
            <div className="form-group">
              <textarea
                className="input-textarea"
                rows={3}
                placeholder="Öz xülasəni, sualını və ya kod qeydini əlavə et..."
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={savingNote || !noteInput.trim()}
                onClick={handleSaveNote}
              >
                Qeydi əlavə et
              </button>
            </div>
            {notes.length === 0 ? (
              <p className="muted">Hələ qeyd yoxdur.</p>
            ) : (
              <div className="notes-list">
                {notes.map((n) => (
                  <div key={n.id} className="note-card">
                    <div className="note-card-header">
                      <span className="badge badge-muted">
                        {n.section_id ?? "Ümumi dərs qeydi"}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => handleDeleteNote(n.id)}
                      >
                        Sil
                      </button>
                    </div>
                    <p>{n.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <h3>Mənimsəmə Meyarları və Rəsmi Mənbələr</h3>
            <h4>Mastery Criteria:</h4>
            <ul>
              {lesson.mastery_criteria.map((mc, i) => (
                <li key={i}>{mc}</li>
              ))}
            </ul>
            {lesson.references.length > 0 && (
              <>
                <hr className="divider" />
                <h4>Rəsmi Sənədlər və İstinadlar:</h4>
                <ul>
                  {lesson.references.map((r, i) => (
                    <li key={i}>
                      <a href={r.url} target="_blank" rel="noreferrer">
                        {r.title}
                      </a>
                      {r.note ? ` — ${r.note}` : ""}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
