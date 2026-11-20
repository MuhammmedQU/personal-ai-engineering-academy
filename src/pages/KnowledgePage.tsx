import React, { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { BookmarkItem, NoteItem } from "../types.ts";

interface KnowledgePageProps {
  onOpenLesson: (lessonId: string, sectionId?: string | null) => void;
  onOpenPractice: (exerciseId?: string) => void;
  onOpenProject: (projectId: string) => void;
  onAskMentor: (ctx: {
    exerciseId?: string;
    lessonId?: string;
    codeSnippet?: string;
    errorOutput?: string;
    title: string;
  }) => void;
  onProgressUpdated: () => void;
}

export function KnowledgePage({
  onOpenLesson,
  onOpenPractice,
  onOpenProject,
  onAskMentor,
  onProgressUpdated,
}: KnowledgePageProps) {
  const [tab, setTab] = useState<"flashcards" | "mistakes" | "snippets" | "glossary" | "resources">(
    "flashcards",
  );

  // Global search
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<
    Array<{
      type: string;
      id: string;
      title: string;
      snippet: string;
      targetId: string;
      sectionId?: string;
    }>
  >([]);

  // Flashcards
  const [cards, setCards] = useState<
    Array<{
      id: number;
      lesson_id: string | null;
      front: string;
      back: string;
      tags: string;
      interval_days: number;
      ease_factor: number;
      repetitions: number;
      next_review_at: string | null;
    }>
  >([]);
  const [dueCount, setDueCount] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [newFront, setNewFront] = useState("");
  const [newBack, setNewBack] = useState("");
  const [newCardTags, setNewCardTags] = useState("");

  // Mistake notebook
  const [mistakes, setMistakes] = useState<
    Array<{
      exerciseId: string;
      title: string;
      category: string;
      lessonId: string | null;
      lessonTitle: string | null;
      failCount: number;
      passCount: number;
      lastFeedback: string;
      lastFailedAt: string;
      takeaway: string;
      resolved: boolean;
    }>
  >([]);
  const [takeawayDrafts, setTakeawayDrafts] = useState<Record<string, string>>({});

  // Knowledge data
  const [snippets, setSnippets] = useState<
    Array<{ id: number; title: string; language: string; tags: string; code: string; notes: string }>
  >([]);
  const [resources, setResources] = useState<
    Array<{ id: number; kind: string; title: string; url_or_path: string; tags: string; summary: string }>
  >([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [glossary, setGlossary] = useState<
    Array<{ term: string; definition: string; lessonId: string; lessonTitle: string; track: string }>
  >([]);
  const [glossaryFilter, setGlossaryFilter] = useState("");

  // Snippet form
  const [snipTitle, setSnipTitle] = useState("");
  const [snipLang, setSnipLang] = useState("python");
  const [snipTags, setSnipTags] = useState("");
  const [snipCode, setSnipCode] = useState("");
  const [snipNotes, setSnipNotes] = useState("");

  // Resource form
  const [resKind, setResKind] = useState("paper");
  const [resTitle, setResTitle] = useState("");
  const [resUrl, setResUrl] = useState("");
  const [resTags, setResTags] = useState("");
  const [resSummary, setResSummary] = useState("");

  const loadAll = async () => {
    const [fc, mk, kn] = await Promise.all([
      api.getFlashcards(),
      api.getMistakes(),
      api.getKnowledge(),
    ]);
    setCards(fc.cards);
    setDueCount(fc.dueCount);
    setMistakes(mk.mistakes);
    const draftMap: Record<string, string> = {};
    for (const m of mk.mistakes) draftMap[m.exerciseId] = m.takeaway;
    setTakeawayDrafts(draftMap);
    setSnippets(kn.snippets);
    setResources(kn.resources);
    setNotes(kn.notes);
    setBookmarks(kn.bookmarks);
    setGlossary(kn.glossary);
  };

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (searchQ.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api.globalSearch(searchQ.trim()).then((r) => setSearchResults(r.results));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [searchQ]);

  const nowIso = new Date().toISOString();
  const dueCards = cards.filter((c) => !c.next_review_at || c.next_review_at <= nowIso);
  const activeCard = dueCards[0] ?? null;

  const handleReviewCard = async (quality: 1 | 2 | 3 | 4) => {
    if (!activeCard) return;
    await api.reviewFlashcard(activeCard.id, quality);
    setFlipped(false);
    await loadAll();
    onProgressUpdated();
  };

  const handleAddCard = async () => {
    if (!newFront.trim() || !newBack.trim()) return;
    await api.createFlashcard({
      front: newFront.trim(),
      back: newBack.trim(),
      tags: newCardTags.trim(),
    });
    setNewFront("");
    setNewBack("");
    setNewCardTags("");
    await loadAll();
    onProgressUpdated();
  };

  const handleSaveSnippet = async () => {
    if (!snipTitle.trim() || !snipCode.trim()) return;
    await api.saveSnippet({
      title: snipTitle.trim(),
      language: snipLang,
      tags: snipTags.trim(),
      code: snipCode,
      notes: snipNotes.trim(),
    });
    setSnipTitle("");
    setSnipTags("");
    setSnipCode("");
    setSnipNotes("");
    await loadAll();
  };

  const handleSaveResource = async () => {
    if (!resTitle.trim()) return;
    await api.saveResource({
      kind: resKind,
      title: resTitle.trim(),
      urlOrPath: resUrl.trim(),
      tags: resTags.trim(),
      summary: resSummary.trim(),
    });
    setResTitle("");
    setResUrl("");
    setResTags("");
    setResSummary("");
    await loadAll();
  };

  const filteredGlossary = glossary.filter(
    (g) =>
      !glossaryFilter.trim() ||
      g.term.toLowerCase().includes(glossaryFilter.toLowerCase()) ||
      g.definition.toLowerCase().includes(glossaryFilter.toLowerCase()),
  );

  return (
    <div className="knowledge-page">
      <div className="page-header">
        <div>
          <h1>Şəxsi Bilik Bazası, Flashcards və Səhvlər Dəftəri</h1>
          <p className="subtitle">
            Bütün dərslər, texniki terminlər, SM-2 aralıqlı təkrar kartları, səhv analizləri, kod parçaları (snippets) və PDF/məqalə resursların üzərində vahid axtarış.
          </p>
        </div>
      </div>

      {/* Global Search Box */}
      <div className="panel">
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>Qlobal Axtarış (bütün dərslər, {glossary.length} termin, tapşırıqlar, layihələr, qeydlər və kod parçaları)</label>
          <input
            type="text"
            className="input-field"
            placeholder="Məsələn: LoRA, cosine similarity, LEFT JOIN, PID, overfitting, quantization..."
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
          />
        </div>
        {searchResults.length > 0 && (
          <div className="search-results-list" style={{ marginTop: "0.75rem" }}>
            {searchResults.map((r, i) => (
              <div key={`${r.type}-${r.id}-${i}`} className="mistake-row">
                <div>
                  <span className="badge badge-type">{r.type.toUpperCase()}</span>{" "}
                  <strong>{r.title}</strong>
                  <p className="muted" style={{ margin: "0.2rem 0 0" }}>{r.snippet}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={() => {
                    if (r.type === "lesson" || r.type === "term" || r.type === "note") {
                      onOpenLesson(r.targetId, r.sectionId ?? null);
                    } else if (r.type === "exercise") {
                      onOpenPractice(r.targetId);
                    } else if (r.type === "project") {
                      onOpenProject(r.targetId);
                    } else if (r.type === "snippet") {
                      setTab("snippets");
                    } else {
                      setTab("resources");
                    }
                  }}
                >
                  Keç →
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mode Tabs */}
      <div className="lesson-mode-tabs">
        <button
          type="button"
          className={`mode-tab ${tab === "flashcards" ? "active" : ""}`}
          onClick={() => setTab("flashcards")}
        >
          1. Flashcards & Spaced Repetition ({dueCount} gözləyir)
        </button>
        <button
          type="button"
          className={`mode-tab ${tab === "mistakes" ? "active" : ""}`}
          onClick={() => setTab("mistakes")}
        >
          2. Mistake Notebook ({mistakes.length})
        </button>
        <button
          type="button"
          className={`mode-tab ${tab === "snippets" ? "active" : ""}`}
          onClick={() => setTab("snippets")}
        >
          3. Code Snippets ({snippets.length})
        </button>
        <button
          type="button"
          className={`mode-tab ${tab === "glossary" ? "active" : ""}`}
          onClick={() => setTab("glossary")}
        >
          4. Personal Glossary ({glossary.length})
        </button>
        <button
          type="button"
          className={`mode-tab ${tab === "resources" ? "active" : ""}`}
          onClick={() => setTab("resources")}
        >
          5. PDFs, Məqalələr & Qeydlər ({resources.length + notes.length})
        </button>
      </div>

      {/* TAB 1: Flashcards */}
      {tab === "flashcards" && (
        <div className="cards-grid-2">
          <div className="panel">
            <div className="panel-header-row">
              <h3>Aralıqlı Təkrar (SM-2 Spaced Repetition)</h3>
              <span className="badge badge-category">Vaxtı çatan: {dueCards.length} / {cards.length}</span>
            </div>
            {activeCard ? (
              <div className="flashcard-stage">
                <div className="flashcard-box" onClick={() => setFlipped((f) => !f)}>
                  <div className="exercise-badges">
                    {activeCard.tags && <span className="badge badge-type">{activeCard.tags}</span>}
                    <span className="badge badge-muted">
                      İnterval: {activeCard.interval_days} gün · Təkrar: {activeCard.repetitions}
                    </span>
                  </div>
                  <h2 style={{ marginTop: "0.75rem" }}>{activeCard.front}</h2>
                  {flipped ? (
                    <div className="flashcard-answer">
                      <hr className="divider" />
                      <p>{activeCard.back}</p>
                    </div>
                  ) : (
                    <p className="muted">Cavabı görmək üçün kartın üzərinə kliklə...</p>
                  )}
                </div>
                {!flipped ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setFlipped(true)}
                  >
                    Cavabı Göstər
                  </button>
                ) : (
                  <div className="exercise-actions">
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => handleReviewCard(1)}
                    >
                      1. Unutdum (1 gün)
                    </button>
                    <button
                      type="button"
                      className="btn btn-warning btn-sm"
                      onClick={() => handleReviewCard(2)}
                    >
                      2. Çətin
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => handleReviewCard(3)}
                    >
                      3. Yaxşı
                    </button>
                    <button
                      type="button"
                      className="btn btn-success btn-sm"
                      onClick={() => handleReviewCard(4)}
                    >
                      4. Çox asan
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="feedback-box feedback-pass">
                <strong>Əla!</strong> Hazırda vaxtı çatmış flashcard yoxdur. Yeni dərs açdıqda həmin dərsin texniki terminləri avtomatik buraya əlavə olunur, yaxud sağdan öz kartını yarada bilərsən.
              </div>
            )}
          </div>

          <div className="panel">
            <h3>Yeni Şəxsi Flashcard Yarat</h3>
            <div className="form-group">
              <label>Ön üz (Sual və ya İngilis termini)</label>
              <input
                type="text"
                className="input-field"
                placeholder="Məs. Why divide by sqrt(d_k) in Self-Attention?"
                value={newFront}
                onChange={(e) => setNewFront(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Arxa üz (Qısa, dəqiq izah)</label>
              <textarea
                className="input-textarea"
                rows={3}
                placeholder="Böyük dot product-lar softmax-ı doyma (saturation) zonasına itələyir və gradient sıfıra yaxınlaşır..."
                value={newBack}
                onChange={(e) => setNewBack(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Teqlər (istəyə bağlı)</label>
              <input
                type="text"
                className="input-field"
                placeholder="transformers, math, attention"
                value={newCardTags}
                onChange={(e) => setNewCardTags(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!newFront.trim() || !newBack.trim()}
              onClick={handleAddCard}
            >
              Flashcard Əlavə Et
            </button>
          </div>
        </div>
      )}

      {/* TAB 2: Mistake Notebook */}
      {tab === "mistakes" && (
        <div className="panel">
          <h3>Səhvlər Dəftəri (Mistake Notebook)</h3>
          <p className="subtitle">
            Uğursuz cəhdlərin burada toplanır. Hər səhv üçün &ldquo;Niyə səhv etdim?&rdquo; qeydini yaz — bu, eyni səhvi ikinci dəfə etməməyin ən effektiv yoludur.
          </p>
          {mistakes.length === 0 ? (
            <p className="muted">Hələ qeydə alınmış uğursuz tapşırıq cəhdi yoxdur.</p>
          ) : (
            <div className="notes-list">
              {mistakes.map((m) => (
                <div key={m.exerciseId} className="note-card">
                  <div className="panel-header-row">
                    <div>
                      <span className="badge badge-category">{m.category}</span>{" "}
                      <span className={`badge ${m.resolved ? "badge-success" : "badge-danger"}`}>
                        {m.resolved ? "✓ Həll edilib" : `${m.failCount} uğursuz cəhd`}
                      </span>{" "}
                      <strong>{m.title}</strong>
                    </div>
                    <div className="exercise-actions" style={{ marginTop: 0 }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() =>
                          onAskMentor({
                            exerciseId: m.exerciseId,
                            lessonId: m.lessonId ?? undefined,
                            errorOutput: m.lastFeedback,
                            title: m.title,
                          })
                        }
                      >
                        Mentordan izah istə
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() =>
                          m.lessonId ? onOpenLesson(m.lessonId) : onOpenPractice(m.exerciseId)
                        }
                      >
                        Yenidən həll et →
                      </button>
                    </div>
                  </div>
                  <p className="muted">Son rəy: {m.lastFeedback}</p>
                  <div className="quick-note-bar" style={{ marginTop: "0.5rem", paddingTop: "0.5rem" }}>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="Əsas çıxardığım dərs (takeaway): Məs. bool Python-da int subclass-dır..."
                      value={takeawayDrafts[m.exerciseId] ?? ""}
                      onChange={(e) =>
                        setTakeawayDrafts((prev) => ({ ...prev, [m.exerciseId]: e.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-xs"
                      onClick={async () => {
                        const txt = (takeawayDrafts[m.exerciseId] ?? "").trim();
                        if (!txt) return;
                        await api.saveMistakeReflection(m.exerciseId, {
                          takeaway: txt,
                          resolved: m.resolved,
                        });
                        await loadAll();
                      }}
                    >
                      Dərsi saxla
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Code Snippets */}
      {tab === "snippets" && (
        <div className="cards-grid-2">
          <div className="panel">
            <h3>Yeni Kod Parçası (Snippet) Saxla</h3>
            <div className="form-group">
              <label>Başlıq</label>
              <input
                type="text"
                className="input-field"
                placeholder="Məs. PyTorch reproducible seed + AMP template"
                value={snipTitle}
                onChange={(e) => setSnipTitle(e.target.value)}
              />
            </div>
            <div className="cards-grid-2">
              <div className="form-group">
                <label>Dil</label>
                <select
                  className="input-field"
                  value={snipLang}
                  onChange={(e) => setSnipLang(e.target.value)}
                >
                  <option value="python">Python</option>
                  <option value="sql">SQL</option>
                  <option value="bash">Bash</option>
                  <option value="dockerfile">Dockerfile</option>
                  <option value="yaml">YAML</option>
                  <option value="json">JSON</option>
                </select>
              </div>
              <div className="form-group">
                <label>Teqlər</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="pytorch, training, utils"
                  value={snipTags}
                  onChange={(e) => setSnipTags(e.target.value)}
                />
              </div>
            </div>
            <div className="form-group">
              <label>Kod</label>
              <textarea
                className="code-textarea"
                rows={6}
                value={snipCode}
                onChange={(e) => setSnipCode(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Qısa qeyd</label>
              <input
                type="text"
                className="input-field"
                value={snipNotes}
                onChange={(e) => setSnipNotes(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!snipTitle.trim() || !snipCode.trim()}
              onClick={handleSaveSnippet}
            >
              Snippet Saxla
            </button>
          </div>

          <div className="panel">
            <h3>Saxlanılmış Kod Parçaları ({snippets.length})</h3>
            {snippets.length === 0 ? (
              <p className="muted">Hələ kod parçası saxlanmayıb.</p>
            ) : (
              <div className="notes-list">
                {snippets.map((sn) => (
                  <div key={sn.id} className="note-card">
                    <div className="panel-header-row">
                      <div>
                        <span className="badge badge-type">{sn.language}</span>{" "}
                        <strong>{sn.title}</strong>
                        {sn.tags && <small className="muted"> · {sn.tags}</small>}
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={async () => {
                          await api.deleteSnippet(sn.id);
                          await loadAll();
                        }}
                      >
                        Sil
                      </button>
                    </div>
                    {sn.notes && <p className="muted">{sn.notes}</p>}
                    <pre className="solution-code">
                      <code>{sn.code}</code>
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: Personal Glossary */}
      {tab === "glossary" && (
        <div className="panel">
          <div className="panel-header-row">
            <h3>AI Engineering Texniki Lüğəti ({filteredGlossary.length} / {glossary.length})</h3>
            <input
              type="text"
              className="input-field"
              style={{ maxWidth: 340 }}
              placeholder="Termin və ya izah axtar..."
              value={glossaryFilter}
              onChange={(e) => setGlossaryFilter(e.target.value)}
            />
          </div>
          <div className="terms-grid">
            {filteredGlossary.slice(0, 90).map((g, i) => (
              <div key={`${g.lessonId}-${i}`} className="term-card">
                <strong className="term-en">{g.term}</strong>
                <p className="term-az">{g.definition}</p>
                <button
                  type="button"
                  className="link-btn"
                  style={{ marginTop: "0.35rem", fontSize: "0.78rem" }}
                  onClick={() => onOpenLesson(g.lessonId)}
                >
                  Dərs: {g.lessonTitle}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 5: PDFs, Papers, Resources & Lesson Notes */}
      {tab === "resources" && (
        <div className="cards-grid-2">
          <div className="panel">
            <h3>PDF, Məqalə (Paper) və İstinad Əlavə Et</h3>
            <div className="cards-grid-2">
              <div className="form-group">
                <label>Növ</label>
                <select
                  className="input-field"
                  value={resKind}
                  onChange={(e) => setResKind(e.target.value)}
                >
                  <option value="paper">Research Paper (arXiv)</option>
                  <option value="pdf">Lokal PDF / Kitab</option>
                  <option value="article">Texniki Məqalə / Docs</option>
                  <option value="glossary">Şəxsi Termin</option>
                  <option value="note">Ümumi Qeyd</option>
                </select>
              </div>
              <div className="form-group">
                <label>Teqlər</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="rag, lora, attention"
                  value={resTags}
                  onChange={(e) => setResTags(e.target.value)}
                />
              </div>
            </div>
            <div className="form-group">
              <label>Başlıq</label>
              <input
                type="text"
                className="input-field"
                placeholder="Məs. Attention Is All You Need (Vaswani et al.)"
                value={resTitle}
                onChange={(e) => setResTitle(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>URL və ya Lokal PDF Yolu</label>
              <input
                type="text"
                className="input-field"
                placeholder="https://arxiv.org/abs/1706.03762 və ya C:\Docs\paper.pdf"
                value={resUrl}
                onChange={(e) => setResUrl(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Şəxsi Xülasə / Əsas Nəticələr</label>
              <textarea
                className="input-textarea"
                rows={3}
                value={resSummary}
                onChange={(e) => setResSummary(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!resTitle.trim()}
              onClick={handleSaveResource}
            >
              Resursu Saxla
            </button>
          </div>

          <div className="panel">
            <h3>Məqalələr, PDF-lər ({resources.length}) & Dərs Qeydləri ({notes.length})</h3>
            {resources.map((r) => (
              <div key={r.id} className="note-card">
                <div className="panel-header-row">
                  <div>
                    <span className="badge badge-category">{r.kind.toUpperCase()}</span>{" "}
                    <strong>{r.title}</strong>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={async () => {
                      await api.deleteResource(r.id);
                      await loadAll();
                    }}
                  >
                    Sil
                  </button>
                </div>
                {r.url_or_path && (
                  <small className="muted font-mono" style={{ display: "block" }}>
                    {r.url_or_path.startsWith("https://") ? (
                      <a href={r.url_or_path} target="_blank" rel="noreferrer">
                        {r.url_or_path}
                      </a>
                    ) : (
                      r.url_or_path
                    )}
                  </small>
                )}
                {r.summary && <p style={{ marginTop: "0.35rem" }}>{r.summary}</p>}
              </div>
            ))}
            {notes.length > 0 && <hr className="divider" />}
            {notes.map((n) => (
              <div key={n.id} className="note-card">
                <div className="panel-header-row">
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => onOpenLesson(n.lesson_id, n.section_id)}
                  >
                    Dərs qeydi: {n.lesson_id}
                  </button>
                  {n.tags && <span className="badge badge-muted">{n.tags}</span>}
                </div>
                <p>{n.content}</p>
              </div>
            ))}
            {bookmarks.length > 0 && (
              <>
                <hr className="divider" />
                <h4>Əlfəcinlər ({bookmarks.length})</h4>
                {bookmarks.map((b) => (
                  <div key={b.id} className="muted">
                    ★ {b.label}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
