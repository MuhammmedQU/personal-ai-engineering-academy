export type MasteryStatus =
  | "not_started"
  | "introduced"
  | "practicing"
  | "demonstrated"
  | "needs_review";

export interface SkillWithMastery {
  id: string;
  name: string;
  track: string;
  description: string;
  mastery: {
    status: MasteryStatus;
    distinctPassedCount: number;
    attemptsCount: number;
    correctCount: number;
    failStreak: number;
    lastPracticedAt: string | null;
    nextReviewAt: string | null;
  };
}

export interface LessonSummaryItem {
  id: string;
  title: string;
  summary: string;
  level: "foundation" | "core" | "advanced";
  estimated_minutes: [number, number];
  skills: string[];
  status: "not_started" | "in_progress" | "completed";
}

export interface ModuleView {
  id: string;
  title: string;
  summary: string;
  status: "authored" | "planned";
  level: "foundation" | "core" | "advanced" | "specialization";
  optional: boolean;
  prerequisites: string[];
  outcomes: string[];
  effort_hours: [number, number];
  practical_task: string;
  mastery_criteria: string[];
  lessons: string[];
  planned_topics: string[];
  lessonSummaries: LessonSummaryItem[];
  completedLessonsCount: number;
  totalLessonsCount: number;
}

export interface TrackView {
  id: string;
  code: string;
  title: string;
  summary: string;
  why: string;
  optional: boolean;
  modules: ModuleView[];
}

export interface MilestoneView {
  id: string;
  title: string;
  goal: string;
  tasks: string[];
  evidence_required: string;
  skills: string[];
  status: "not_started" | "in_progress" | "completed";
  checkedTasks: number[];
  notes: string;
  evidence: string;
  updatedAt: string | null;
}

export interface ProjectView {
  id: string;
  title: string;
  summary: string;
  optional: boolean;
  level: "foundation" | "core" | "advanced";
  estimated_hours: [number, number];
  recommended_lessons: string[];
  problem_statement: string;
  intended_user: string;
  requirements: string[];
  non_goals: string[];
  architecture: string;
  milestones: MilestoneView[];
  test_plan: string[];
  failure_cases: string[];
  privacy_security: string[];
  definition_of_done: string[];
  readme_outline: string[];
  stretch_goals: string[];
  completedMilestones: number;
  totalMilestones: number;
  isComplete: boolean;
}

export interface ExerciseView {
  id: string;
  type: "mcq" | "multi" | "numeric" | "text" | "order" | "code" | "explain";
  title: string;
  prompt: string;
  skills: string[];
  category: string;
  difficulty: 1 | 2 | 3;
  hints: string[];
  options?: Array<{ id: string; text: string }>;
  unit?: string | null;
  tolerance?: number;
  case_sensitive?: boolean;
  items?: Array<{ id: string; text: string }>;
  starter_code?: string;
  tests?: Array<{ name: string; code: string }>;
  rubric?: string[];
}

export interface LessonSection {
  id: string;
  kind:
    | "explanation"
    | "analogy"
    | "diagram"
    | "worked_example"
    | "code"
    | "mistakes"
    | "tradeoffs"
    | "deep_dive";
  title: string;
  body: string;
}

export interface LessonView {
  id: string;
  track: string;
  module: string;
  title: string;
  summary: string;
  level: "foundation" | "core" | "advanced";
  estimated_minutes: [number, number];
  prerequisites: string[];
  next?: string | null;
  skills: string[];
  objectives: string[];
  why_it_matters: string;
  terms: Array<{ term: string; definition: string }>;
  sections: LessonSection[];
  mastery_criteria: string[];
  quiz: {
    pass_threshold: number;
    questions: ExerciseView[];
  };
  exercises: ExerciseView[];
  references: Array<{ title: string; url: string; note?: string }>;
}

export interface NoteItem {
  id: number;
  lesson_id: string;
  section_id: string | null;
  tags?: string;
  content: string;
  updated_at: string;
}

