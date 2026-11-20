/**
 * Personal University modular API routes:
 * - Secure local AI provider configuration (write-only key store)
 * - Coding Lab saved drafts & safe in-memory SQLite SQL sandbox
 * - Project attached files + Senior Engineer AI code review
 * - SM-2 Spaced Repetition Flashcards (auto-seeded from started lessons + custom)
 * - Mistake Notebook & learner takeaway reflections
 * - Knowledge Management (code snippets, PDF/paper/glossary resources, global search)
 * - Study Planner (streaks, daily goal, 30-day calendar, smart next-best-task recommendations)
 */
import type { Hono } from "hono";
import type { ContentStore } from "./content/loader.ts";
import { getDb, getProfile, recordStudyActivity } from "./db.ts";
import { getSkillMasteryMap } from "./engine.ts";
import { checkMentorRateLimit, tutorProvider } from "./mentor.ts";
import { hasForbiddenSql, runSandboxedSql } from "./sqlSandbox.ts";
import { ApiError, readBody, schemas } from "./validation.ts";

export function computeLearningStreak(db = getDb()): {
  streakDays: number;
  todayMinutes: number;
  last30Days: Array<{ dayIso: string; minutes: number; actionsCount: number }>;
} {
  const rows = db
    .prepare(
      `SELECT day_iso, COALESCE(SUM(minutes), 0) AS mins, COUNT(*) AS cnt
       FROM study_sessions
       GROUP BY day_iso
       ORDER BY day_iso DESC`,
    )
    .all() as Array<{ day_iso: string; mins: number; cnt: number }>;

  const byDay = new Map(
    rows.map((r) => [r.day_iso, { minutes: Number(r.mins), actionsCount: Number(r.cnt) }]),
  );

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const todayMinutes = byDay.get(todayIso)?.minutes ?? 0;

  // Compute consecutive active days ending today or yesterday
  let streakDays = 0;
  const cursor = new Date(today);
  if (!byDay.has(todayIso)) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  while (true) {
    const iso = cursor.toISOString().slice(0, 10);
    if ((byDay.get(iso)?.minutes ?? 0) > 0) {
      streakDays++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    } else {
      break;
    }
  }

  const last30Days: Array<{ dayIso: string; minutes: number; actionsCount: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const stats = byDay.get(iso);
    last30Days.push({
      dayIso: iso,
      minutes: stats?.minutes ?? 0,
      actionsCount: stats?.actionsCount ?? 0,
    });
  }

  return { streakDays, todayMinutes, last30Days };
}

