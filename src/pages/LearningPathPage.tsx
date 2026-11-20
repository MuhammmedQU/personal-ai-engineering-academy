import React, { useState } from "react";
import type { TrackView } from "../types.ts";

interface LearningPathPageProps {
  tracks: TrackView[];
  onOpenLesson: (lessonId: string) => void;
}

export function LearningPathPage({ tracks, onOpenLesson }: LearningPathPageProps) {
  const [selectedTrackId, setSelectedTrackId] = useState<string>("all");

  const visibleTracks =
    selectedTrackId === "all"
      ? tracks
      : tracks.filter((t) => t.id === selectedTrackId);

  return (
    <div className="learning-path-page">
      <div className="page-header">
        <div>
          <h1>AI Engineering Yol Xəritəsi (Learning Path)</h1>
          <p className="subtitle">
            Bünövrədən (Python, Riyaziyyat, Classical ML, Deep Learning) müasir LLM/RAG sistemlərinə, Production MLOps-a və Məhsul mühəndisliyinə qədər struktur yol xəritəsi. Tam yazılmış modullar (&ldquo;Authored&rdquo;) ilə gələcək plan modulları (&ldquo;Planned roadmap&rdquo;) dürüst şəkildə fərqləndirilir.
          </p>
        </div>
      </div>

      <div className="filter-bar">
        <button
          type="button"
          className={`filter-chip ${selectedTrackId === "all" ? "active" : ""}`}
          onClick={() => setSelectedTrackId("all")}
        >
          Hamısı ({tracks.length} Track)
        </button>
        {tracks.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`filter-chip ${selectedTrackId === t.id ? "active" : ""}`}
            onClick={() => setSelectedTrackId(t.id)}
          >
            {t.code}. {t.title} {t.optional ? "(Seçmə)" : ""}
          </button>
        ))}
      </div>

      <div className="tracks-list">
        {visibleTracks.map((track) => (
          <div key={track.id} className="track-section panel">
            <div className="track-header">
              <div>
                <div className="track-badges">
                  <span className="badge badge-category">Track {track.code}</span>
                  {track.optional && <span className="badge badge-muted">Seçmə İxtisaslaşma</span>}
                </div>
                <h2>
                  {track.code}. {track.title}
                </h2>
                <p>{track.summary}</p>
              </div>
            </div>
            <div className="track-why-box">
              <strong>Niyə vacibdir?</strong> {track.why}
            </div>

            <div className="modules-grid">
              {track.modules.map((mod) => (
                <div
                  key={mod.id}
                  className={`module-card ${
                    mod.status === "authored" ? "module-authored" : "module-planned"
                  }`}
                >
                  <div className="module-card-header">
                    <div className="exercise-badges">
                      <span
                        className={`badge ${
                          mod.status === "authored" ? "badge-success" : "badge-muted"
                        }`}
                      >
                        {mod.status === "authored"
                          ? `Tam hazırdır (${mod.completedLessonsCount}/${mod.totalLessonsCount} dərs)`
                          : "Roadmap (Planned)"}
                      </span>
                      <span className="badge badge-type">{mod.level}</span>
                      <span className="badge badge-diff">
                        Təxmini: {mod.effort_hours[0]}–{mod.effort_hours[1]} saat
                      </span>
                    </div>
                    <h3>{mod.title}</h3>
                    <p className="muted">{mod.summary}</p>
                  </div>

                  {mod.prerequisites.length > 0 && (
                    <div className="module-prereqs">
                      <small>
                        <strong>İlkin şərt modullar:</strong> {mod.prerequisites.join(", ")}
                      </small>
                    </div>
                  )}

                  <div className="module-details-cols">
                    <div>
                      <strong>Öyrənmə Nəticələri:</strong>
                      <ul>
                        {mod.outcomes.map((o, i) => (
                          <li key={i}>{o}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <strong>Mənimsəmə Meyarları (Mastery Criteria):</strong>
                      <ul>
                        {mod.mastery_criteria.map((mc, i) => (
                          <li key={i}>{mc}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="module-practical-task">
                    <strong>Praktik Tapşırıq:</strong> {mod.practical_task}
                  </div>

                  {mod.status === "authored" && mod.lessonSummaries.length > 0 && (
                    <div className="module-lessons-list">
                      <strong>Dərslər:</strong>
                      <div className="lesson-Rows">
                        {mod.lessonSummaries.map((ls, idx) => (
                          <div key={ls.id} className="module-lesson-row">
                            <div>
                              <span
                                className={`status-dot status-${ls.status}`}
                                title={ls.status}
                              />
                              <strong>
                                {idx + 1}. {ls.title}
                              </strong>{" "}
                              <small className="muted">
                                ({ls.estimated_minutes[0]}–{ls.estimated_minutes[1]} dəq)
                              </small>
                            </div>
                            <button
                              type="button"
                              className="btn btn-primary btn-xs"
                              onClick={() => onOpenLesson(ls.id)}
                            >
                              {ls.status === "completed"
                                ? "Təkrar bax"
                                : ls.status === "in_progress"
                                  ? "Davam et →"
                                  : "Başla →"}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {mod.planned_topics.length > 0 && (
                    <div className="module-planned-topics">
                      <small className="muted">
                        <strong>Planlaşdırılan növbəti mövzular:</strong>{" "}
                        {mod.planned_topics.join(" · ")}
                      </small>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
