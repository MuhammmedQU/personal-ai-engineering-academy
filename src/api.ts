import type {
  BootstrapData,
  BookmarkItem,
  DiagnosticSummary,
  ExerciseView,
  LessonView,
  NoteItem,
  SafeMentorConfig,
} from "./types.ts";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) msg = err.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const api = {
  getBootstrap: () => request<BootstrapData>("/api/bootstrap"),

  getDiagnostic: () =>
    request<{
      areas: Array<{
        id: string;
        title: string;
        description: string;
        self_rating_prompt: string;
        related_modules: string[];
      }>;
      goals: Array<{ id: string; label: string; focus_modules: string[] }>;
      checks: Array<{ area: string; question: ExerciseView }>;
    }>("/api/diagnostic"),

  submitDiagnostic: (payload: {
    name?: string;
    goalId: string;
    weeklyHours: number;
    selfRatings: Record<string, number>;
    answers: Record<string, unknown>;
  }) =>
    request<{
      results: Record<string, { passed: boolean; skipped: boolean; feedback: string; explanation: string }>;
      summary: DiagnosticSummary;
    }>("/api/diagnostic/submit", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getLesson: (id: string) =>
    request<{
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
    }>(`/api/lessons/${encodeURIComponent(id)}`),

  updateLessonSection: (
    lessonId: string,
    payload: { sectionId: string; mark?: "understood" | "unclear" | "clear" },
  ) =>
    request<{
      lastSectionId: string;
      understoodSections: string[];
      unclearSections: string[];
    }>(`/api/lessons/${encodeURIComponent(lessonId)}/section`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  submitQuiz: (lessonId: string, answers: Record<string, unknown>) =>
    request<{
      score: number;
      correct: number;
      total: number;
      passThreshold: number;
      passed: boolean;
      details: Record<string, { passed: boolean; feedback: string; explanation: string }>;
      lessonCompleted: boolean;
    }>(`/api/lessons/${encodeURIComponent(lessonId)}/quiz`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    }),

  submitExercise: (
    exerciseId: string,
    payload: { answer: unknown; usedHint?: boolean; revealedSolution?: boolean },
  ) =>
    request<{
      grade: {
        passed: boolean;
        feedback: string;
        explanation?: string;
        optionFeedback?: Record<string, string>;
        rubric?: string[];
        modelAnswer?: string;
      };
      updatedSkills: unknown[];
      lessonCompleted: boolean;
    }>(`/api/exercises/${encodeURIComponent(exerciseId)}/submit`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  revealExercise: (exerciseId: string) =>
    request<{ solution: unknown; explanation: string }>(
      `/api/exercises/${encodeURIComponent(exerciseId)}/reveal`,
      { method: "POST" },
    ),

  getPractice: () =>
    request<{
      exercises: Array<{
        exercise: ExerciseView;
        sourceKind: "lesson" | "practice";
        lessonId: string | null;
        lessonTitle: string | null;
        topic: string | null;
        stats: {
          attempts: number;
          passedUnaided: boolean;
          fails: number;
          recurringMistake: boolean;
          lastAttemptAt: string | null;
        };
      }>;
    }>("/api/practice"),

  activateProject: (projectId: string) =>
    request<{ activeProjectId: string }>(
      `/api/projects/${encodeURIComponent(projectId)}/activate`,
      { method: "POST" },
    ),

  updateMilestone: (
    projectId: string,
    milestoneId: string,
    payload: {
      checkedTasks: number[];
      notes: string;
      evidence: string;
      markComplete?: boolean;
    },
  ) =>
    request<{
      projectId: string;
      milestoneId: string;
      status: string;
      checkedTasks: number[];
      notes: string;
      evidence: string;
      warning: string | null;
      updatedAt: string;
    }>(
      `/api/projects/${encodeURIComponent(projectId)}/milestones/${encodeURIComponent(milestoneId)}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),

  saveNote: (payload: {
    id?: number;
    lessonId: string;
    sectionId?: string | null;
    tags?: string;
    content: string;
  }) =>
    request<NoteItem>("/api/notes", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  deleteNote: (id: number) =>
    request<{ ok: boolean }>(`/api/notes/${id}`, { method: "DELETE" }),

  toggleBookmark: (payload: {
    targetType: "lesson" | "exercise" | "project";
    targetId: string;
    sectionId?: string | null;
    label: string;
  }) =>
    request<{ bookmarked: boolean; id: number }>("/api/bookmarks", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  deleteBookmark: (id: number) =>
    request<{ ok: boolean }>(`/api/bookmarks/${id}`, { method: "DELETE" }),

  getMentorHistory: (contextType = "global", contextId = "main") =>
    request<{
      contextType: string;
      contextId: string;
      messages: Array<{
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
      }>;
      updatedAt: string | null;
      status: {
        configured: boolean;
        provider: string;
        model: string;
        privacyNotice: string;
      };
      retentionPolicy: string;
    }>(
      `/api/mentor/history?contextType=${encodeURIComponent(contextType)}&contextId=${encodeURIComponent(contextId)}`,
    ),

  askMentor: (payload: {
    action:
      | "chat"
      | "lesson-help"
      | "review-exercise"
      | "explain-code"
      | "study-plan"
      | "generate-exercise"
      | "explain-mistake"
      | "review-project-file";
    message: string;
    contextType?: string;
    contextId?: string;
    context?: {
      lessonId?: string;
      sectionId?: string;
      exerciseId?: string;
      projectId?: string;
      filename?: string;
      codeSnippet?: string;
      learnerAnswer?: string;
      errorOutput?: string;
      explanationLevel?: "beginner" | "intermediate" | "advanced";
      socraticMode?: boolean;
    };
  }) =>
    request<{
      mode: "live-ai" | "demo-no-key";
      providerName: string;
      modelName: string;
      explanationLevel: "beginner" | "intermediate" | "advanced";
      reply: string;
      followUpQuestion?: string;
      referencedLessons: Array<{ id: string; title: string }>;
      usage?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCostUsd: number | null;
      } | null;
      fallbackError?: string | null;
      privacyNotice: string;
      messages: Array<{
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
      }>;
    }>("/api/mentor/ask", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getMentorConfig: () => request<SafeMentorConfig>("/api/mentor/config"),

  saveMentorConfig: (payload: {
    provider: "demo" | "openai" | "gemini" | "anthropic" | "ollama";
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    clearKey?: boolean;
  }) =>
    request<SafeMentorConfig>("/api/mentor/config", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  clearMentorHistory: (contextType = "global", contextId = "main") =>
    request<{ ok: boolean }>(
      `/api/mentor/history?contextType=${encodeURIComponent(contextType)}&contextId=${encodeURIComponent(contextId)}`,
      { method: "DELETE" },
    ),

  updateSettings: (payload: {
    name?: string;
    goalId?: string;
    weeklyHours?: number;
    dailyGoalMinutes?: number;
    explanationLevel?: "beginner" | "intermediate" | "advanced";
    socraticMode?: boolean;
    remindersEnabled?: boolean;
    theme?: "dark" | "light";
  }) =>
    request<{
      name: string;
      goalId: string;
      weeklyHours: number;
      dailyGoalMinutes: number;
      explanationLevel: "beginner" | "intermediate" | "advanced";
      socraticMode: boolean;
      remindersEnabled: boolean;
      theme: "dark" | "light";
    }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  // ---- Coding Lab Drafts & SQL Sandbox ----
  getLabDrafts: () =>
    request<{
      drafts: Array<{
        id: number;
        draft_key: string;
        exercise_id: string | null;
        title: string;
        language: "python" | "sql";
        code: string;
        stdin: string;
        last_output: string;
        updated_at: string;
      }>;
    }>("/api/lab/drafts"),

  saveLabDraft: (payload: {
    draftKey?: string;
    exerciseId?: string | null;
    title: string;
    language: "python" | "sql";
    code: string;
    stdin?: string;
    lastOutput?: string;
  }) =>
    request<{ draft: Record<string, unknown> }>("/api/lab/drafts", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  deleteLabDraft: (id: number) =>
    request<{ ok: boolean }>(`/api/lab/drafts/${id}`, { method: "DELETE" }),

  runSqlSandbox: (payload: { setupSql: string; querySql: string }) =>
    request<{
      ok: boolean;
      error?: string;
      columns: string[];
      rows: Array<Record<string, unknown>>;
      totalRows?: number;
      truncated?: boolean;
      elapsedMs?: number;
    }>("/api/lab/sql", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // ---- Project Files & AI Senior Code Review ----
  getProjectFiles: (projectId: string) =>
    request<{
      files: Array<{
        id: number;
        project_id: string;
        filename: string;
        language: string;
        content: string;
        ai_review: string;
        updated_at: string;
      }>;
    }>(`/api/projects/${encodeURIComponent(projectId)}/files`),

  saveProjectFile: (
    projectId: string,
    payload: { id?: number; filename: string; language: string; content: string },
  ) =>
    request<{ file: Record<string, unknown> }>(
      `/api/projects/${encodeURIComponent(projectId)}/files`,
      { method: "POST", body: JSON.stringify(payload) },
    ),

  deleteProjectFile: (projectId: string, fileId: number) =>
    request<{ ok: boolean }>(
      `/api/projects/${encodeURIComponent(projectId)}/files/${fileId}`,
      { method: "DELETE" },
    ),

  reviewProjectFile: (projectId: string, fileId: number) =>
    request<{ review: { reply: string; mode: string }; fileId: number; updatedAt: string }>(
      `/api/projects/${encodeURIComponent(projectId)}/files/${fileId}/review`,
      { method: "POST" },
    ),

  // ---- Flashcards & SM-2 Spaced Repetition ----
  getFlashcards: () =>
    request<{
      cards: Array<{
        id: number;
        card_key: string | null;
        lesson_id: string | null;
        front: string;
        back: string;
        tags: string;
        interval_days: number;
        ease_factor: number;
        repetitions: number;
        last_reviewed_at: string | null;
        next_review_at: string | null;
        created_at: string;
      }>;
      dueCount: number;
    }>("/api/flashcards"),

  createFlashcard: (payload: {
    lessonId?: string | null;
    front: string;
    back: string;
    tags?: string;
  }) =>
    request<{ card: Record<string, unknown> }>("/api/flashcards", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  reviewFlashcard: (id: number, quality: 1 | 2 | 3 | 4) =>
    request<{ card: Record<string, unknown> }>(`/api/flashcards/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ quality }),
    }),

  deleteFlashcard: (id: number) =>
    request<{ ok: boolean }>(`/api/flashcards/${id}`, { method: "DELETE" }),

  // ---- Mistake Notebook ----
  getMistakes: () =>
    request<{
      mistakes: Array<{
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
      }>;
    }>("/api/mistakes"),

  saveMistakeReflection: (
    exerciseId: string,
    payload: { takeaway: string; resolved?: boolean },
  ) =>
    request<{ exerciseId: string; takeaway: string; resolved: boolean }>(
      `/api/mistakes/${encodeURIComponent(exerciseId)}/reflection`,
      { method: "POST", body: JSON.stringify(payload) },
    ),

  // ---- Knowledge Management & Global Search ----
  getKnowledge: () =>
    request<{
      snippets: Array<{
        id: number;
        title: string;
        language: string;
        tags: string;
        code: string;
        notes: string;
        updated_at: string;
      }>;
      resources: Array<{
        id: number;
        kind: string;
        title: string;
        url_or_path: string;
        tags: string;
        summary: string;
        updated_at: string;
      }>;
      notes: NoteItem[];
      bookmarks: BookmarkItem[];
      glossary: Array<{
        term: string;
        definition: string;
        lessonId: string;
        lessonTitle: string;
        track: string;
      }>;
    }>("/api/knowledge"),

  saveSnippet: (payload: {
    id?: number;
    title: string;
    language: string;
    tags?: string;
    code: string;
    notes?: string;
  }) =>
    request<{ snippet: Record<string, unknown> }>("/api/knowledge/snippets", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  deleteSnippet: (id: number) =>
    request<{ ok: boolean }>(`/api/knowledge/snippets/${id}`, { method: "DELETE" }),

  saveResource: (payload: {
    id?: number;
    kind: string;
    title: string;
    urlOrPath?: string;
    tags?: string;
    summary?: string;
  }) =>
    request<{ resource: Record<string, unknown> }>("/api/knowledge/resources", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  deleteResource: (id: number) =>
    request<{ ok: boolean }>(`/api/knowledge/resources/${id}`, { method: "DELETE" }),

  globalSearch: (q: string) =>
    request<{
      query: string;
      results: Array<{
        type: "lesson" | "term" | "exercise" | "project" | "note" | "snippet" | "resource";
        id: string;
        title: string;
        snippet: string;
        targetId: string;
        sectionId?: string;
      }>;
    }>(`/api/search?q=${encodeURIComponent(q)}`),

  // ---- Study Planner ----
  getPlanner: () =>
    request<{
      streakDays: number;
      todayMinutes: number;
      dailyGoalMinutes: number;
      weeklyHoursGoal: number;
      totalMonthMinutes: number;
      activeDaysLast30: number;
      dueFlashcards: number;
      last30Days: Array<{ dayIso: string; minutes: number; actionsCount: number }>;
      recommendations: Array<{
        priority: number;
        category: "review" | "exercise" | "lesson" | "project";
        title: string;
        reason: string;
        estimatedMinutes: number;
        targetId: string;
      }>;
      tasks: Array<{
        id: number;
        title: string;
        category: string;
        target_id: string | null;
        estimated_minutes: number;
        due_date: string | null;
        priority: 1 | 2 | 3;
        completed: number;
        completed_at: string | null;
        created_at: string;
      }>;
    }>("/api/planner"),

  createPlannerTask: (payload: {
    title: string;
    category?: "lesson" | "exercise" | "project" | "review" | "custom";
    targetId?: string | null;
    estimatedMinutes?: number;
    dueDate?: string | null;
    priority?: 1 | 2 | 3;
  }) =>
    request<{ task: Record<string, unknown> }>("/api/planner/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updatePlannerTask: (
    id: number,
    payload: { completed?: boolean; priority?: 1 | 2 | 3; dueDate?: string | null; title?: string },
  ) =>
    request<{ task: Record<string, unknown> }>(`/api/planner/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deletePlannerTask: (id: number) =>
    request<{ ok: boolean }>(`/api/planner/tasks/${id}`, { method: "DELETE" }),

  exportBackup: () => request<Record<string, unknown>>("/api/export"),

  importBackup: (data: Record<string, unknown>) =>
    request<{ ok: boolean; safetySnapshot?: string | null }>("/api/import", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  listBackups: () =>
    request<{
      backups: Array<{
        filename: string;
        reason: string;
        sizeBytes: number;
        createdAt: string;
      }>;
    }>("/api/backups"),

  createBackup: () =>
    request<{ ok: boolean; filename: string; reason: string }>("/api/backups/create", {
      method: "POST",
    }),

  restoreBackup: (filename: string) =>
    request<{ ok: boolean; restoredFrom: string; safetySnapshot: string | null }>(
      "/api/backups/restore",
      {
        method: "POST",
        body: JSON.stringify({ filename }),
      },
    ),

  resetAll: () =>
    request<{ ok: boolean; safetySnapshot?: string | null }>("/api/reset", {
      method: "POST",
    }),
};
