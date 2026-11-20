/**
 * Zod schemas for file-based learning content.
 *
 * All curriculum content (tracks, modules, lessons, exercises, quizzes, skills,
 * projects, diagnostic) lives in YAML files under `content/`. These schemas are
 * the single source of truth for what a valid content file looks like.
 * `npm run validate:content` and the test-suite use them to reject broken or
 * incomplete content before it reaches the UI.
 *
 * This module is imported by the server AND (type-only) by the frontend.
 */
import { z } from "zod";

const slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "must be a lowercase slug")
  .min(2)
  .max(80);
const optId = z.string().regex(/^[a-z0-9]+$/, "option ids must be [a-z0-9]+");
const range = z
  .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
  .refine(([a, b]) => a <= b, "range min must be <= max");

// ---------------------------------------------------------------------------
// Skills, tracks, modules
// ---------------------------------------------------------------------------

export const SkillSchema = z.strictObject({
  id: slug,
  name: z.string(),
  track: slug,
  description: z.string(),
});

export const ModuleSchema = z
  .strictObject({
    id: slug,
    title: z.string(),
    summary: z.string(),
    // "authored": lessons exist. "planned": roadmap entry only, lessons NOT written yet.
    status: z.enum(["authored", "planned"]),
    level: z.enum(["foundation", "core", "advanced", "specialization"]),
    optional: z.boolean().default(false),
    prerequisites: z.array(slug).default([]),
    outcomes: z.array(z.string()).min(1),
    effort_hours: range, // a range, never a guarantee
    practical_task: z.string(),
    mastery_criteria: z.array(z.string()).min(1),
    lessons: z.array(slug).default([]),
    planned_topics: z.array(z.string()).default([]),
  })
  .superRefine((m, ctx) => {
    if (m.status === "authored" && m.lessons.length === 0)
      ctx.addIssue({ code: "custom", message: `module ${m.id}: authored modules need lessons` });
    if (m.status === "planned" && m.lessons.length > 0)
      ctx.addIssue({ code: "custom", message: `module ${m.id}: planned modules must not list lessons` });
  });

export const TrackSchema = z.strictObject({
  id: slug,
  code: z.string(),
  title: z.string(),
  summary: z.string(),
  why: z.string(),
  optional: z.boolean().default(false),
  modules: z.array(ModuleSchema),
});

export const TracksFileSchema = z.strictObject({ tracks: z.array(TrackSchema) });
export const SkillsFileSchema = z.strictObject({ skills: z.array(SkillSchema) });

// ---------------------------------------------------------------------------
// Exercises / quiz questions
// ---------------------------------------------------------------------------

export const ExerciseCategory = z.enum([
  "python",
  "predict-output",
  "debug",
  "explain-code",
  "math",
  "ml-metric",
  "data",
  "llm-architecture",
  "production",
  "concept",
]);

const exerciseBase = {
  id: slug,
  title: z.string(),
  prompt: z.string(), // markdown
  skills: z.array(slug).min(1),
  category: ExerciseCategory,
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  hints: z.array(z.string()).default([]), // staged, revealed one by one
  explanation: z.string(), // WHY the correct answer is correct (shown after solve / reveal)
};

const OptionSchema = z.strictObject({
  id: optId,
  text: z.string(),
  feedback: z.string(), // why this option is right / wrong
});

const uniqueIds = (ids: string[]) => new Set(ids).size === ids.length;

export const MCQSchema = z
  .strictObject({
    ...exerciseBase,
    type: z.literal("mcq"),
    options: z.array(OptionSchema).min(2),
    answer: optId,
  })
  .superRefine((e, ctx) => {
    const ids = e.options.map((o) => o.id);
    if (!uniqueIds(ids)) ctx.addIssue({ code: "custom", message: `${e.id}: duplicate option ids` });
    if (!ids.includes(e.answer))
      ctx.addIssue({ code: "custom", message: `${e.id}: answer '${e.answer}' is not an option id` });
  });

