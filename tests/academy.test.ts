import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { checkCodeExercise } from "../server/content/codecheck.ts";
import { loadContent } from "../server/content/loader.ts";
import type { CodeExercise } from "../server/content/schema.ts";
import { resetDbForTests } from "../server/db.ts";
import {
  getSkillMasteryMap,
  gradeExercise,
  introduceSkills,
  sanitizeExercise,
  updateSkillsFromAttempt,
} from "../server/engine.ts";

const store = loadContent();

describe("Curriculum Content & Code Exercises QA", () => {
  it("loads all 8 tracks, 45 lessons, 44 skills, 8 projects, and diagnostic without error", () => {
    expect(store.tracks.length).toBe(8);
    expect(store.lessons.size).toBe(45);
    expect(store.skills.size).toBe(44);
    expect(store.projects.size).toBe(8);
    expect(store.diagnostic).not.toBeNull();
    expect(store.practiceExercises().length).toBeGreaterThanOrEqual(105);
  });

  it("strips answers, solutions, and option feedback when sanitizing exercises for the client", () => {
    for (const ref of store.exercises.values()) {
      const clean = sanitizeExercise(ref.exercise);
      expect(clean).not.toHaveProperty("answer");
      expect(clean).not.toHaveProperty("answers");
      expect(clean).not.toHaveProperty("accepted");
      expect(clean).not.toHaveProperty("solution");
      expect(clean).not.toHaveProperty("model_answer");
      if (Array.isArray(clean.options)) {
        for (const opt of clean.options as Array<Record<string, unknown>>) {
          expect(opt).not.toHaveProperty("feedback");
        }
      }
    }
  });

  it("verifies sample code exercise reference solution passes and starter fails", () => {
    const ref = store.exercises.get("ex-pyfn-min-max-scale");
    expect(ref).toBeDefined();
    const check = checkCodeExercise(ref!.exercise as CodeExercise);
    expect(check.ok).toBe(true);
    expect(check.problems).toEqual([]);
  });
});

describe("Grading & Evidence-Based Mastery Engine", () => {
  beforeEach(() => {
    resetDbForTests(":memory:");
  });

  it("grades mcq, multi, numeric, text, order, code, and explain exercises accurately", () => {
    // 1. MCQ
    const mcq = store.exercises.get("q-pyfn-sort-return")!.exercise;
    expect(gradeExercise(mcq, { answer: "b" }).passed).toBe(true);
    expect(gradeExercise(mcq, { answer: "a" }).passed).toBe(false);

    // 2. Multi
    const multi = store.exercises.get("q-pyfn-side-effects")!.exercise;
    expect(gradeExercise(multi, { answer: ["a", "b", "d"] }).passed).toBe(true);
    expect(gradeExercise(multi, { answer: ["a", "b"] }).passed).toBe(false);

    // 3. Text
    const txt = store.exercises.get("ex-pyfn-predict-aliasing")!.exercise;
    expect(gradeExercise(txt, { answer: " [0.5, 7] " }).passed).toBe(true);
    expect(gradeExercise(txt, { answer: "[50, 7]" }).passed).toBe(false);

    // 4. Numeric
    const num = store.exercises.get("diag-math-gd")!.exercise;
    expect(gradeExercise(num, { answer: "2.4" }).passed).toBe(true);
    expect(gradeExercise(num, { answer: 3.0 }).passed).toBe(false);

    // 5. Explain
    const exp = store.exercises.get("ex-pyfn-explain-skew")!.exercise;
    expect(
      gradeExercise(exp, {
        answer: { text: "Too short", checkedRubric: [0, 1, 2, 3] },
      }).passed,
    ).toBe(false);
    expect(
      gradeExercise(exp, {
        answer: {
          text: "Funksiya DataFrame-i yerində mutate edir, təkrar çağırışda income-u yenidən bölür və serving zamanı training mean əvəzinə cari sorğudan hesablayır.",
          checkedRubric: [0, 1, 2],
        },
      }).passed,
    ).toBe(true);
  });

  it("enforces evidence-based mastery: opening a lesson only introduces skills, hints/reveals block Demonstrated, 2 distinct unaided solves reach Demonstrated", () => {
    const db = resetDbForTests(":memory:");

    // Step 1: Opening lesson only sets status to 'introduced'
    introduceSkills(["py-functions"], db);
    expect(getSkillMasteryMap(store, db)["py-functions"].status).toBe("introduced");

    // Step 2: Passing an exercise WITH a hint transitions to 'practicing', NOT 'demonstrated'
    updateSkillsFromAttempt({
      store,
      exerciseId: "ex-pyfn-min-max-scale",
      skillIds: ["py-functions"],
      passed: true,
      usedHint: true,
      revealedSolution: false,
      db,
    });
    expect(getSkillMasteryMap(store, db)["py-functions"].status).toBe("practicing");

    // Step 3: First unaided pass on exercise #1 -> still 'practicing' (needs 2 distinct exercises)
    updateSkillsFromAttempt({
      store,
      exerciseId: "ex-pyfn-min-max-scale",
      skillIds: ["py-functions"],
      passed: true,
      usedHint: false,
      revealedSolution: false,
      db,
    });
    expect(getSkillMasteryMap(store, db)["py-functions"].status).toBe("practicing");

    // Step 4: Second unaided pass on a DISTINCT exercise (#2) -> 'demonstrated' + spaced review scheduled!
    updateSkillsFromAttempt({
      store,
      exerciseId: "ex-pyfn-fix-mutable-default",
      skillIds: ["py-functions"],
      passed: true,
      usedHint: false,
      revealedSolution: false,
      db,
    });
    const afterDem = getSkillMasteryMap(store, db)["py-functions"];
    expect(afterDem.status).toBe("demonstrated");
    expect(afterDem.next_review_at).not.toBeNull();

    // Step 5: Failing an exercise on a demonstrated skill moves it to 'needs_review'
    updateSkillsFromAttempt({
      store,
      exerciseId: "ex-pyfn-predict-aliasing",
      skillIds: ["py-functions"],
      passed: false,
      usedHint: false,
      revealedSolution: false,
      db,
    });
    expect(getSkillMasteryMap(store, db)["py-functions"].status).toBe("needs_review");
  });
});

