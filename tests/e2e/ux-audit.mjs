// Multi-viewport Chrome UX & Accessibility Audit (Desktop 1440px, Tablet 768px, Mobile 390px)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 3199;
const base = `http://localhost:${port}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aiea-ux-"));
const dbPath = path.join(tmpDir, "academy.sqlite");

const server = spawn("node", ["server/index.ts"], {
  env: { ...process.env, PORT: String(port), DB_PATH: dbPath, AI_PROVIDER: "demo" },
  stdio: ["ignore", "pipe", "pipe"],
});

await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("server timeout")), 15000);
  server.stdout.on("data", (d) => {
    if (String(d).includes("listening")) {
      clearTimeout(t);
      res();
    }
  });
  server.stderr.on("data", (d) => process.stderr.write(d));
});

// Seed one manual backup so Settings Backup Management table is populated during multi-viewport audit
await fetch(`${base}/api/backups/create`, { method: "POST" });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console.error: " + m.text());
});
page.on("response", (r) => {
  if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`);
});

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

const NAV_TABS = [
  { label: "Dashboard", desktopMatch: "1. Dashboard", mobileMatch: "Dashboard" },
  { label: "Learning Path", desktopMatch: "2. Learning Path", mobileMatch: "Yol Xəritəsi" },
  { label: "Lessons", desktopMatch: "3. Lessons", mobileMatch: "Dərslər" },
  { label: "Practice Lab", desktopMatch: "4. Practice Lab", mobileMatch: "Praktika" },
  { label: "Projects", desktopMatch: "5. Projects", mobileMatch: "Layihələr" },
  { label: "AI Mentor", desktopMatch: "6. AI Mentor", mobileMatch: "AI Mentor" },
  { label: "Progress", desktopMatch: "7. Progress & Portfolio", mobileMatch: "İrəliləyiş" },
  { label: "Study Planner", desktopMatch: "8. Study Planner", mobileMatch: "Planlayıcı" },
  { label: "Knowledge", desktopMatch: "9. Knowledge & Flashcards", mobileMatch: "Bilik Bazası" },
  { label: "Settings", desktopMatch: "10. Settings", mobileMatch: "Tənzimləmələr" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const findings = [];

for (const vp of VIEWPORTS) {
  await page.setViewport({ width: vp.width, height: vp.height });
  await page.goto(base, { waitUntil: "networkidle0" });
  await sleep(250);

  for (const tab of NAV_TABS) {
    const match = vp.width > 960 ? tab.desktopMatch : tab.mobileMatch;
    const sel = vp.width > 960 ? ".app-sidebar .nav-item" : ".mobile-topbar .filter-chip";
    const clicked = await page.evaluate(
      ({ sel, match }) => {
        const el = [...document.querySelectorAll(sel)].find((b) => b.innerText.includes(match));
        if (!el) return false;
        el.click();
        return true;
      },
      { sel, match },
    );
    if (!clicked) {
      findings.push(`[${vp.name}] ${tab.label}: nav button "${match}" NOT FOUND`);
      continue;
    }
    try {
      await page.waitForSelector("main h1", { timeout: 5000 });
    } catch {}
    await sleep(200);

    const audit = await page.evaluate(() => {
      const docOverflow = document.documentElement.scrollWidth - window.innerWidth;
      const bodyOverflow = document.body.scrollWidth - window.innerWidth;
      const h1Count = document.querySelectorAll("h1").length;
      const emptyButtons = [...document.querySelectorAll("button")].filter(
        (b) => !b.innerText.trim() && !b.getAttribute("aria-label") && !b.getAttribute("title"),
      ).length;
      const unlabeledInputs = [...document.querySelectorAll("input, select, textarea")].filter((el) => {
        if (el.type === "hidden" || el.type === "checkbox" || el.type === "radio") return false;
        const id = el.getAttribute("id");
        const hasLabelFor = id && document.querySelector(`label[for="${id}"]`);
        const insideLabel = Boolean(el.closest("label"));
        const insideFormGroupWithLabel = Boolean(el.closest(".form-group")?.querySelector("label"));
        const hasAria = Boolean(el.getAttribute("aria-label") || el.getAttribute("placeholder"));
        return !hasLabelFor && !insideLabel && !insideFormGroupWithLabel && !hasAria;
      }).length;

      const offenders = [];
      if (docOverflow > 2) {
        for (const el of document.querySelectorAll("main *, header *")) {
          const r = el.getBoundingClientRect();
          if (r.right > window.innerWidth + 2 && el.children.length === 0) {
            offenders.push(`${el.tagName}.${el.className || ""}(right=${Math.round(r.right)})`);
            if (offenders.length >= 4) break;
          }
        }
      }
      return { docOverflow, bodyOverflow, h1Count, emptyButtons, unlabeledInputs, offenders };
    });

    if (audit.docOverflow > 2 || audit.bodyOverflow > 2) {
      findings.push(
        `[OVERFLOW][${vp.name}] ${tab.label}: scrollWidth exceeds innerWidth by ${Math.max(audit.docOverflow, audit.bodyOverflow)}px (${audit.offenders.join(", ")})`,
      );
    }
    if (audit.h1Count === 0) {
      findings.push(`[A11Y][${vp.name}] ${tab.label}: missing <h1>`);
    }
    if (audit.emptyButtons > 0) {
      findings.push(`[A11Y][${vp.name}] ${tab.label}: ${audit.emptyButtons} button(s) without text/aria-label`);
    }
    if (audit.unlabeledInputs > 0) {
      findings.push(`[A11Y][${vp.name}] ${tab.label}: ${audit.unlabeledInputs} input(s) without label/aria-label`);
    }
  }
}

// Check Active Lesson Player on mobile (390px) including Mermaid + KaTeX
await page.setViewport({ width: 390, height: 844 });
await page.goto(base, { waitUntil: "networkidle0" });
await page.evaluate(() => {
  const b = [...document.querySelectorAll(".mobile-topbar .filter-chip")].find((x) =>
    x.innerText.includes("Dərslər"),
  );
  b?.click();
});
await sleep(300);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes("Dərsi Aç"));
  b?.click();
});
await sleep(500);
const lessonMobOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth - window.innerWidth,
);
if (lessonMobOverflow > 2) {
  findings.push(`[OVERFLOW][mobile] Active Lesson Player: overflow by ${lessonMobOverflow}px`);
}

// Check mobile topbar parity: Diagnostic + Theme toggle accessible on mobile/tablet?
const mobileTopbarCheck = await page.evaluate(() => {
  const btns = [...document.querySelectorAll(".mobile-topbar button")].map((b) => b.innerText);
  return {
    hasDiag: btns.some((t) => t.includes("Diaqnostika")),
    hasTheme: btns.some((t) => t.includes("Açıq") || t.includes("Tünd")),
  };
});
if (!mobileTopbarCheck.hasDiag) {
  findings.push(`[UX][mobile] Mobile topbar missing "Diaqnostika" navigation button`);
}
if (!mobileTopbarCheck.hasTheme) {
  findings.push(`[UX][mobile] Mobile topbar missing quick Light/Dark theme toggle`);
}

await browser.close();
server.kill();
await sleep(300);
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`=== UX & ACCESSIBILITY AUDIT RESULTS ===`);
console.log(`Runtime/HTTP errors: ${errors.length}`);
errors.forEach((e) => console.log("  ERR:", e));
console.log(`Findings (${findings.length}):`);
findings.forEach((f) => console.log("  -", f));
process.exit(errors.length > 0 || findings.length > 0 ? 1 : 0);
