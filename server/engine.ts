/**
 * Core pedagogical engine:
 * - Server-side exercise & quiz grading
 * - Sanitization of exercises sent to the client (answers hidden until solved/revealed)
 * - Evidence-based skill mastery state machine & spaced review scheduler
 * - Diagnostic evaluation & adaptive study plan generator
 */
import type { DatabaseSync } from "node:sqlite";
import type { ContentStore } from "./content/loader.ts";
import type { Exercise, Lesson, QuizQuestion } from "./content/schema.ts";
import { getDb, recordStudyActivity, type MasteryStatus, type SkillMasteryRow } from "./db.ts";

// ---------------------------------------------------------------------------
// 1. Exercise sanitization (hide answers from initial payload)
// ---------------------------------------------------------------------------

export function sanitizeExercise(ex: Exercise | QuizQuestion): Record<string, unknown> {
  const base = {
    id: ex.id,
    type: ex.type,
    title: ex.title,
    prompt: ex.prompt,
    skills: ex.skills,
    category: ex.category,
    difficulty: ex.difficulty,
    hints: ex.hints,
  };

  switch (ex.type) {
    case "mcq":
    case "multi":
      return {
        ...base,
        options: ex.options.map((o) => ({ id: o.id, text: o.text })),
      };
    case "numeric":
      return {
        ...base,
        unit: ex.unit ?? null,
        tolerance: ex.tolerance,
      };
    case "text":
      return {
        ...base,
        case_sensitive: ex.case_sensitive,
      };
    case "order":
      return {
        ...base,
        // Deterministic shuffle so the client doesn't receive items in the exact answer order
        items: deterministicShuffle(ex.items, ex.id),
      };
    case "code":
      return {
        ...base,
        starter_code: ex.starter_code,
        tests: ex.tests,
      };
    case "explain":
      return {
        ...base,
        rubric: ex.rubric,
      };
  }
}

