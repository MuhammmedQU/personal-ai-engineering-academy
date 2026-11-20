import React, { useEffect, useState } from "react";
import { api } from "../api.ts";

interface PlannerPageProps {
  onOpenLesson: (lessonId: string) => void;
  onOpenProject: (projectId: string) => void;
  onOpenPractice: () => void;
  onOpenKnowledge: () => void;
  onProgressUpdated: () => void;
}

export function PlannerPage({
  onOpenLesson,
  onOpenProject,
  onOpenPractice,
  onOpenKnowledge,
  onProgressUpdated,
}: PlannerPageProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getPlanner>> | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState<
    "lesson" | "exercise" | "project" | "review" | "custom"
  >("custom");
  const [newMinutes, setNewMinutes] = useState(25);
  const [newDue, setNewDue] = useState(() => new Date().toISOString().slice(0, 10));
  const [newPriority, setNewPriority] = useState<1 | 2 | 3>(2);

  const loadPlanner = async () => {
    setLoading(true);
    try {
      const res = await api.getPlanner();
      setData(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlanner();
  }, []);

  if (loading || !data) {
    return <div className="panel">Tədris planlayıcısı yüklənir...</div>;
  }

  const goalPct = Math.min(
    100,
    Math.round((data.todayMinutes / Math.max(1, data.dailyGoalMinutes)) * 100),
  );

  const handleAddTask = async () => {
    if (!newTitle.trim()) return;
    await api.createPlannerTask({
      title: newTitle.trim(),
      category: newCategory,
      estimatedMinutes: newMinutes,
      dueDate: newDue,
      priority: newPriority,
    });
    setNewTitle("");
    await loadPlanner();
    onProgressUpdated();
  };

  const pendingTasks = data.tasks.filter((t) => t.completed === 0);
  const completedTasks = data.tasks.filter((t) => t.completed === 1);

  return (
    <div className="planner-page">
      <div className="page-header">
        <div>
          <h1>Şəxsi Tədris Planlayıcısı (Study Planner & 30-Day Analytics)</h1>
          <p className="subtitle">
            Gündəlik və həftəlik öyrənmə ritmi, real ardıcıllıq (streak), zəif mövzulara görə növbəti ən yaxşı addım tövsiyələri və 30 günlük təqvim hesabatı.
          </p>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="cards-grid-3">
        <div className="panel">
          <span className="badge badge-category">Bugünkü Hədəf</span>
          <h2>
            {data.todayMinutes} / {data.dailyGoalMinutes} dəq ({goalPct}%)
          </h2>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${goalPct}%` }} />
          </div>
        </div>
        <div className="panel">
          <span className="badge badge-success">Ardıcıl Günlər (Streak)</span>
          <h2>{data.streakDays} gün</h2>
          <small className="muted">Son 30 gündə aktiv gün sayı: {data.activeDaysLast30} gün</small>
        </div>
        <div className="panel">
          <span className="badge badge-type">Aylıq İcmal (30 gün)</span>
          <h2>{data.totalMonthMinutes} dəq</h2>
          <small className="muted">
            Həftəlik hədəf: {data.weeklyHoursGoal} saat · Gözləyən flashcard: {data.dueFlashcards}
          </small>
        </div>
      </div>

      {/* Smart Recommendations ("Next Best Task") */}
      <div className="panel">
        <h3>Sənin İrəliləyişinə Görə Tövsiyə Olunan Növbəti Addımlar</h3>
        <div className="cards-grid-2">
          {data.recommendations.map((rec, i) => (
            <div key={i} className="action-card">
              <div className="panel-header-row">
                <span className="badge badge-category">Prioritet #{rec.priority}</span>
                <span className="badge badge-muted">~{rec.estimatedMinutes} dəq</span>
              </div>
              <h4>{rec.title}</h4>
              <p className="muted">{rec.reason}</p>
              <div className="exercise-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-xs"
                  onClick={() => {
                    if (rec.category === "lesson") onOpenLesson(rec.targetId);
                    else if (rec.category === "project") onOpenProject(rec.targetId);
                    else if (rec.targetId === "flashcards") onOpenKnowledge();
                    else onOpenPractice();
                  }}
                >
                  İndi başla →
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={async () => {
                    await api.createPlannerTask({
                      title: rec.title,
                      category: rec.category,
                      targetId: rec.targetId,
                      estimatedMinutes: rec.estimatedMinutes,
                      priority: (rec.priority <= 3 ? rec.priority : 2) as 1 | 2 | 3,
                    });
                    await loadPlanner();
                  }}
                >
                  + Planıma əlavə et
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Custom Task Builder & Task List */}
      <div className="cards-grid-2">
        <div className="panel">
          <h3>Yeni Öyrənmə Tapşırığı Planlaşdır</h3>
          <div className="form-group">
            <label>Tapşırıq adı</label>
            <input
              type="text"
              className="input-field"
              placeholder="Məs. Self-Attention kod tapşırığını ipucusuz həll et"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
          </div>
          <div className="form-grid-3">
            <div className="form-group">
              <label>Kateqoriya</label>
              <select
                className="input-field"
                value={newCategory}
                onChange={(e) =>
                  setNewCategory(
                    e.target.value as "lesson" | "exercise" | "project" | "review" | "custom",
                  )
                }
              >
                <option value="lesson">Dərs</option>
                <option value="exercise">Məşq / Kod</option>
                <option value="project">Layihə</option>
                <option value="review">Təkrar</option>
                <option value="custom">Fərdi</option>
              </select>
            </div>
            <div className="form-group">
              <label>Təxmini vaxt (dəq)</label>
              <input
                type="number"
                min={5}
                max={300}
                className="input-field"
                value={newMinutes}
                onChange={(e) => setNewMinutes(Number(e.target.value) || 25)}
              />
            </div>
            <div className="form-group">
              <label>Prioritet</label>
              <select
                className="input-field"
                value={newPriority}
                onChange={(e) => setNewPriority(Number(e.target.value) as 1 | 2 | 3)}
              >
                <option value={1}>1 — Yüksək</option>
                <option value={2}>2 — Orta</option>
                <option value={3}>3 — Aşağı</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Tarix (Due Date)</label>
            <input
              type="date"
              className="input-field"
              value={newDue}
              onChange={(e) => setNewDue(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!newTitle.trim()}
            onClick={handleAddTask}
          >
            Planı Əlavə Et
          </button>
        </div>

        <div className="panel">
          <h3>Aktiv Plan ({pendingTasks.length}) & Tamamlananlar ({completedTasks.length})</h3>
          {pendingTasks.length === 0 ? (
            <p className="muted">Aktiv tapşırıq yoxdur. Yuxarıdakı tövsiyələrdən əlavə edə bilərsən.</p>
          ) : (
            <div className="notes-list">
              {pendingTasks.map((t) => (
                <div key={t.id} className="mistake-row">
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={async () => {
                        await api.updatePlannerTask(t.id, { completed: true });
                        await loadPlanner();
                        onProgressUpdated();
                      }}
                    />
                    <div>
                      <strong>{t.title}</strong>
                      <div className="muted" style={{ fontSize: "0.78rem" }}>
                        P{t.priority} · {t.category} · ~{t.estimated_minutes} dəq · {t.due_date ?? ""}
                      </div>
                    </div>
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={async () => {
                      await api.deletePlannerTask(t.id);
                      await loadPlanner();
                    }}
                  >
                    Sil
                  </button>
                </div>
              ))}
            </div>
          )}

          {completedTasks.length > 0 && (
            <>
              <hr className="divider" />
              <h4>Tamamlanmış Tarixçə ({completedTasks.length})</h4>
              <div className="notes-list">
                {completedTasks.slice(0, 8).map((t) => (
                  <div key={t.id} className="muted" style={{ fontSize: "0.85rem" }}>
                    ✓ {t.title} ({t.estimated_minutes} dəq)
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 30-Day Activity Calendar Heatmap */}
      <div className="panel">
        <h3>Son 30 Günün Öyrənmə Təqvimi (Calendar Heatmap)</h3>
        <div className="calendar-heatmap-grid">
          {data.last30Days.map((day) => {
            const level =
              day.minutes === 0
                ? 0
                : day.minutes < 15
                  ? 1
                  : day.minutes < 35
                    ? 2
                    : 3;
            return (
              <div
                key={day.dayIso}
                className={`heatmap-cell heatmap-lvl-${level}`}
                title={`${day.dayIso}: ${day.minutes} dəq (${day.actionsCount} addım)`}
              >
                <span className="heatmap-date">{day.dayIso.slice(8)}</span>
                <small>{day.minutes}d</small>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