export interface BookmarkItem {
  id: number;
  target_type: "lesson" | "exercise" | "project";
  target_id: string;
  section_id: string | null;
  label: string;
  created_at: string;
}

export interface DiagnosticSummary {
  goalId: string;
  weeklyHours: number;
  createdAt?: string;
  strongAreas: Array<{
    areaId: string;
    title: string;
    selfRating: number;
    checksTotal: number;
    checksCorrect: number;
    classification: "strong" | "partial" | "missing";
    note: string;
    relatedModules: string[];
  }>;
  partialAreas: Array<{
    areaId: string;
    title: string;
    selfRating: number;
    checksTotal: number;
    checksCorrect: number;
    classification: "strong" | "partial" | "missing";
    note: string;
    relatedModules: string[];
  }>;
  missingAreas: Array<{
    areaId: string;
    title: string;
    selfRating: number;
    checksTotal: number;
    checksCorrect: number;
    classification: "strong" | "partial" | "missing";
    note: string;
    relatedModules: string[];
  }>;
  firstThreeActions: Array<{
    type: "lesson" | "project" | "practice";
    id: string;
    title: string;
    reason: string;
  }>;
  studyPlan: Array<{
    phase: number;
    moduleId: string;
    moduleTitle: string;
    trackTitle: string;
    status: "authored" | "planned";
    effortHours: [number, number];
    estimatedWeeksRange: [number, number];
    reason: string;
    lessonIds: string[];
  }>;
}

export interface SafeMentorConfig {
  provider: "demo" | "openai" | "gemini" | "anthropic" | "ollama";
  model: string;
  baseUrl: string;
  hasStoredKey: boolean;
  maskedKey: string | null;
  configured: boolean;
  source: "local-config" | "env" | "demo";
  privacyNotice: string;
}

export interface BootstrapData {
  profile: {
    name: string;
    onboarded: boolean;
    goalId: string;
    weeklyHours: number;
    dailyGoalMinutes: number;
    explanationLevel: "beginner" | "intermediate" | "advanced";
    socraticMode: boolean;
    activeProjectId: string | null;
    lastLessonId: string | null;
    lastSectionId: string | null;
    remindersEnabled: boolean;
    theme: "dark" | "light";
  };
  latestDiagnostic: DiagnosticSummary | null;
  tracks: TrackView[];
  skills: SkillWithMastery[];
  lessonProgress: Record<
    string,
    {
      lessonId: string;
      status: string;
      lastSectionId: string | null;
      understoodSections: string[];
      unclearSections: string[];
      startedAt: string;
      updatedAt: string;
    }
  >;
  projects: ProjectView[];
  dashboard: {
    currentStage: string;
    completedLessonsTotal: number;
    totalAuthoredLessons: number;
    streakDays: number;
    todayMinutes: number;
    dailyGoalMinutes: number;
    dueFlashcardsCount: number;
    nextRecommendedLesson: {
      id: string;
      title: string;
      summary: string;
      trackId: string;
      trackTitle: string;
      moduleId: string;
      moduleTitle: string;
      estimatedMinutes: [number, number];
      lastSectionId: string | null;
      isResume: boolean;
    } | null;
    currentProject: {
      id: string;
      title: string;
      completedMilestones: number;
      totalMilestones: number;
      nextMilestone: MilestoneView | null;
    } | null;
    weeklyActivity: Array<{
      dayIso: string;
      minutes: number;
      actionsCount: number;
    }>;
    skillsMap: {
      strong: SkillWithMastery[];
      inProgress: SkillWithMastery[];
      needsWork: SkillWithMastery[];
      notStartedCount: number;
    };
    recentMistakes: Array<{
      exerciseId: string;
      title: string;
      lessonId: string | null;
      category: string;
      feedback: string;
      createdAt: string;
    }>;
    dueReviews: SkillWithMastery[];
  };
  mentorStatus: {
    configured: boolean;
    provider: string;
    model: string;
    privacyNotice: string;
  };
  mentorConfig: SafeMentorConfig;
  bookmarks: BookmarkItem[];
  notes: NoteItem[];
}
