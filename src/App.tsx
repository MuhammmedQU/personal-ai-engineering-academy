import React, { Suspense, lazy, useEffect, useState } from "react";
import { api } from "./api.ts";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import type { BootstrapData } from "./types.ts";

// Route-level code splitting: Dashboard stays eager for fast initial paint;
// all other workspaces (including Markdown/KaTeX/Mermaid/Pyodide) load on demand.
const DiagnosticPage = lazy(() =>
  import("./pages/DiagnosticPage.tsx").then((m) => ({ default: m.DiagnosticPage })),
);
const KnowledgePage = lazy(() =>
  import("./pages/KnowledgePage.tsx").then((m) => ({ default: m.KnowledgePage })),
);
const LearningPathPage = lazy(() =>
  import("./pages/LearningPathPage.tsx").then((m) => ({ default: m.LearningPathPage })),
);
const LessonsPage = lazy(() =>
  import("./pages/LessonsPage.tsx").then((m) => ({ default: m.LessonsPage })),
);
const MentorPage = lazy(() =>
  import("./pages/MentorPage.tsx").then((m) => ({ default: m.MentorPage })),
);
const PlannerPage = lazy(() =>
  import("./pages/PlannerPage.tsx").then((m) => ({ default: m.PlannerPage })),
);
const PracticeLabPage = lazy(() =>
  import("./pages/PracticeLabPage.tsx").then((m) => ({ default: m.PracticeLabPage })),
);
const ProgressPage = lazy(() =>
  import("./pages/ProgressPage.tsx").then((m) => ({ default: m.ProgressPage })),
);
const ProjectsPage = lazy(() =>
  import("./pages/ProjectsPage.tsx").then((m) => ({ default: m.ProjectsPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage.tsx").then((m) => ({ default: m.SettingsPage })),
);

class RouteErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="panel">
          <h2>Bölmə yüklənərkən xəta baş verdi</h2>
          <p className="text-danger">{this.state.error.message}</p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => this.setState({ error: null })}
          >
            Yenidən cəhd et
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export type NavTab =
  | "dashboard"
  | "learning-path"
  | "lessons"
  | "practice-lab"
  | "projects"
  | "ai-mentor"
  | "progress"
  | "settings"
  | "planner"
  | "knowledge"
  | "diagnostic";

const NAV_ITEMS: Array<{ id: NavTab; label: string; short: string }> = [
  { id: "dashboard", label: "1. Dashboard", short: "Dashboard" },
  { id: "learning-path", label: "2. Learning Path", short: "Yol Xəritəsi" },
  { id: "lessons", label: "3. Lessons", short: "Dərslər" },
  { id: "practice-lab", label: "4. Practice Lab", short: "Praktika" },
  { id: "projects", label: "5. Projects", short: "Layihələr" },
  { id: "ai-mentor", label: "6. AI Mentor", short: "AI Mentor" },
  { id: "progress", label: "7. Progress & Portfolio", short: "İrəliləyiş" },
  { id: "planner", label: "8. Study Planner", short: "Planlayıcı" },
  { id: "knowledge", label: "9. Knowledge & Flashcards", short: "Bilik Bazası" },
  { id: "settings", label: "10. Settings", short: "Tənzimləmələr" },
];

export function App() {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<NavTab>("dashboard");
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [mentorContext, setMentorContext] = useState<{
    lessonId?: string;
    sectionId?: string;
    exerciseId?: string;
    projectId?: string;
    codeSnippet?: string;
    errorOutput?: string;
    title?: string;
  } | null>(null);

  const refreshBootstrap = async () => {
    try {
      const res = await api.getBootstrap();
      setData(res);
      document.documentElement.setAttribute("data-theme", res.profile.theme || "dark");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshBootstrap();
  }, []);

  const openLesson = (lessonId: string, sectionId?: string | null) => {
    setActiveLessonId(lessonId || null);
    setActiveSectionId(sectionId ?? null);
    setActiveTab("lessons");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openPractice = (exerciseId?: string) => {
    setActiveExerciseId(exerciseId ?? null);
    setActiveTab("practice-lab");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setActiveTab("projects");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openMentorWithContext = (ctx: {
    lessonId?: string;
    sectionId?: string;
    exerciseId?: string;
    projectId?: string;
    codeSnippet?: string;
    errorOutput?: string;
    title?: string;
  }) => {
    setMentorContext(ctx);
    setActiveTab("ai-mentor");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleThemeQuick = async () => {
    if (!data) return;
    const nextTheme = data.profile.theme === "dark" ? "light" : "dark";
    await api.updateSettings({ theme: nextTheme });
    await refreshBootstrap();
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="panel">
          <h2>AI Engineering Academy yüklənir...</h2>
          <p className="muted">Kurikulum, bacarıqlar və lokal SQLite bazası oxunur.</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="loading-screen">
        <div className="panel">
          <h2>Serverlə əlaqə xətası</h2>
          <p className="text-danger">{error ?? "Məlumat yüklənmədi"}</p>
          <button type="button" className="btn btn-primary" onClick={refreshBootstrap}>
            Yenidən cəhd et
          </button>
        </div>
      </div>
    );
  }

  const demonstratedCount = data.dashboard.skillsMap.strong.length;

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand-box">
          <div className="brand-logo">AI</div>
          <div>
            <strong className="brand-title">AI Engineering Academy</strong>
            <small className="brand-sub">Şəxsi Mühəndislik Məktəbi</small>
          </div>
        </div>

        <nav className="main-nav" aria-label="Əsas naviqasiya">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${activeTab === item.id ? "active" : ""}`}
              onClick={() => setActiveTab(item.id)}
            >
              <span>{item.label}</span>
              {item.id === "lessons" && (
                <small className="nav-badge">
                  {data.dashboard.completedLessonsTotal}/{data.dashboard.totalAuthoredLessons}
                </small>
              )}
              {item.id === "progress" && (
                <small className="nav-badge">{demonstratedCount}</small>
              )}
              {item.id === "knowledge" && data.dashboard.dueFlashcardsCount > 0 && (
                <small className="nav-badge">{data.dashboard.dueFlashcardsCount}</small>
              )}
              {item.id === "planner" && data.dashboard.streakDays > 0 && (
                <small className="nav-badge">{data.dashboard.streakDays}d</small>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            type="button"
            className={`nav-item ${activeTab === "diagnostic" ? "active" : ""}`}
            onClick={() => setActiveTab("diagnostic")}
          >
            <span>Diaqnostika & Plan</span>
            <small className="nav-badge">{data.profile.onboarded ? "✓" : "!"}</small>
          </button>
          <div className="sidebar-status-row">
            <span
              className={`badge ${
                data.mentorStatus.configured ? "badge-success" : "badge-muted"
              }`}
            >
              {data.mentorStatus.configured ? "Mentor: Live AI" : "Mentor: Offline Demo"}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={toggleThemeQuick}
              title="Görünüş rejimini dəyiş"
            >
              {data.profile.theme === "dark" ? "☀ Açıq" : "☾ Tünd"}
            </button>
          </div>
        </div>
      </aside>

      <div className="app-main-wrap">
        <header className="mobile-topbar">
          <div className="mobile-topbar-row">
            <strong>AI Engineering Academy</strong>
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
              <button
                type="button"
                className={`btn btn-ghost btn-xs ${activeTab === "diagnostic" ? "active" : ""}`}
                onClick={() => setActiveTab("diagnostic")}
              >
                Diaqnostika
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={toggleThemeQuick}
                title="Görünüş rejimini dəyiş"
              >
                {data.profile.theme === "dark" ? "☀ Açıq" : "☾ Tünd"}
              </button>
            </div>
          </div>
          <nav className="mobile-nav-scroll" aria-label="Mobil naviqasiya">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`filter-chip ${activeTab === item.id ? "active" : ""}`}
                onClick={() => setActiveTab(item.id)}
              >
                {item.short}
              </button>
            ))}
          </nav>
        </header>

        <main className="app-content">
          <RouteErrorBoundary>
            <Suspense fallback={<div className="panel">Bölmə yüklənir...</div>}>
              {activeTab === "dashboard" && (
                <DashboardPage
                  data={data}
                  onStartDiagnostic={() => setActiveTab("diagnostic")}
                  onOpenLesson={openLesson}
                  onOpenPractice={openPractice}
                  onOpenProject={openProject}
                  onOpenPath={() => setActiveTab("learning-path")}
                  onOpenPlanner={() => setActiveTab("planner")}
                  onOpenKnowledge={() => setActiveTab("knowledge")}
                />
              )}

              {activeTab === "diagnostic" && (
                <DiagnosticPage
                  initialName={data.profile.name}
                  initialGoalId={data.profile.goalId}
                  initialWeeklyHours={data.profile.weeklyHours}
                  existingSummary={data.latestDiagnostic}
                  onComplete={refreshBootstrap}
                  onOpenLesson={openLesson}
                  onOpenProject={openProject}
                />
              )}

              {activeTab === "learning-path" && (
                <LearningPathPage tracks={data.tracks} onOpenLesson={openLesson} />
              )}

              {activeTab === "lessons" && (
                <LessonsPage
                  tracks={data.tracks}
                  activeLessonId={activeLessonId}
                  initialSectionId={activeSectionId}
                  onSelectLesson={openLesson}
                  onProgressUpdated={refreshBootstrap}
                  onAskMentor={openMentorWithContext}
                />
              )}

              {activeTab === "practice-lab" && (
                <PracticeLabPage
                  initialExerciseId={activeExerciseId}
                  onProgressUpdated={refreshBootstrap}
                  onAskMentor={openMentorWithContext}
                />
              )}

              {activeTab === "projects" && (
                <ProjectsPage
                  projects={data.projects}
                  activeProjectId={data.profile.activeProjectId}
                  selectedProjectId={selectedProjectId}
                  onSelectProject={setSelectedProjectId}
                  onOpenLesson={openLesson}
                  onProgressUpdated={refreshBootstrap}
                  onAskMentor={openMentorWithContext}
                />
              )}

              {activeTab === "ai-mentor" && (
                <MentorPage
                  data={data}
                  initialContext={mentorContext}
                  onOpenLesson={openLesson}
                />
              )}

              {activeTab === "progress" && (
                <ProgressPage
                  data={data}
                  onOpenLesson={openLesson}
                  onOpenProject={openProject}
                  onOpenPractice={() => openPractice()}
                  onProgressUpdated={refreshBootstrap}
                />
              )}

              {activeTab === "planner" && (
                <PlannerPage
                  onOpenLesson={(lessonId) => openLesson(lessonId)}
                  onOpenProject={openProject}
                  onOpenPractice={() => openPractice()}
                  onOpenKnowledge={() => setActiveTab("knowledge")}
                  onProgressUpdated={refreshBootstrap}
                />
              )}

              {activeTab === "knowledge" && (
                <KnowledgePage
                  onOpenLesson={openLesson}
                  onOpenPractice={openPractice}
                  onOpenProject={openProject}
                  onAskMentor={openMentorWithContext}
                  onProgressUpdated={refreshBootstrap}
                />
              )}

              {activeTab === "settings" && (
                <SettingsPage data={data} onUpdated={refreshBootstrap} />
              )}
            </Suspense>
          </RouteErrorBoundary>
        </main>
      </div>
    </div>
  );
}
