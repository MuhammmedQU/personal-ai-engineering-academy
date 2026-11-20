import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { loadContent } from "../server/content/loader.ts";
import { resetDbForTests } from "../server/db.ts";
import { getSkillMasteryMap } from "../server/engine.ts";

const store = loadContent();
const post = (app: ReturnType<typeof createApp>, url: string, body: unknown) =>
  app.request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("Mastery integrity (evidence rules)", () => {
  beforeEach(() => {
    resetDbForTests(":memory:");
  });

  it("passing a lesson quiz alone must NOT make a skill Demonstrated", async () => {
    const app = createApp(store);
    await post(app, "/api/lessons/py-functions-contracts/quiz", {
      answers: {
        "q-pyfn-sort-return": "b",
        "q-pyfn-type-hints": "b",
        "q-pyfn-side-effects": ["a", "b", "d"],
        "q-pyfn-mutable-default": "[1, 2]",
      },
    });
    const m = getSkillMasteryMap(store)["py-functions"];
    expect(m.status).not.toBe("demonstrated");
    expect(m.status).toBe("practicing");
  });

  it("a diagnostic check alone must NOT make a skill Demonstrated", async () => {
    const app = createApp(store);
    await post(app, "/api/diagnostic/submit", {
      goalId: "broad-ai-engineering", weeklyHours: 8, selfRatings: {},
      answers: { "diag-math-dot": 1, "diag-math-gd": 2.4, "diag-ml-precision": 0.75, "diag-dep-p95": "a" },
    });
    for (const id of ["vectors-dot-product", "gradient-descent", "ml-classification-metrics", "prod-monitoring"]) {
      expect(getSkillMasteryMap(store)[id].status, id).not.toBe("demonstrated");
    }
  });

  it("a self-graded 'explain' exercise alone must NOT make a skill Demonstrated", async () => {
    const app = createApp(store);
    const r = await (await post(app, "/api/exercises/ex-pyfn-explain-skew/submit", {
      answer: {
        text: "Funksiya DataFrame-i yerində dəyişir, təkrar çağırışda income yenidən bölünür, serving zamanı mean cari sorğudan hesablanır.",
        checkedRubric: [0, 1, 2, 3],
      },
    })).json();
    expect(r.grade.passed).toBe(true);
    expect(getSkillMasteryMap(store)["py-functions"].status).toBe("practicing");
  });

  it("two distinct unaided graded exercises still reach Demonstrated", async () => {
    const app = createApp(store);
    await post(app, "/api/exercises/ex-pyfn-predict-aliasing/submit", { answer: "[0.5, 7]" });
    expect(getSkillMasteryMap(store)["py-functions"].status).toBe("practicing");
    await post(app, "/api/exercises/ex-pyfn-min-max-scale/submit", {
      answer: { code: "x", testResults: [1, 2, 3, 4, 5].map((i) => ({ name: "t" + i, passed: true, error: null })) },
    });
    expect(getSkillMasteryMap(store)["py-functions"].status).toBe("demonstrated");
  });
});