function deterministicShuffle<T extends { id: string }>(items: T[], seed: string): T[] {
  const copy = [...items];
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (let i = copy.length - 1; i > 0; i--) {
    h ^= i + 1;
    h = Math.imul(h, 16777619);
    const j = Math.abs(h) % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  if (copy.length > 1 && copy.every((item, idx) => item.id === items[idx].id)) {
    [copy[0], copy[1]] = [copy[1], copy[0]];
  }
  return copy;
}

export function sanitizeLesson(lesson: Lesson): Record<string, unknown> {
  return {
    ...lesson,
    quiz: {
      pass_threshold: lesson.quiz.pass_threshold,
      questions: lesson.quiz.questions.map(sanitizeExercise),
    },
    exercises: lesson.exercises.map(sanitizeExercise),
  };
}

// ---------------------------------------------------------------------------
// 2. Exercise Grading
// ---------------------------------------------------------------------------

export interface SubmissionPayload {
  answer: unknown;
  usedHint?: boolean;
  revealedSolution?: boolean;
}

export interface GradeResult {
  passed: boolean;
  feedback: string;
  explanation?: string;
  optionFeedback?: Record<string, string>;
  rubric?: string[];
  modelAnswer?: string;
  expected?: unknown;
}

function normText(s: string, caseSensitive: boolean, collapseWs: boolean): string {
  let out = s.trim();
  if (collapseWs) out = out.replace(/\s+/g, " ");
  if (!caseSensitive) out = out.toLowerCase();
  return out;
}

export function gradeExercise(
  ex: Exercise | QuizQuestion,
  payload: SubmissionPayload,
): GradeResult {
  const ans = payload.answer;

  switch (ex.type) {
    case "mcq": {
      const choice = typeof ans === "string" ? ans.trim() : "";
      const opt = ex.options.find((o) => o.id === choice);
      if (!opt) {
        return {
          passed: false,
          feedback: "Seçim göndərilməyib və ya yanlış seçim identifikatoru.",
        };
      }
      const passed = choice === ex.answer;
      return {
        passed,
        feedback: opt.feedback,
        explanation: passed ? ex.explanation : undefined,
        optionFeedback: { [opt.id]: opt.feedback },
      };
    }

    case "multi": {
      const selected = Array.isArray(ans) ? ans.map(String) : [];
      const selectedSet = new Set(selected);
      const expectedSet = new Set(ex.answers);
      const passed =
        selectedSet.size === expectedSet.size &&
        [...expectedSet].every((id) => selectedSet.has(id));

      const optionFeedback: Record<string, string> = {};
      for (const o of ex.options) {
        if (selectedSet.has(o.id)) {
          optionFeedback[o.id] = o.feedback;
        }
      }
      const missingCount = [...expectedSet].filter((id) => !selectedSet.has(id)).length;
      const wrongCount = [...selectedSet].filter((id) => !expectedSet.has(id)).length;

      let feedback = passed
        ? "Tam doğrudur! Bütün düzgün variantları seçdin."
        : `Hələ tam deyil: ${wrongCount > 0 ? `${wrongCount} yanlış seçim var. ` : ""}${
            missingCount > 0 ? `${missingCount} düzgün seçim çatışmır.` : ""
          }`.trim();

      return {
        passed,
        feedback,
        explanation: passed ? ex.explanation : undefined,
        optionFeedback,
      };
    }

    case "numeric": {
      const num = typeof ans === "number" ? ans : Number(String(ans ?? "").replace(",", ".").trim());
      if (!Number.isFinite(num)) {
        return {
          passed: false,
          feedback: "Ədədi dəyər daxil et (məsələn: 0.75 və ya 2.4).",
        };
      }
      const diff = Math.abs(num - ex.answer);
      const passed = diff <= ex.tolerance + 1e-9;
      return {
        passed,
        feedback: passed
          ? `Doğrudur (${num}${ex.unit ? " " + ex.unit : ""}).`
          : `Cavab (${num}) gözlənilən dəyərdən fərqlidir. Hesablama addımlarını yenidən yoxla.`,
        explanation: passed ? ex.explanation : undefined,
      };
    }

    case "text": {
      const raw = typeof ans === "string" ? ans : String(ans ?? "");
      if (!raw.trim()) {
        return { passed: false, feedback: "Cavab boş ola bilməz." };
      }
      const normalized = normText(raw, ex.case_sensitive, ex.normalize_whitespace);
      const passed = ex.accepted.some(
        (acc) => normText(acc, ex.case_sensitive, ex.normalize_whitespace) === normalized,
      );
      return {
        passed,
        feedback: passed
          ? "Doğru cavab!"
          : `Cavab ("${raw.trim()}") gözlənilən nəticə ilə üst-üstə düşmür. Tip və formatı (məs. mötərizə, boşluq) diqqətlə yoxla.`,
        explanation: passed ? ex.explanation : undefined,
      };
    }

    case "order": {
      const seq = Array.isArray(ans) ? ans.map(String) : [];
      if (seq.length !== ex.answer.length) {
        return { passed: false, feedback: "Bütün addımları sıralamalısan." };
      }
      let correctPositions = 0;
      for (let i = 0; i < ex.answer.length; i++) {
        if (seq[i] === ex.answer[i]) correctPositions++;
      }
      const passed = correctPositions === ex.answer.length;
      return {
        passed,
        feedback: passed
          ? "Ardıcıllıq tam doğrudur!"
          : `${ex.answer.length} addımdan ${correctPositions}-i öz yerindədir. Ardıcıllığı yenidən nəzərdən keçir.`,
        explanation: passed ? ex.explanation : undefined,
      };
    }

    case "code": {
      // Browser Pyodide worker runs the tests and submits `{ code, testResults }`.
      const obj = (ans && typeof ans === "object" ? ans : {}) as {
        code?: string;
        testResults?: Array<{ name: string; passed: boolean; error: string | null }>;
      };
      const results = Array.isArray(obj.testResults) ? obj.testResults : [];
      if (results.length < ex.tests.length) {
        return {
          passed: false,
          feedback: "Kod testləri tam icra olunmayıb. Əvvəlcə 'Run & Test' ilə testləri işə sal.",
        };
      }
      const failed = results.filter((r) => !r.passed);
      const passed = failed.length === 0;
      return {
        passed,
        feedback: passed
          ? `Bütün ${ex.tests.length} test uğurla keçdi!`
          : `${ex.tests.length} testdən ${failed.length}-i uğursuz oldu: ${failed
              .map((f) => `${f.name} (${f.error ?? "failed"})`)
              .join("; ")}`,
        explanation: passed ? ex.explanation : undefined,
      };
    }

    case "explain": {
      const obj = (ans && typeof ans === "object" ? ans : { text: String(ans ?? "") }) as {
        text?: string;
        checkedRubric?: number[];
      };
      const text = (obj.text ?? "").trim();
      const checked = Array.isArray(obj.checkedRubric) ? obj.checkedRubric : [];
      if (text.length < 25) {
        return {
          passed: false,
          feedback: "İzah çox qısadır. Ən azı 1-2 cümlə ilə səbəbi və həlli öz sözlərinlə yaz.",
          rubric: ex.rubric,
        };
      }
      const minRequired = Math.max(1, Math.ceil(ex.rubric.length * 0.75));
      const passed = checked.length >= minRequired;
      return {
        passed,
        feedback: passed
          ? `Özünü-yoxlama tamamlandı (${checked.length}/${ex.rubric.length} meyar). Nümunə cavabla öz izahını müqayisə et.`
          : `Meyarlardan ən azı ${minRequired}-ni qarşıladığını yoxla və izahını təkmilləşdir (${checked.length}/${ex.rubric.length} seçilib).`,
        explanation: ex.explanation,
        rubric: ex.rubric,
        modelAnswer: ex.model_answer,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Mastery & Spaced Review State Machine
// ---------------------------------------------------------------------------

const REVIEW_INTERVALS = [3, 7, 21, 60];

function addDaysIso(nowIso: string, days: number): string {
  const d = new Date(nowIso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export function getSkillMasteryMap(
  store: ContentStore,
  db: DatabaseSync = getDb(),
): Record<string, SkillMasteryRow> {
  const rows = db.prepare("SELECT * FROM skill_mastery").all() as unknown as SkillMasteryRow[];
  const byId: Record<string, SkillMasteryRow> = {};
  for (const r of rows) {
    byId[r.skill_id] = r;
  }
  for (const skillId of store.skills.keys()) {
    if (!byId[skillId]) {
      byId[skillId] = {
        skill_id: skillId,
        status: "not_started",
        distinct_passed_json: "[]",
        attempts_count: 0,
        correct_count: 0,
        fail_streak: 0,
        review_interval_days: 0,
        last_practiced_at: null,
        next_review_at: null,
      };
    }
  }
  return byId;
}

/**
 * Opening a lesson introduces its skills (`not_started` -> `introduced`),
 * never marking them `practicing` or `demonstrated`.
 */
export function introduceSkills(skillIds: string[], db: DatabaseSync = getDb()): void {
  const stmt = db.prepare(
    `INSERT INTO skill_mastery (skill_id, status, distinct_passed_json, attempts_count, correct_count, fail_streak, review_interval_days)
     VALUES (?, 'introduced', '[]', 0, 0, 0, 0)
     ON CONFLICT(skill_id) DO UPDATE SET
       status = CASE WHEN skill_mastery.status = 'not_started' THEN 'introduced' ELSE skill_mastery.status END`,
  );
  for (const id of skillIds) {
    stmt.run(id);
  }
}

/**
 * Where a piece of evidence came from. Only `exercise` (auto-graded practice) and
 * `project` (milestone with recorded evidence) can count toward "Demonstrated".
 * `quiz` (comprehension check right after reading), `diagnostic` (placement) and
 * `self` (self-graded rubric) can raise a skill to "Practicing" but never prove it.
 */
export type EvidenceSource = "exercise" | "quiz" | "diagnostic" | "project" | "self";

export interface MasteryUpdateOptions {
  store: ContentStore;
  exerciseId: string;
  skillIds: string[];
  passed: boolean;
  usedHint: boolean;
  revealedSolution: boolean;
  source?: EvidenceSource;
  db?: DatabaseSync;
}

/** Number of auto-graded practice exercises available for a skill (the ones that can prove it). */
function provableExerciseCount(store: ContentStore, skillId: string): number {
  let n = 0;
  for (const ref of store.exercises.values()) {
    if (ref.kind !== "lesson" && ref.kind !== "practice") continue;
    if (ref.exercise.type === "explain") continue;
    if (ref.exercise.skills.includes(skillId)) n++;
  }
  return n;
}

export function updateSkillsFromAttempt(opts: MasteryUpdateOptions): SkillMasteryRow[] {
  const db = opts.db ?? getDb();
  const nowIso = new Date().toISOString();
  const source: EvidenceSource = opts.source ?? "exercise";
  const canProve = source === "exercise" || source === "project";
  const unaidedPass = opts.passed && !opts.usedHint && !opts.revealedSolution;
  const provingPass = unaidedPass && canProve;
  const updated: SkillMasteryRow[] = [];

  for (const skillId of opts.skillIds) {
    const existing = db
      .prepare("SELECT * FROM skill_mastery WHERE skill_id = ?")
      .get(skillId) as unknown as SkillMasteryRow | undefined;

    const distinctSet = new Set<string>(
      existing ? (JSON.parse(existing.distinct_passed_json) as string[]) : [],
    );
    if (provingPass) {
      distinctSet.add(opts.exerciseId);
    }

    const attemptsCount = (existing?.attempts_count ?? 0) + 1;
    const correctCount = (existing?.correct_count ?? 0) + (opts.passed ? 1 : 0);
    const failStreak = opts.passed ? 0 : (existing?.fail_streak ?? 0) + 1;

    // "Demonstrated" needs 2 distinct unaided solves; if the curriculum only has
    // one provable exercise for a skill, 1 is accepted (never fewer than 1).
    const requiredDistinct = Math.max(1, Math.min(2, provableExerciseCount(opts.store, skillId)));

    let status: MasteryStatus = existing?.status ?? "not_started";
    let intervalDays = existing?.review_interval_days ?? 0;
    let nextReviewAt = existing?.next_review_at ?? null;

    if (!opts.passed) {
      if (failStreak >= 2 || status === "demonstrated") {
        status = "needs_review";
        intervalDays = 1;
        nextReviewAt = addDaysIso(nowIso, 1);
      } else if (status === "not_started" || status === "introduced") {
        status = "practicing";
      }
    } else {
      if (distinctSet.size >= requiredDistinct && provingPass) {
        status = "demonstrated";
        const nextIdx = REVIEW_INTERVALS.findIndex((d) => d > intervalDays);
        intervalDays =
          nextIdx >= 0 ? REVIEW_INTERVALS[nextIdx] : REVIEW_INTERVALS[REVIEW_INTERVALS.length - 1];
        nextReviewAt = addDaysIso(nowIso, intervalDays);
      } else if (status === "needs_review" && provingPass) {
        status = "practicing";
        intervalDays = 3;
        nextReviewAt = addDaysIso(nowIso, 3);
      } else if (status !== "demonstrated" && status !== "needs_review") {
        status = "practicing";
      }
    }

    const distinctJson = JSON.stringify([...distinctSet]);
    db.prepare(
      `INSERT INTO skill_mastery
       (skill_id, status, distinct_passed_json, attempts_count, correct_count, fail_streak, review_interval_days, last_practiced_at, next_review_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(skill_id) DO UPDATE SET
         status = excluded.status,
         distinct_passed_json = excluded.distinct_passed_json,
         attempts_count = excluded.attempts_count,
         correct_count = excluded.correct_count,
         fail_streak = excluded.fail_streak,
         review_interval_days = excluded.review_interval_days,
         last_practiced_at = excluded.last_practiced_at,
         next_review_at = excluded.next_review_at`,
    ).run(
      skillId,
      status,
      distinctJson,
      attemptsCount,
      correctCount,
      failStreak,
      intervalDays,
      nowIso,
      nextReviewAt,
    );

    updated.push({
      skill_id: skillId,
      status,
      distinct_passed_json: distinctJson,
      attempts_count: attemptsCount,
      correct_count: correctCount,
      fail_streak: failStreak,
      review_interval_days: intervalDays,
      last_practiced_at: nowIso,
      next_review_at: nextReviewAt,
    });
  }

  return updated;
}

// ---------------------------------------------------------------------------
// 4. Diagnostic Evaluation & Study Plan Generation
// ---------------------------------------------------------------------------

export interface DiagnosticSubmission {
  name?: string;
  goalId: string;
  weeklyHours: number;
  // areaId -> 0 ("I don't know") | 1 (beginner) | 2 (familiar) | 3 (confident)
  selfRatings: Record<string, number>;
  // questionId -> answer value or "dont_know"
  answers: Record<string, unknown>;
}

export interface DiagnosticAreaEvaluation {
  areaId: string;
  title: string;
  selfRating: number;
  checksTotal: number;
  checksCorrect: number;
  classification: "strong" | "partial" | "missing";
  note: string;
  relatedModules: string[];
}

export interface DiagnosticSummary {
  goalId: string;
  weeklyHours: number;
  strongAreas: DiagnosticAreaEvaluation[];
  partialAreas: DiagnosticAreaEvaluation[];
  missingAreas: DiagnosticAreaEvaluation[];
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

export function evaluateDiagnostic(
  store: ContentStore,
  sub: DiagnosticSubmission,
  db: DatabaseSync = getDb(),
): {
  results: Record<string, { passed: boolean; skipped: boolean; feedback: string; explanation: string }>;
  summary: DiagnosticSummary;
} {
  const diag = store.diagnostic;
  if (!diag) throw new Error("Diagnostic content not loaded");

  const results: Record<
    string,
    { passed: boolean; skipped: boolean; feedback: string; explanation: string }
  > = {};
  const byArea: Record<string, { total: number; correct: number }> = {};

  for (const a of diag.areas) {
    byArea[a.id] = { total: 0, correct: 0 };
  }

  for (const chk of diag.checks) {
    const q = chk.question;
    const rawAns = sub.answers[q.id];
    const skipped =
      rawAns === undefined ||
      rawAns === null ||
      rawAns === "" ||
      rawAns === "dont_know";

    byArea[chk.area].total += 1;

    if (skipped) {
      results[q.id] = {
        passed: false,
        skipped: true,
        feedback: "'Bilmirəm' seçildi — bu mövzu tədris planına əlavə olundu.",
        explanation: q.explanation,
      };
      introduceSkills(q.skills, db);
    } else {
      const graded = gradeExercise(q, { answer: rawAns });
      results[q.id] = {
        passed: graded.passed,
        skipped: false,
        feedback: graded.feedback,
        explanation: q.explanation,
      };
      if (graded.passed) {
        byArea[chk.area].correct += 1;
      }
      // Practical check initializes skill to 'practicing' (never 'demonstrated' from 1 check alone)
      updateSkillsFromAttempt({
        store,
        exerciseId: q.id,
        skillIds: q.skills,
        passed: graded.passed,
        usedHint: false,
        revealedSolution: false,
        source: "diagnostic",
        db,
      });
    }
  }

  const strongAreas: DiagnosticAreaEvaluation[] = [];
  const partialAreas: DiagnosticAreaEvaluation[] = [];
  const missingAreas: DiagnosticAreaEvaluation[] = [];

  for (const a of diag.areas) {
    const selfRating = Number(sub.selfRatings[a.id] ?? 0);
    const stats = byArea[a.id] ?? { total: 0, correct: 0 };
    const ratio = stats.total > 0 ? stats.correct / stats.total : 0;

    let classification: "strong" | "partial" | "missing";
    let note: string;

    if (ratio === 1 && selfRating >= 2) {
      classification = "strong";
      note = `Praktik yoxlama (${stats.correct}/${stats.total}) özünü-qiymətləndirməni təsdiqlədi.`;
      strongAreas.push({
        areaId: a.id,
        title: a.title,
        selfRating,
        checksTotal: stats.total,
        checksCorrect: stats.correct,
        classification,
        note,
        relatedModules: a.related_modules,
      });
    } else if (ratio === 0 && selfRating <= 1) {
      classification = "missing";
      note = "Bünövrədən başlamaq tövsiyə olunur.";
      missingAreas.push({
        areaId: a.id,
        title: a.title,
        selfRating,
        checksTotal: stats.total,
        checksCorrect: stats.correct,
        classification,
        note,
        relatedModules: a.related_modules,
      });
    } else {
      classification = "partial";
      if (selfRating >= 2 && ratio < 1) {
        note = `Tanışlıq var, amma praktik sualda (${stats.correct}/${stats.total}) boşluq aşkarlandı — qısa təkrar və məşq faydalı olacaq.`;
      } else {
        note = `Qismən bilik (${stats.correct}/${stats.total} praktik sual doğru). Seçilmiş dərslərlə möhkəmləndir.`;
      }
      partialAreas.push({
        areaId: a.id,
        title: a.title,
        selfRating,
        checksTotal: stats.total,
        checksCorrect: stats.correct,
        classification,
        note,
        relatedModules: a.related_modules,
      });
    }
  }

  // Build dependency-aware study plan
  const goal =
    diag.goals.find((g) => g.id === sub.goalId) ?? diag.goals[0];
  const strongModSet = new Set(strongAreas.flatMap((a) => a.relatedModules));
  const priorityModIds = new Set<string>([
    ...missingAreas.flatMap((a) => a.relatedModules),
    ...partialAreas.flatMap((a) => a.relatedModules),
    ...goal.focus_modules,
  ]);

  const orderedModules: string[] = [];
  const visitModule = (mId: string) => {
    if (orderedModules.includes(mId)) return;
    const mod = store.modules.get(mId);
    if (!mod) return;
    for (const pre of mod.prerequisites) {
      visitModule(pre);
    }
    orderedModules.push(mId);
  };

  for (const mId of priorityModIds) {
    visitModule(mId);
  }
  for (const t of store.tracks) {
    if (t.optional) continue;
    for (const m of t.modules) {
      visitModule(m.id);
    }
  }

  const weekly = Math.max(2, Math.min(40, sub.weeklyHours || 8));
  const studyPlan: DiagnosticSummary["studyPlan"] = [];
  let phase = 1;

  for (const mId of orderedModules) {
    const mod = store.modules.get(mId);
    if (!mod) continue;
    // Skip authored modules only if learner proved strong in that area AND it's not a focus module without lessons completed
    if (strongModSet.has(mId) && !goal.focus_modules.includes(mId)) continue;
    const trackId = store.moduleTrack.get(mId) ?? "";
    const track = store.tracks.find((t) => t.id === trackId);
    const minW = Math.max(1, Math.round((mod.effort_hours[0] / weekly) * 10) / 10);
    const maxW = Math.max(minW, Math.round((mod.effort_hours[1] / weekly) * 10) / 10);

    let reason = "Məqsədin üçün əsas bünövrə modulu.";
    if (missingAreas.some((a) => a.relatedModules.includes(mId))) {
      reason = "Diaqnostikada yeni mövzu kimi qeyd olundu — sıfırdan öyrəniləcək.";
    } else if (partialAreas.some((a) => a.relatedModules.includes(mId))) {
      reason = "Praktik yoxlamada boşluq aşkarlandı — məşqlərlə möhkəmləndirilməlidir.";
    } else if (goal.focus_modules.includes(mId)) {
      reason = `"${goal.label}" hədəfi üçün birbaşa prioritetdir.`;
    }

    studyPlan.push({
      phase: phase++,
      moduleId: mod.id,
      moduleTitle: mod.title,
      trackTitle: track?.title ?? trackId,
      status: mod.status,
      effortHours: mod.effort_hours,
      estimatedWeeksRange: [minW, maxW],
      reason,
      lessonIds: mod.lessons,
    });
  }

  // First three concrete learning actions
  const firstThreeActions: DiagnosticSummary["firstThreeActions"] = [];
  const authoredLessonsInPlan = studyPlan
    .filter((p) => p.status === "authored")
    .flatMap((p) => p.lessonIds);

  if (authoredLessonsInPlan.length > 0) {
    const l1 = store.lessons.get(authoredLessonsInPlan[0]);
    if (l1) {
      firstThreeActions.push({
        type: "lesson",
        id: l1.id,
        title: `Dərs 1: ${l1.title}`,
        reason: "Səviyyənə və hədəfinə uyğun ilk tam interaktiv dərs.",
      });
    }
  }
  if (authoredLessonsInPlan.length > 1) {
    const l2 = store.lessons.get(authoredLessonsInPlan[1]);
    if (l2) {
      firstThreeActions.push({
        type: "lesson",
        id: l2.id,
        title: `Dərs 2: ${l2.title}`,
        reason: "Növbəti addımda anlayışı kod və quiz ilə yoxla.",
      });
    }
  }
  const firstProject = [...store.projects.values()][0];
  if (firstProject) {
    firstThreeActions.push({
      type: "project",
      id: firstProject.id,
      title: `Layihə: ${firstProject.title}`,
      reason: "Erkən mərhələdən kiçik, real mühəndislik layihəsinə başla.",
    });
  } else if (authoredLessonsInPlan.length > 2) {
    const l3 = store.lessons.get(authoredLessonsInPlan[2]);
    if (l3) {
      firstThreeActions.push({
        type: "lesson",
        id: l3.id,
        title: `Dərs 3: ${l3.title}`,
        reason: "Üçüncü addım kimi bu dərsi tamamla.",
      });
    }
  }

  const summary: DiagnosticSummary = {
    goalId: goal.id,
    weeklyHours: weekly,
    strongAreas,
    partialAreas,
    missingAreas,
    firstThreeActions,
    studyPlan,
  };

  // Persist diagnostic attempt and update user profile
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO diagnostic_attempts (self_ratings_json, answers_json, results_json, summary_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    JSON.stringify(sub.selfRatings),
    JSON.stringify(sub.answers),
    JSON.stringify(results),
    JSON.stringify(summary),
    now,
  );

  const recommendedLessonId = authoredLessonsInPlan[0] ?? store.lessonOrder()[0] ?? null;
  const recommendedProjectId = firstProject?.id ?? null;

  db.prepare(
    `UPDATE user_profile
     SET name = COALESCE(?, name),
         onboarded = 1,
         goal_id = ?,
         weekly_hours = ?,
         last_lesson_id = COALESCE(last_lesson_id, ?),
         active_project_id = COALESCE(active_project_id, ?),
         updated_at = ?
     WHERE id = 1`,
  ).run(
    sub.name?.trim() || null,
    goal.id,
    weekly,
    recommendedLessonId,
    recommendedProjectId,
    now,
  );

  recordStudyActivity("diagnostic", goal.id, 10, db);

  return { results, summary };
}