export const MultiSchema = z
  .strictObject({
    ...exerciseBase,
    type: z.literal("multi"),
    options: z.array(OptionSchema).min(3),
    answers: z.array(optId).min(1),
  })
  .superRefine((e, ctx) => {
    const ids = e.options.map((o) => o.id);
    if (!uniqueIds(ids)) ctx.addIssue({ code: "custom", message: `${e.id}: duplicate option ids` });
    const missing = e.answers.filter((a) => !ids.includes(a));
    if (missing.length)
      ctx.addIssue({ code: "custom", message: `${e.id}: answers ${missing.join(",")} are not option ids` });
  });

export const NumericSchema = z.strictObject({
  ...exerciseBase,
  type: z.literal("numeric"),
  answer: z.number(),
  tolerance: z.number().nonnegative(),
  unit: z.string().optional(),
});

/** Short exact answer, e.g. "predict the output". Compared after normalisation. */
export const TextSchema = z.strictObject({
  ...exerciseBase,
  type: z.literal("text"),
  accepted: z.array(z.string()).min(1),
  case_sensitive: z.boolean().default(false),
  normalize_whitespace: z.boolean().default(true),
});

export const OrderSchema = z
  .strictObject({
    ...exerciseBase,
    type: z.literal("order"),
    items: z.array(z.strictObject({ id: optId, text: z.string() })).min(3),
    answer: z.array(optId),
  })
  .superRefine((e, ctx) => {
    const ids = e.items.map((i) => i.id);
    const ok =
      uniqueIds(ids) &&
      ids.length === e.answer.length &&
      [...ids].sort().join("|") === [...e.answer].sort().join("|");
    if (!ok) ctx.addIssue({ code: "custom", message: `${e.id}: answer must be a permutation of item ids` });
  });

/** Runs in the learner's browser via Pyodide. Pure-Python standard library only. */
export const CodeSchema = z.strictObject({
  ...exerciseBase,
  type: z.literal("code"),
  starter_code: z.string(),
  tests: z.array(z.strictObject({ name: z.string(), code: z.string() })).min(2),
  solution: z.string(), // must pass all tests (verified by validate:content)
});

/** Free-text explanation. Not auto-graded: self-check against rubric, or AI review if configured. */
export const ExplainSchema = z.strictObject({
  ...exerciseBase,
  type: z.literal("explain"),
  rubric: z.array(z.string()).min(2),
  model_answer: z.string(),
});

export const ExerciseSchema = z.discriminatedUnion("type", [
  MCQSchema,
  MultiSchema,
  NumericSchema,
  TextSchema,
  OrderSchema,
  CodeSchema,
  ExplainSchema,
]);

export const QuizQuestionSchema = z.discriminatedUnion("type", [
  MCQSchema,
  MultiSchema,
  NumericSchema,
  TextSchema,
  OrderSchema,
]);

export const QuizSchema = z.strictObject({
  pass_threshold: z.number().gt(0).lte(1).default(0.7),
  questions: z.array(QuizQuestionSchema).min(3),
});

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

export const SectionKind = z.enum([
  "explanation",
  "analogy",
  "diagram",
  "worked_example",
  "code",
  "mistakes",
  "tradeoffs",
  "deep_dive",
]);

export const REQUIRED_SECTION_KINDS = [
  "explanation",
  "analogy",
  "worked_example",
  "code",
  "mistakes",
  "tradeoffs",
] as const;

export const SectionSchema = z.strictObject({
  id: slug,
  kind: SectionKind,
  title: z.string(),
  body: z.string(), // markdown; supports $math$, ```mermaid``` and fenced code
});

export const ReferenceSchema = z.strictObject({
  title: z.string(),
  url: z.string().startsWith("https://", "reference urls must be https"),
  note: z.string().optional(),
});

