/**
 * Hono HTTP application for AI Engineering Academy.
 *
 * Exposes `/api/*` endpoints for curriculum content, onboarding diagnostic,
 * lesson player, exercise & quiz grading, evidence-based skill mastery,
 * project workspace with evidence enforcement, AI mentor, notes, bookmarks,
 * and long-term JSON backup export/import.
 */
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { getStore, REPO_ROOT, type ContentStore } from "./content/loader.ts";
import {
  checkDbIntegrity,
  getCurrentDbPath,
  getDb,
  getProfile,
  recordStudyActivity,
  type SkillMasteryRow,
} from "./db.ts";
import {
  evaluateDiagnostic,
  getSkillMasteryMap,
  gradeExercise,
  introduceSkills,
  sanitizeExercise,
  sanitizeLesson,
  updateSkillsFromAttempt,
  type DiagnosticSubmission,
} from "./engine.ts";
import { checkMentorRateLimit, tutorProvider, type MentorRequest } from "./mentor.ts";
import {
  computeLearningStreak,
  registerPersonalRoutes,
  syncLessonFlashcards,
} from "./personalRoutes.ts";
import {
  ApiError,
  importSchema,
  localOnlyGuard,
  readBody,
  schemas,
  sizeLimit,
} from "./validation.ts";

