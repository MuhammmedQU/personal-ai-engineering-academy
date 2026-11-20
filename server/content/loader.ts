/**
 * Loads and cross-validates all YAML content under `content/` into an
 * in-memory `ContentStore`.
 *
 * Structural validation is handled by the Zod schemas in `./schema.ts`.
 * Referential integrity (do prerequisites exist? are skill IDs defined?
 * are exercise IDs globally unique? does lesson file name match lesson ID?)
 * is enforced here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { ZodError } from "zod";
import {
  DiagnosticFileSchema,
  LessonSchema,
  PracticeFileSchema,
  ProjectTemplateSchema,
  SkillsFileSchema,
  TracksFileSchema,
  type DiagnosticFile,
  type Exercise,
  type Lesson,
  type Module,
  type PracticeFile,
  type ProjectTemplate,
  type QuizQuestion,
  type Skill,
  type Track,
} from "./schema.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../..");
export const DEFAULT_CONTENT_DIR = path.join(REPO_ROOT, "content");

export class ContentError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super("Content validation failed:\n  - " + errors.join("\n  - "));
    this.errors = errors;
  }
}

export interface ExerciseRef {
  exercise: Exercise | QuizQuestion;
  kind: "lesson" | "quiz" | "practice" | "diagnostic";
  lessonId?: string;
  topic?: string;
}

export class ContentStore {
  tracks: Track[] = [];
  skills: Map<string, Skill> = new Map();
  modules: Map<string, Module> = new Map();
  moduleTrack: Map<string, string> = new Map();
  lessons: Map<string, Lesson> = new Map();
  exercises: Map<string, ExerciseRef> = new Map();
  practice: PracticeFile[] = [];
  projects: Map<string, ProjectTemplate> = new Map();
  diagnostic: DiagnosticFile | null = null;

  /** Canonical lesson order: track order -> module order -> lesson order. */
  lessonOrder(): string[] {
    const out: string[] = [];
    for (const t of this.tracks) {
      for (const m of t.modules) {
        out.push(...m.lessons);
      }
    }
    return out;
  }

  /** Return all exercise IDs tagged with `skillId`. */
  exercisesForSkill(skillId: string, includeQuiz = false): string[] {
    const out: string[] = [];
    for (const [id, ref] of this.exercises.entries()) {
      if (ref.kind === "diagnostic") continue;
      if (ref.kind === "quiz" && !includeQuiz) continue;
      if (ref.exercise.skills.includes(skillId)) out.push(id);
    }
    return out;
  }

  /** All non-diagnostic, non-quiz exercises available in Practice Lab. */
  practiceExercises(): Array<ExerciseRef & { id: string }> {
    const out: Array<ExerciseRef & { id: string }> = [];
    for (const [id, ref] of this.exercises.entries()) {
      if (ref.kind === "lesson" || ref.kind === "practice") {
        out.push({ id, ...ref });
      }
    }
    return out;
  }
}

function readYaml(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf-8");
  return YAML.parse(raw);
}

function walkYamlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkYamlFiles(full));
    } else if (entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) {
      results.push(full);
    }
  }
  return results.sort();
}

function formatZodError(fileName: string, err: ZodError): string[] {
  return err.issues.map((issue) => {
    const loc = issue.path.map(String).join(".");
    return `${fileName}: ${loc ? loc + ": " : ""}${issue.message}`;
  });
}

const PARTIAL_IGNORED = [
  "has no content file",
  "unknown prerequisite lesson",
  "unknown next lesson",
  "unknown recommended lesson",
];

export interface LoadContentOptions {
  contentDir?: string;
  partial?: boolean;
}

