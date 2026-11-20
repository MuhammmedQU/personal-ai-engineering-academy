/**
 * CLI script to validate all YAML content files and execute reference solutions
 * for all `code` exercises.
 *
 * Usage:
 *   node server/scripts/validateContent.ts [--partial] [--skip-code] [--only <lesson-id|topic>]
 */
import { checkCodeExercise } from "../content/codecheck.ts";
import { ContentError, loadContent } from "../content/loader.ts";
import type { CodeExercise } from "../content/schema.ts";

const args = process.argv.slice(2);
const skipCode = args.includes("--skip-code");
const partial = args.includes("--partial");
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;

function main(): number {
  let store;
  try {
    store = loadContent({ partial });
  } catch (e) {
    if (e instanceof ContentError) {
      console.error("CONTENT INVALID");
      for (const err of e.errors) {
        console.error("  -", err);
      }
      return 1;
    }
    throw e;
  }

  const byType: Record<string, number> = {};
  for (const ref of store.exercises.values()) {
    if (ref.kind === "diagnostic") continue;
    byType[ref.exercise.type] = (byType[ref.exercise.type] ?? 0) + 1;
  }

  console.log(
    `tracks=${store.tracks.length} modules=${store.modules.size} lessons=${store.lessons.size} ` +
      `skills=${store.skills.size} projects=${store.projects.size}`,
  );
  console.log("exercises+quiz questions by type:", byType);

  if (skipCode) {
    console.log("OK (code exercises not executed)");
    return 0;
  }

  const codeRefs = [...store.exercises.values()].filter((r) => {
    if (r.exercise.type !== "code") return false;
    if (only && r.lessonId !== only && r.topic !== only) return false;
    return true;
  });

  let bad = 0;
  for (const ref of codeRefs) {
    const res = checkCodeExercise(ref.exercise as CodeExercise);
    if (!res.ok) {
      bad++;
      console.error(`  CODE EXERCISE ${res.exerciseId}:`);
      for (const p of res.problems) {
        console.error(`    - ${p}`);
      }
    }
  }
  console.log(`code exercises checked: ${codeRefs.length}, problems: ${bad}`);
  return bad > 0 ? 1 : 0;
}

process.exitCode = main();
