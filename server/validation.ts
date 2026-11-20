/**
 * Request validation & hardening helpers for the HTTP API.
 *
 * Threat model: a single-user, local-first app bound to localhost. The realistic
 * attackers are (a) a malicious web page open in the same browser trying to call
 * http://localhost:3001 (CSRF / DNS rebinding) and (b) malformed or oversized input.
 */
import type { Context, Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z, type ZodType } from "zod";

export class ApiError extends Error {
  status: 400 | 403 | 404 | 413 | 429;
  constructor(status: 400 | 403 | 404 | 413 | 429, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Origin / Host guard
// ---------------------------------------------------------------------------

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function extraHosts(): Set<string> {
  return new Set(
    (process.env.ALLOWED_HOSTS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function hostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return LOCAL_HOSTS.has(h) || extraHosts().has(h);
}

export async function localOnlyGuard(c: Context, next: Next) {
  const url = new URL(c.req.url);
  if (!hostAllowed(url.hostname)) {
    throw new ApiError(403, "Host not allowed");
  }
  const origin = c.req.header("origin");
  if (origin && origin !== "null") {
    let ok = false;
    try {
      ok = hostAllowed(new URL(origin).hostname);
    } catch {
      ok = false;
    }
    if (!ok) throw new ApiError(403, "Cross-origin request blocked");
  } else if (origin === "null") {
    throw new ApiError(403, "Opaque origin blocked");
  }
  await next();
}

const small = bodyLimit({
  maxSize: 1024 * 1024,
  onError: (c) => c.json({ error: "Request body too large (max 1 MB)" }, 413),
});
const large = bodyLimit({
  maxSize: 25 * 1024 * 1024,
  onError: (c) => c.json({ error: "Backup file too large (max 25 MB)" }, 413),
});
export const sizeLimit = (c: Context, next: Next) =>
  new URL(c.req.url).pathname === "/api/import" ? large(c, next) : small(c, next);

// ---------------------------------------------------------------------------
// JSON parsing + zod
// ---------------------------------------------------------------------------

export async function readBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length ? issue.path.join(".") + ": " : "";
    throw new ApiError(400, `Invalid request: ${where}${issue.message}`);
  }
  return parsed.data;
}

const shortStr = (max: number) => z.string().max(max);
const id = (max = 120) => z.string().min(1).max(max);
const plainRecord = <V extends ZodType>(v: V) =>
  z
    .custom<Record<string, unknown>>(
      (x) => typeof x === "object" && x !== null && !Array.isArray(x),
      { message: "expected an object" },
    )
    .pipe(z.record(z.string().max(200), v));

export const schemas = {
  diagnostic: z.strictObject({
    name: shortStr(60).optional(),
    goalId: id(60),
    weeklyHours: z.number().finite().min(1).max(80),
    selfRatings: plainRecord(z.number().int().min(0).max(3)),
    answers: plainRecord(
      z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]),
    ),
  }),
  section: z.strictObject({
    sectionId: id(80),
    mark: z.enum(["understood", "unclear", "clear"]).optional(),
  }),
  quiz: z.strictObject({ answers: plainRecord(z.unknown()) }),
  exerciseSubmit: z.strictObject({
    answer: z.unknown(),
    usedHint: z.boolean().optional(),
    revealedSolution: z.boolean().optional(),
  }),
  milestone: z.strictObject({
    checkedTasks: z.array(z.number().int().min(0).max(100)).max(100),
    notes: shortStr(5000),
    evidence: shortStr(5000),
    markComplete: z.boolean().optional(),
  }),
  projectFile: z.strictObject({
    id: z.number().int().positive().optional(),
    filename: z.string().trim().min(1).max(120),
    language: z.enum(["python", "sql", "yaml", "json", "dockerfile", "markdown", "text"]).default("python"),
    content: z.string().min(1).max(50_000),
  }),
  note: z.strictObject({
    id: z.number().int().positive().optional(),
    lessonId: id(),
    sectionId: id(80).nullable().optional(),
    tags: shortStr(200).optional(),
    content: z.string().trim().min(1, "note is empty").max(5000, "note too long (max 5000 chars)"),
  }),
  bookmark: z.strictObject({
    targetType: z.enum(["lesson", "exercise", "project"]),
    targetId: id(),
    sectionId: id(80).nullable().optional(),
    label: z.string().min(1).max(200),
  }),
  mentor: z.strictObject({
    action: z.enum([
      "chat",
      "lesson-help",
      "review-exercise",
      "explain-code",
      "study-plan",
      "generate-exercise",
      "explain-mistake",
      "review-project-file",
    ]),
    message: z.string().trim().min(1).max(4000),
    contextType: shortStr(40).optional(),
    contextId: shortStr(120).optional(),
    context: z
      .strictObject({
        lessonId: shortStr(120).optional(),
        sectionId: shortStr(120).optional(),
        exerciseId: shortStr(120).optional(),
        projectId: shortStr(120).optional(),
        filename: shortStr(120).optional(),
        codeSnippet: shortStr(20_000).optional(),
        learnerAnswer: shortStr(5000).optional(),
        errorOutput: shortStr(5000).optional(),
        explanationLevel: z.enum(["beginner", "intermediate", "advanced"]).optional(),
        socraticMode: z.boolean().optional(),
      })
      .optional(),
  }),
  mentorConfig: z.strictObject({
    provider: z.enum(["demo", "openai", "gemini", "anthropic", "ollama"]),
    model: shortStr(120).optional(),
    baseUrl: shortStr(300).optional(),
    apiKey: shortStr(300).optional(),
    clearKey: z.boolean().optional(),
  }),
  settings: z.strictObject({
    name: z.string().trim().min(1).max(60).optional(),
    goalId: id(60).optional(),
    weeklyHours: z.number().int().min(2).max(40).optional(),
    dailyGoalMinutes: z.number().int().min(10).max(360).optional(),
    explanationLevel: z.enum(["beginner", "intermediate", "advanced"]).optional(),
    socraticMode: z.boolean().optional(),
    remindersEnabled: z.boolean().optional(),
    theme: z.enum(["dark", "light"]).optional(),
  }),
  codeDraft: z.strictObject({
    draftKey: shortStr(120).optional(),
    exerciseId: shortStr(120).nullable().optional(),
    title: z.string().trim().min(1).max(140),
    language: z.enum(["python", "sql"]).default("python"),
    code: z.string().max(40_000),
    stdin: z.string().max(10_000).default(""),
    lastOutput: z.string().max(20_000).default(""),
  }),
  sqlSandbox: z.strictObject({
    setupSql: z.string().max(20_000).default(""),
    querySql: z.string().trim().min(1).max(10_000),
  }),
  flashcardCreate: z.strictObject({
    lessonId: shortStr(120).nullable().optional(),
    front: z.string().trim().min(1).max(500),
    back: z.string().trim().min(1).max(2000),
    tags: shortStr(200).default(""),
  }),
  flashcardReview: z.strictObject({
    quality: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  }),
  mistakeReflection: z.strictObject({
    takeaway: z.string().trim().min(1).max(2000),
    resolved: z.boolean().optional(),
  }),
  codeSnippet: z.strictObject({
    id: z.number().int().positive().optional(),
    title: z.string().trim().min(1).max(160),
    language: z.enum(["python", "sql", "bash", "yaml", "json", "dockerfile"]).default("python"),
    tags: shortStr(200).default(""),
    code: z.string().min(1).max(25_000),
    notes: shortStr(3000).default(""),
  }),
  knowledgeResource: z.strictObject({
    id: z.number().int().positive().optional(),
    kind: z.enum(["pdf", "paper", "article", "glossary", "note"]).default("article"),
    title: z.string().trim().min(1).max(200),
    urlOrPath: shortStr(500).default(""),
    tags: shortStr(200).default(""),
    summary: shortStr(4000).default(""),
  }),
  studyTaskCreate: z.strictObject({
    title: z.string().trim().min(1).max(200),
    category: z.enum(["lesson", "exercise", "project", "review", "custom"]).default("custom"),
    targetId: shortStr(120).nullable().optional(),
    estimatedMinutes: z.number().int().min(5).max(300).default(25),
    dueDate: shortStr(20).nullable().optional(),
    priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  }),
  studyTaskUpdate: z.strictObject({
    completed: z.boolean().optional(),
    priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    dueDate: shortStr(20).nullable().optional(),
    title: z.string().trim().min(1).max(200).optional(),
  }),
};