export function loadContent(opts: LoadContentOptions = {}): ContentStore {
  const contentDir = opts.contentDir ?? process.env.CONTENT_DIR ?? DEFAULT_CONTENT_DIR;
  const partial = opts.partial ?? false;
  const errors: string[] = [];
  const store = new ContentStore();

  // ---- 1. skills.yaml ----
  const skillsPath = path.join(contentDir, "skills.yaml");
  if (!fs.existsSync(skillsPath)) {
    errors.push("skills.yaml missing");
  } else {
    try {
      const parsed = SkillsFileSchema.parse(readYaml(skillsPath));
      for (const s of parsed.skills) {
        if (store.skills.has(s.id)) {
          errors.push(`skills.yaml: duplicate skill id '${s.id}'`);
        }
        store.skills.set(s.id, s);
      }
    } catch (e) {
      if (e instanceof ZodError) errors.push(...formatZodError("skills.yaml", e));
      else errors.push(`skills.yaml: ${(e as Error).message}`);
    }
  }

  // ---- 2. tracks.yaml ----
  const tracksPath = path.join(contentDir, "tracks.yaml");
  if (!fs.existsSync(tracksPath)) {
    errors.push("tracks.yaml missing");
  } else {
    try {
      const parsed = TracksFileSchema.parse(readYaml(tracksPath));
      store.tracks = parsed.tracks;
      for (const t of store.tracks) {
        for (const m of t.modules) {
          if (store.modules.has(m.id)) {
            errors.push(`tracks.yaml: duplicate module id '${m.id}'`);
          }
          store.modules.set(m.id, m);
          store.moduleTrack.set(m.id, t.id);
        }
      }
    } catch (e) {
      if (e instanceof ZodError) errors.push(...formatZodError("tracks.yaml", e));
      else errors.push(`tracks.yaml: ${(e as Error).message}`);
    }
  }

  const trackIds = new Set(store.tracks.map((t) => t.id));

  const addExercises = (
    items: Array<Exercise | QuizQuestion>,
    kind: ExerciseRef["kind"],
    where: string,
    extra: { lessonId?: string; topic?: string } = {},
  ) => {
    for (const ex of items) {
      if (store.exercises.has(ex.id)) {
        errors.push(`${where}: duplicate exercise/question id '${ex.id}'`);
        continue;
      }
      store.exercises.set(ex.id, { exercise: ex, kind, ...extra });
      for (const sk of ex.skills) {
        if (!store.skills.has(sk)) {
          errors.push(`${where}: exercise '${ex.id}' references unknown skill '${sk}'`);
        }
      }
    }
  };

  // ---- 3. lessons ----
  for (const file of walkYamlFiles(path.join(contentDir, "lessons"))) {
    const base = path.basename(file);
    try {
      const lesson = LessonSchema.parse(readYaml(file));
      if (store.lessons.has(lesson.id)) {
        errors.push(`${base}: duplicate lesson id '${lesson.id}'`);
        continue;
      }
      const stem = base.replace(/\.ya?ml$/, "");
      if (stem !== lesson.id) {
        errors.push(`${base}: file name must equal lesson id '${lesson.id}'`);
      }
      store.lessons.set(lesson.id, lesson);
      addExercises(lesson.exercises, "lesson", base, { lessonId: lesson.id });
      addExercises(lesson.quiz.questions, "quiz", base, { lessonId: lesson.id });
    } catch (e) {
      if (e instanceof ZodError) errors.push(...formatZodError(base, e));
      else errors.push(`${base}: ${(e as Error).message}`);
    }
  }

  // ---- 4. practice ----
  for (const file of walkYamlFiles(path.join(contentDir, "practice"))) {
    const base = path.basename(file);
    try {
      const pf = PracticeFileSchema.parse(readYaml(file));
      store.practice.push(pf);
      addExercises(pf.exercises, "practice", base, { topic: pf.topic });
    } catch (e) {
      if (e instanceof ZodError) errors.push(...formatZodError(base, e));
      else errors.push(`${base}: ${(e as Error).message}`);
    }
  }

  // ---- 5. projects ----
  for (const file of walkYamlFiles(path.join(contentDir, "projects"))) {
    const base = path.basename(file);
    try {
      const proj = ProjectTemplateSchema.parse(readYaml(file));
      if (store.projects.has(proj.id)) {
        errors.push(`${base}: duplicate project id '${proj.id}'`);
      }
      store.projects.set(proj.id, proj);
    } catch (e) {
      if (e instanceof ZodError) errors.push(...formatZodError(base, e));
      else errors.push(`${base}: ${(e as Error).message}`);
    }
  }

  // ---- 6. diagnostic.yaml ----
  const diagPath = path.join(contentDir, "diagnostic.yaml");
  if (!fs.existsSync(diagPath)) {
    errors.push("diagnostic.yaml missing");
  } else {
    try {
      const diag = DiagnosticFileSchema.parse(readYaml(diagPath));
      store.diagnostic = diag;
      for (const chk of diag.checks) {
        const q = chk.question;
        if (store.exercises.has(q.id)) {
          errors.push(`diagnostic.yaml: duplicate id '${q.id}'`);
        }
        store.exercises.set(q.id, { exercise: q, kind: "diagnostic" });
        for (const sk of q.skills) {
          if (!store.skills.has(sk)) {
            errors.push(`diagnostic.yaml: check '${q.id}' references unknown skill '${sk}'`);
          }
        }
      }
    } catch (e) {
      if (e instanceof ZodError) errors.push(...formatZodError("diagnostic.yaml", e));
      else errors.push(`diagnostic.yaml: ${(e as Error).message}`);
    }
  }

  // ---- 7. Referential checks ----
  for (const s of store.skills.values()) {
    if (!trackIds.has(s.track)) {
      errors.push(`skill ${s.id}: unknown track '${s.track}'`);
    }
  }

  for (const [mId, m] of store.modules.entries()) {
    for (const pre of m.prerequisites) {
      if (!store.modules.has(pre)) {
        errors.push(`module ${mId}: unknown prerequisite module '${pre}'`);
      }
    }
    for (const lId of m.lessons) {
      if (!store.lessons.has(lId)) {
        errors.push(`module ${mId}: lesson '${lId}' has no content file`);
      }
    }
  }

  for (const [lId, lesson] of store.lessons.entries()) {
    if (!trackIds.has(lesson.track)) {
      errors.push(`lesson ${lId}: unknown track '${lesson.track}'`);
    }
    const mod = store.modules.get(lesson.module);
    if (!mod) {
      errors.push(`lesson ${lId}: unknown module '${lesson.module}'`);
    } else {
      if (!mod.lessons.includes(lId)) {
        errors.push(`lesson ${lId}: not listed in module '${lesson.module}'`);
      }
      if (store.moduleTrack.get(lesson.module) !== lesson.track) {
        errors.push(`lesson ${lId}: module '${lesson.module}' is not in track '${lesson.track}'`);
      }
    }
    for (const pre of lesson.prerequisites) {
      if (!store.lessons.has(pre)) {
        errors.push(`lesson ${lId}: unknown prerequisite lesson '${pre}'`);
      }
    }
    if (lesson.next && !store.lessons.has(lesson.next)) {
      errors.push(`lesson ${lId}: unknown next lesson '${lesson.next}'`);
    }
    for (const sk of lesson.skills) {
      if (!store.skills.has(sk)) {
        errors.push(`lesson ${lId}: unknown skill '${sk}'`);
      }
    }
  }

  for (const [pId, p] of store.projects.entries()) {
    for (const lId of p.recommended_lessons) {
      if (!store.lessons.has(lId)) {
        errors.push(`project ${pId}: unknown recommended lesson '${lId}'`);
      }
    }
    for (const ms of p.milestones) {
      for (const sk of ms.skills) {
        if (!store.skills.has(sk)) {
          errors.push(`project ${pId}/${ms.id}: unknown skill '${sk}'`);
        }
      }
    }
  }

  if (store.diagnostic) {
    const areaIds = new Set(store.diagnostic.areas.map((a) => a.id));
    for (const a of store.diagnostic.areas) {
      for (const m of a.related_modules) {
        if (!store.modules.has(m)) {
          errors.push(`diagnostic area ${a.id}: unknown module '${m}'`);
        }
      }
    }
    for (const g of store.diagnostic.goals) {
      for (const m of g.focus_modules) {
        if (!store.modules.has(m)) {
          errors.push(`diagnostic goal ${g.id}: unknown module '${m}'`);
        }
      }
    }
    for (const chk of store.diagnostic.checks) {
      if (!areaIds.has(chk.area)) {
        errors.push(`diagnostic check ${chk.question.id}: unknown area '${chk.area}'`);
      }
    }
  }

  const finalErrors = partial
    ? errors.filter((e) => !PARTIAL_IGNORED.some((substr) => e.includes(substr)))
    : errors;

  if (finalErrors.length > 0) {
    throw new ContentError(finalErrors);
  }
  return store;
}

let cachedStore: ContentStore | null = null;

export function getStore(): ContentStore {
  if (!cachedStore) {
    cachedStore = loadContent();
  }
  return cachedStore;
}

export function reloadStore(): ContentStore {
  cachedStore = loadContent();
  return cachedStore;
}
