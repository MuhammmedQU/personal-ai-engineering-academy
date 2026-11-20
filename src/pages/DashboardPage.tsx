import React from "react";
import type { BootstrapData } from "../types.ts";

interface DashboardPageProps {
  data: BootstrapData;
  onStartDiagnostic: () => void;
  onOpenLesson: (lessonId: string, sectionId?: string | null) => void;
  onOpenPractice: (exerciseId?: string) => void;
  onOpenProject: (projectId: string) => void;
  onOpenPath: () => void;
  onOpenPlanner: () => void;
  onOpenKnowledge: () => void;
}

export function DashboardPage({
  data,
  onStartDiagnostic,
  onOpenLesson,
  onOpenPractice,
  onOpenProject,
  onOpenPath,
  onOpenPlanner,
  onOpenKnowledge,
}: DashboardPageProps) {
  const { profile, dashboard, latestDiagnostic } = data;
  const nextLesson = dashboard.nextRecommendedLesson;
  const proj = dashboard.currentProject;
  const maxWeeklyMinutes = Math.max(
    30,
    ...dashboard.weeklyActivity.map((d) => d.minutes),
  );
  const totalWeekMinutes = dashboard.weeklyActivity.reduce((acc, d) => acc + d.minutes, 0);
  const dailyGoalPct = Math.min(
    100,
    Math.round((dashboard.todayMinutes / Math.max(1, dashboard.dailyGoalMinutes)) * 100),
  );

  return (
    <div className="dashboard-page">
      {/* Honest Onboarding Banner if user hasn't run diagnostic yet */}
      {!profile.onboarded ? (
        <div className="onboarding-hero panel">
          <div className="onboarding-hero-content">
            <span className="badge badge-category">Yeni Öyrənən — Dürüst Başlanğıc Vəziyyəti</span>
            <h1>Xoş gəldin! Gəl sənin real səviyyəndən başlayaq.</h1>
            <p>
              Bu platforma saxta irəliləyiş faizləri göstərmir və sənin sıfırdan başladığını fərz etmir.
              3 dəqiqəlik ilkin diaqnostika və praktik yoxlama ilə güclü və zəif tərəflərini müəyyən et,
              fərdi tədris planını qur. Yaxud birbaşa ilk dərsdən başla.
            </p>
            <div className="hero-actions">
              <button type="button" className="btn btn-primary" onClick={onStartDiagnostic}>
                Diaqnostikanı Başlat (Tövsiyə olunur) →
              </button>
              {nextLesson && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onOpenLesson(nextLesson.id)}
                >
                  Birbaşa 1-ci dərsə keç: {nextLesson.title}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="stage-banner panel">
          <div>
            <span className="badge badge-success">{dashboard.currentStage}</span>
            <h1>Salam, {profile.name} — Öyrənmə Mühiti</h1>
            <p className="subtitle">
              Tamamlanmış dərslər: <strong>{dashboard.completedLessonsTotal}</strong> /{" "}
              {dashboard.totalAuthoredLessons} &middot; Sübut olunmuş bacarıqlar (Demonstrated):{" "}
              <strong>{dashboard.skillsMap.strong.length}</strong> &middot; Həftəlik hədəf:{" "}
              <strong>{profile.weeklyHours} saat</strong>
            </p>
          </div>
          <div className="hero-actions">
            {nextLesson && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onOpenLesson(nextLesson.id, nextLesson.lastSectionId)}
              >
                {nextLesson.isResume ? "Dərsə davam et →" : "Növbəti dərsə başla →"}
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={onStartDiagnostic}>
              Diaqnostika hesabatı
            </button>
          </div>
        </div>
      )}

      {/* Personal Study Stats Strip: Daily Goal, Streak, Due Flashcards, Quick Knowledge */}
      <div className="dashboard-kpi-strip">
        <div className="panel kpi-mini-card">
          <div className="panel-header-row" style={{ marginBottom: "0.35rem" }}>
            <span className="badge badge-category">Bugünkü Hədəf</span>
            <strong>{dailyGoalPct}%</strong>
          </div>
          <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>
            {dashboard.todayMinutes} / {dashboard.dailyGoalMinutes} dəq
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${dailyGoalPct}%` }} />
          </div>
        </div>

        <div className="panel kpi-mini-card">
          <span className="badge badge-success">Öyrənmə Ardıcıllığı</span>
          <div style={{ fontSize: "1.2rem", fontWeight: 700, marginTop: "0.3rem" }}>
            {dashboard.streakDays} gün streak
          </div>
          <button type="button" className="link-btn" onClick={onOpenPlanner} style={{ padding: 0 }}>
            30 günlük təqvim & planlayıcı →
          </button>
        </div>

        <div className="panel kpi-mini-card">
          <span className="badge badge-type">Aralıqlı Təkrar (SM-2)</span>
          <div style={{ fontSize: "1.2rem", fontWeight: 700, marginTop: "0.3rem" }}>
            {dashboard.dueFlashcardsCount} flashcard gözləyir
          </div>
          <button type="button" className="link-btn" onClick={onOpenKnowledge} style={{ padding: 0 }}>
            Flashcards & Səhvlər Dəftəri →
          </button>
        </div>

        <div className="panel kpi-mini-card">
          <span className="badge badge-muted">Şəxsi Bilik Bazası</span>
          <div style={{ fontSize: "1.05rem", fontWeight: 700, marginTop: "0.3rem" }}>
            {data.notes.length} qeyd · {data.bookmarks.length} əlfəcin
          </div>
          <button type="button" className="link-btn" onClick={onOpenKnowledge} style={{ padding: 0 }}>
            Qlobal axtarış & snippets →
          </button>
        </div>
      </div>

      {/* Primary Action Cards: Next Lesson + Current Project */}
      <div className="cards-grid-2">
        <div className="panel">
          <div className="panel-header-row">
            <span className="badge badge-type">Növbəti Tövsiyə Olunan Dərs</span>
            {nextLesson && (
              <span className="muted">
                {nextLesson.estimatedMinutes[0]}–{nextLesson.estimatedMinutes[1]} dəq
              </span>
            )}
          </div>
          {nextLesson ? (
            <>
              <h2>{nextLesson.title}</h2>
              <p className="muted">
                {nextLesson.trackTitle} &rarr; {nextLesson.moduleTitle}
              </p>
              <p>{nextLesson.summary}</p>
              <div className="card-footer-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => onOpenLesson(nextLesson.id, nextLesson.lastSectionId)}
                >
                  {nextLesson.isResume ? "Qaldığın yerdən davam et →" : "Dərsi aç →"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={onOpenPath}>
                  Bütün yol xəritəsi
                </button>
              </div>
            </>
          ) : (
            <p>Bütün mövcud dərslər tamamlanıb!</p>
          )}
        </div>

        <div className="panel">
          <div className="panel-header-row">
            <span className="badge badge-category">Aktiv Layihə & Növbəti Milestone</span>
            {proj && (
              <span className="muted">
                {proj.completedMilestones}/{proj.totalMilestones} milestone sübutla tamamlanıb
              </span>
            )}
          </div>
          {proj ? (
            <>
              <h2>{proj.title}</h2>
              {proj.nextMilestone ? (
                <div className="milestone-callout">
                  <strong>Növbəti Milestone: {proj.nextMilestone.title}</strong>
                  <p>{proj.nextMilestone.goal}</p>
                  <small className="muted">
                    Tələb olunan sübut (Evidence): {proj.nextMilestone.evidence_required}
                  </small>
                </div>
              ) : (
                <p className="badge badge-success">Bütün milestone-lar tamamlanıb!</p>
              )}
              <div className="card-footer-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onOpenProject(proj.id)}
                >
                  Layihə iş sahəsini aç →
                </button>
              </div>
            </>
          ) : (
            <p className="muted">Hələ layihə seçilməyib.</p>
          )}
        </div>
      </div>

      {/* First 3 actions from diagnostic if onboarded */}
      {latestDiagnostic && latestDiagnostic.firstThreeActions.length > 0 && (
        <div className="panel">
          <h3>Diaqnostikadan İlk 3 Öyrənmə Addımın</h3>
          <div className="cards-grid-3">
            {latestDiagnostic.firstThreeActions.map((act, idx) => (
              <div key={idx} className="action-card">
                <span className="badge badge-type">Addım #{idx + 1}</span>
                <h4>{act.title}</h4>
                <p className="muted">{act.reason}</p>
                {act.type === "lesson" ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onOpenLesson(act.id)}
                  >
                    Dərsi aç
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onOpenProject(act.id)}
                  >
                    Layihəni aç
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weekly Activity + Spaced Review & Recent Mistakes */}
      <div className="cards-grid-2">
        <div className="panel">
          <div className="panel-header-row">
            <h3>Son 7 Günün Faktiki Öyrənmə Aktivliyi</h3>
            <span className="badge badge-muted">Cəmi: {totalWeekMinutes} dəq</span>
          </div>
          <p className="subtitle">
            Yalnız real dərs bölməsi, quiz, tapşırıq və layihə milestone-ları qeydə alınır.
          </p>
          <div className="activity-chart">
            {dashboard.weeklyActivity.map((day) => {
              const heightPct =
                day.minutes > 0 ? Math.max(12, Math.round((day.minutes / maxWeeklyMinutes) * 100)) : 4;
              return (
                <div key={day.dayIso} className="activity-bar-col">
                  <div className="activity-bar-track">
                    <div
                      className={`activity-bar-fill ${day.minutes > 0 ? "has-activity" : ""}`}
                      style={{ height: `${heightPct}%` }}
                      title={`${day.dayIso}: ${day.minutes} dəq (${day.actionsCount} addım)`}
                    />
                  </div>
                  <span className="activity-bar-val">{day.minutes}d</span>
                  <span className="activity-bar-day">{day.dayIso.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <h3>Yenidən Baxılmalı Səhvlər və Spaced Review</h3>
          {dashboard.dueReviews.length > 0 && (
            <div className="review-alert-box">
              <strong>Təkrar vaxtı çatan bacarıqlar ({dashboard.dueReviews.length}):</strong>
              <div className="tag-list">
                {dashboard.dueReviews.map((sk) => (
                  <button
                    key={sk.id}
                    type="button"
                    className="tag-btn tag-warning"
                    onClick={() => onOpenPractice()}
                  >
                    {sk.name} ({sk.mastery.status})
                  </button>
                ))}
              </div>
            </div>
          )}

          {dashboard.recentMistakes.length === 0 ? (
            <p className="muted">
              Hələ həll edilməmiş səhv cəhd yoxdur. Tapşırıqlar üzərində işlədikcə təkrarlanan səhvlərin burada görünəcək.
            </p>
          ) : (
            <div className="mistakes-list">
              {dashboard.recentMistakes.map((m) => (
                <div key={m.exerciseId} className="mistake-row">
                  <div>
                    <span className="badge badge-category">{m.category}</span>{" "}
                    <strong>{m.title}</strong>
                    <p className="muted">{m.feedback}</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() =>
                      m.lessonId ? onOpenLesson(m.lessonId) : onOpenPractice(m.exerciseId)
                    }
                  >
                    Yenidən cəhd et
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Skills Map: Strong / In progress / Needs work */}
      <div className="panel">
        <div className="panel-header-row">
          <h3>Bacarıqlar Xəritəsi (Skills Map — Sübut Əsaslı)</h3>
          <span className="muted">
            Başlanmayıb: {dashboard.skillsMap.notStartedCount} bacarıq
          </span>
        </div>
        <p className="subtitle">
          Bir bacarığın &ldquo;Strong (Demonstrated)&rdquo; olması üçün yalnız dərsi oxumaq kifayət deyil — ən azı 2 fərqli tapşırığı ipucu və hazır həll açmadan doğru həll etməlisən.
        </p>
        <div className="cards-grid-3">
          <div className="skill-column">
            <h4>Güclü / Sübut Olunmuş ({dashboard.skillsMap.strong.length})</h4>
            {dashboard.skillsMap.strong.length === 0 ? (
              <p className="muted">Hələ sübut olunmuş bacarıq yoxdur.</p>
            ) : (
              <div className="tag-list">
                {dashboard.skillsMap.strong.map((sk) => (
                  <span key={sk.id} className="badge badge-success" title={sk.description}>
                    ✓ {sk.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="skill-column">
            <h4>Öyrənilir / Məşqdə ({dashboard.skillsMap.inProgress.length})</h4>
            {dashboard.skillsMap.inProgress.length === 0 ? (
              <p className="muted">Hələ başlanmış bacarıq yoxdur.</p>
            ) : (
              <div className="tag-list">
                {dashboard.skillsMap.inProgress.map((sk) => (
                  <span key={sk.id} className="badge badge-type" title={sk.description}>
                    ◐ {sk.name} ({sk.mastery.distinctPassedCount}/2)
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="skill-column">
            <h4>Təkrar Lazımdır / Needs Work ({dashboard.skillsMap.needsWork.length})</h4>
            {dashboard.skillsMap.needsWork.length === 0 ? (
              <p className="muted">Hazırda təcili təkrar tələb edən bacarıq yoxdur.</p>
            ) : (
              <div className="tag-list">
                {dashboard.skillsMap.needsWork.map((sk) => (
                  <button
                    key={sk.id}
                    type="button"
                    className="tag-btn tag-danger"
                    onClick={() => onOpenPractice()}
                  >
                    ! {sk.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