export const LessonSchema = z
  .strictObject({
    id: slug,
    track: slug,
    module: slug,
    title: z.string(),
    summary: z.string(),
    level: z.enum(["foundation", "core", "advanced"]),
    estimated_minutes: range,
    prerequisites: z.array(slug).default([]), // lesson ids
    next: slug.nullable().optional(), // lesson id
    skills: z.array(slug).min(1),
    objectives: z.array(z.string()).min(2),
    why_it_matters: z.string(),
    terms: z.array(z.strictObject({ term: z.string(), definition: z.string() })).min(3),
    sections: z.array(SectionSchema).min(6),
    mastery_criteria: z.array(z.string()).min(2),
    quiz: QuizSchema,
    exercises: z.array(ExerciseSchema).min(2),
    references: z.array(ReferenceSchema).default([]),
  })
  .superRefine((l, ctx) => {
    const kinds = new Set(l.sections.map((s) => s.kind));
    const missing = REQUIRED_SECTION_KINDS.filter((k) => !kinds.has(k));
    if (missing.length)
      ctx.addIssue({ code: "custom", message: `lesson ${l.id}: missing required section kinds ${missing.join(", ")}` });
    if (!uniqueIds(l.sections.map((s) => s.id)))
      ctx.addIssue({ code: "custom", message: `lesson ${l.id}: duplicate section ids` });
  });

/** Extra exercises that are not attached to a lesson (Practice Lab only). */
export const PracticeFileSchema = z.strictObject({
  topic: slug,
  title: z.string(),
  exercises: z.array(ExerciseSchema).min(1),
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const MilestoneTemplateSchema = z.strictObject({
  id: slug,
  title: z.string(),
  goal: z.string(),
  tasks: z.array(z.string()).min(2),
  evidence_required: z.string(), // what counts as proof this milestone is done
  skills: z.array(slug).default([]),
});

export const ProjectTemplateSchema = z.strictObject({
  id: slug,
  title: z.string(),
  summary: z.string(),
  optional: z.boolean().default(false),
  level: z.enum(["foundation", "core", "advanced"]),
  estimated_hours: range,
  recommended_lessons: z.array(slug).default([]),
  problem_statement: z.string(),
  intended_user: z.string(),
  requirements: z.array(z.string()).min(3),
  non_goals: z.array(z.string()).min(2),
  architecture: z.string(), // markdown, may include mermaid
  milestones: z.array(MilestoneTemplateSchema).min(3),
  test_plan: z.array(z.string()).min(3),
  failure_cases: z.array(z.string()).min(3),
  privacy_security: z.array(z.string()).min(2),
  definition_of_done: z.array(z.string()).min(3),
  readme_outline: z.array(z.string()).min(4),
  stretch_goals: z.array(z.string()).default([]),
});

// ---------------------------------------------------------------------------
// Diagnostic
// ---------------------------------------------------------------------------

export const DiagnosticFileSchema = z.strictObject({
  areas: z
    .array(
      z.strictObject({
        id: slug,
        title: z.string(),
        description: z.string(),
        self_rating_prompt: z.string(),
        related_modules: z.array(slug).min(1),
      }),
    )
    .min(1),
  goals: z
    .array(z.strictObject({ id: slug, label: z.string(), focus_modules: z.array(slug).min(1) }))
    .min(1),
  checks: z
    .array(
      z.strictObject({
        area: slug,
        question: z.discriminatedUnion("type", [MCQSchema, NumericSchema, TextSchema]),
      }),
    )
    .min(7),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type Skill = z.infer<typeof SkillSchema>;
export type Module = z.infer<typeof ModuleSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Exercise = z.infer<typeof ExerciseSchema>;
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;
export type CodeExercise = z.infer<typeof CodeSchema>;
export type Lesson = z.infer<typeof LessonSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type PracticeFile = z.infer<typeof PracticeFileSchema>;
export type ProjectTemplate = z.infer<typeof ProjectTemplateSchema>;
export type DiagnosticFile = z.infer<typeof DiagnosticFileSchema>;
