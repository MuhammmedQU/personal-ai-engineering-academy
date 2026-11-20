import React, { useState } from "react";
import { api } from "../api.ts";
import type { BootstrapData, MasteryStatus } from "../types.ts";

interface ProgressPageProps {
  data: BootstrapData;
  onOpenLesson: (lessonId: string, sectionId?: string | null) => void;
  onOpenProject: (projectId: string) => void;
  onOpenPractice: () => void;
  onProgressUpdated: () => void;
}

const STATUS_LABELS: Record<MasteryStatus, string> = {
  demonstrated: "Demonstrated (Sübut olunub)",
  practicing: "Practicing (Məşqdə)",
  needs_review: "Needs Review (Təkrar lazımdır)",
  introduced: "Introduced (Tanış olunub)",
  not_started: "Not Started (Başlanmayıb)",
};

export function ProgressPage({
  data,
  onOpenLesson,
  onOpenProject,
  onOpenPractice,
  onProgressUpdated,
}: ProgressPageProps) {
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const counts: Record<MasteryStatus, number> = {
    demonstrated: 0,
    practicing: 0,
    needs_review: 0,
    introduced: 0,
    not_started: 0,
  };
  for (const sk of data.skills) {
    counts[sk.mastery.status] = (counts[sk.mastery.status] ?? 0) + 1;
  }

  const visibleSkills =
    statusFilter === "all"
      ? data.skills
      : data.skills.filter((s) => s.mastery.status === statusFilter);

  const completedMilestonesList = data.projects.flatMap((p) =>
    p.milestones
      .filter((m) => m.status === "completed" && m.evidence.trim().length > 0)
      .map((m) => ({
        projectId: p.id,
        projectTitle: p.title,
        milestoneTitle: m.title,
        evidence: m.evidence,
        updatedAt: m.updatedAt,
      })),
  );

  return (
    <div className="progress-page">
      <div className="page-header">
        <div>
          <h1>İrəliləyiş, Bacarıq Mənimsəməsi və Mühəndislik Portfeli</h1>
          <p className="subtitle">
            Mastery statusu yalnız dərs açmaqla dəyişmir: <strong>Not started &rarr; Introduced &rarr; Practicing &rarr; Demonstrated &rarr; Needs review</strong>. &ldquo;Demonstrated&rdquo; üçün həmin bacarıq üzrə ən azı 2 fərqli tapşırığı ipucu və hazır həll açmadan doğru həll etməlisən.
          </p>
        </div>
      </div>

      {/* Mastery Summary Cards */}
      <div className="cards-grid-5">
        {(Object.keys(STATUS_LABELS) as MasteryStatus[]).map((st) => (
          <button
            key={st}
            type="button"
            className={`stat-card-btn ${statusFilter === st ? "active" : ""}`}
            onClick={() => setStatusFilter(statusFilter === st ? "all" : st)}
          >
            <span className={`badge status-badge-${st}`}>{STATUS_LABELS[st]}</span>
            <strong className="stat-big-num">{counts[st]}</strong>
          </button>
        ))}
      </div>

      {/* All 41 Skills Table */}
      <div className="panel">
        <div className="panel-header-row">
          <h3>Bacarıqlar Cədvəli ({visibleSkills.length}/{data.skills.length})</h3>
          {statusFilter !== "all" && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => setStatusFilter("all")}
            >
              Filtri sıfırla
            </button>
          )}
        </div>
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Bacarıq</th>
                <th>Track</th>
                <th>Status</th>
                <th>Müstəqil Həll (Fərqli Tapşırıq)</th>
                <th>Cəhdlər (Doğru/Cəmi)</th>
                <th>Növbəti Təkrar (Spaced Review)</th>
              </tr>
            </thead>
            <tbody>
              {visibleSkills.map((sk) => (
                <tr key={sk.id}>
                  <td>
                    <strong>{sk.name}</strong>
                    <br />
                    <small className="muted">{sk.description}</small>
                  </td>
                  <td>{sk.track}</td>
                  <td>
                    <span className={`badge status-badge-${sk.mastery.status}`}>
                      {STATUS_LABELS[sk.mastery.status]}
                    </span>
                  </td>
                  <td>{sk.mastery.distinctPassedCount} / 2</td>
                  <td>
                    {sk.mastery.correctCount} / {sk.mastery.attemptsCount}
                  </td>
                  <td>
                    {sk.mastery.nextReviewAt
                      ? sk.mastery.nextReviewAt.slice(0, 10)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Project Evidence Portfolio */}
      <div className="panel">
        <div className="panel-header-row">
          <h3>Layihə Sübutları Portfeli ({completedMilestonesList.length} Tamamlanmış Milestone)</h3>
        </div>
        {completedMilestonesList.length === 0 ? (
          <p className="muted">
            Hələ sübutla tamamlanmış layihə milestone-u yoxdur. Layihələr bölməsində milestone tapşırıqlarını bitirib sübut (test çıxışı, metrik cədvəli, kod xülasəsi) əlavə etdikdə burada portfel kimi toplanır.
          </p>
        ) : (
          <div className="evidence-portfolio-list">
            {completedMilestonesList.map((item, idx) => (
              <div key={idx} className="evidence-card">
                <div className="panel-header-row">
                  <strong>
                    {item.projectTitle} &rarr; {item.milestoneTitle}
                  </strong>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => onOpenProject(item.projectId)}
                  >
                    Layihəyə bax
                  </button>
                </div>
                <pre className="evidence-pre">{item.evidence}</pre>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Saved Bookmarks & Notes */}
      <div className="cards-grid-2">
        <div className="panel">
          <h3>Əlfəcinlər / Bookmarks ({data.bookmarks.length})</h3>
          {data.bookmarks.length === 0 ? (
            <p className="muted">Hələ əlfəcin əlavə edilməyib.</p>
          ) : (
            <div className="notes-list">
              {data.bookmarks.map((bm) => (
                <div key={bm.id} className="note-card">
                  <div className="panel-header-row">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() =>
                        bm.target_type === "lesson"
                          ? onOpenLesson(bm.target_id, bm.section_id)
                          : bm.target_type === "project"
                            ? onOpenProject(bm.target_id)
                            : onOpenPractice()
                      }
                    >
                      ★ {bm.label}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={async () => {
                        await api.deleteBookmark(bm.id);
                        onProgressUpdated();
                      }}
                    >
                      Sil
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <h3>Bütün Dərs Qeydlərim ({data.notes.length})</h3>
          {data.notes.length === 0 ? (
            <p className="muted">Hələ dərs qeydi yazılmayıb.</p>
          ) : (
            <div className="notes-list">
              {data.notes.map((n) => (
                <div key={n.id} className="note-card">
                  <div className="panel-header-row">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => onOpenLesson(n.lesson_id, n.section_id)}
                    >
                      {n.lesson_id} {n.section_id ? `(${n.section_id})` : ""}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={async () => {
                        await api.deleteNote(n.id);
                        onProgressUpdated();
                      }}
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
      </div>
    </div>
  );
}