describe("HTTP API End-to-End Journeys", () => {
  beforeEach(() => {
    resetDbForTests(":memory:");
  });

  it("starts with an honest un-onboarded state and processes diagnostic submission", async () => {
    const app = createApp(store);

    const boot1 = await (await app.request("/api/bootstrap")).json();
    expect(boot1.profile.onboarded).toBe(false);
    expect(boot1.dashboard.completedLessonsTotal).toBe(0);
    expect(boot1.dashboard.skillsMap.strong.length).toBe(0);

    const diagRes = await app.request("/api/diagnostic/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Orxan",
        goalId: "broad-ai-engineering",
        weeklyHours: 10,
        selfRatings: {
          python: 3,
          software: 2,
          math: 2,
          "classical-ml": 1,
          "deep-learning": 0,
          llm: 1,
          deployment: 0,
        },
        answers: {
          "diag-py-dict-get": "2",
          "diag-py-mutable-default": "b",
          "diag-math-dot": 1,
          "diag-dl-zero-grad": "dont_know",
        },
      }),
    });
    expect(diagRes.status).toBe(200);
    const diagBody = await diagRes.json();
    expect(diagBody.summary.strongAreas.some((a: { areaId: string }) => a.areaId === "python")).toBe(
      true,
    );
    expect(diagBody.summary.firstThreeActions.length).toBe(3);

    const boot2 = await (await app.request("/api/bootstrap")).json();
    expect(boot2.profile.onboarded).toBe(true);
    expect(boot2.profile.name).toBe("Orxan");
  });

  it("tracks lesson sections, grades quiz & exercises, and marks lesson completed only when both quiz and exercise pass", async () => {
    const app = createApp(store);

    // Open lesson
    const lRes = await app.request("/api/lessons/py-functions-contracts");
    expect(lRes.status).toBe(200);

    // Mark section understood
    const secRes = await app.request("/api/lessons/py-functions-contracts/section", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionId: "contract-idea", mark: "understood" }),
    });
    const secBody = await secRes.json();
    expect(secBody.understoodSections).toContain("contract-idea");

    // Submit passing quiz
    const quizRes = await app.request("/api/lessons/py-functions-contracts/quiz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: {
          "q-pyfn-sort-return": "b",
          "q-pyfn-type-hints": "b",
          "q-pyfn-side-effects": ["a", "b", "d"],
          "q-pyfn-mutable-default": "[1, 2]",
        },
      }),
    });
    const quizBody = await quizRes.json();
    expect(quizBody.passed).toBe(true);
    // Lesson not yet completed because no exercise has been solved yet!
    expect(quizBody.lessonCompleted).toBe(false);

    // Now solve an exercise in the lesson
    const exRes = await app.request("/api/exercises/ex-pyfn-predict-aliasing/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: "[0.5, 7]", usedHint: false }),
    });
    const exBody = await exRes.json();
    expect(exBody.grade.passed).toBe(true);
    expect(exBody.lessonCompleted).toBe(true);
  });

  it("blocks marking a project milestone complete without evidence and succeeds when evidence is recorded", async () => {
    const app = createApp(store);
    const proj = store.projects.get("tabular-ml-prediction")!;
    const ms = proj.milestones[0];
    const allTasks = ms.tasks.map((_, i) => i);

    // Attempt to complete without evidence
    const res1 = await app.request(
      `/api/projects/tabular-ml-prediction/milestones/${ms.id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkedTasks: allTasks,
          notes: "Done",
          evidence: "",
          markComplete: true,
        }),
      },
    );
    const body1 = await res1.json();
    expect(body1.status).toBe("in_progress");
    expect(body1.warning).toBeTruthy();

    // Now provide real evidence
    const res2 = await app.request(
      `/api/projects/tabular-ml-prediction/milestones/${ms.id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkedTasks: allTasks,
          notes: "Chronological split implemented",
          evidence: "Train: 2024-01..09 (12,400 rows), Val: 2024-10 (1,550 rows), Test: 2024-11 (1,610 rows). 0 leakage columns.",
          markComplete: true,
        }),
      },
    );
    const body2 = await res2.json();
    expect(body2.status).toBe("completed");
    expect(body2.warning).toBeNull();
  });

  it("provides a clearly-labelled offline demo AI Mentor response when no API key is configured", async () => {
    const prevProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "demo";
    try {
      const app = createApp(store);
      const res = await app.request("/api/mentor/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "lesson-help",
          message: "Mutable default argument niyə təhlükəlidir?",
          context: { lessonId: "py-functions-contracts" },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.mode).toBe("demo-no-key");
      expect(body.reply).toContain("Demo Mentor Rejimi");
      expect(body.messages.length).toBe(2);
    } finally {
      if (prevProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = prevProvider;
    }
  });
});
