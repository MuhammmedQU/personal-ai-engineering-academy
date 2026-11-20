import React, { useEffect, useState } from "react";
import { api } from "../api.ts";
import { MarkdownView } from "../components/MarkdownView.tsx";
import type { BootstrapData } from "../types.ts";

interface MentorPageProps {
  data: BootstrapData;
  initialContext?: {
    lessonId?: string;
    sectionId?: string;
    exerciseId?: string;
    projectId?: string;
    codeSnippet?: string;
    errorOutput?: string;
    title?: string;
  } | null;
  onOpenLesson: (lessonId: string) => void;
}

export function MentorPage({ data, initialContext, onOpenLesson }: MentorPageProps) {
  const [selectedLessonId, setSelectedLessonId] = useState<string>(
    initialContext?.lessonId ?? data.profile.lastLessonId ?? "",
  );
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>(
    initialContext?.exerciseId ?? "",
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    initialContext?.projectId ?? data.profile.activeProjectId ?? "",
  );
  const [explanationLevel, setExplanationLevel] = useState<
    "beginner" | "intermediate" | "advanced"
  >(data.profile.explanationLevel ?? "intermediate");
  const [socraticMode, setSocraticMode] = useState<boolean>(data.profile.socraticMode ?? true);
  const [codeSnippet, setCodeSnippet] = useState<string>(initialContext?.codeSnippet ?? "");
  const [errorOutput, setErrorOutput] = useState<string>(initialContext?.errorOutput ?? "");
  const [showCodeBox, setShowCodeBox] = useState<boolean>(Boolean(initialContext?.codeSnippet));
  const [messageInput, setMessageInput] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);
  const [messages, setMessages] = useState<
    Array<{
      role: "user" | "assistant";
      content: string;
      action?: string;
      mode?: string;
      usage?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCostUsd: number | null;
      } | null;
      createdAt: string;
    }>
  >([]);
  const [referencedLessons, setReferencedLessons] = useState<Array<{ id: string; title: string }>>(
    [],
  );
  const [retentionPolicy, setRetentionPolicy] = useState<string>("");

  const contextId = selectedLessonId || "main";
  const contextType = selectedLessonId ? "lesson" : "global";

  useEffect(() => {
    if (initialContext) {
      if (initialContext.lessonId) setSelectedLessonId(initialContext.lessonId);
      if (initialContext.exerciseId) setSelectedExerciseId(initialContext.exerciseId);
      if (initialContext.projectId) setSelectedProjectId(initialContext.projectId);
      if (initialContext.codeSnippet) {
        setCodeSnippet(initialContext.codeSnippet);
        setShowCodeBox(true);
      }
      if (initialContext.errorOutput) {
        setErrorOutput(initialContext.errorOutput);
      }
    }
  }, [initialContext]);

  useEffect(() => {
    api.getMentorHistory(contextType, contextId).then((res) => {
      setMessages(res.messages);
      setRetentionPolicy(res.retentionPolicy);
    });
  }, [contextType, contextId]);

  const sendAction = async (
    action:
      | "chat"
      | "lesson-help"
      | "review-exercise"
      | "explain-code"
      | "study-plan"
      | "generate-exercise"
      | "explain-mistake",
    customMsg?: string,
  ) => {
    const text = (customMsg ?? messageInput).trim();
    if (!text) return;
    setSending(true);
    try {
      const res = await api.askMentor({
        action,
        message: text,
        contextType,
        contextId,
        context: {
          lessonId: selectedLessonId || undefined,
          sectionId: initialContext?.sectionId,
          exerciseId: selectedExerciseId || undefined,
          projectId: selectedProjectId || undefined,
          codeSnippet: codeSnippet.trim() || undefined,
          errorOutput: errorOutput.trim() || undefined,
          explanationLevel,
          socraticMode,
        },
      });
      setMessages(res.messages);
      setReferencedLessons(res.referencedLessons);
      if (!customMsg) setMessageInput("");
    } finally {
      setSending(false);
    }
  };

  const handleClearHistory = async () => {
    await api.clearMentorHistory(contextType, contextId);
    setMessages([]);
  };

  const allLessons = data.tracks.flatMap((t) =>
    t.modules.flatMap((m) => m.lessonSummaries),
  );

  return (
    <div className="mentor-page">
      <div className="page-header">
        <div>
          <h1>AI Engineering Mentor & Kod Təhlilçisi</h1>
          <p className="subtitle">
            Mentor sənin profilini, diaqnostika nəticəni, cari dərsini, tapşırıq tarixçəni və `.agents/skills/ai-engineering-tutor/SKILL.md` qaydalarını bilir: Azərbaycan dilində sadə izah edir, praktikada hazır cavab əvəzinə əvvəlcə ipucu verir və hər dəfə yalnız bir fokuslanmış sual soruşur.
          </p>
        </div>
        <div>
          <span
            className={`badge ${
              data.mentorStatus.configured ? "badge-success" : "badge-category"
            }`}
          >
            {data.mentorStatus.configured
              ? `Canlı AI: ${data.mentorStatus.provider} (${data.mentorStatus.model})`
              : "Demo Mentor Rejimi (API key təyin edilməyib)"}
          </span>
        </div>
      </div>

      {/* Privacy & Missing-Key Notice */}
      <div className="panel privacy-notice-panel">
        <div>
          <strong>Məxfilik və Provayder Vəziyyəti:</strong> {data.mentorStatus.privacyNotice}
        </div>
        {retentionPolicy && <small className="muted">Saxlanma qaydası: {retentionPolicy}</small>}
      </div>

      <div className="mentor-workspace-grid">
        {/* Sidebar: Context Selector & TutorProvider Actions */}
        <aside className="mentor-sidebar panel">
          <h3>Kontekst və Sürətli Alətlər</h3>

          <div className="form-group">
            <label>Dərs Konteksti</label>
            <select
              className="input-field"
              value={selectedLessonId}
              onChange={(e) => setSelectedLessonId(e.target.value)}
            >
              <option value="">Ümumi (Bütün Kurikulum)</option>
              {allLessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Layihə Konteksti</label>
            <select
              className="input-field"
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
            >
              <option value="">Layihə seçilməyib</option>
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Tapşırıq ID (İstəyə bağlı)</label>
            <input
              type="text"
              className="input-field font-mono"
              placeholder="məs. ex-pyfn-min-max-scale"
              value={selectedExerciseId}
              onChange={(e) => setSelectedExerciseId(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>İzah Dərinliyi (Explanation Level)</label>
            <select
              className="input-field"
              value={explanationLevel}
              onChange={(e) =>
                setExplanationLevel(e.target.value as "beginner" | "intermediate" | "advanced")
              }
            >
              <option value="beginner">Başlanğıc (Beginner — analogiya və intuisiya)</option>
              <option value="intermediate">Orta (Intermediate — riyaziyyat və kod)</option>
              <option value="advanced">İrəli (Advanced — trade-off, Big-O, production)</option>
            </select>
          </div>

          <div className="form-group">
            <label className="option-label">
              <input
                type="checkbox"
                checked={socraticMode}
                onChange={(e) => setSocraticMode(e.target.checked)}
              />
              <span>Sokratik rejim (hər cavabdan sonra yoxlama sualı soruş)</span>
            </label>
          </div>

          <div className="mentor-quick-buttons">
            <strong>TutorProvider Əməliyyatları:</strong>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={sending}
              onClick={() =>
                sendAction(
                  "lesson-help",
                  selectedLessonId
                    ? `Cari dərsi (${selectedLessonId}) sadə intuisiya və kiçik rəqəmli nümunə ilə izah et.`
                    : "Hazırda hansı dərsdən başlamağımı və əsas konsepti izah et.",
                )
              }
            >
              1. generateLessonHelp() — Dərsi İzah Et
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={sending}
              onClick={() =>
                sendAction(
                  "review-exercise",
                  selectedExerciseId
                    ? `${selectedExerciseId} tapşırığı üzrə tam həlli açmadan mərhələli ipucu və yoxlama siyahısı ver.`
                    : "Cari dərsin tapşırığını həll etmək üçün mənə mərhələli ipucu ver.",
                )
              }
            >
              2. reviewExercise() — Tapşırıq İpucu
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={sending}
              onClick={() => {
                setShowCodeBox(true);
                sendAction(
                  "explain-code",
                  codeSnippet.trim()
                    ? "Bu kod parçasını Code Review Protocol-a uyğun təhlil et (nə edir, edge case-lər, potensial bug-lar):"
                    : "Dərsdəki kod nümunəsinin əsas sətirlərini və mümkün səhvlərini izah et.",
                );
              }}
            >
              3. explainCode() — Kodu Təhlil Et
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={sending}
              onClick={() =>
                sendAction(
                  "study-plan",
                  "Mənim cari bacarıq statuslarıma (Demonstrated vs Needs review) və həftəlik saatıma uyğun növbəti 3 konkret öyrənmə addımını qur.",
                )
              }
            >
              4. createStudyPlan() — Fərdi Plan
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={sending}
              onClick={() =>
                sendAction(
                  "generate-exercise",
                  "Cari dərsim və ya ən zəif bacarığım üzrə mənim üçün yeni praktik kodlaşdırma və ya düşünmə tapşırığı yarat (əvvəlcə həlli göstərmə).",
                )
              }
            >
              5. generateExercise() — Yeni Tapşırıq Yarat
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={sending}
              onClick={() =>
                sendAction(
                  "explain-mistake",
                  errorOutput
                    ? `Bu səhvin/xətanın səbəbini izah et: ${errorOutput}`
                    : "Son tapşırıqda niyə səhv etdiyimi addım-addım izah et və məni düzgün həllə yönləndir.",
                )
              }
            >
              6. explainMistake() — Səhvimi İzah Et
            </button>

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={sending}
              onClick={() =>
                sendAction(
                  "chat",
                  "LLM API istifadə etmək ilə ML model train etmək arasındakı mühəndislik fərqini izah et.",
                )
              }
            >
              LLM API vs Model Training fərqi
            </button>
          </div>

          {referencedLessons.length > 0 && (
            <div className="referenced-lessons-box">
              <strong>Əlaqəli Dərslər:</strong>
              {referencedLessons.map((rl) => (
                <button
                  key={rl.id}
                  type="button"
                  className="link-btn"
                  onClick={() => onOpenLesson(rl.id)}
                >
                  {rl.title} →
                </button>
              ))}
            </div>
          )}
        </aside>

        {/* Main Chat & Code Snippet Box */}
        <main className="mentor-chat-panel panel">
          <div className="panel-header-row">
            <h3>Mentor Söhbəti ({contextType === "lesson" ? `Dərs: ${contextId}` : "Ümumi"})</h3>
            {messages.length > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={handleClearHistory}
              >
                Tarixçəni təmizlə
              </button>
            )}
          </div>

          {showCodeBox && (
            <div className="mentor-code-attachment">
              <div className="panel-header-row">
                <label>Təhlil və ya Debug üçün Kod Parçası (İstəyə bağlı):</label>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => setShowCodeBox(false)}
                >
                  Gizlət
                </button>
              </div>
              <textarea
                className="code-textarea"
                rows={5}
                placeholder="Python kodunu bura yapışdır..."
                value={codeSnippet}
                onChange={(e) => setCodeSnippet(e.target.value)}
              />
            </div>
          )}

          <div className="chat-messages-box">
            {messages.length === 0 ? (
              <div className="empty-chat-state">
                <p>
                  Hələ mesaj yoxdur. Soldakı <strong>TutorProvider</strong> düymələrindən birini seç və ya aşağıda konkret sualını yaz.
                </p>
              </div>
            ) : (
              messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`chat-bubble ${
                    m.role === "user" ? "chat-bubble-user" : "chat-bubble-assistant"
                  }`}
                >
                  <div className="chat-bubble-meta">
                    <strong>{m.role === "user" ? data.profile.name : "AI Mentor"}</strong>
                    <div className="exercise-badges" style={{ marginBottom: 0 }}>
                      {m.usage && (
                        <span className="badge badge-type">
                          {m.usage.totalTokens} token
                          {m.usage.estimatedCostUsd !== null
                            ? ` (~${m.usage.estimatedCostUsd.toFixed(5)} USD)`
                            : ""}
                        </span>
                      )}
                      {m.mode && (
                        <span className="badge badge-muted">
                          {m.mode === "live-ai" ? "Canlı LLM" : "Lokal Demo"}
                        </span>
                      )}
                    </div>
                  </div>
                  <MarkdownView content={m.content} />
                </div>
              ))
            )}
          </div>

          <div className="chat-input-bar">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowCodeBox((v) => !v)}
            >
              {showCodeBox ? "Kod qutusunu bağla" : "+ Kod əlavə et"}
            </button>
            <input
              type="text"
              className="input-field"
              placeholder="Sualını Azərbaycan və ya İngilis terminləri ilə yaz..."
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendAction("chat");
                }
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={sending || !messageInput.trim()}
              onClick={() => sendAction("chat")}
            >
              {sending ? "Cavablanır..." : "Göndər"}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