/** Auto-seeds glossary flashcards for any lesson the learner has started (never duplicates). */
export function syncLessonFlashcards(store: ContentStore, db = getDb()): void {
  const started = db
    .prepare("SELECT lesson_id FROM lesson_progress")
    .all() as Array<{ lesson_id: string }>;
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO flashcards
     (card_key, lesson_id, front, back, tags, interval_days, ease_factor, repetitions, next_review_at, created_at)
     VALUES (?, ?, ?, ?, ?, 0, 2.5, 0, ?, ?)`,
  );
  for (const row of started) {
    const lesson = store.lessons.get(row.lesson_id);
    if (!lesson) continue;
    for (const term of lesson.terms) {
      const key = `lesson:${lesson.id}:${term.term.toLowerCase()}`;
      stmt.run(key, lesson.id, term.term, term.definition, lesson.track, now, now);
    }
  }
}

export function registerPersonalRoutes(app: Hono, store: () => ContentStore): void {
  // -------------------------------------------------------------------------
  // 1. Secure Local AI Provider Configuration (write-only API key)
  // -------------------------------------------------------------------------
  app.get("/api/mentor/config", (c) => {
    return c.json(tutorProvider.getSafeConfig());
  });

  app.put("/api/mentor/config", async (c) => {
    const body = await readBody(c, schemas.mentorConfig);
    const safe = tutorProvider.saveConfig(body);
    return c.json(safe);
  });

  // -------------------------------------------------------------------------
  // 2. Coding Lab: Saved Code Drafts & Safe In-Memory SQLite SQL Sandbox
  // -------------------------------------------------------------------------
  app.get("/api/lab/drafts", (c) => {
    const rows = getDb()
      .prepare("SELECT * FROM code_drafts ORDER BY updated_at DESC")
      .all();
    return c.json({ drafts: rows });
  });

  app.post("/api/lab/drafts", async (c) => {
    const body = await readBody(c, schemas.codeDraft);
    const db = getDb();
    const now = new Date().toISOString();
    const draftKey =
      body.draftKey ||
      (body.exerciseId ? `ex:${body.exerciseId}` : `scratch:${body.title.toLowerCase()}`);

    db.prepare(
      `INSERT INTO code_drafts (draft_key, exercise_id, title, language, code, stdin, last_output, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(draft_key) DO UPDATE SET
         title = excluded.title,
         language = excluded.language,
         code = excluded.code,
         stdin = excluded.stdin,
         last_output = excluded.last_output,
         updated_at = excluded.updated_at`,
    ).run(
      draftKey,
      body.exerciseId ?? null,
      body.title,
      body.language,
      body.code,
      body.stdin,
      body.lastOutput,
      now,
    );

    const saved = db
      .prepare("SELECT * FROM code_drafts WHERE draft_key = ?")
      .get(draftKey);
    return c.json({ draft: saved });
  });

  app.delete("/api/lab/drafts/:id", (c) => {
    const id = Number(c.req.param("id"));
    getDb().prepare("DELETE FROM code_drafts WHERE id = ?").run(id);
    return c.json({ ok: true });
  });

  app.post("/api/lab/sql", async (c) => {
    const body = await readBody(c, schemas.sqlSandbox);
    // Strict safety: never allow ATTACH/DETACH/LOAD_EXTENSION or unsafe PRAGMAs
    if (hasForbiddenSql(body.setupSql, body.querySql)) {
      throw new ApiError(400, "Sandboxed SQL: ATTACH/DETACH/LOAD_EXTENSION qadağandır.");
    }
    const result = await runSandboxedSql(body.setupSql, body.querySql);
    return c.json(result, 200);
  });

  // -------------------------------------------------------------------------
  // 3. Project Laboratory: Attached Learner Files & AI Code Reviews
  // -------------------------------------------------------------------------
  app.get("/api/projects/:id/files", (c) => {
    const projectId = c.req.param("id");
    if (!store().projects.has(projectId)) {
      throw new ApiError(404, "Project not found");
    }
    const files = getDb()
      .prepare("SELECT * FROM project_files WHERE project_id = ? ORDER BY updated_at DESC")
      .all(projectId);
    return c.json({ files });
  });

  app.post("/api/projects/:id/files", async (c) => {
    const projectId = c.req.param("id");
    if (!store().projects.has(projectId)) {
      throw new ApiError(404, "Project not found");
    }
    const body = await readBody(c, schemas.projectFile);
    const db = getDb();
    const now = new Date().toISOString();

    if (body.id) {
      db.prepare(
        "UPDATE project_files SET filename = ?, language = ?, content = ?, updated_at = ? WHERE id = ? AND project_id = ?",
      ).run(body.filename, body.language, body.content, now, body.id, projectId);
      const updated = db.prepare("SELECT * FROM project_files WHERE id = ?").get(body.id);
      return c.json({ file: updated });
    }

    const res = db
      .prepare(
        `INSERT INTO project_files (project_id, filename, language, content, ai_review, updated_at)
         VALUES (?, ?, ?, ?, '', ?)`,
      )
      .run(projectId, body.filename, body.language, body.content, now);
    const inserted = db
      .prepare("SELECT * FROM project_files WHERE id = ?")
      .get(Number(res.lastInsertRowid));
    recordStudyActivity("project_file", `${projectId}:${body.filename}`, 10, db);
    return c.json({ file: inserted });
  });

  app.delete("/api/projects/:id/files/:fileId", (c) => {
    const projectId = c.req.param("id");
    const fileId = Number(c.req.param("fileId"));
    getDb()
      .prepare("DELETE FROM project_files WHERE id = ? AND project_id = ?")
      .run(fileId, projectId);
    return c.json({ ok: true });
  });

  app.post("/api/projects/:id/files/:fileId/review", async (c) => {
    if (!checkMentorRateLimit()) {
      throw new ApiError(429, "Sorğu limiti aşılıb. Bir neçə saniyə gözləyin.");
    }
    const projectId = c.req.param("id");
    const fileId = Number(c.req.param("fileId"));
    const db = getDb();
    const file = db
      .prepare("SELECT * FROM project_files WHERE id = ? AND project_id = ?")
      .get(fileId, projectId) as
      | { id: number; filename: string; content: string; language: string }
      | undefined;
    if (!file) throw new ApiError(404, "Attached project file not found");

    const review = await tutorProvider.reviewProjectFile(store(), {
      action: "review-project-file",
      message: `Layihə faylı "${file.filename}" üçün ciddi Senior AI Engineer icmalı (code review) yaz: nə edir, kritik xətalar, edge case-lər, təhlükəsizlik və ilk etməli olduğum ən kiçik təhlükəsiz düzəliş.`,
      context: {
        projectId,
        filename: file.filename,
        codeSnippet: file.content,
      },
    });

    const now = new Date().toISOString();
    db.prepare("UPDATE project_files SET ai_review = ?, updated_at = ? WHERE id = ?").run(
      review.reply,
      now,
      file.id,
    );
    recordStudyActivity("project_review", `${projectId}:${file.filename}`, 5, db);

    return c.json({ review, fileId: file.id, updatedAt: now });
  });

  // -------------------------------------------------------------------------
  // 4. Flashcards & SM-2 Spaced Repetition
  // -------------------------------------------------------------------------
  app.get("/api/flashcards", (c) => {
    const s = store();
    const db = getDb();
    syncLessonFlashcards(s, db);
    const nowIso = new Date().toISOString();
    const cards = db
      .prepare("SELECT * FROM flashcards ORDER BY COALESCE(next_review_at, created_at) ASC")
      .all() as Array<Record<string, unknown>>;
    const dueCount = cards.filter(
      (card) => !card.next_review_at || String(card.next_review_at) <= nowIso,
    ).length;
    return c.json({ cards, dueCount });
  });

  app.post("/api/flashcards", async (c) => {
    const body = await readBody(c, schemas.flashcardCreate);
    const db = getDb();
    const now = new Date().toISOString();
    const key = `custom:${now}:${Math.random().toString(36).slice(2, 8)}`;
    const res = db
      .prepare(
        `INSERT INTO flashcards
         (card_key, lesson_id, front, back, tags, interval_days, ease_factor, repetitions, next_review_at, created_at)
         VALUES (?, ?, ?, ?, ?, 0, 2.5, 0, ?, ?)`,
      )
      .run(key, body.lessonId ?? null, body.front, body.back, body.tags, now, now);
    const card = db.prepare("SELECT * FROM flashcards WHERE id = ?").get(Number(res.lastInsertRowid));
    return c.json({ card });
  });

  app.post("/api/flashcards/:id/review", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await readBody(c, schemas.flashcardReview);
    const db = getDb();
    const card = db.prepare("SELECT * FROM flashcards WHERE id = ?").get(id) as
      | { id: number; interval_days: number; ease_factor: number; repetitions: number }
      | undefined;
    if (!card) throw new ApiError(404, "Flashcard not found");

    // SM-2 adaptation for quality 1 (Again), 2 (Hard), 3 (Good), 4 (Easy)
    let reps = card.repetitions;
    let ef = card.ease_factor;
    let interval = card.interval_days;

    if (body.quality === 1) {
      reps = 0;
      interval = 1;
      ef = Math.max(1.3, ef - 0.2);
    } else {
      reps += 1;
      if (reps === 1) interval = body.quality === 4 ? 3 : 1;
      else if (reps === 2) interval = body.quality === 2 ? 3 : 6;
      else {
        const mult = body.quality === 2 ? 1.2 : body.quality === 4 ? ef * 1.3 : ef;
        interval = Math.max(1, Math.round(interval * mult));
      }
      const qScore = body.quality === 2 ? 3 : body.quality === 3 ? 4 : 5;
      ef = Math.max(1.3, ef + (0.1 - (5 - qScore) * (0.08 + (5 - qScore) * 0.02)));
    }

    const now = new Date();
    const next = new Date(now);
    next.setUTCDate(next.getUTCDate() + interval);

    db.prepare(
      `UPDATE flashcards
       SET interval_days = ?, ease_factor = ?, repetitions = ?, last_reviewed_at = ?, next_review_at = ?
       WHERE id = ?`,
    ).run(interval, Math.round(ef * 100) / 100, reps, now.toISOString(), next.toISOString(), id);

    recordStudyActivity("flashcard", String(id), 2, db);
    const updated = db.prepare("SELECT * FROM flashcards WHERE id = ?").get(id);
    return c.json({ card: updated });
  });

  app.delete("/api/flashcards/:id", (c) => {
    const id = Number(c.req.param("id"));
    getDb().prepare("DELETE FROM flashcards WHERE id = ?").run(id);
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // 5. Mistake Notebook & Reflections
  // -------------------------------------------------------------------------
  app.get("/api/mistakes", (c) => {
    const s = store();
    const db = getDb();
    const grouped = db
      .prepare(
        `SELECT exercise_id,
                COUNT(*) AS fail_count,
                MAX(created_at) AS last_failed_at,
                (SELECT feedback FROM exercise_attempts ea2 WHERE ea2.exercise_id = ea.exercise_id AND ea2.passed = 0 ORDER BY id DESC LIMIT 1) AS last_feedback,
                (SELECT COUNT(*) FROM exercise_attempts ea3 WHERE ea3.exercise_id = ea.exercise_id AND ea3.passed = 1 AND ea3.revealed_solution = 0) AS pass_count
         FROM exercise_attempts ea
         WHERE passed = 0 AND revealed_solution = 0
         GROUP BY exercise_id
         ORDER BY last_failed_at DESC`,
      )
      .all() as Array<{
      exercise_id: string;
      fail_count: number;
      last_failed_at: string;
      last_feedback: string;
      pass_count: number;
    }>;

    const reflections = new Map(
      (
        db.prepare("SELECT * FROM mistake_reflections").all() as Array<{
          exercise_id: string;
          takeaway: string;
          resolved: number;
          updated_at: string;
        }>
      ).map((r) => [r.exercise_id, r]),
    );

    const items = grouped
      .map((g) => {
        const ref = s.exercises.get(g.exercise_id);
        if (!ref) return null;
        const refl = reflections.get(g.exercise_id);
        return {
          exerciseId: g.exercise_id,
          title: ref.exercise.title,
          category: ref.exercise.category,
          lessonId: ref.lessonId ?? null,
          lessonTitle: ref.lessonId ? s.lessons.get(ref.lessonId)?.title ?? null : null,
          failCount: Number(g.fail_count),
          passCount: Number(g.pass_count),
          lastFeedback: g.last_feedback,
          lastFailedAt: g.last_failed_at,
          takeaway: refl?.takeaway ?? "",
          resolved: Boolean(refl?.resolved) || Number(g.pass_count) > 0,
        };
      })
      .filter(Boolean);

    return c.json({ mistakes: items });
  });

  app.post("/api/mistakes/:exerciseId/reflection", async (c) => {
    const exerciseId = c.req.param("exerciseId");
    const body = await readBody(c, schemas.mistakeReflection);
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO mistake_reflections (exercise_id, takeaway, resolved, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(exercise_id) DO UPDATE SET
         takeaway = excluded.takeaway,
         resolved = excluded.resolved,
         updated_at = excluded.updated_at`,
    ).run(exerciseId, body.takeaway, body.resolved ? 1 : 0, now);
    return c.json({ exerciseId, takeaway: body.takeaway, resolved: Boolean(body.resolved), updatedAt: now });
  });

  // -------------------------------------------------------------------------
  // 6. Knowledge Management (Snippets, Resources/PDFs, Glossary, Global Search)
  // -------------------------------------------------------------------------
  app.get("/api/knowledge", (c) => {
    const s = store();
    const db = getDb();
    const snippets = db
      .prepare("SELECT * FROM code_snippets ORDER BY updated_at DESC")
      .all();
    const resources = db
      .prepare("SELECT * FROM knowledge_resources ORDER BY updated_at DESC")
      .all();
    const notes = db.prepare("SELECT * FROM notes ORDER BY updated_at DESC").all();
    const bookmarks = db.prepare("SELECT * FROM bookmarks ORDER BY id DESC").all();

    const glossary: Array<{
      term: string;
      definition: string;
      lessonId: string;
      lessonTitle: string;
      track: string;
    }> = [];
    for (const lesson of s.lessons.values()) {
      for (const t of lesson.terms) {
        glossary.push({
          term: t.term,
          definition: t.definition,
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          track: lesson.track,
        });
      }
    }

    return c.json({ snippets, resources, notes, bookmarks, glossary });
  });

  app.post("/api/knowledge/snippets", async (c) => {
    const body = await readBody(c, schemas.codeSnippet);
    const db = getDb();
    const now = new Date().toISOString();
    if (body.id) {
      db.prepare(
        "UPDATE code_snippets SET title = ?, language = ?, tags = ?, code = ?, notes = ?, updated_at = ? WHERE id = ?",
      ).run(body.title, body.language, body.tags, body.code, body.notes, now, body.id);
      return c.json({ snippet: db.prepare("SELECT * FROM code_snippets WHERE id = ?").get(body.id) });
    }
    const res = db
      .prepare(
        "INSERT INTO code_snippets (title, language, tags, code, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(body.title, body.language, body.tags, body.code, body.notes, now);
    return c.json({
      snippet: db.prepare("SELECT * FROM code_snippets WHERE id = ?").get(Number(res.lastInsertRowid)),
    });
  });

  app.delete("/api/knowledge/snippets/:id", (c) => {
    getDb().prepare("DELETE FROM code_snippets WHERE id = ?").run(Number(c.req.param("id")));
    return c.json({ ok: true });
  });

  app.post("/api/knowledge/resources", async (c) => {
    const body = await readBody(c, schemas.knowledgeResource);
    const db = getDb();
    const now = new Date().toISOString();
    if (body.id) {
      db.prepare(
        "UPDATE knowledge_resources SET kind = ?, title = ?, url_or_path = ?, tags = ?, summary = ?, updated_at = ? WHERE id = ?",
      ).run(body.kind, body.title, body.urlOrPath, body.tags, body.summary, now, body.id);
      return c.json({
        resource: db.prepare("SELECT * FROM knowledge_resources WHERE id = ?").get(body.id),
      });
    }
    const res = db
      .prepare(
        "INSERT INTO knowledge_resources (kind, title, url_or_path, tags, summary, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(body.kind, body.title, body.urlOrPath, body.tags, body.summary, now);
    return c.json({
      resource: db
        .prepare("SELECT * FROM knowledge_resources WHERE id = ?")
        .get(Number(res.lastInsertRowid)),
    });
  });

  app.delete("/api/knowledge/resources/:id", (c) => {
    getDb().prepare("DELETE FROM knowledge_resources WHERE id = ?").run(Number(c.req.param("id")));
    return c.json({ ok: true });
  });

  app.get("/api/search", (c) => {
    const q = (c.req.query("q") || "").trim().toLowerCase();
    if (q.length < 2) return c.json({ query: q, results: [] });

    const s = store();
    const db = getDb();
    const results: Array<{
      type: "lesson" | "term" | "exercise" | "project" | "note" | "snippet" | "resource";
      id: string;
      title: string;
      snippet: string;
      targetId: string;
      sectionId?: string;
    }> = [];

    for (const lesson of s.lessons.values()) {
      if (
        lesson.title.toLowerCase().includes(q) ||
        lesson.summary.toLowerCase().includes(q) ||
        lesson.id.toLowerCase().includes(q)
      ) {
        results.push({
          type: "lesson",
          id: lesson.id,
          title: lesson.title,
          snippet: lesson.summary.slice(0, 140),
          targetId: lesson.id,
        });
      }
      for (const t of lesson.terms) {
        if (t.term.toLowerCase().includes(q) || t.definition.toLowerCase().includes(q)) {
          results.push({
            type: "term",
            id: `${lesson.id}:${t.term}`,
            title: `${t.term} (${lesson.title})`,
            snippet: t.definition.slice(0, 140),
            targetId: lesson.id,
          });
        }
      }
    }

    for (const ref of s.practiceExercises()) {
      if (
        ref.exercise.title.toLowerCase().includes(q) ||
        ref.exercise.prompt.toLowerCase().includes(q)
      ) {
        results.push({
          type: "exercise",
          id: ref.id,
          title: ref.exercise.title,
          snippet: `${ref.exercise.category} · ${ref.exercise.type}`,
          targetId: ref.id,
        });
      }
    }

    for (const proj of s.projects.values()) {
      if (proj.title.toLowerCase().includes(q) || proj.summary.toLowerCase().includes(q)) {
        results.push({
          type: "project",
          id: proj.id,
          title: proj.title,
          snippet: proj.summary.slice(0, 140),
          targetId: proj.id,
        });
      }
    }

    const notes = db.prepare("SELECT * FROM notes").all() as Array<{
      id: number;
      lesson_id: string;
      section_id: string | null;
      tags: string;
      content: string;
    }>;
    for (const n of notes) {
      if (n.content.toLowerCase().includes(q) || (n.tags || "").toLowerCase().includes(q)) {
        results.push({
          type: "note",
          id: String(n.id),
          title: `Qeyd (${n.lesson_id})`,
          snippet: n.content.slice(0, 140),
          targetId: n.lesson_id,
          sectionId: n.section_id ?? undefined,
        });
      }
    }

    const snippets = db.prepare("SELECT * FROM code_snippets").all() as Array<{
      id: number;
      title: string;
      tags: string;
      code: string;
      notes: string;
    }>;
    for (const sn of snippets) {
      if (
        sn.title.toLowerCase().includes(q) ||
        sn.tags.toLowerCase().includes(q) ||
        sn.code.toLowerCase().includes(q)
      ) {
        results.push({
          type: "snippet",
          id: String(sn.id),
          title: sn.title,
          snippet: sn.notes || sn.code.slice(0, 120),
          targetId: String(sn.id),
        });
      }
    }

    const resources = db.prepare("SELECT * FROM knowledge_resources").all() as Array<{
      id: number;
      kind: string;
      title: string;
      tags: string;
      summary: string;
    }>;
    for (const r of resources) {
      if (
        r.title.toLowerCase().includes(q) ||
        r.tags.toLowerCase().includes(q) ||
        r.summary.toLowerCase().includes(q)
      ) {
        results.push({
          type: "resource",
          id: String(r.id),
          title: `[${r.kind.toUpperCase()}] ${r.title}`,
          snippet: r.summary.slice(0, 140),
          targetId: String(r.id),
        });
      }
    }

    return c.json({ query: q, results: results.slice(0, 40) });
  });

  // -------------------------------------------------------------------------
  // 7. Study Planner: Daily/Weekly Schedule, Streaks, 30-Day Report & Recommendations
  // -------------------------------------------------------------------------
  app.get("/api/planner", (c) => {
    const s = store();
    const db = getDb();
    const profile = getProfile(db);
    syncLessonFlashcards(s, db);

    const { streakDays, todayMinutes, last30Days } = computeLearningStreak(db);
    const masteryMap = getSkillMasteryMap(s, db);
    const nowIso = new Date().toISOString();

    const dueFlashcards = (
      db
        .prepare("SELECT COUNT(*) AS cnt FROM flashcards WHERE next_review_at IS NULL OR next_review_at <= ?")
        .get(nowIso) as { cnt: number }
    ).cnt;

    const tasks = db
      .prepare("SELECT * FROM study_tasks ORDER BY completed ASC, priority ASC, id DESC")
      .all();

    // Generate smart prioritized "Next Best Tasks" based on actual progress & weaknesses
    const recommendations: Array<{
      priority: number;
      category: "review" | "exercise" | "lesson" | "project";
      title: string;
      reason: string;
      estimatedMinutes: number;
      targetId: string;
    }> = [];

    const weakSkills = Object.values(masteryMap).filter((m) => m.status === "needs_review");
    if (weakSkills.length > 0) {
      const sk = s.skills.get(weakSkills[0].skill_id);
      recommendations.push({
        priority: 1,
        category: "review",
        title: `Zəif bacarığı təkrarla: ${sk?.name ?? weakSkills[0].skill_id}`,
        reason: "Bu bacarıq 'Needs review' statusundadır — Practice Lab-da 1 tapşırığı ipucusuz həll et.",
        estimatedMinutes: 15,
        targetId: weakSkills[0].skill_id,
      });
    }

    if (dueFlashcards > 0) {
      recommendations.push({
        priority: 1,
        category: "review",
        title: `Spaced Repetition: ${dueFlashcards} Flashcard təkrarı`,
        reason: "Yaddaş əyrisini qorumaq üçün vaxtı çatmış termin kartlarını yoxla.",
        estimatedMinutes: 5,
        targetId: "flashcards",
      });
    }

    const completedSet = new Set(
      (
        db
          .prepare("SELECT lesson_id FROM lesson_progress WHERE status = 'completed'")
          .all() as Array<{ lesson_id: string }>
      ).map((r) => r.lesson_id),
    );
    const nextLessonId =
      (profile.last_lesson_id && !completedSet.has(profile.last_lesson_id)
        ? profile.last_lesson_id
        : s.lessonOrder().find((id) => !completedSet.has(id))) ?? s.lessonOrder()[0];

    if (nextLessonId) {
      const l = s.lessons.get(nextLessonId);
      if (l) {
        recommendations.push({
          priority: 2,
          category: "lesson",
          title: `Dərs: ${l.title}`,
          reason: "Yol xəritəsindəki növbəti tamamlanmamış dərs (bölmələr + quiz + kod tapşırığı).",
          estimatedMinutes: l.estimated_minutes[0],
          targetId: l.id,
        });
      }
    }

    const activeProj =
      (profile.active_project_id ? s.projects.get(profile.active_project_id) : null) ??
      [...s.projects.values()][0];
    if (activeProj) {
      recommendations.push({
        priority: 3,
        category: "project",
        title: `Layihə Milestone: ${activeProj.title}`,
        reason: "Real mühəndislik portfelini irəli aparmaq üçün kod və test sübutu əlavə et.",
        estimatedMinutes: 30,
        targetId: activeProj.id,
      });
    }

    const totalMonthMinutes = last30Days.reduce((a, b) => a + b.minutes, 0);
    const activeDaysLast30 = last30Days.filter((d) => d.minutes > 0).length;

    return c.json({
      streakDays,
      todayMinutes,
      dailyGoalMinutes: profile.daily_goal_minutes,
      weeklyHoursGoal: profile.weekly_hours,
      totalMonthMinutes,
      activeDaysLast30,
      dueFlashcards,
      last30Days,
      recommendations,
      tasks,
    });
  });

  app.post("/api/planner/tasks", async (c) => {
    const body = await readBody(c, schemas.studyTaskCreate);
    const db = getDb();
    const now = new Date().toISOString();
    const res = db
      .prepare(
        `INSERT INTO study_tasks (title, category, target_id, estimated_minutes, due_date, priority, completed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        body.title,
        body.category,
        body.targetId ?? null,
        body.estimatedMinutes,
        body.dueDate ?? now.slice(0, 10),
        body.priority,
        now,
      );
    const task = db.prepare("SELECT * FROM study_tasks WHERE id = ?").get(Number(res.lastInsertRowid));
    return c.json({ task });
  });

  app.patch("/api/planner/tasks/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await readBody(c, schemas.studyTaskUpdate);
    const db = getDb();
    const existing = db.prepare("SELECT * FROM study_tasks WHERE id = ?").get(id) as
      | { id: number; title: string; priority: number; due_date: string | null; completed: number; estimated_minutes: number }
      | undefined;
    if (!existing) throw new ApiError(404, "Task not found");

    const now = new Date().toISOString();
    const nextCompleted =
      typeof body.completed === "boolean" ? (body.completed ? 1 : 0) : existing.completed;
    const completedAt = nextCompleted === 1 ? now : null;

    db.prepare(
      `UPDATE study_tasks
       SET title = ?, priority = ?, due_date = ?, completed = ?, completed_at = ?
       WHERE id = ?`,
    ).run(
      body.title ?? existing.title,
      body.priority ?? existing.priority,
      body.dueDate !== undefined ? body.dueDate : existing.due_date,
      nextCompleted,
      completedAt,
      id,
    );

    if (existing.completed === 0 && nextCompleted === 1) {
      recordStudyActivity("planner_task", String(id), Math.min(30, existing.estimated_minutes), db);
    }

    return c.json({ task: db.prepare("SELECT * FROM study_tasks WHERE id = ?").get(id) });
  });

  app.delete("/api/planner/tasks/:id", (c) => {
    getDb().prepare("DELETE FROM study_tasks WHERE id = ?").run(Number(c.req.param("id")));
    return c.json({ ok: true });
  });
}
