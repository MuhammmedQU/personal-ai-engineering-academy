// Browser E2E: drives real Chrome (puppeteer-core) against the real production server.
// Usage: npm run build && node tests/e2e/browser.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 3188;
const base = `http://localhost:${port}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiea-browser-"));
const dbPath = path.join(tmpDir, "academy.sqlite");
const shotDir = path.join(os.tmpdir(), "aiea-shots");
fs.mkdirSync(shotDir, { recursive: true });

const results = [];
const pageErrors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name} (${Date.now() - t0}ms)`);
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
    console.log(`FAIL  ${name}: ${e.message}`);
    try {
      await page.screenshot({ path: path.join(shotDir, name.replace(/\W+/g, "_") + ".png") });
    } catch {}
  }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

let page, browser, server;

async function startServer() {
  const env = { ...process.env, PORT: String(port), DB_PATH: dbPath, AI_PROVIDER: "demo" };
  server = spawn("node", ["server/index.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("server start timeout")), 15000);
    server.stdout.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(t); res(); } });
    server.stderr.on("data", (d) => process.stderr.write(d));
  });
}

const waitText = (text, timeout = 15000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);

async function clickText(text, { sel = "button", nth = 0, scope = null } = {}) {
  const ok = await page.evaluate(({ text, sel, nth, scope }) => {
    const root = scope ? document.querySelector(scope) : document;
    const els = [...root.querySelectorAll(sel)].filter((e) => e.innerText.includes(text) && !e.disabled);
    if (!els[nth]) return false;
    els[nth].click();
    return true;
  }, { text, sel, nth, scope });
  assert(ok, `no clickable <${sel}> containing "${text}"`);
}