// ---------------------------------------------------------------------------
// Backup import schema (backward compatible with v1 backups)
// ---------------------------------------------------------------------------
const iso = z.string().max(40);
const jsonText = z.string().max(2_000_000).refine((s) => {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}, "must be valid JSON text");
const bool01 = z.union([z.literal(0), z.literal(1)]);
const MAX_ROWS = 200_000;

export const importSchema = z.object({
  version: z.literal(1),
  user_profile: z
    .array(
      z.object({
        name: shortStr(60),
        onboarded: bool01,
        goal_id: id(60),
        weekly_hours: z.number().int().min(1).max(80),
        daily_goal_minutes: z.number().int().min(10).max(360).optional(),
        explanation_level: z.enum(["beginner", "intermediate", "advanced"]).optional(),
        socratic_mode: bool01.optional(),
        active_project_id: id().nullable(),
        last_lesson_id: id().nullable(),
        last_section_id: id().nullable(),
        reminders_enabled: bool01,
        theme: z.enum(["dark", "light"]),
        created_at: iso,
        updated_at: iso,
      }),
    )
    .max(1),
  diagnostic_attempts: z
    .array(
      z.object({
        id: z.number().int(),
        self_ratings_json: jsonText,
        answers_json: jsonText,
        results_json: jsonText,
        summary_json: jsonText,
        created_at: iso,
      }),
    )
    .max(MAX_ROWS),
  lesson_progress: z
    .array(
      z.object({
        lesson_id: id(),
        status: shortStr(30),
        last_section_id: id().nullable(),
        understood_sections_json: jsonText,
        unclear_sections_json: jsonText,
        started_at: iso,
        updated_at: iso,
      }),
    )
    .max(MAX_ROWS),
  exercise_attempts: z
    .array(
      z.object({
        id: z.number().int(),
        exercise_id: id(),
        lesson_id: id().nullable(),
        passed: bool01,
        used_hint: bool01,
        revealed_solution: bool01,
        self_assessed: bool01,
        answer_json: jsonText,
        feedback: shortStr(5000),
        created_at: iso,
      }),
    )
    .max(MAX_ROWS),
  quiz_attempts: z
    .array(
      z.object({
        id: z.number().int(),
        lesson_id: id(),
        score: z.number().min(0).max(1),
        passed: bool01,
        details_json: jsonText,
        created_at: iso,
      }),
    )
    .max(MAX_ROWS),
  skill_mastery: z
    .array(
      z.object({
        skill_id: id(),
        status: z.enum(["not_started", "introduced", "practicing", "demonstrated", "needs_review"]),
        distinct_passed_json: jsonText,
        attempts_count: z.number().int().min(0),
        correct_count: z.number().int().min(0),
        fail_streak: z.number().int().min(0),
        review_interval_days: z.number().int().min(0),
        last_practiced_at: iso.nullable(),
        next_review_at: iso.nullable(),
      }),
    )
    .max(MAX_ROWS),
  project_progress: z
    .array(
      z.object({
        project_id: id(),
        milestone_id: id(),
        status: shortStr(30),
        checked_tasks_json: jsonText,
        notes: shortStr(5000),
        evidence: shortStr(5000),
        updated_at: iso,
      }),
    )
    .max(MAX_ROWS),
  notes: z
    .array(
      z.object({
        id: z.number().int(),
        lesson_id: id(),
        section_id: id(80).nullable(),
        tags: shortStr(200).optional(),
        content: z.string().min(1).max(5000),
        updated_at: iso,
      }),
    )
    .max(MAX_ROWS),
  bookmarks: z
    .array(
      z.object({
        id: z.number().int(),
        target_type: z.enum(["lesson", "exercise", "project"]),
        target_id: id(),
        section_id: id(80).nullable(),
        label: shortStr(200),
        created_at: iso,
      }),
    )
    .max(MAX_ROWS),
  study_sessions: z
    .array(
      z.object({
        id: z.number().int(),
        day_iso: shortStr(10),
        activity_type: shortStr(40),
        ref_id: shortStr(200),
        minutes: z.number().int().min(0).max(1000),
        created_at: iso,
      }),
    )
    .max(MAX_ROWS),
  mentor_conversations: z
    .array(
      z.object({
        id: z.number().int(),
        context_type: shortStr(40),
        context_id: shortStr(120),
        messages_json: jsonText,
        updated_at: iso,
      }),
    )
    .max(MAX_ROWS)
    .optional(),
  flashcards: z.array(z.record(z.string(), z.unknown())).max(MAX_ROWS).optional(),
  code_drafts: z.array(z.record(z.string(), z.unknown())).max(MAX_ROWS).optional(),
  code_snippets: z.array(z.record(z.string(), z.unknown())).max(MAX_ROWS).optional(),
  knowledge_resources: z.array(z.record(z.string(), z.unknown())).max(MAX_ROWS).optional(),
  project_files: z.array(z.record(z.string(), z.unknown())).max(MAX_ROWS).optional(),
  mistake_reflections: z.array(z.record(z.string(), z.unknown())).max(MAX_ROWS).optional(),
  study_tasks: z.array(z.record(z.string(), z.unknown())).max(MAX_ROWS).optional(),
});
export type ImportData = z.infer<typeof importSchema>;