export function createApp(customStore?: ContentStore) {
  const app = new Hono();

  // Security: local-only Host/Origin guard (no CORS headers are ever sent) + body size limits.
  app.use("*", localOnlyGuard);
  app.use("/api/*", sizeLimit);

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: err.message }, err.status);
    }
    // Never leak stack traces / internals to the client; log them server-side.
    console.error(`[api] ${c.req.method} ${new URL(c.req.url).pathname} failed:`, err);
    return c.json({ error: "Internal server error" }, 500);
  });

  const store = () => customStore ?? getStore();

  // ---- Local Pyodide WASM/Stdlib Assets (100% offline browser Python sandbox) ----
  app.get("/pyodide/:file", (c) => {
    const file = path.basename(c.req.param("file"));
    const full = path.join(REPO_ROOT, "node_modules", "pyodide", file);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return c.notFound();
    }
    const ext = path.extname(file).toLowerCase();
    const mime: Record<string, string> = {
      ".js": "application/javascript; charset=utf-8",
      ".mjs": "application/javascript; charset=utf-8",
      ".wasm": "application/wasm",
      ".zip": "application/zip",
      ".json": "application/json; charset=utf-8",
      ".map": "application/json; charset=utf-8",
    };
    return new Response(fs.readFileSync(full), {
      headers: {
        "Content-Type": mime[ext] || "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
      },
    });
  });

  // ---- Health ----
  app.get("/api/health", (c) => {
    const s = store();
    const dbIntegrity = checkDbIntegrity(getDb());
    return c.json({
      ok: dbIntegrity.ok,
      dbIntegrity,
      tracks: s.tracks.length,
      modules: s.modules.size,
      lessons: s.lessons.size,
      skills: s.skills.size,
      exercises: s.exercises.size,
      projects: s.projects.size,
      mentor: tutorProvider.getStatus(),
    });
  });

  // ---- Bootstrap (Dashboard + Shell state) ----
  app.get("/api/bootstrap", (c) => {
    const s = store();
    const db = getDb();
    const profile = getProfile(db);
    const masteryMap = getSkillMasteryMap(s, db);

    const latestDiagRow = db
      .prepare("SELECT summary_json, created_at FROM diagnostic_attempts ORDER BY id DESC LIMIT 1")
      .get() as { summary_json: string; created_at: string } | undefined;
    const latestDiagnostic = latestDiagRow
      ? { ...JSON.parse(latestDiagRow.summary_json), createdAt: latestDiagRow.created_at }
      : null;

    const lessonProgressRows = db
      .prepare("SELECT * FROM lesson_progress")
      .all() as Array<{
      lesson_id: string;
      status: string;
      last_section_id: string | null;
      understood_sections_json: string;
      unclear_sections_json: string;
      started_at: string;
      updated_at: string;
    }>;

    const lessonProgress: Record<
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
    > = {};
    for (const r of lessonProgressRows) {
      lessonProgress[r.lesson_id] = {
        lessonId: r.lesson_id,
        status: r.status,
        lastSectionId: r.last_section_id,
        understoodSections: JSON.parse(r.understood_sections_json),
        unclearSections: JSON.parse(r.unclear_sections_json),
        startedAt: r.started_at,
        updatedAt: r.updated_at,
      };
    }

    // Tracks & modules enriched with lesson metadata
    const tracks = s.tracks.map((t) => ({
      ...t,
      modules: t.modules.map((m) => {
        const lessonSummaries = m.lessons
          .map((lId) => s.lessons.get(lId))
          .filter(Boolean)
          .map((l) => ({
            id: l!.id,
            title: l!.title,
            summary: l!.summary,
            level: l!.level,
            estimated_minutes: l!.estimated_minutes,
            skills: l!.skills,
            status: lessonProgress[l!.id]?.status ?? "not_started",
          }));
        const completedCount = lessonSummaries.filter((l) => l.status === "completed").length;
        return {
          ...m,
          lessonSummaries,
          completedLessonsCount: completedCount,
          totalLessonsCount: lessonSummaries.length,
        };
      }),
    }));

    // Skills list with mastery
    const skills = [...s.skills.values()].map((sk) => {
      const m = masteryMap[sk.id];
      const distinctPassed: string[] = m ? JSON.parse(m.distinct_passed_json) : [];
      return {
        ...sk,
        mastery: {
          status: m?.status ?? "not_started",
          distinctPassedCount: distinctPassed.length,
          attemptsCount: m?.attempts_count ?? 0,
          correctCount: m?.correct_count ?? 0,
          failStreak: m?.fail_streak ?? 0,
          lastPracticedAt: m?.last_practiced_at ?? null,
          nextReviewAt: m?.next_review_at ?? null,
        },
      };
    });

    // Projects enriched with milestone completion & evidence
    const projRows = db.prepare("SELECT * FROM project_progress").all() as Array<{
      project_id: string;
      milestone_id: string;
      status: string;
      checked_tasks_json: string;
      notes: string;
      evidence: string;
      updated_at: string;
    }>;
    const projProgressByKey = new Map<string, (typeof projRows)[number]>();
    for (const r of projRows) {
      projProgressByKey.set(`${r.project_id}::${r.milestone_id}`, r);
    }

    const projects = [...s.projects.values()].map((p) => {
      const milestones = p.milestones.map((ms) => {
        const row = projProgressByKey.get(`${p.id}::${ms.id}`);
        const checkedTasks: number[] = row ? JSON.parse(row.checked_tasks_json) : [];
        return {
          ...ms,
          status: row?.status ?? "not_started",
          checkedTasks,
          notes: row?.notes ?? "",
          evidence: row?.evidence ?? "",
          updatedAt: row?.updated_at ?? null,
        };
      });
      const completedMilestones = milestones.filter(
        (m) => m.status === "completed" && m.evidence.trim().length >= 15,
      ).length;
      return {
        ...p,
        milestones,
        completedMilestones,
        totalMilestones: milestones.length,
        isComplete: completedMilestones === milestones.length && milestones.length > 0,
      };
    });

    // Determine next recommended lesson
    const canonicalOrder = s.lessonOrder().filter((id) => s.lessons.has(id));
    let nextLessonId: string | null = null;
    if (
      profile.last_lesson_id &&
      s.lessons.has(profile.last_lesson_id) &&
      lessonProgress[profile.last_lesson_id]?.status !== "completed"
    ) {
      nextLessonId = profile.last_lesson_id;
    } else if (latestDiagnostic?.studyPlan) {
      for (const item of latestDiagnostic.studyPlan) {
        for (const lId of item.lessonIds || []) {
          if (s.lessons.has(lId) && lessonProgress[lId]?.status !== "completed") {
            nextLessonId = lId;
            break;
          }
        }
        if (nextLessonId) break;
      }
    }
    if (!nextLessonId) {
      nextLessonId =
        canonicalOrder.find((id) => lessonProgress[id]?.status !== "completed") ??
        canonicalOrder[0] ??
        null;
    }

    const nextLessonObj = nextLessonId ? s.lessons.get(nextLessonId) : null;
    const nextRecommendedLesson = nextLessonObj
      ? {
          id: nextLessonObj.id,
          title: nextLessonObj.title,
          summary: nextLessonObj.summary,
          trackId: nextLessonObj.track,
          trackTitle: s.tracks.find((t) => t.id === nextLessonObj.track)?.title ?? nextLessonObj.track,
          moduleId: nextLessonObj.module,
          moduleTitle: s.modules.get(nextLessonObj.module)?.title ?? nextLessonObj.module,
          estimatedMinutes: nextLessonObj.estimated_minutes,
          lastSectionId: lessonProgress[nextLessonObj.id]?.lastSectionId ?? null,
          isResume: Boolean(lessonProgress[nextLessonObj.id]),
        }
      : null;

    // Active project & next milestone
    const activeProject =
      projects.find((p) => p.id === profile.active_project_id) ??
      projects.find((p) => !p.isComplete) ??
      projects[0] ??
      null;
    const nextMilestone =
      activeProject?.milestones.find((m) => m.status !== "completed") ??
      activeProject?.milestones[0] ??
      null;

    // Weekly activity (last 7 UTC days — honest numbers, 0 when no activity)
    const weeklyActivity: Array<{ dayIso: string; minutes: number; actionsCount: number }> = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const dayIso = d.toISOString().slice(0, 10);
      const row = db
        .prepare(
          "SELECT COALESCE(SUM(minutes), 0) AS mins, COUNT(*) AS cnt FROM study_sessions WHERE day_iso = ?",
        )
        .get(dayIso) as { mins: number; cnt: number };
      weeklyActivity.push({
        dayIso,
        minutes: Number(row?.mins ?? 0),
        actionsCount: Number(row?.cnt ?? 0),
      });
    }

    // Recent mistakes to revisit
    const failedRows = db
      .prepare(
        `SELECT exercise_id, lesson_id, feedback, created_at
         FROM exercise_attempts
         WHERE passed = 0 AND revealed_solution = 0
         ORDER BY id DESC
         LIMIT 20`,
      )
      .all() as Array<{
      exercise_id: string;
      lesson_id: string | null;
      feedback: string;
      created_at: string;
    }>;

    const seenMistakeIds = new Set<string>();
    const recentMistakes: Array<{
      exerciseId: string;
      title: string;
      lessonId: string | null;
      category: string;
      feedback: string;
      createdAt: string;
    }> = [];

    for (const r of failedRows) {
      if (seenMistakeIds.has(r.exercise_id)) continue;
      // Check if they subsequently passed it unaided
      const passedLater = db
        .prepare(
          "SELECT 1 FROM exercise_attempts WHERE exercise_id = ? AND passed = 1 AND revealed_solution = 0 LIMIT 1",
        )
        .get(r.exercise_id);
      const ref = s.exercises.get(r.exercise_id);
      if (!ref || ref.kind === "diagnostic") continue;
      seenMistakeIds.add(r.exercise_id);
      recentMistakes.push({
        exerciseId: r.exercise_id,
        title: ref.exercise.title,
        lessonId: r.lesson_id ?? ref.lessonId ?? null,
        category: ref.exercise.category,
        feedback: r.feedback,
        createdAt: r.created_at,
      });
      if (recentMistakes.length >= 6 || passedLater) {
        if (recentMistakes.length >= 6) break;
      }
    }

    // Spaced review due skills
    const nowIso = new Date().toISOString();
    const dueReviews =
      profile.reminders_enabled === 1
        ? skills.filter(
            (sk) =>
              sk.mastery.status === "needs_review" ||
              (sk.mastery.nextReviewAt && sk.mastery.nextReviewAt <= nowIso),
          )
        : [];

    // Skills map: Strong / In progress / Needs work
    const skillsMap = {
      strong: skills.filter((sk) => sk.mastery.status === "demonstrated"),
      inProgress: skills.filter(
        (sk) => sk.mastery.status === "practicing" || sk.mastery.status === "introduced",
      ),
      needsWork: skills.filter((sk) => sk.mastery.status === "needs_review"),
      notStartedCount: skills.filter((sk) => sk.mastery.status === "not_started").length,
    };

    const completedLessonsTotal = Object.values(lessonProgress).filter(
      (lp) => lp.status === "completed",
    ).length;

    let currentStage = "Başlanğıc — Diaqnostika gözlənilir";
    if (profile.onboarded) {
      if (completedLessonsTotal === 0 && skillsMap.strong.length === 0) {
        currentStage = "Mərhələ 1: Diaqnostika tamamlandı — İlk dərsə başla";
      } else if (skillsMap.strong.length < 5) {
        currentStage = "Mərhələ 1: Bünövrə bacarıqların qurulması";
      } else if (skillsMap.strong.length < 15) {
        currentStage = "Mərhələ 2: Praktik ML & LLM mühəndisliyi";
      } else {
        currentStage = "Mərhələ 3: Sistem inteqrasiyası və Production layihələr";
      }
    }

    const bookmarks = db
      .prepare("SELECT * FROM bookmarks ORDER BY id DESC")
      .all();
    const notes = db
      .prepare("SELECT * FROM notes ORDER BY updated_at DESC")
      .all();

    syncLessonFlashcards(s, db);
    const { streakDays, todayMinutes } = computeLearningStreak(db);
    const dueFlashcardsCount = (
      db
        .prepare("SELECT COUNT(*) AS cnt FROM flashcards WHERE next_review_at IS NULL OR next_review_at <= ?")
        .get(nowIso) as { cnt: number }
    ).cnt;

    return c.json({
      profile: {
        name: profile.name,
        onboarded: Boolean(profile.onboarded),
        goalId: profile.goal_id,
        weeklyHours: profile.weekly_hours,
        dailyGoalMinutes: profile.daily_goal_minutes,
        explanationLevel: profile.explanation_level,
        socraticMode: Boolean(profile.socratic_mode),
        activeProjectId: activeProject?.id ?? null,
        lastLessonId: profile.last_lesson_id,
        lastSectionId: profile.last_section_id,
        remindersEnabled: Boolean(profile.reminders_enabled),
        theme: profile.theme,
      },
      latestDiagnostic,
      tracks,
      skills,
      lessonProgress,
      projects,
      dashboard: {
        currentStage,
        completedLessonsTotal,
        totalAuthoredLessons: s.lessons.size,
        streakDays,
        todayMinutes,
        dailyGoalMinutes: profile.daily_goal_minutes,
        dueFlashcardsCount,
        nextRecommendedLesson,
        currentProject: activeProject
          ? {
              id: activeProject.id,
              title: activeProject.title,
              completedMilestones: activeProject.completedMilestones,
              totalMilestones: activeProject.totalMilestones,
              nextMilestone,
            }
          : null,
        weeklyActivity,
        skillsMap,
        recentMistakes,
        dueReviews,
      },
      mentorStatus: tutorProvider.getStatus(),
      mentorConfig: tutorProvider.getSafeConfig(),
      bookmarks,
      notes,
    });
  });

  // ---- Diagnostic ----
  app.get("/api/diagnostic", (c) => {
    const s = store();
    if (!s.diagnostic) return c.json({ error: "Diagnostic not configured" }, 404);
    return c.json({
      areas: s.diagnostic.areas,
      goals: s.diagnostic.goals,
      checks: s.diagnostic.checks.map((chk) => ({
        area: chk.area,
        question: sanitizeExercise(chk.question),
      })),
    });
  });

  app.post("/api/diagnostic/submit", async (c) => {
    const body = (await readBody(c, schemas.diagnostic)) as DiagnosticSubmission;
    const s = store();
    if (!s.diagnostic?.goals.some((g) => g.id === body.goalId)) {
      throw new ApiError(400, `Invalid request: goalId: unknown goal '${body.goalId}'`);
    }
    const result = evaluateDiagnostic(s, body);
    return c.json(result);
  });

  // ---- Lesson Player ----
  app.get("/api/lessons/:id", (c) => {
    const s = store();
    const lessonId = c.req.param("id");
    const lesson = s.lessons.get(lessonId);
    if (!lesson) return c.json({ error: `Lesson '${lessonId}' not found` }, 404);

    const db = getDb();
    const now = new Date().toISOString();

    // Opening a lesson introduces its skills (if not_started) and records progress
    introduceSkills(lesson.skills, db);

    const existing = db
      .prepare("SELECT * FROM lesson_progress WHERE lesson_id = ?")
      .get(lessonId) as
      | {
          lesson_id: string;
          status: string;
          last_section_id: string | null;
          understood_sections_json: string;
          unclear_sections_json: string;
          started_at: string;
          updated_at: string;
        }
      | undefined;

    const firstSectionId = lesson.sections[0]?.id ?? null;
    if (!existing) {
      db.prepare(
        `INSERT INTO lesson_progress
         (lesson_id, status, last_section_id, understood_sections_json, unclear_sections_json, started_at, updated_at)
         VALUES (?, 'in_progress', ?, '[]', '[]', ?, ?)`,
      ).run(lessonId, firstSectionId, now, now);
    }

    db.prepare("UPDATE user_profile SET last_lesson_id = ?, updated_at = ? WHERE id = 1").run(
      lessonId,
      now,
    );

    const progressRow = db
      .prepare("SELECT * FROM lesson_progress WHERE lesson_id = ?")
      .get(lessonId) as {
      lesson_id: string;
      status: string;
      last_section_id: string | null;
      understood_sections_json: string;
      unclear_sections_json: string;
      started_at: string;
      updated_at: string;
    };

    const exerciseIds = lesson.exercises.map((e) => e.id);
    const exerciseAttempts: Record<
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
    > = {};

    for (const exId of exerciseIds) {
      const rows = db
        .prepare(
          "SELECT * FROM exercise_attempts WHERE exercise_id = ? ORDER BY id DESC LIMIT 10",
        )
        .all(exId) as Array<{
        id: number;
        passed: number;
        used_hint: number;
        revealed_solution: number;
        answer_json: string;
        feedback: string;
        created_at: string;
      }>;
      exerciseAttempts[exId] = rows.map((r) => ({
        id: r.id,
        passed: Boolean(r.passed),
        usedHint: Boolean(r.used_hint),
        revealedSolution: Boolean(r.revealed_solution),
        answer: JSON.parse(r.answer_json),
        feedback: r.feedback,
        createdAt: r.created_at,
      }));
    }

    const quizAttempts = (
      db
        .prepare("SELECT * FROM quiz_attempts WHERE lesson_id = ? ORDER BY id DESC LIMIT 5")
        .all(lessonId) as Array<{
        id: number;
        score: number;
        passed: number;
        details_json: string;
        created_at: string;
      }>
    ).map((q) => ({
      id: q.id,
      score: q.score,
      passed: Boolean(q.passed),
      details: JSON.parse(q.details_json),
      createdAt: q.created_at,
    }));

    const notes = db
      .prepare("SELECT * FROM notes WHERE lesson_id = ? ORDER BY updated_at DESC")
      .all(lessonId);

    const bookmarks = db
      .prepare("SELECT * FROM bookmarks WHERE target_type = 'lesson' AND target_id = ?")
      .all(lessonId);

    const prereqLessons = lesson.prerequisites.map((pId) => {
      const pl = s.lessons.get(pId);
      return { id: pId, title: pl?.title ?? pId };
    });
    const nextLesson = lesson.next
      ? { id: lesson.next, title: s.lessons.get(lesson.next)?.title ?? lesson.next }
      : null;

    return c.json({
      lesson: sanitizeLesson(lesson),
      prereqLessons,
      nextLesson,
      progress: {
        status: progressRow.status,
        lastSectionId: progressRow.last_section_id ?? firstSectionId,
        understoodSections: JSON.parse(progressRow.understood_sections_json),
        unclearSections: JSON.parse(progressRow.unclear_sections_json),
      },
      exerciseAttempts,
      quizAttempts,
      notes,
      bookmarks,
    });
  });

  app.post("/api/lessons/:id/section", async (c) => {
    const lessonId = c.req.param("id");
    const lessonDef = store().lessons.get(lessonId);
    if (!lessonDef) throw new ApiError(404, `Lesson '${lessonId}' not found`);
    const body = await readBody(c, schemas.section);
    if (!lessonDef.sections.some((sec) => sec.id === body.sectionId)) {
      throw new ApiError(400, `Invalid request: sectionId '${body.sectionId}' is not in this lesson`);
    }
    const db = getDb();
    const now = new Date().toISOString();

    const row = db
      .prepare("SELECT * FROM lesson_progress WHERE lesson_id = ?")
      .get(lessonId) as
      | {
          understood_sections_json: string;
          unclear_sections_json: string;
        }
      | undefined;

    const understood = new Set<string>(
      row ? JSON.parse(row.understood_sections_json) : [],
    );
    const unclear = new Set<string>(
      row ? JSON.parse(row.unclear_sections_json) : [],
    );

    if (body.mark === "understood") {
      understood.add(body.sectionId);
      unclear.delete(body.sectionId);
    } else if (body.mark === "unclear") {
      unclear.add(body.sectionId);
      understood.delete(body.sectionId);
    } else if (body.mark === "clear") {
      understood.delete(body.sectionId);
      unclear.delete(body.sectionId);
    }

    db.prepare(
      `INSERT INTO lesson_progress
       (lesson_id, status, last_section_id, understood_sections_json, unclear_sections_json, started_at, updated_at)
       VALUES (?, 'in_progress', ?, ?, ?, ?, ?)
       ON CONFLICT(lesson_id) DO UPDATE SET
         last_section_id = excluded.last_section_id,
         understood_sections_json = excluded.understood_sections_json,
         unclear_sections_json = excluded.unclear_sections_json,
         updated_at = excluded.updated_at`,
    ).run(
      lessonId,
      body.sectionId,
      JSON.stringify([...understood]),
      JSON.stringify([...unclear]),
      now,
      now,
    );

    db.prepare(
      "UPDATE user_profile SET last_lesson_id = ?, last_section_id = ?, updated_at = ? WHERE id = 1",
    ).run(lessonId, body.sectionId, now);

    recordStudyActivity("lesson_section", `${lessonId}:${body.sectionId}`, 3, db);

    return c.json({
      lastSectionId: body.sectionId,
      understoodSections: [...understood],
      unclearSections: [...unclear],
    });
  });

  // Helper to check if a lesson has demonstrated enough evidence to be marked completed
  function checkAndMarkLessonCompletion(s: ContentStore, lessonId: string, db = getDb()): boolean {
    const lesson = s.lessons.get(lessonId);
    if (!lesson) return false;

    const quizPassed = db
      .prepare("SELECT 1 FROM quiz_attempts WHERE lesson_id = ? AND passed = 1 LIMIT 1")
      .get(lessonId);

    let passedExercises = 0;
    for (const ex of lesson.exercises) {
      const ok = db
        .prepare(
          "SELECT 1 FROM exercise_attempts WHERE exercise_id = ? AND passed = 1 AND revealed_solution = 0 LIMIT 1",
        )
        .get(ex.id);
      if (ok) passedExercises++;
    }

    if (quizPassed && passedExercises >= 1) {
      const now = new Date().toISOString();
      db.prepare(
        "UPDATE lesson_progress SET status = 'completed', updated_at = ? WHERE lesson_id = ?",
      ).run(now, lessonId);
      return true;
    }
    return false;
  }

  // ---- Quiz Submission ----
  app.post("/api/lessons/:id/quiz", async (c) => {
    const s = store();
    const lessonId = c.req.param("id");
    const lesson = s.lessons.get(lessonId);
    if (!lesson) return c.json({ error: "Lesson not found" }, 404);

    const body = await readBody(c, schemas.quiz);
    const answers = body.answers ?? {};
    const db = getDb();

    let correct = 0;
    const details: Record<
      string,
      { passed: boolean; feedback: string; explanation: string }
    > = {};

    for (const q of lesson.quiz.questions) {
      const grade = gradeExercise(q, { answer: answers[q.id] });
      if (grade.passed) correct++;
      details[q.id] = {
        passed: grade.passed,
        feedback: grade.feedback,
        explanation: q.explanation,
      };
      updateSkillsFromAttempt({
        store: s,
        exerciseId: q.id,
        skillIds: q.skills,
        passed: grade.passed,
        usedHint: false,
        revealedSolution: false,
        source: "quiz",
        db,
      });
    }

    const total = lesson.quiz.questions.length;
    const score = total > 0 ? correct / total : 0;
    const passed = score >= lesson.quiz.pass_threshold;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO quiz_attempts (lesson_id, score, passed, details_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(lessonId, score, passed ? 1 : 0, JSON.stringify(details), now);

    recordStudyActivity("quiz", lessonId, 5, db);
    const lessonCompleted = checkAndMarkLessonCompletion(s, lessonId, db);

    return c.json({
      score,
      correct,
      total,
      passThreshold: lesson.quiz.pass_threshold,
      passed,
      details,
      lessonCompleted,
    });
  });

  // ---- Exercise Submission & Solution Reveal ----
  app.post("/api/exercises/:id/submit", async (c) => {
    const s = store();
    const exId = c.req.param("id");
    const ref = s.exercises.get(exId);
    if (!ref) return c.json({ error: `Exercise '${exId}' not found` }, 404);

    const body = await readBody(c, schemas.exerciseSubmit);

    const grade = gradeExercise(ref.exercise, body);
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO exercise_attempts
       (exercise_id, lesson_id, passed, used_hint, revealed_solution, self_assessed, answer_json, feedback, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      exId,
      ref.lessonId ?? null,
      grade.passed ? 1 : 0,
      body.usedHint ? 1 : 0,
      body.revealedSolution ? 1 : 0,
      ref.exercise.type === "explain" ? 1 : 0,
      JSON.stringify(body.answer ?? null),
      grade.feedback,
      now,
    );

    const updatedSkills = updateSkillsFromAttempt({
      store: s,
      exerciseId: exId,
      skillIds: ref.exercise.skills,
      passed: grade.passed,
      usedHint: Boolean(body.usedHint),
      revealedSolution: Boolean(body.revealedSolution),
      source: ref.exercise.type === "explain" ? "self" : "exercise",
      db,
    });

    recordStudyActivity("exercise", exId, 6, db);

    let lessonCompleted = false;
    if (ref.lessonId) {
      lessonCompleted = checkAndMarkLessonCompletion(s, ref.lessonId, db);
    }

    return c.json({
      grade,
      updatedSkills,
      lessonCompleted,
    });
  });

  app.post("/api/exercises/:id/reveal", (c) => {
    const s = store();
    const exId = c.req.param("id");
    const ref = s.exercises.get(exId);
    if (!ref) return c.json({ error: `Exercise '${exId}' not found` }, 404);

    const ex = ref.exercise;
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO exercise_attempts
       (exercise_id, lesson_id, passed, used_hint, revealed_solution, self_assessed, answer_json, feedback, created_at)
       VALUES (?, ?, 0, 1, 1, 0, '"revealed"', 'Həll nümunəsi açıldı (Demonstrated sübutu kimi sayılmır).', ?)`,
    ).run(exId, ref.lessonId ?? null, now);

    let solutionView: unknown = null;
    switch (ex.type) {
      case "code":
        solutionView = ex.solution;
        break;
      case "explain":
        solutionView = ex.model_answer;
        break;
      case "mcq":
        solutionView = ex.answer;
        break;
      case "multi":
        solutionView = ex.answers;
        break;
      case "numeric":
        solutionView = ex.answer;
        break;
      case "text":
        solutionView = ex.accepted[0];
        break;
      case "order":
        solutionView = ex.answer;
        break;
    }

    return c.json({
      solution: solutionView,
      explanation: ex.explanation,
    });
  });

  // ---- Practice Lab ----
  app.get("/api/practice", (c) => {
    const s = store();
    const db = getDb();

    const attemptStats = db
      .prepare(
        `SELECT exercise_id,
                COUNT(*) AS attempts,
                SUM(CASE WHEN passed = 1 AND revealed_solution = 0 THEN 1 ELSE 0 END) AS unaided_passes,
                SUM(CASE WHEN passed = 0 AND revealed_solution = 0 THEN 1 ELSE 0 END) AS fails,
                MAX(created_at) AS last_at
         FROM exercise_attempts
         GROUP BY exercise_id`,
      )
      .all() as Array<{
      exercise_id: string;
      attempts: number;
      unaided_passes: number;
      fails: number;
      last_at: string;
    }>;

    const statsById = new Map(attemptStats.map((a) => [a.exercise_id, a]));

    const items = s.practiceExercises().map((ref) => {
      const st = statsById.get(ref.id);
      const lessonTitle = ref.lessonId ? s.lessons.get(ref.lessonId)?.title ?? null : null;
      return {
        exercise: sanitizeExercise(ref.exercise),
        sourceKind: ref.kind,
        lessonId: ref.lessonId ?? null,
        lessonTitle,
        topic: ref.topic ?? null,
        stats: {
          attempts: Number(st?.attempts ?? 0),
          passedUnaided: Number(st?.unaided_passes ?? 0) > 0,
          fails: Number(st?.fails ?? 0),
          recurringMistake:
            Number(st?.fails ?? 0) >= 2 && Number(st?.unaided_passes ?? 0) === 0,
          lastAttemptAt: st?.last_at ?? null,
        },
      };
    });

    return c.json({ exercises: items });
  });

  // ---- Projects Workspace ----
  app.post("/api/projects/:id/activate", (c) => {
    const s = store();
    const projectId = c.req.param("id");
    if (!s.projects.has(projectId)) return c.json({ error: "Project not found" }, 404);
    const db = getDb();
    db.prepare("UPDATE user_profile SET active_project_id = ?, updated_at = ? WHERE id = 1").run(
      projectId,
      new Date().toISOString(),
    );
    return c.json({ activeProjectId: projectId });
  });

  app.post("/api/projects/:id/milestones/:milestoneId", async (c) => {
    const s = store();
    const projectId = c.req.param("id");
    const milestoneId = c.req.param("milestoneId");
    const project = s.projects.get(projectId);
    if (!project) return c.json({ error: "Project not found" }, 404);
    const milestone = project.milestones.find((m) => m.id === milestoneId);
    if (!milestone) return c.json({ error: "Milestone not found" }, 404);

    const body = await readBody(c, schemas.milestone);

    const checked = Array.isArray(body.checkedTasks) ? body.checkedTasks : [];
    const notes = String(body.notes ?? "");
    const evidence = String(body.evidence ?? "").trim();

    let status = checked.length > 0 || notes || evidence ? "in_progress" : "not_started";
    let warning: string | null = null;

    if (body.markComplete) {
      if (checked.length < milestone.tasks.length) {
        warning = "Milestone-u tamamlamaq üçün bütün tapşırıq bəndlərini (checklist) yerinə yetirməlisən.";
      } else if (evidence.length < 15) {
        warning =
          "Sübut (Evidence) qeyd edilmədən milestone tamamlanmış sayıla bilməz! (Test nəticəsi, Git commit, metrik cədvəli və ya qısa texniki xülasə əlavə et).";
      } else {
        status = "completed";
      }
    }

    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO project_progress
       (project_id, milestone_id, status, checked_tasks_json, notes, evidence, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, milestone_id) DO UPDATE SET
         status = excluded.status,
         checked_tasks_json = excluded.checked_tasks_json,
         notes = excluded.notes,
         evidence = excluded.evidence,
         updated_at = excluded.updated_at`,
    ).run(projectId, milestoneId, status, JSON.stringify(checked), notes, evidence, now);

    if (status === "completed") {
      recordStudyActivity("project_milestone", `${projectId}:${milestoneId}`, 15, db);
      // Completing a project milestone with real evidence also counts as practice toward its skills
      for (const sk of milestone.skills) {
        updateSkillsFromAttempt({
          store: s,
          exerciseId: `proj-${projectId}-${milestoneId}`,
          skillIds: [sk],
          passed: true,
          usedHint: false,
          revealedSolution: false,
          source: "project",
          db,
        });
      }
    }

    return c.json({
      projectId,
      milestoneId,
      status,
      checkedTasks: checked,
      notes,
      evidence,
      warning,
      updatedAt: now,
    });
  });

  // ---- Notes & Bookmarks ----
  app.post("/api/notes", async (c) => {
    const body = await readBody(c, schemas.note);
    const s = store();
    if (!s.lessons.has(body.lessonId)) {
      throw new ApiError(404, `Lesson '${body.lessonId}' not found`);
    }
    const content = body.content;
    const db = getDb();
    const now = new Date().toISOString();

    if (body.id) {
      db.prepare("UPDATE notes SET content = ?, tags = ?, updated_at = ? WHERE id = ?").run(
        content,
        body.tags ?? "",
        now,
        body.id,
      );
      return c.json({ id: body.id, lessonId: body.lessonId, sectionId: body.sectionId ?? null, tags: body.tags ?? "", content, updated_at: now });
    }

    const res = db
      .prepare(
        "INSERT INTO notes (lesson_id, section_id, tags, content, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(body.lessonId, body.sectionId ?? null, body.tags ?? "", content, now);
    return c.json({
      id: Number(res.lastInsertRowid),
      lesson_id: body.lessonId,
      section_id: body.sectionId ?? null,
      tags: body.tags ?? "",
      content,
      updated_at: now,
    });
  });

  app.delete("/api/notes/:id", (c) => {
    const id = Number(c.req.param("id"));
    getDb().prepare("DELETE FROM notes WHERE id = ?").run(id);
    return c.json({ ok: true });
  });

  app.post("/api/bookmarks", async (c) => {
    const body = await readBody(c, schemas.bookmark);
    const db = getDb();
    const now = new Date().toISOString();
    const existing = db
      .prepare(
        "SELECT id FROM bookmarks WHERE target_type = ? AND target_id = ? AND COALESCE(section_id, '') = COALESCE(?, '')",
      )
      .get(body.targetType, body.targetId, body.sectionId ?? null) as { id: number } | undefined;

    if (existing) {
      db.prepare("DELETE FROM bookmarks WHERE id = ?").run(existing.id);
      return c.json({ bookmarked: false, id: existing.id });
    }

    const res = db
      .prepare(
        "INSERT INTO bookmarks (target_type, target_id, section_id, label, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(body.targetType, body.targetId, body.sectionId ?? null, body.label, now);
    return c.json({ bookmarked: true, id: Number(res.lastInsertRowid) });
  });

  app.delete("/api/bookmarks/:id", (c) => {
    const id = Number(c.req.param("id"));
    getDb().prepare("DELETE FROM bookmarks WHERE id = ?").run(id);
    return c.json({ ok: true });
  });

  // ---- AI Mentor ----
  app.get("/api/mentor/history", (c) => {
    const contextType = c.req.query("contextType") || "global";
    const contextId = c.req.query("contextId") || "main";
    const row = getDb()
      .prepare(
        "SELECT messages_json, updated_at FROM mentor_conversations WHERE context_type = ? AND context_id = ?",
      )
      .get(contextType, contextId) as { messages_json: string; updated_at: string } | undefined;

    return c.json({
      contextType,
      contextId,
      messages: row ? JSON.parse(row.messages_json) : [],
      updatedAt: row?.updated_at ?? null,
      status: tutorProvider.getStatus(),
      retentionPolicy:
        "Yalnız seçilmiş mövzu üzrə son 30 mesaj lokal SQLite bazasında saxlanılır. İstənilən vaxt tarixçəni silə bilərsən.",
    });
  });

  app.post("/api/mentor/ask", async (c) => {
    if (!checkMentorRateLimit()) {
      return c.json(
        { error: "Sorğu limiti (dəqiqədə 30 sorğu) aşılıb. Bir neçə saniyə gözləyin." },
        429,
      );
    }
    const body = (await readBody(c, schemas.mentor)) as MentorRequest & {
      contextType?: string;
      contextId?: string;
    };
    const s = store();
    let response;
    switch (body.action) {
      case "lesson-help":
        response = await tutorProvider.generateLessonHelp(s, body);
        break;
      case "review-exercise":
        response = await tutorProvider.reviewExercise(s, body);
        break;
      case "explain-code":
        response = await tutorProvider.explainCode(s, body);
        break;
      case "study-plan":
        response = await tutorProvider.createStudyPlan(s, body);
        break;
      case "generate-exercise":
        response = await tutorProvider.generateExercise(s, body);
        break;
      case "explain-mistake":
        response = await tutorProvider.explainMistake(s, body);
        break;
      case "review-project-file":
        response = await tutorProvider.reviewProjectFile(s, body);
        break;
      default:
        response = await tutorProvider.chat(s, body);
        break;
    }

    const contextType = body.contextType || (body.context?.lessonId ? "lesson" : "global");
    const contextId = body.contextId || body.context?.lessonId || "main";
    const db = getDb();
    const now = new Date().toISOString();

    const existing = db
      .prepare(
        "SELECT messages_json FROM mentor_conversations WHERE context_type = ? AND context_id = ?",
      )
      .get(contextType, contextId) as { messages_json: string } | undefined;

    const messages: Array<{
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
    }> = existing ? JSON.parse(existing.messages_json) : [];

    messages.push({
      role: "user",
      content: body.message,
      action: body.action,
      createdAt: now,
    });
    messages.push({
      role: "assistant",
      content: response.reply,
      mode: response.mode,
      usage: response.usage ?? null,
      createdAt: now,
    });

    // Retain at most 30 messages per conversation thread
    const trimmed = messages.slice(-30);
    db.prepare(
      `INSERT INTO mentor_conversations (context_type, context_id, messages_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(context_type, context_id) DO UPDATE SET
         messages_json = excluded.messages_json,
         updated_at = excluded.updated_at`,
    ).run(contextType, contextId, JSON.stringify(trimmed), now);

    recordStudyActivity("mentor", contextId, 2, db);

    return c.json({
      ...response,
      messages: trimmed,
    });
  });

  app.delete("/api/mentor/history", (c) => {
    const contextType = c.req.query("contextType") || "global";
    const contextId = c.req.query("contextId") || "main";
    getDb()
      .prepare("DELETE FROM mentor_conversations WHERE context_type = ? AND context_id = ?")
      .run(contextType, contextId);
    return c.json({ ok: true });
  });

  // ---- Settings, Export, Import, Reset ----
  app.put("/api/settings", async (c) => {
    const body = await readBody(c, schemas.settings);
    const db = getDb();
    const current = getProfile(db);
    const now = new Date().toISOString();

    const name = body.name?.trim() || current.name;
    const goalId = body.goalId || current.goal_id;
    const weeklyHours =
      typeof body.weeklyHours === "number"
        ? Math.max(2, Math.min(40, body.weeklyHours))
        : current.weekly_hours;
    const dailyGoalMinutes =
      typeof body.dailyGoalMinutes === "number"
        ? Math.max(10, Math.min(360, body.dailyGoalMinutes))
        : current.daily_goal_minutes;
    const explanationLevel = body.explanationLevel ?? current.explanation_level;
    const socraticMode =
      typeof body.socraticMode === "boolean"
        ? body.socraticMode
          ? 1
          : 0
        : current.socratic_mode;
    const remindersEnabled =
      typeof body.remindersEnabled === "boolean"
        ? body.remindersEnabled
          ? 1
          : 0
        : current.reminders_enabled;
    const theme = body.theme === "light" || body.theme === "dark" ? body.theme : current.theme;

    db.prepare(
      `UPDATE user_profile
       SET name = ?, goal_id = ?, weekly_hours = ?, daily_goal_minutes = ?, explanation_level = ?, socratic_mode = ?, reminders_enabled = ?, theme = ?, updated_at = ?
       WHERE id = 1`,
    ).run(
      name,
      goalId,
      weeklyHours,
      dailyGoalMinutes,
      explanationLevel,
      socraticMode,
      remindersEnabled,
      theme,
      now,
    );

    return c.json({
      name,
      goalId,
      weeklyHours,
      dailyGoalMinutes,
      explanationLevel,
      socraticMode: Boolean(socraticMode),
      remindersEnabled: Boolean(remindersEnabled),
      theme,
    });
  });

  function exportAllData(db = getDb()) {
    return {
      exportedAt: new Date().toISOString(),
      version: 1 as const,
      user_profile: db.prepare("SELECT * FROM user_profile").all(),
      diagnostic_attempts: db.prepare("SELECT * FROM diagnostic_attempts").all(),
      lesson_progress: db.prepare("SELECT * FROM lesson_progress").all(),
      exercise_attempts: db.prepare("SELECT * FROM exercise_attempts").all(),
      quiz_attempts: db.prepare("SELECT * FROM quiz_attempts").all(),
      skill_mastery: db.prepare("SELECT * FROM skill_mastery").all(),
      project_progress: db.prepare("SELECT * FROM project_progress").all(),
      project_files: db.prepare("SELECT * FROM project_files").all(),
      notes: db.prepare("SELECT * FROM notes").all(),
      bookmarks: db.prepare("SELECT * FROM bookmarks").all(),
      flashcards: db.prepare("SELECT * FROM flashcards").all(),
      code_drafts: db.prepare("SELECT * FROM code_drafts").all(),
      code_snippets: db.prepare("SELECT * FROM code_snippets").all(),
      knowledge_resources: db.prepare("SELECT * FROM knowledge_resources").all(),
      mistake_reflections: db.prepare("SELECT * FROM mistake_reflections").all(),
      study_tasks: db.prepare("SELECT * FROM study_tasks").all(),
      study_sessions: db.prepare("SELECT * FROM study_sessions").all(),
      mentor_conversations: db.prepare("SELECT * FROM mentor_conversations").all(),
    };
  }

  function getBackupsDir(): string | null {
    const dbPath = getCurrentDbPath();
    if (!dbPath || dbPath === ":memory:") return null;
    return path.join(path.dirname(dbPath), "backups");
  }

  function createSafetyBackup(reason: string, db = getDb()): string | null {
    const dir = getBackupsDir();
    if (!dir) return null;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const safeReason = reason.replace(/[^a-z0-9_-]/gi, "-").slice(0, 32);
      const filename = `backup-${safeReason}-${ts}.json`;
      const fullPath = path.join(dir, filename);
      fs.writeFileSync(fullPath, JSON.stringify(exportAllData(db), null, 2), "utf-8");
      // Keep the most recent 20 snapshots
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .reverse();
      for (const stale of files.slice(20)) {
        try {
          fs.rmSync(path.join(dir, stale), { force: true });
        } catch {}
      }
      return filename;
    } catch {
      return null;
    }
  }

  function restoreValidatedBackup(data: ReturnType<typeof importSchema.parse>, db = getDb()) {
    db.exec("BEGIN TRANSACTION;");
    try {
      if (data.user_profile.length > 0) {
        const p = data.user_profile[0];
        db.prepare(
          `UPDATE user_profile
           SET name = ?, onboarded = ?, goal_id = ?, weekly_hours = ?,
               daily_goal_minutes = ?, explanation_level = ?, socratic_mode = ?,
               active_project_id = ?, last_lesson_id = ?, last_section_id = ?,
               reminders_enabled = ?, theme = ?, created_at = ?, updated_at = ?
           WHERE id = 1`,
        ).run(
          p.name,
          p.onboarded,
          p.goal_id,
          p.weekly_hours,
          p.daily_goal_minutes ?? 30,
          p.explanation_level ?? "intermediate",
          p.socratic_mode ?? 1,
          p.active_project_id,
          p.last_lesson_id,
          p.last_section_id,
          p.reminders_enabled,
          p.theme,
          p.created_at,
          p.updated_at,
        );
      }

      db.exec("DELETE FROM diagnostic_attempts;");
      const diagStmt = db.prepare(
        `INSERT INTO diagnostic_attempts
         (id, self_ratings_json, answers_json, results_json, summary_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const r of data.diagnostic_attempts) {
        diagStmt.run(
          r.id,
          r.self_ratings_json,
          r.answers_json,
          r.results_json,
          r.summary_json,
          r.created_at,
        );
      }

      db.exec("DELETE FROM lesson_progress;");
      const lpStmt = db.prepare(
        `INSERT INTO lesson_progress
         (lesson_id, status, last_section_id, understood_sections_json, unclear_sections_json, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of data.lesson_progress) {
        lpStmt.run(
          r.lesson_id,
          r.status,
          r.last_section_id,
          r.understood_sections_json,
          r.unclear_sections_json,
          r.started_at,
          r.updated_at,
        );
      }

      db.exec("DELETE FROM exercise_attempts;");
      const exStmt = db.prepare(
        `INSERT INTO exercise_attempts
         (id, exercise_id, lesson_id, passed, used_hint, revealed_solution, self_assessed, answer_json, feedback, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of data.exercise_attempts) {
        exStmt.run(
          r.id,
          r.exercise_id,
          r.lesson_id,
          r.passed,
          r.used_hint,
          r.revealed_solution,
          r.self_assessed,
          r.answer_json,
          r.feedback,
          r.created_at,
        );
      }

      db.exec("DELETE FROM quiz_attempts;");
      const qzStmt = db.prepare(
        `INSERT INTO quiz_attempts
         (id, lesson_id, score, passed, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const r of data.quiz_attempts) {
        qzStmt.run(r.id, r.lesson_id, r.score, r.passed, r.details_json, r.created_at);
      }

      db.exec("DELETE FROM skill_mastery;");
      const smStmt = db.prepare(
        `INSERT INTO skill_mastery
         (skill_id, status, distinct_passed_json, attempts_count, correct_count, fail_streak, review_interval_days, last_practiced_at, next_review_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of data.skill_mastery) {
        smStmt.run(
          r.skill_id,
          r.status,
          r.distinct_passed_json,
          r.attempts_count,
          r.correct_count,
          r.fail_streak,
          r.review_interval_days,
          r.last_practiced_at,
          r.next_review_at,
        );
      }

      db.exec("DELETE FROM project_progress;");
      const ppStmt = db.prepare(
        `INSERT INTO project_progress
         (project_id, milestone_id, status, checked_tasks_json, notes, evidence, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of data.project_progress) {
        ppStmt.run(
          r.project_id,
          r.milestone_id,
          r.status,
          r.checked_tasks_json,
          r.notes,
          r.evidence,
          r.updated_at,
        );
      }

      db.exec("DELETE FROM notes;");
      const noteStmt = db.prepare(
        `INSERT INTO notes (id, lesson_id, section_id, tags, content, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const r of data.notes) {
        noteStmt.run(r.id, r.lesson_id, r.section_id, r.tags ?? "", r.content, r.updated_at);
      }

      db.exec("DELETE FROM bookmarks;");
      const bmStmt = db.prepare(
        `INSERT INTO bookmarks (id, target_type, target_id, section_id, label, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const r of data.bookmarks) {
        bmStmt.run(r.id, r.target_type, r.target_id, r.section_id, r.label, r.created_at);
      }

      db.exec("DELETE FROM study_sessions;");
      const ssStmt = db.prepare(
        `INSERT INTO study_sessions (id, day_iso, activity_type, ref_id, minutes, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const r of data.study_sessions) {
        ssStmt.run(r.id, r.day_iso, r.activity_type, r.ref_id, r.minutes, r.created_at);
      }

      if (data.mentor_conversations) {
        db.exec("DELETE FROM mentor_conversations;");
        const mcStmt = db.prepare(
          `INSERT INTO mentor_conversations (id, context_type, context_id, messages_json, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        );
        for (const r of data.mentor_conversations) {
          mcStmt.run(r.id, r.context_type, r.context_id, r.messages_json, r.updated_at);
        }
      }

      if (data.flashcards) {
        db.exec("DELETE FROM flashcards;");
        const fcStmt = db.prepare(
          `INSERT INTO flashcards (id, card_key, lesson_id, front, back, tags, interval_days, ease_factor, repetitions, last_reviewed_at, next_review_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const r of data.flashcards) {
          fcStmt.run(
            Number(r.id),
            r.card_key ? String(r.card_key) : null,
            r.lesson_id ? String(r.lesson_id) : null,
            String(r.front ?? ""),
            String(r.back ?? ""),
            String(r.tags ?? ""),
            Number(r.interval_days ?? 0),
            Number(r.ease_factor ?? 2.5),
            Number(r.repetitions ?? 0),
            r.last_reviewed_at ? String(r.last_reviewed_at) : null,
            r.next_review_at ? String(r.next_review_at) : null,
            String(r.created_at ?? new Date().toISOString()),
          );
        }
      }

      if (data.code_snippets) {
        db.exec("DELETE FROM code_snippets;");
        const csStmt = db.prepare(
          `INSERT INTO code_snippets (id, title, language, tags, code, notes, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const r of data.code_snippets) {
          csStmt.run(
            Number(r.id),
            String(r.title ?? ""),
            String(r.language ?? "python"),
            String(r.tags ?? ""),
            String(r.code ?? ""),
            String(r.notes ?? ""),
            String(r.updated_at ?? new Date().toISOString()),
          );
        }
      }

      if (data.knowledge_resources) {
        db.exec("DELETE FROM knowledge_resources;");
        const krStmt = db.prepare(
          `INSERT INTO knowledge_resources (id, kind, title, url_or_path, tags, summary, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const r of data.knowledge_resources) {
          krStmt.run(
            Number(r.id),
            String(r.kind ?? "article"),
            String(r.title ?? ""),
            String(r.url_or_path ?? ""),
            String(r.tags ?? ""),
            String(r.summary ?? ""),
            String(r.updated_at ?? new Date().toISOString()),
          );
        }
      }

      if (data.project_files) {
        db.exec("DELETE FROM project_files;");
        const pfStmt = db.prepare(
          `INSERT INTO project_files (id, project_id, filename, language, content, ai_review, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const r of data.project_files) {
          pfStmt.run(
            Number(r.id),
            String(r.project_id ?? ""),
            String(r.filename ?? ""),
            String(r.language ?? "python"),
            String(r.content ?? ""),
            String(r.ai_review ?? ""),
            String(r.updated_at ?? new Date().toISOString()),
          );
        }
      }

      if (data.study_tasks) {
        db.exec("DELETE FROM study_tasks;");
        const stStmt = db.prepare(
          `INSERT INTO study_tasks (id, title, category, target_id, estimated_minutes, due_date, priority, completed, completed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const r of data.study_tasks) {
          stStmt.run(
            Number(r.id),
            String(r.title ?? ""),
            String(r.category ?? "custom"),
            r.target_id ? String(r.target_id) : null,
            Number(r.estimated_minutes ?? 25),
            r.due_date ? String(r.due_date) : null,
            Number(r.priority ?? 2),
            Number(r.completed ?? 0),
            r.completed_at ? String(r.completed_at) : null,
            String(r.created_at ?? new Date().toISOString()),
          );
        }
      }

      if (data.mistake_reflections) {
        db.exec("DELETE FROM mistake_reflections;");
        const mrStmt = db.prepare(
          `INSERT INTO mistake_reflections (exercise_id, takeaway, resolved, updated_at)
           VALUES (?, ?, ?, ?)`,
        );
        for (const r of data.mistake_reflections) {
          mrStmt.run(
            String(r.exercise_id ?? ""),
            String(r.takeaway ?? ""),
            Number(r.resolved ?? 0),
            String(r.updated_at ?? new Date().toISOString()),
          );
        }
      }

      if (data.code_drafts) {
        db.exec("DELETE FROM code_drafts;");
        const cdStmt = db.prepare(
          `INSERT INTO code_drafts (id, draft_key, exercise_id, title, language, code, stdin, last_output, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const r of data.code_drafts) {
          cdStmt.run(
            Number(r.id),
            r.draft_key ? String(r.draft_key) : null,
            r.exercise_id ? String(r.exercise_id) : null,
            String(r.title ?? ""),
            String(r.language ?? "python"),
            String(r.code ?? ""),
            String(r.stdin ?? ""),
            String(r.last_output ?? ""),
            String(r.updated_at ?? new Date().toISOString()),
          );
        }
      }

      db.exec("COMMIT;");
    } catch (e) {
      db.exec("ROLLBACK;");
      throw e;
    }
  }

  app.get("/api/export", (c) => {
    return c.json(exportAllData(getDb()));
  });

  function parseBackupReason(filename: string): string {
    const m = /^backup-(manual|pre-reset|pre-import|pre-restore)-[0-9]{4}-/.exec(filename);
    if (m) return m[1];
    const generic = /^backup-([a-z0-9_-]+?)-[0-9]{4}-/i.exec(filename);
    return generic ? generic[1] : "snapshot";
  }

  app.get("/api/backups", (c) => {
    const dir = getBackupsDir();
    if (!dir || !fs.existsSync(dir)) return c.json({ backups: [] });
    const backups = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return {
          filename: f,
          reason: parseBackupReason(f),
          sizeBytes: st.size,
          createdAt: st.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return c.json({ backups });
  });

  app.post("/api/backups/create", (c) => {
    const filename = createSafetyBackup("manual", getDb());
    if (!filename) {
      throw new ApiError(
        400,
        "Lokal ehtiyat nüsxəsi yalnız diskdə saxlanan SQLite bazası üçün yaradıla bilər.",
      );
    }
    return c.json({ ok: true, filename, reason: "manual" });
  });

  app.post("/api/backups/restore", async (c) => {
    const raw = (await c.req.json().catch(() => null)) as { filename?: string } | null;
    const filename = raw?.filename ?? "";
    if (!filename || !/^[a-zA-Z0-9._-]+\.json$/.test(filename)) {
      throw new ApiError(400, "Invalid backup filename");
    }
    const dir = getBackupsDir();
    if (!dir) throw new ApiError(400, "Backups are only available for file-backed SQLite databases");
    const target = path.resolve(dir, filename);
    if (!target.startsWith(path.resolve(dir) + path.sep) || !fs.existsSync(target)) {
      throw new ApiError(404, "Backup file not found");
    }
    const parsed = importSchema.parse(JSON.parse(fs.readFileSync(target, "utf-8")));
    const db = getDb();
    const safetySnapshot = createSafetyBackup("pre-restore", db);
    restoreValidatedBackup(parsed, db);
    return c.json({ ok: true, restoredFrom: filename, safetySnapshot });
  });

  app.post("/api/import", async (c) => {
    const data = await readBody(c, importSchema);
    const db = getDb();
    const safetySnapshot = createSafetyBackup("pre-import", db);
    try {
      restoreValidatedBackup(data, db);
      return c.json({ ok: true, safetySnapshot });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.post("/api/reset", (c) => {
    const db = getDb();
    const safetySnapshot = createSafetyBackup("pre-reset", db);
    const now = new Date().toISOString();
    db.exec(`
      DELETE FROM diagnostic_attempts;
      DELETE FROM lesson_progress;
      DELETE FROM exercise_attempts;
      DELETE FROM quiz_attempts;
      DELETE FROM skill_mastery;
      DELETE FROM project_progress;
      DELETE FROM project_files;
      DELETE FROM notes;
      DELETE FROM bookmarks;
      DELETE FROM flashcards;
      DELETE FROM code_drafts;
      DELETE FROM code_snippets;
      DELETE FROM knowledge_resources;
      DELETE FROM mistake_reflections;
      DELETE FROM study_tasks;
      DELETE FROM mentor_conversations;
      DELETE FROM study_sessions;
    `);
    db.prepare(
      `UPDATE user_profile
       SET onboarded = 0, active_project_id = NULL, last_lesson_id = NULL, last_section_id = NULL, updated_at = ?
       WHERE id = 1`,
    ).run(now);
    return c.json({ ok: true, safetySnapshot });
  });

  // ---- Personal University Extended Routes (Planner, Flashcards, Knowledge, SQL/Code Lab, Project Reviews) ----
  registerPersonalRoutes(app, store);

  // ---- Production static file serving (when `dist/` exists) ----
  const distDir = path.resolve(REPO_ROOT, "dist");
  if (fs.existsSync(distDir)) {
    app.get("*", (c) => {
      const reqPath = decodeURIComponent(new URL(c.req.url).pathname);
      if (reqPath.startsWith("/api/")) return c.notFound();
      const rel = reqPath === "/" ? "index.html" : reqPath.replace(/^\/+/, "");
      const candidate = path.resolve(distDir, rel);
      if (
        (candidate === distDir || candidate.startsWith(distDir + path.sep)) &&
        fs.existsSync(candidate) &&
        fs.statSync(candidate).isFile()
      ) {
        const ext = path.extname(candidate).toLowerCase();
        const mime: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".js": "application/javascript; charset=utf-8",
          ".mjs": "application/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
          ".json": "application/json",
          ".wasm": "application/wasm",
          ".woff2": "font/woff2",
          ".woff": "font/woff",
          ".ttf": "font/ttf",
        };
        return new Response(fs.readFileSync(candidate), {
          headers: { "Content-Type": mime[ext] || "application/octet-stream" },
        });
      }
      const indexHtml = path.join(distDir, "index.html");
      if (fs.existsSync(indexHtml)) {
        return new Response(fs.readFileSync(indexHtml), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return c.notFound();
    });
  }

  return app;
}