async function setValue(handle, value) {
  await handle.evaluate((el, v) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function card(selector, titleIncludes) {
  const h = await page.evaluateHandle(({ selector, titleIncludes }) => {
    return [...document.querySelectorAll(selector)].find((c) => c.innerText.includes(titleIncludes)) || null;
  }, { selector, titleIncludes });
  const el = h.asElement();
  assert(el, `card "${titleIncludes}" not found`);
  return el;
}
async function cardClick(c, text) {
  const ok = await c.evaluate((root, text) => {
    const b = [...root.querySelectorAll("button")].find((e) => e.innerText.includes(text) && !e.disabled);
    if (!b) return false;
    b.click();
    return true;
  }, text);
  assert(ok, `card button "${text}" not found/enabled`);
}
const cardText = (c) => c.evaluate((e) => e.innerText);

const SOLUTION_MINMAX = `def min_max_scale(values):
    if not values:
        return []
    lo, hi = min(values), max(values)
    span = hi - lo
    if span == 0:
        return [0.0 for _ in values]
    return [(v - lo) / span for v in values]
`;
const SOLUTION_TAG = `def add_tag(tag, tags=None):
    result = [] if tags is None else list(tags)
    result.append(tag)
    return result
`;

await startServer();
browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
page.on("pageerror", (e) => pageErrors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") pageErrors.push("console.error: " + m.text()); });
page.on("requestfailed", (r) => pageErrors.push("requestfailed: " + r.url() + " " + r.failure()?.errorText));
const loadedScripts = [];
page.on("response", (r) => {
  if (r.status() >= 400) pageErrors.push(`HTTP ${r.status()}: ${r.url()}`);
  if (r.url().includes("/assets/") && r.url().endsWith(".js")) {
    loadedScripts.push(path.basename(new URL(r.url()).pathname));
  }
});

// ---------------- 1. onboarding + diagnostic ----------------
await step("1a. fresh app shows honest onboarding + lazy bundle does not eagerly load heavy chunks", async () => {
  await page.goto(base, { waitUntil: "networkidle0" });
  await waitText("Xoş gəldin");
  const t = await page.evaluate(() => document.body.innerText);
  assert(t.includes("Hələ sübut olunmuş bacarıq yoxdur"), "expected empty skills map text");
  assert(t.includes("Cəmi: 0 dəq"), "weekly activity should be 0 for new user");
  const joined = loadedScripts.join(",");
  assert(!/mermaid/i.test(joined), `mermaid should NOT load on initial Dashboard (loaded: ${joined})`);
  assert(!/katex/i.test(joined), `katex should NOT load on initial Dashboard (loaded: ${joined})`);
  assert(!/codeHighlight/i.test(joined), `codeHighlight should NOT load on initial Dashboard (loaded: ${joined})`);
  assert(!/SettingsPage|LessonsPage/i.test(joined), `lazy pages should NOT load on initial Dashboard (loaded: ${joined})`);
});

await step("1b. diagnostic wizard: 3 screens, <=8 questions each, 'I don't know' works", async () => {
  await clickText("Diaqnostikanı Başlat");
  await waitText("Addım 1/3");
  const areas = await page.$$eval(".diag-area-row", (e) => e.length);
  assert(areas <= 8, `screen 1 has ${areas} rows`);
  await clickText("Növbəti: Praktik Yoxlama (1/2)");
  await waitText("Hissə 1");
  let qs = await page.$$eval(".diag-question-card", (e) => e.length);
  assert(qs <= 8 && qs > 0, `screen 2 has ${qs} questions`);
  // answer: dict-get text correct, mutable default (b) correct, others 'dont know' except math-dot
  const c1 = await card(".diag-question-card", "Output-u proqnozlaşdır");
  await setValue(await c1.$("input[type=text]"), "2");
  const c2 = await card(".diag-question-card", "Bu kodda problem nədir");
  await c2.evaluate((r) => r.querySelectorAll("input[type=radio]")[1].click());
  const c3 = await card(".diag-question-card", "Hansı HTTP cavabı");
  await c3.evaluate((r) => r.querySelector(".dont-know-option input").click());
  const c5 = await card(".diag-question-card", "Dot product");
  await setValue(await c5.$("input[type=text]"), "1");
  await clickText("Növbəti: Praktik Yoxlama (2/2)");
  await waitText("Hissə 2");
  qs = await page.$$eval(".diag-question-card", (e) => e.length);
  assert(qs <= 8 && qs > 0, `screen 3 has ${qs} questions`);
  const c8 = await card(".diag-question-card", "Training loop");
  await c8.evaluate((r) => r.querySelector(".dont-know-option input").click());
  await clickText("Diaqnostikanı Tamamla");
  await waitText("Diaqnostika Nəticəsi", 20000);
  const t = await page.evaluate(() => document.body.innerText);
  assert(t.includes("İlk 3 Konkret Addım"), "missing first three actions");
  assert(t.includes("tam dərs"), "study plan must show authored lesson counts");
  assert(t.includes("Bilmirəm seçildi"), "skipped questions must be reported as skipped, not wrong");
});

// ---------------- 2. dashboard + path ----------------
await step("2a. dashboard after onboarding shows real data", async () => {
  await clickText("1. Dashboard");
  await waitText("Öyrənmə Mühiti");
  const t = await page.evaluate(() => document.body.innerText);
  assert(t.includes("Növbəti Tövsiyə Olunan Dərs"), "next lesson card missing");
  assert(t.includes("Aktiv Layihə"), "project card missing");
});
await step("2b. learning path: tracks A-H, all 31 modules authored including Linux, Distributed & Multimodal", async () => {
  await clickText("2. Learning Path");
  await waitText("Yol Xəritəsi");
  const t = await page.evaluate(() => document.body.innerText);
  assert(/Tam hazırdır \(\d+\/\d+ dərs\)/.test(t), "authored label missing");
  assert(t.includes("Linux, Command Line"), "Linux CLI module missing");
  assert(t.includes("Distributed Systems, Data Engineering"), "Distributed Data module missing");
  assert(t.includes("Multimodal AI"), "Multimodal Research module missing");
  await clickText("C. Classical Machine Learning", { sel: ".filter-chip" });
  await waitText("Model evaluation");
  const tracksShown = await page.$$eval(".track-section", (e) => e.length);
  assert(tracksShown === 1, `track filter should show 1 track, got ${tracksShown}`);
  await clickText("Hamısı", { sel: ".filter-chip" });
});

// ---------------- 3. lesson ----------------
await step("3a. open lesson from learning path", async () => {
  await clickText("2. Learning Path").catch(() => {});
  await clickText("Başla →", { sel: ".module-lesson-row button" });
  await waitText("Öyrənmə Hədəfləri");
  const t = await page.evaluate(() => document.body.innerText);
  assert(t.includes("Funksiyalar müqavilə kimi"), "wrong first lesson");
  assert(t.includes("Function signature"), "glossary missing");
});
await step("3b. sections: progressive disclosure, understood/unclear, katex + mermaid render", async () => {
  await clickText("Başa düşdüm kimi işarələ");
  await waitText("✓ Başa düşdüm");
  // go to diagram section
  await clickText("Vizual Diaqram", { sel: ".section-nav-item" });
  await page.waitForSelector(".mermaid-diagram svg", { timeout: 20000 });
  await clickText("Rəqəmlərlə Nümunə", { sel: ".section-nav-item" });
  await page.waitForSelector(".katex", { timeout: 10000 });
  await clickText("? Qarışıqdır");
  await waitText("(İşarələnib)");
});

// ---------------- 6. quiz ----------------
await step("6. quiz: wrong answers get feedback, then pass", async () => {
  await clickText("2. Anlama Yoxlaması");
  await waitText("Qısa Anlama Yoxlaması");
  const qs = await page.$$(".quiz-question-card");
  assert(qs.length === 4, `expected 4 quiz questions, got ${qs.length}`);
  // first attempt: deliberately wrong on q1 (option a), right otherwise
  await qs[0].evaluate((r) => r.querySelectorAll("input[type=radio]")[0].click());
  await qs[1].evaluate((r) => r.querySelectorAll("input[type=radio]")[1].click());
  await qs[2].evaluate((r) => { const i = r.querySelectorAll("input[type=checkbox]"); [0, 1, 3].forEach((k) => i[k].click()); });
  await setValue(await qs[3].$("input[type=text]"), "[1, 2]");
  await clickText("Quiz Cavablarını Təsdiqlə");
  await waitText("Nəticə: 3/4");
  const t = await page.evaluate(() => document.body.innerText);
  assert(t.includes("✗ Səhv"), "wrong answer feedback missing");
  assert(t.includes("Niyə") || t.includes("In-place"), "explanation missing");
});

// ---------------- 4/5. exercises + pyodide ----------------
await step("4a. non-code exercise: wrong then right, hints staged", async () => {
  await clickText("3. Praktik Tapşırıqlar");
  await waitText("Praktik Tapşırıqlar (Hands-on");
  const c = await card(".exercise-card", "Predict the output: aliasing");
  await setValue(await c.$("input[type=text]"), "[50, 7]");
  await cardClick(c, "Cavabı Yoxla");
  await page.waitForFunction((e) => e.innerText.includes("Yenidən cəhd et"), {}, c);
  assert(!(await cardText(c)).includes("Aliasing"), "explanation must not leak on wrong answer");
  await cardClick(c, "İpucu göstər");
  assert((await cardText(c)).includes("Mərhələli İpucu (1/2)"), "stage 1 hint missing");
  await setValue(await c.$("input[type=text]"), "[0.5, 7]");
  await cardClick(c, "Cavabı Yoxla");
  await page.waitForFunction((e) => e.innerText.includes("Doğrudur!"), {}, c);
});

await step("5a. Pyodide: run broken starter -> real failing tests", async () => {
  const c = await card(".exercise-card", "min_max_scale funksiyasını");
  await cardClick(c, "Run & Test");
  await page.waitForFunction((e) => e.querySelector(".test-results-box"), { timeout: 90000 }, c);
  const fails = await c.$$eval(".test-fail", (e) => e.length);
  assert(fails >= 1, "starter code should fail at least one real test");
  assert((await cardText(c)).includes("Yenidən cəhd et"), "failure feedback missing");
});
await step("5b. Pyodide: correct solution passes all 5 tests", async () => {
  const c = await card(".exercise-card", "min_max_scale funksiyasını");
  await setValue(await c.$("textarea.code-textarea"), SOLUTION_MINMAX);
  await cardClick(c, "Run & Test");
  await page.waitForFunction((e) => e.innerText.includes("Bütün 5 test uğurla keçdi"), { timeout: 60000 }, c);
  const passes = await c.$$eval(".test-pass", (e) => e.length);
  assert(passes === 5, `expected 5 passing rows, got ${passes}`);
});
await step("5c. Pyodide sandbox: infinite loop is killed by timeout, UI recovers", async () => {
  const c = await card(".exercise-card", "paylaşılan default list");
  await setValue(await c.$("textarea.code-textarea"), "while True:\n    pass\n");
  await cardClick(c, "Run & Test");
  await page.waitForFunction((e) => e.innerText.includes("İcra vaxtı limiti"), { timeout: 40000 }, c);
  // worker must be replaced and next run must work
  await setValue(await c.$("textarea.code-textarea"), SOLUTION_TAG);
  await cardClick(c, "Run & Test");
  await page.waitForFunction((e) => e.innerText.includes("Bütün 3 test uğurla keçdi"), { timeout: 90000 }, c);
});
await step("5d. Pyodide: syntax error and runtime error are reported, not crash", async () => {
  const c = await card(".exercise-card", "paylaşılan default list");
  await setValue(await c.$("textarea.code-textarea"), "def add_tag(:\n");
  await cardClick(c, "Run & Test");
  await page.waitForFunction((e) => e.querySelectorAll(".test-fail").length >= 1 && e.innerText.includes("SyntaxError"), { timeout: 30000 }, c);
});
await step("4b. explain exercise: rubric self-check + model answer revealed", async () => {
  const c = await card(".exercise-card", "İzah et: in-place");
  await setValue(await c.$("textarea.input-textarea"), "Funksiya DataFrame-i yerində dəyişir, təkrar çağırışda income yenidən bölünür və serving zamanı mean cari sorğudan hesablanır.");
  await c.evaluate((r) => [...r.querySelectorAll(".rubric-checklist input")].slice(0, 3).forEach((i) => i.click()));
  await cardClick(c, "Cavabı Yoxla");
  await page.waitForFunction((e) => e.innerText.includes("Nümunə Mühəndis Cavabı"), {}, c);
});
await step("4c. reveal solution works and warns it does not count as evidence", async () => {
  const c = await card(".exercise-card", "paylaşılan default list");
  await cardClick(c, "Həlli göstər");
  await page.waitForFunction((e) => e.innerText.includes("İstinad Həlli"), {}, c);
  assert((await cardText(c)).includes("sayılmır"), "reveal warning missing");
});
await step("3c. lesson marked completed only after quiz pass + exercise", async () => {
  // quiz was 3/4 = 75% >= 0.75 threshold -> passed; exercises solved -> completed
  await page.goto(base, { waitUntil: "networkidle0" });
  await clickText("3. Lessons");
  await waitText("Dərslər Kataloqu");
  const t = await page.evaluate(() => document.body.innerText);
  assert(t.includes("✓ Tamamlanıb"), "lesson should be completed");
});

// ---------------- 7. notes + bookmarks ----------------
await step("7. notes and bookmarks save", async () => {
  await clickText("Dərsi Aç →");
  await waitText("Öyrənmə Hədəfləri");
  const input = await page.$(".quick-note-bar input");
  await setValue(input, "browser-test-note");
  await clickText("Qeydi saxla");
  await clickText("4. Qeydlərim");
  await waitText("browser-test-note");
  await clickText("Əlfəcinə əlavə et");
  await waitText("Əlfəcinləndi");
});

// ---------------- 8. projects ----------------
await step("8. project milestone: evidence gate + completion", async () => {
  await clickText("5. Projects");
  await waitText("Mühəndislik Layihələri");
  const m = await card(".milestone-card", "Milestone #1");
  await m.evaluate((r) => r.querySelectorAll(".milestone-tasks input[type=checkbox]").forEach((i) => i.click()));
  await cardClick(m, "Sübutu Təsdiqlə");
  await page.waitForFunction((e) => e.innerText.includes("Sübut (Evidence) qeyd edilmədən"), {}, m);
  await setValue(await m.$("textarea.input-textarea.font-mono"), "pytest: 12 passed; split sizes train 9k / val 1k / test 1k; leakage audit table in README");
  await cardClick(m, "Sübutu Təsdiqlə");
  await page.waitForFunction((e) => e.innerText.includes("Sübutla Tamamlanıb"), { timeout: 10000 }, m);
});

// ---------------- 10. mentor ----------------
await step("10. AI mentor offline demo: labelled, contextual, history", async () => {
  await clickText("6. AI Mentor");
  await waitText("Demo Mentor Rejimi");
  await clickText("1. generateLessonHelp()");
  await page.waitForFunction(() => document.querySelectorAll(".chat-bubble-assistant").length >= 1, { timeout: 20000 });
  const t = await page.evaluate(() => document.querySelector(".chat-bubble-assistant").innerText);
  assert(t.includes("Demo Mentor Rejimi"), "response must be labelled demo");
  const input = await page.$(".chat-input-bar input");
  await setValue(input, "LLM API ilə model train etmək arasında fərq nədir?");
  await clickText("Göndər");
  await page.waitForFunction(() => document.querySelectorAll(".chat-bubble-assistant").length >= 2, { timeout: 20000 });
  const all = await page.evaluate(() => document.body.innerText);
  assert(all.includes("Model Training"), "role distinction answer missing");
});

// ---------------- 9. refresh persistence ----------------
await step("9. persistence after full page refresh", async () => {
  await page.reload({ waitUntil: "networkidle0" });
  await waitText("Öyrənmə Mühiti");
  await clickText("7. Progress");
  await waitText("Layihə Sübutları Portfeli");
  const t = await page.evaluate(() => document.body.innerText);
  assert(t.includes("browser-test-note"), "note lost after refresh");
  assert(t.includes("★"), "bookmark lost after refresh");
  assert(/1 Tamamlanmış Milestone/.test(t), "milestone evidence lost after refresh");
  await clickText("6. AI Mentor");
  await waitText("Demo Mentor Rejimi");
  await page.waitForFunction(() => document.querySelectorAll(".chat-bubble").length >= 2, { timeout: 10000 });
});

// ---------------- 12. Coding Lab (Python Sandbox + SQL Sandbox) ----------------
await step("12. coding lab: Python 3.12 sandbox (stdin + draft) & isolated SQL sandbox", async () => {
  await clickText("4. Practice Lab");
  await waitText("Coding & Practice Laboratory");
  await clickText("2. Python 3.12 Sandbox");
  await waitText("Run Python (Pyodide)");
  const pyArea = await page.$("textarea.code-textarea");
  await setValue(pyArea, "name = input()\nprint(f'Hello {name}: {2+2}')\n");
  const stdinArea = await page.$("textarea.input-textarea");
  await setValue(stdinArea, "AI-Engineer\n");
  await clickText("Run Python (Pyodide)");
  await waitText("Hello AI-Engineer: 4", 90000);
  await clickText("Qaralamanı Saxla");
  await waitText("Kod qaralaması SQLite bazasında saxlanıldı");

  await clickText("3. SQL Sandbox");
  await waitText("Run SQL Query");
  await clickText("Run SQL Query");
  await waitText("Nəticə (2 sətir)");
  const sqlText = await page.evaluate(() => document.body.innerText);
  assert(sqlText.includes("avg_latency_ms") && sqlText.includes("v1") && sqlText.includes("v2"), "SQL sandbox output missing");
});

// ---------------- 13. Projects Attached File + AI Code Review ----------------
await step("13. projects: attach learner code file and receive Senior Engineer AI Code Review", async () => {
  await clickText("5. Projects");
  await waitText("Mühəndislik Layihələri");
  const fileInputs = await page.$$(".projects-page input[type=text]");
  await setValue(fileInputs[0], "pipeline.py");
  const codeArea = await page.$(".projects-page textarea.code-textarea");
  await setValue(codeArea, "def load_items(x, buf=[]):\n    return eval(x)\n");
  await clickText("Faylı Layihəyə Əlavə Et");
  await waitText("pipeline.py");
  await clickText("AI Code Review");
  await waitText("Mutable default", 20000);
  const t = await page.evaluate(() => document.body.innerText);
  assert(t.includes("eval"), "AI review should catch eval() hazard");
});

// ---------------- 14. Study Planner ----------------
await step("14. study planner: 30-day calendar heatmap + create & complete study task", async () => {
  await clickText("8. Study Planner");
  await waitText("Şəxsi Tədris Planlayıcısı");
  const cells = await page.$$eval(".heatmap-cell", (e) => e.length);
  assert(cells === 30, `expected 30 heatmap cells, got ${cells}`);
  const titleInput = await page.$(".planner-page input[type=text]");
  await setValue(titleInput, "Transformer Attention təkrarı");
  await clickText("Planı Əlavə Et");
  await waitText("Transformer Attention təkrarı");
  const cb = await page.$(".planner-page input[type=checkbox]");
  await cb.click();
  await waitText("Tamamlanmış Tarixçə");
});

// ---------------- 15. Knowledge Base, SM-2 Flashcards & Mistake Notebook ----------------
await step("15. knowledge base: global search, SM-2 flashcard review, mistake reflection", async () => {
  await clickText("9. Knowledge & Flashcards");
  await waitText("Şəxsi Bilik Bazası");
  // Global search
  const searchInput = await page.$(".knowledge-page input[type=text]");
  await setValue(searchInput, "LoRA");
  await waitText("Keç →", 10000);
  // SM-2 Flashcard flip & review (auto-seeded from started lesson!)
  await clickText("Cavabı Göstər");
  await waitText("3. Yaxşı");
  await clickText("3. Yaxşı");
  // Mistake notebook (we had an earlier wrong attempt in step 4a!)
  await clickText("2. Mistake Notebook");
  await waitText("Səhvlər Dəftəri");
  const reflInput = await page.$(".quick-note-bar input");
  if (reflInput) {
    await setValue(reflInput, "List-ləri copy etmədən dəyişmək aliasing yaradır");
    await clickText("Dərsi saxla");
  }
});

// ---------------- 11. settings ----------------
await step("11. settings: theme change applies + persists, export works", async () => {
  await clickText("10. Settings");
  await waitText("Tənzimləmələr");
  const sel = (await page.$$("select.input-field"))[1];
  await sel.select("light");
  await clickText("Dəyişiklikləri Yadda Saxla");
  await waitText("yadda saxlanıldı");
  await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light");
  await page.reload({ waitUntil: "networkidle0" });
  assert((await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "light", "theme not persisted");
  const exp = await page.evaluate(async () => (await fetch("/api/export")).json());
  assert(exp.exercise_attempts.length > 0 && exp.notes.length > 0, "export missing data");
  assert(exp.flashcards.length > 0 && exp.study_tasks.length > 0 && exp.project_files.length > 0, "export missing new personal university data");
});

await step("11b. backup management UI: manual snapshot, strong restore confirm, pre-restore snapshot, no delete button", async () => {
  await clickText("10. Settings");
  await waitText("Ehtiyat Nüsxə İdarəetməsi");

  // Confirm ZERO delete buttons exist inside backup management panel
  const delBtns = await page.evaluate(() => {
    const panel = document.querySelector("#backup-management-panel");
    return [...(panel?.querySelectorAll("button") ?? [])].filter((b) =>
      /sil|delete/i.test(b.innerText),
    ).length;
  });
  assert(delBtns === 0, `backup panel must never have delete buttons, found ${delBtns}`);

  // Create a manual backup
  await clickText("+ Əl ilə Backup Yarat");
  await waitText("Əl ilə ehtiyat nüsxəsi yaradıldı");
  await waitText("Əl ilə (manual)");
  const tableText = await page.$eval("#backup-management-panel", (el) => el.innerText);
  assert(tableText.includes("UTC") && /KB|B/.test(tableText) && tableText.includes("backup-manual-"), "backup row missing date/size/filename");

  // Change profile name so we can verify restore genuinely reverts DB state
  const nameInput = await page.$("#settings-name");
  const origName = await nameInput.evaluate((el) => el.value);
  await setValue(nameInput, "TempNameBeforeRestore");
  await clickText("Dəyişiklikləri Yadda Saxla");
  await waitText("Tənzimləmələr yadda saxlanıldı");

  // Open restore confirmation for the manual backup
  await clickText("Bərpa et...", { scope: "#backup-management-panel" });
  await waitText("Bərpa Təsdiqi Tələb Olunur");

  // Strong confirmation guard: confirm button MUST be disabled before checking acknowledgement box
  const disabledBefore = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#backup-management-panel [role="alertdialog"] button')].find((b) =>
      b.innerText.includes("Bəli, bu nüsxəni bərpa et"),
    );
    return Boolean(btn && btn.disabled);
  });
  assert(disabledBefore, "restore confirmation button MUST be disabled until checkbox is checked");

  // Check confirmation checkbox and restore
  await page.click('#backup-management-panel [role="alertdialog"] input[type="checkbox"]');
  await clickText("Bəli, bu nüsxəni bərpa et", { scope: "#backup-management-panel" });
  await waitText("Ehtiyat nüsxə uğurla bərpa olundu");
  await waitText("Bərpa öncəsi (avto)");

  // Profile name must be restored back to origName!
  await page.waitForFunction(
    (expected) => document.querySelector("#settings-name")?.value === expected,
    { timeout: 10000 },
    origName,
  );
});

await step("11c. reset: confirm flow creates automatic pre-reset backup and returns to honest onboarding", async () => {
  await clickText("10. Settings");
  await waitText("Ehtiyat Nüsxə İdarəetməsi");
  await clickText("Bütün öyrənmə tarixçəsini sıfırla");
  await clickText("Bəli, bütün irəliləyişi sil");
  await waitText("sıfırlandı");
  await waitText("Sıfırlama öncəsi (avto)");
  await clickText("1. Dashboard");
  await waitText("Xoş gəldin");
});

// ---------------- secrets ----------------
await step("secrets: no API key anywhere in served frontend or API responses", async () => {
  const keys = ["GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "AI_API_KEY"]
    .map((k) => process.env[k]).filter((v) => v && v.length > 8);
  const files = [];
  (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); f.isDirectory() ? walk(p) : /\.(js|html|css|map)$/.test(f.name) && files.push(p); } })("dist");
  let leaked = 0;
  for (const f of files) { const s = fs.readFileSync(f, "utf8"); for (const k of keys) if (s.includes(k)) leaked++; }
  const api = await page.evaluate(async () => (await (await fetch("/api/bootstrap")).text()) + (await (await fetch("/api/health")).text()));
  for (const k of keys) if (api.includes(k)) leaked++;
  console.log(`      (checked ${files.length} dist files, ${keys.length} real key value(s) present in env; values never printed)`);
  assert(leaked === 0, "API KEY LEAKED to frontend");
});

await browser.close();
server.kill();
await sleep(500);
fs.rmSync(tmpDir, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser steps passed. Screenshots of failures: ${shotDir}`);
const uniq = [...new Set(pageErrors)];
console.log(`browser console/page/network errors captured: ${uniq.length}`);
uniq.slice(0, 20).forEach((e) => console.log("  - " + e));
process.exit(failed.length ? 1 : 0);
