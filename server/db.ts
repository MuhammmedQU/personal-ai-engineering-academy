/**
 * Local-first SQLite database layer powered by Node 24's built-in `node:sqlite`.
 *
 * Stores all learner state: profile, diagnostic attempts, lesson progress,
 * exercise attempts, quiz attempts, skill mastery + spaced review schedule,
 * project milestone evidence, attached project files & AI code reviews,
 * notes, bookmarks, flashcards (SM-2 spaced repetition), code drafts/scratchpads,
 * reusable code snippets, knowledge resources (PDFs/papers/glossary),
 * mistake reflections, study planner tasks, mentor conversations, and
 * daily study activity.
 *
 * Non-destructive migrations: existing tables and rows are always preserved.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { REPO_ROOT } from "./content/loader.ts";

export type MasteryStatus =
  | "not_started"
  | "introduced"
  | "practicing"
  | "demonstrated"
  | "needs_review";

export type ExplanationLevel = "beginner" | "intermediate" | "advanced";

export interface UserProfileRow {
  id: number;
  name: string;
  onboarded: number;
  goal_id: string;
  weekly_hours: number;
  daily_goal_minutes: number;
  explanation_level: ExplanationLevel;
  socratic_mode: number;
  active_project_id: string | null;
  last_lesson_id: string | null;
  last_section_id: string | null;
  reminders_enabled: number;
  theme: "dark" | "light";
  created_at: string;
  updated_at: string;
}

export interface SkillMasteryRow {
  skill_id: string;
  status: MasteryStatus;
  distinct_passed_json: string; // JSON string[] of exercise IDs solved unaided
  attempts_count: number;
  correct_count: number;
  fail_streak: number;
  review_interval_days: number;
  last_practiced_at: string | null;
  next_review_at: string | null;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'Learner',
  onboarded INTEGER NOT NULL DEFAULT 0,
  goal_id TEXT NOT NULL DEFAULT 'broad-ai-engineering',
  weekly_hours INTEGER NOT NULL DEFAULT 8,
  daily_goal_minutes INTEGER NOT NULL DEFAULT 30,
  explanation_level TEXT NOT NULL DEFAULT 'intermediate',
  socratic_mode INTEGER NOT NULL DEFAULT 1,
  active_project_id TEXT,
  last_lesson_id TEXT,
  last_section_id TEXT,
  reminders_enabled INTEGER NOT NULL DEFAULT 1,
  theme TEXT NOT NULL DEFAULT 'dark',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diagnostic_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  self_ratings_json TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  results_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lesson_progress (
  lesson_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'in_progress',
  last_section_id TEXT,
  understood_sections_json TEXT NOT NULL DEFAULT '[]',
  unclear_sections_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exercise_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exercise_id TEXT NOT NULL,
  lesson_id TEXT,
  passed INTEGER NOT NULL,
  used_hint INTEGER NOT NULL DEFAULT 0,
  revealed_solution INTEGER NOT NULL DEFAULT 0,
  self_assessed INTEGER NOT NULL DEFAULT 0,
  answer_json TEXT NOT NULL,
  feedback TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exercise_attempts_ex ON exercise_attempts(exercise_id);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id TEXT NOT NULL,
  score REAL NOT NULL,
  passed INTEGER NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_lesson ON quiz_attempts(lesson_id);

CREATE TABLE IF NOT EXISTS skill_mastery (
  skill_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'not_started',
  distinct_passed_json TEXT NOT NULL DEFAULT '[]',
  attempts_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  fail_streak INTEGER NOT NULL DEFAULT 0,
  review_interval_days INTEGER NOT NULL DEFAULT 0,
  last_practiced_at TEXT,
  next_review_at TEXT
);

CREATE TABLE IF NOT EXISTS project_progress (
  project_id TEXT NOT NULL,
  milestone_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started',
  checked_tasks_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, milestone_id)
);

CREATE TABLE IF NOT EXISTS project_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'python',
  content TEXT NOT NULL,
  ai_review TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_files_proj ON project_files(project_id);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id TEXT NOT NULL,
  section_id TEXT,
  tags TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_lesson ON notes(lesson_id);

CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  section_id TEXT,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(target_type, target_id, section_id)
);

CREATE TABLE IF NOT EXISTS flashcards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_key TEXT UNIQUE,
  lesson_id TEXT,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  interval_days INTEGER NOT NULL DEFAULT 0,
  ease_factor REAL NOT NULL DEFAULT 2.5,
  repetitions INTEGER NOT NULL DEFAULT 0,
  last_reviewed_at TEXT,
  next_review_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS code_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_key TEXT UNIQUE,
  exercise_id TEXT,
  title TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'python',
  code TEXT NOT NULL,
  stdin TEXT NOT NULL DEFAULT '',
  last_output TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS code_snippets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'python',
  tags TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'article',
  title TEXT NOT NULL,
  url_or_path TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mistake_reflections (
  exercise_id TEXT PRIMARY KEY,
  takeaway TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'lesson',
  target_id TEXT,
  estimated_minutes INTEGER NOT NULL DEFAULT 25,
  due_date TEXT,
  priority INTEGER NOT NULL DEFAULT 2,
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mentor_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  context_type TEXT NOT NULL,
  context_id TEXT NOT NULL,
  messages_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  UNIQUE(context_type, context_id)
);

CREATE TABLE IF NOT EXISTS study_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_iso TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_study_sessions_day ON study_sessions(day_iso);
`;

function runSafeColumnMigrations(db: DatabaseSync): void {
  const ensureColumn = (table: string, col: string, defSql: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${defSql};`);
    }
  };

  ensureColumn("user_profile", "daily_goal_minutes", "INTEGER NOT NULL DEFAULT 30");
  ensureColumn("user_profile", "explanation_level", "TEXT NOT NULL DEFAULT 'intermediate'");
  ensureColumn("user_profile", "socratic_mode", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("notes", "tags", "TEXT NOT NULL DEFAULT ''");
}

let dbInstance: DatabaseSync | null = null;
let currentDbPath: string | null = null;

export function getDb(customPath?: string): DatabaseSync {
  if (!customPath && dbInstance) {
    return dbInstance;
  }
  const targetPath =
    customPath ??
    process.env.DB_PATH ??
    path.join(REPO_ROOT, "data", "academy.sqlite");

  if (dbInstance && currentDbPath === targetPath) {
    return dbInstance;
  }

  if (targetPath !== ":memory:") {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }

  const db = new DatabaseSync(targetPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA_SQL);
  runSafeColumnMigrations(db);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO user_profile
     (id, name, onboarded, goal_id, weekly_hours, daily_goal_minutes, explanation_level, socratic_mode, reminders_enabled, theme, created_at, updated_at)
     VALUES (1, 'Learner', 0, 'broad-ai-engineering', 8, 30, 'intermediate', 1, 1, 'dark', ?, ?)`,
  ).run(now, now);

  dbInstance = db;
  currentDbPath = targetPath;
  return db;
}

export function getCurrentDbPath(): string | null {
  return currentDbPath;
}

export function checkDbIntegrity(db = getDb()): { ok: boolean; detail: string } {
  try {
    const row = db.prepare("PRAGMA quick_check;").get() as { quick_check?: string } | undefined;
    const status = row?.quick_check ?? "unknown";
    return { ok: status === "ok", detail: status };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

export function resetDbForTests(dbPath = ":memory:"): DatabaseSync {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore
    }
  }
  dbInstance = null;
  currentDbPath = null;
  return getDb(dbPath);
}

export function getProfile(db = getDb()): UserProfileRow {
  return db.prepare("SELECT * FROM user_profile WHERE id = 1").get() as unknown as UserProfileRow;
}

export function recordStudyActivity(
  activityType: string,
  refId: string,
  minutes = 5,
  db = getDb(),
): void {
  const now = new Date();
  const dayIso = now.toISOString().slice(0, 10);
  db.prepare(
    `INSERT INTO study_sessions (day_iso, activity_type, ref_id, minutes, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(dayIso, activityType, refId, minutes, now.toISOString());
}
