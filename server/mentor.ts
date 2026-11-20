/**
 * Personal AI Mentor & TutorProvider implementation.
 *
 * Implements:
 * - `TutorProvider` interface (`generateLessonHelp`, `reviewExercise`,
 *   `explainCode`, `createStudyPlan`, `generateExercise`, `explainMistake`,
 *   `reviewProjectFile`, `chat`)
 * - Server-side provider configuration supporting OpenAI, Anthropic, Google
 *   Gemini, Ollama, and offline Demo mode, with a local gitignored secrets
 *   store (`data/local-secrets.json`) that NEVER returns raw API keys to the
 *   browser.
 * - Adaptive explanation depth (`beginner` | `intermediate` | `advanced`) and
 *   optional Socratic mode grounded in `.agents/skills/*.md` and actual
 *   learner progress (diagnostic, completed lessons, notes, quiz results,
 *   and skill mastery).
 */
import fs from "node:fs";
import path from "node:path";
import type { ContentStore } from "./content/loader.ts";
import { REPO_ROOT } from "./content/loader.ts";
import { getDb, getProfile, type ExplanationLevel } from "./db.ts";
import { getSkillMasteryMap } from "./engine.ts";

export type MentorAction =
  | "chat"
  | "lesson-help"
  | "review-exercise"
  | "explain-code"
  | "study-plan"
  | "generate-exercise"
  | "explain-mistake"
  | "review-project-file";

export type ProviderKind = "demo" | "openai" | "gemini" | "anthropic" | "ollama";

export interface MentorContext {
  lessonId?: string;
  sectionId?: string;
  exerciseId?: string;
  projectId?: string;
  filename?: string;
  codeSnippet?: string;
  learnerAnswer?: string;
  errorOutput?: string;
  explanationLevel?: ExplanationLevel;
  socraticMode?: boolean;
}

export interface MentorRequest {
  action: MentorAction;
  message: string;
  contextType?: string;
  contextId?: string;
  context?: MentorContext;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
}

export interface MentorResponse {
  mode: "live-ai" | "demo-no-key";
  providerName: string;
  modelName: string;
  explanationLevel: ExplanationLevel;
  reply: string;
  followUpQuestion?: string;
  referencedLessons: Array<{ id: string; title: string }>;
  usage?: TokenUsage | null;
  fallbackError?: string | null;
  privacyNotice: string;
}

export interface StoredMentorConfig {
  provider: ProviderKind;
  model: string;
  baseUrl: string;
  apiKey?: string;
}

export interface SafeMentorConfigView {
  provider: ProviderKind;
  model: string;
  baseUrl: string;
  hasStoredKey: boolean;
  maskedKey: string | null;
  configured: boolean;
  source: "local-config" | "env" | "demo";
  privacyNotice: string;
}

export interface TutorProvider {
  getStatus(): {
    configured: boolean;
    provider: string;
    model: string;
    privacyNotice: string;
  };
  getSafeConfig(): SafeMentorConfigView;
  saveConfig(update: {
    provider: ProviderKind;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    clearKey?: boolean;
  }): SafeMentorConfigView;
  generateLessonHelp(store: ContentStore, req: MentorRequest): Promise<MentorResponse>;
  reviewExercise(store: ContentStore, req: MentorRequest): Promise<MentorResponse>;
  explainCode(store: ContentStore, req: MentorRequest): Promise<MentorResponse>;
  createStudyPlan(store: ContentStore, req: MentorRequest): Promise<MentorResponse>;
  generateExercise(store: ContentStore, req: MentorRequest): Promise<MentorResponse>;
  explainMistake(store: ContentStore, req: MentorRequest): Promise<MentorResponse>;
  reviewProjectFile(store: ContentStore, req: MentorRequest): Promise<MentorResponse>;
  chat(store: ContentStore, req: MentorRequest): Promise<MentorResponse>;
}

const PRIVACY_NOTICE_LIVE =
  "Canlı AI provayderi aktivdir: göndərdiyiniz sual, cari dərs konteksti və kod parçası seçilmiş LLM provayderinə göndərilir. API açarı yalnız lokal serverdə saxlanılır və HEÇ VAXT brauzerə ötürülmür. Real production açarlarını və ya həssas şəxsi məlumatları paylaşmayın.";

const PRIVACY_NOTICE_OFFLINE =
  "Offline Demo Mentor rejimi (API açarı aktiv deyil): heç bir məlumat xarici serverə göndərilmir. Cavablar bütün lokal kurikulum bazası, lüğət, kod təhlili qaydaları və cari tapşırıq kontekstiniz əsasında yerli olaraq yaradılır.";

const DEFAULT_MODELS: Record<ProviderKind, string> = {
  demo: "local-curriculum-assistant",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
  anthropic: "claude-3-5-sonnet-latest",
  ollama: "llama3.1",
};

const DEFAULT_BASE_URLS: Record<ProviderKind, string> = {
  demo: "",
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  anthropic: "https://api.anthropic.com/v1",
  ollama: "http://localhost:11434/v1",
};

function secretsFilePath(): string {
  return process.env.SECRETS_PATH || path.join(REPO_ROOT, "data", "local-secrets.json");
}

function readStoredConfig(): StoredMentorConfig | null {
  if (process.env.AI_PROVIDER === "demo") return null;
  const p = secretsFilePath();
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<StoredMentorConfig>;
    if (!raw.provider) return null;
    return {
      provider: raw.provider,
      model: raw.model ?? "",
      baseUrl: raw.baseUrl ?? "",
      apiKey: raw.apiKey ?? "",
    };
  } catch {
    return null;
  }
}

function writeStoredConfig(cfg: StoredMentorConfig): void {
  const p = secretsFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), { encoding: "utf-8", mode: 0o600 });
}

function maskSecret(key?: string): string | null {
  const trimmed = (key || "").trim();
  if (!trimmed) return null;
  if (trimmed.length <= 4) return "***";
  return `***${trimmed.slice(-4)}`;
}

// Simple in-memory sliding-window rate limiter (30 requests / minute)
const requestTimestamps: number[] = [];
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

export function checkMentorRateLimit(): boolean {
  const now = Date.now();
  while (requestTimestamps.length > 0 && now - requestTimestamps[0] > RATE_LIMIT_WINDOW_MS) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= RATE_LIMIT_MAX) {
    return false;
  }
  requestTimestamps.push(now);
  return true;
}

function loadSkillInstructions(): string {
  const skillPaths = [
    path.join(REPO_ROOT, ".agents", "skills", "ai-engineering-tutor", "SKILL.md"),
    path.join(REPO_ROOT, ".agents", "skills", "curriculum-architect", "SKILL.md"),
    path.join(REPO_ROOT, ".agents", "skills", "project-reviewer", "SKILL.md"),
  ];
  return skillPaths
    .filter((p) => fs.existsSync(p))
    .map((p) => fs.readFileSync(p, "utf-8"))
    .join("\n\n---\n\n");
}

function detectProviderConfig(): {
  configured: boolean;
  provider: ProviderKind;
  apiKey: string;
  model: string;
  baseUrl: string;
  source: "local-config" | "env" | "demo";
} {
  const explicitEnv = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (explicitEnv === "demo" || explicitEnv === "offline" || explicitEnv === "none") {
    return {
      configured: false,
      provider: "demo",
      apiKey: "",
      model: DEFAULT_MODELS.demo,
      baseUrl: "",
      source: "demo",
    };
  }

  // 1. Check local user-configured settings file (`data/local-secrets.json`) first
  const stored = readStoredConfig();
  if (stored) {
    if (stored.provider === "demo") {
      return {
        configured: false,
        provider: "demo",
        apiKey: "",
        model: DEFAULT_MODELS.demo,
        baseUrl: "",
        source: "local-config",
      };
    }
    if (stored.provider === "ollama") {
      return {
        configured: true,
        provider: "ollama",
        apiKey: "ollama",
        model: stored.model || DEFAULT_MODELS.ollama,
        baseUrl: stored.baseUrl || DEFAULT_BASE_URLS.ollama,
        source: "local-config",
      };
    }
    const key = (stored.apiKey || "").trim();
    if (key) {
      return {
        configured: true,
        provider: stored.provider,
        apiKey: key,
        model: stored.model || DEFAULT_MODELS[stored.provider],
        baseUrl: stored.baseUrl || DEFAULT_BASE_URLS[stored.provider],
        source: "local-config",
      };
    }
  }

  // 2. Fall back to explicit server environment variables
  const genericKey = (process.env.AI_API_KEY || "").trim();
  const openaiKey = (process.env.OPENAI_API_KEY || "").trim();
  const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
  const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  const customModel = (process.env.AI_MODEL || "").trim();
  const customBase = (process.env.AI_BASE_URL || "").trim();

  if (explicitEnv === "ollama") {
    return {
      configured: true,
      provider: "ollama",
      apiKey: "ollama",
      model: customModel || DEFAULT_MODELS.ollama,
      baseUrl: customBase || DEFAULT_BASE_URLS.ollama,
      source: "env",
    };
  }
  if (explicitEnv === "gemini") {
    const key = genericKey || geminiKey;
    if (key) {
      return {
        configured: true,
        provider: "gemini",
        apiKey: key,
        model: customModel || DEFAULT_MODELS.gemini,
        baseUrl: customBase || DEFAULT_BASE_URLS.gemini,
        source: "env",
      };
    }
  }
  if (explicitEnv === "anthropic") {
    const key = genericKey || anthropicKey;
    if (key) {
      return {
        configured: true,
        provider: "anthropic",
        apiKey: key,
        model: customModel || DEFAULT_MODELS.anthropic,
        baseUrl: customBase || DEFAULT_BASE_URLS.anthropic,
        source: "env",
      };
    }
  }
  if (explicitEnv === "openai" || (!explicitEnv && genericKey)) {
    const key = genericKey || openaiKey;
    if (key) {
      return {
        configured: true,
        provider: "openai",
        apiKey: key,
        model: customModel || DEFAULT_MODELS.openai,
        baseUrl: customBase || DEFAULT_BASE_URLS.openai,
        source: "env",
      };
    }
  }

  return {
    configured: false,
    provider: "demo",
    apiKey: "",
    model: DEFAULT_MODELS.demo,
    baseUrl: "",
    source: "demo",
  };
}

function buildLearnerSnapshot(store: ContentStore, ctx?: MentorContext): string {
  const db = getDb();
  const profile = getProfile(db);
  const masteryMap = getSkillMasteryMap(store, db);
  const demonstrated: string[] = [];
  const needsReview: string[] = [];
  const practicing: string[] = [];

  for (const [id, row] of Object.entries(masteryMap)) {
    const name = store.skills.get(id)?.name ?? id;
    if (row.status === "demonstrated") demonstrated.push(name);
    else if (row.status === "needs_review") needsReview.push(name);
    else if (row.status === "practicing") practicing.push(name);
  }

  const completedLessons = (
    db.prepare("SELECT lesson_id FROM lesson_progress WHERE status = 'completed'").all() as Array<{
      lesson_id: string;
    }>
  ).map((r) => r.lesson_id);

  const recentNotes = (
    db.prepare("SELECT lesson_id, content FROM notes ORDER BY updated_at DESC LIMIT 5").all() as Array<{
      lesson_id: string;
      content: string;
    }>
  ).map((n) => `[${n.lesson_id}] ${n.content.slice(0, 120)}`);

  const recentQuizzes = (
    db
      .prepare("SELECT lesson_id, score, passed FROM quiz_attempts ORDER BY id DESC LIMIT 5")
      .all() as Array<{ lesson_id: string; score: number; passed: number }>
  ).map((q) => `${q.lesson_id}: ${Math.round(q.score * 100)}% (${q.passed ? "passed" : "failed"})`);

  const recentMistakes = (
    db
      .prepare(
        `SELECT exercise_id, feedback
         FROM exercise_attempts
         WHERE passed = 0 AND revealed_solution = 0
         ORDER BY id DESC LIMIT 5`,
      )
      .all() as Array<{ exercise_id: string; feedback: string }>
  ).map((m) => `${m.exercise_id}: ${m.feedback.slice(0, 100)}`);

  const level = ctx?.explanationLevel ?? profile.explanation_level ?? "intermediate";
  const socratic = ctx?.socraticMode ?? Boolean(profile.socratic_mode);

  const lines: string[] = [
    `Learner profile: name=${profile.name}, goal=${profile.goal_id}, weekly_hours=${profile.weekly_hours}, daily_goal_min=${profile.daily_goal_minutes}, explanation_level=${level}, socratic_mode=${socratic}`,
    `Completed lessons (${completedLessons.length}/${store.lessons.size}): ${completedLessons.slice(0, 10).join(", ") || "none yet"}`,
    `Demonstrated skills (${demonstrated.length}): ${demonstrated.slice(0, 10).join(", ") || "none yet"}`,
    `Needs review / knowledge gaps (${needsReview.length}): ${needsReview.join(", ") || "none"}`,
    `Practicing (${practicing.length}): ${practicing.slice(0, 8).join(", ") || "none"}`,
    `Recent quiz scores: ${recentQuizzes.join(" | ") || "none yet"}`,
    `Recent mistakes: ${recentMistakes.join(" | ") || "none"}`,
    `Recent learner notes: ${recentNotes.join(" | ") || "none"}`,
  ];

  if (ctx?.lessonId) {
    const lesson = store.lessons.get(ctx.lessonId);
    if (lesson) {
      lines.push(`Current lesson: ${lesson.title} (${lesson.id})`);
      if (ctx.sectionId) {
        const sec = lesson.sections.find((s) => s.id === ctx.sectionId);
        if (sec) {
          lines.push(`Current section: ${sec.title} (${sec.kind})\n${sec.body.slice(0, 1200)}`);
        }
      }
    }
  }

  if (ctx?.exerciseId) {
    const ref = store.exercises.get(ctx.exerciseId);
    if (ref) {
      lines.push(
        `Current exercise: ${ref.exercise.title} (type=${ref.exercise.type}, category=${ref.exercise.category})\nPrompt: ${ref.exercise.prompt}`,
      );
      if (ref.exercise.hints.length > 0) {
        lines.push(`Available staged hints: ${ref.exercise.hints.join(" | ")}`);
      }
    }
  }

  if (ctx?.projectId) {
    const proj = store.projects.get(ctx.projectId);
    if (proj) {
      lines.push(
        `Current project: ${proj.title} — ${proj.problem_statement}\nRequirements: ${proj.requirements.join("; ")}`,
      );
    }
  }

  if (ctx?.codeSnippet) {
    lines.push(
      `Learner code (${ctx.filename || "snippet"}):\n\`\`\`\n${ctx.codeSnippet.slice(0, 4000)}\n\`\`\``,
    );
  }
  if (ctx?.errorOutput) {
    lines.push(`Error / test output:\n${ctx.errorOutput.slice(0, 1200)}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Offline TF-IDF retrieval + pedagogical synthesis (Demo Mode — No API Key)
// ---------------------------------------------------------------------------

interface SearchChunk {
  lessonId: string;
  lessonTitle: string;
  sectionTitle: string;
  kind: string;
  text: string;
  tokens: Set<string>;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9əöüöğçşı_+-]+/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function searchCurriculum(
  store: ContentStore,
  query: string,
  preferredLessonId?: string,
  topK = 3,
): SearchChunk[] {
  const qTokens = tokenize(query);
  const chunks: SearchChunk[] = [];

  for (const lesson of store.lessons.values()) {
    const termsText = lesson.terms.map((t) => `**${t.term}**: ${t.definition}`).join("\n");
    chunks.push({
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      sectionTitle: "Terminlər və Əsas Məqsəd",
      kind: "terms",
      text: `${lesson.summary}\n\n${lesson.why_it_matters}\n\n${termsText}`,
      tokens: new Set(tokenize(`${lesson.title} ${lesson.summary} ${termsText}`)),
    });
    for (const sec of lesson.sections) {
      chunks.push({
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        sectionTitle: sec.title,
        kind: sec.kind,
        text: sec.body,
        tokens: new Set(tokenize(`${lesson.title} ${sec.title} ${sec.body}`)),
      });
    }
  }

  const docFreq: Record<string, number> = {};
  for (const tok of qTokens) {
    docFreq[tok] = chunks.filter((c) => c.tokens.has(tok)).length;
  }

  const scored = chunks.map((chunk) => {
    let score = preferredLessonId && chunk.lessonId === preferredLessonId ? 1.5 : 0;
    for (const tok of qTokens) {
      if (chunk.tokens.has(tok)) {
        const idf = Math.log(1 + chunks.length / (1 + (docFreq[tok] || 1)));
        score += idf;
      }
    }
    return { chunk, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter((s) => s.score > 0)
    .slice(0, topK)
    .map((s) => s.chunk);
}

function staticCodeReviewIssues(code: string): string[] {
  const issues: string[] = [];
  if (/def\s+\w+\([^)]*=\s*(\[\]|\{\})/.test(code)) {
    issues.push(
      "- **[Kritik Bug] Mutable default argument (`=[]` / `={}`):** Default obyekt funksiya təyin olunanda bir dəfə yaradılır və çağırışlar arasında paylaşılır. `None` istifadə edib daxildə yeni obyekt yarat.",
    );
  }
  if (/=\s*\w+\.sort\(\)/.test(code)) {
    issues.push(
      "- **[Bug] `list.sort()` mənimsədilməsi:** `.sort()` yerində sıralayır və `None` qaytarır. Yeni sıralanmış list üçün `sorted(...)` istifadə et.",
    );
  }
  if (/except\s*:/.test(code)) {
    issues.push(
      "- **[Etibarlılıq] Bare `except:` bloku:** Bütün xətaları (`NameError`, `KeyboardInterrupt` daxil) səssizcə gizlədir. Yalnız gözlədiyin konkret exception tipini (`ValueError`, `KeyError`) tut.",
    );
  }
  if (/\beval\s*\(|\bexec\s*\(/.test(code)) {
    issues.push(
      "- **[Təhlükəsizlik] `eval()` / `exec()` çağırışı:** Etibarsız girişlərdə Remote Code Execution yaradır. JSON üçün `json.loads()` və sxem doğrulaması istifadə et.",
    );
  }
  if (/f["']SELECT\s+.*\{|f["']INSERT\s+.*\{|f["']DELETE\s+.*\{/i.test(code)) {
    issues.push(
      "- **[Təhlükəsizlik] SQL Injection riski:** SQL sorğusuna f-string ilə dəyişən birləşdirilib. Yalnız `?` parametrləşdirilmiş sorğular (`cursor.execute(sql, (val,))`) istifadə et.",
    );
  }
  if (/(api_key|secret|password)\s*=\s*["'][A-Za-z0-9_\-]{10,}["']/i.test(code)) {
    issues.push(
      "- **[Təhlükəsizlik] Hardcoded secret aşkarlandı:** Açar və parollar kodda yox, server-side environment variable-da (`os.environ`) saxlanmalıdır.",
    );
  }
  if (/requests\.(get|post)\([^)]*\)/.test(code) && !/timeout\s*=/.test(code)) {
    issues.push(
      "- **[Etibarlılıq] HTTP sorğusunda `timeout` yoxdur:** Qarşı server cavab verməsə worker sonsuza qədər asılı qala bilər. `timeout=10` əlavə et.",
    );
  }
  if (/fit_transform\(/.test(code) && !/train/i.test(code)) {
    issues.push(
      "- **[ML Doğruluq] Potensial Data Leakage:** `fit_transform()` yalnız training datası üzərində çağırılmalı, validation/test datasında isə yalnız `transform()` işlədilməlidir.",
    );
  }
  return issues;
}

const LEVEL_BANNER: Record<ExplanationLevel, string> = {
  beginner: "Səviyyə: **Başlanğıc (Beginner)** — gündəlik analogiya və sadə addımlarla izah",
  intermediate: "Səviyyə: **Orta (Intermediate)** — mühəndislik müqaviləsi, riyazi addımlar və kod",
  advanced: "Səviyyə: **İrəli (Advanced)** — trade-off-lar, mürəkkəblik (Big-O), yaddaş/gecikmə və production riskləri",
};

function buildOfflineDemoResponse(store: ContentStore, req: MentorRequest): MentorResponse {
  const db = getDb();
  const profile = getProfile(db);
  const ctx = req.context;
  const level: ExplanationLevel = ctx?.explanationLevel ?? profile.explanation_level ?? "intermediate";
  const socratic = ctx?.socraticMode ?? Boolean(profile.socratic_mode);

  const lesson = ctx?.lessonId ? store.lessons.get(ctx.lessonId) : undefined;
  const section =
    lesson && ctx?.sectionId ? lesson.sections.find((s) => s.id === ctx.sectionId) : undefined;
  const exRef = ctx?.exerciseId ? store.exercises.get(ctx.exerciseId) : undefined;
  const project = ctx?.projectId ? store.projects.get(ctx.projectId) : undefined;

  const hits = searchCurriculum(
    store,
    `${req.message} ${lesson?.title ?? ""} ${section?.title ?? ""} ${exRef?.exercise.title ?? ""}`,
    lesson?.id,
    3,
  );

  const referencedLessonsMap = new Map<string, { id: string; title: string }>();
  if (lesson) referencedLessonsMap.set(lesson.id, { id: lesson.id, title: lesson.title });
  for (const h of hits) {
    referencedLessonsMap.set(h.lessonId, { id: h.lessonId, title: h.lessonTitle });
  }

  const parts: string[] = [
    `> **[Demo Mentor Rejimi — API açarı aktiv deyil]** | ${LEVEL_BANNER[level]}  \n` +
      `> *Canlı AI (OpenAI, Anthropic, Gemini və ya lokal Ollama) qoşmaq üçün **Settings** bölməsindən provayder seçə bilərsən.*`,
  ];

  const lowerMsg = req.message.toLowerCase();
  if (
    lowerMsg.includes("api") &&
    (lowerMsg.includes("train") || lowerMsg.includes("model") || lowerMsg.includes("fərq"))
  ) {
    parts.push(
      "### Mühəndislik fərqi: LLM API istifadəsi vs Model Training\n" +
        "- **LLM API (AI Application Engineering):** Pretrained modelə HTTP ilə prompt, JSON sxemi, RAG konteksti və tool sxemi göndərməkdir — çəkilər dəyişmir.\n" +
        "- **Model Training / Fine-Tuning (ML Engineering):** Dataset, loss funksiyası və gradient descent/LoRA ilə modelin parametrlərini yeniləməkdir.\n" +
        "- **Production AI / MLOps:** İstənilən modeli testlər, Docker, CI/CD, latency/cost monitorinqi və təhlükəsizlik qapıları ilə xidmətə çıxarmaqdır.",
    );
  }

  if (req.action === "review-project-file") {
    const code = ctx?.codeSnippet || "";
    const issues = staticCodeReviewIssues(code);
    parts.push(
      `### Senior Engineer Layihə Fayl İcmalı: \`${ctx?.filename || "attached_file"}\`` +
        (project ? ` (Layihə: **${project.title}**)` : ""),
    );
    parts.push(
      `**1. Cari kodun xülasəsi:** ${code.split(/\r?\n/).length} sətirlik modul göndərilib. Aşağıda avtomatik statik yoxlama və \`project-reviewer\` protokolu üzrə prioritet tapıntılar verilib:`,
    );
    if (issues.length > 0) {
      parts.push("**2. Kritik bloklayıcılar və yüksək təsirli risklər:**\n" + issues.join("\n"));
    } else {
      parts.push(
        "**2. Statik təhlükəsizlik və anti-pattern yoxlaması:** Aşkar `eval()`, SQL f-string injection, bare `except:`, mutable default və ya hardcoded secret tapılmadı.",
      );
    }
    parts.push(
      "**3. Mühəndislik Yoxlama Siyahısı (Verification Steps):**\n" +
        "- Boş input, `NaN`/`None` və sərhəd ölçüləri üçün ən azı 3 deterministik `pytest` testi əlavə et.\n" +
        "- Əgər bu ML/LLM faylıdırsa, baseline nəticəni və held-out eval metrikini (tək accuracy yox!) README-də göstər.\n" +
        "- Kodu işə saldığını iddia etməzdən əvvəl test nəticəsini layihənin **Evidence** bölməsinə yapışdır.",
    );
  } else if (req.action === "generate-exercise") {
    const mastery = getSkillMasteryMap(store, db);
    const weakSkill = Object.values(mastery).find(
      (m) => m.status === "needs_review" || m.status === "practicing",
    );
    const targetLesson =
      lesson ??
      (weakSkill
        ? [...store.lessons.values()].find((l) => l.skills.includes(weakSkill.skill_id))
        : [...store.lessons.values()][0]);
    const sampleEx = targetLesson?.exercises[0];
    parts.push(
      `### Sənin üçün Fərdi Praktik Tapşırıq (${targetLesson?.title ?? "Ümumi"})`,
    );
    if (sampleEx) {
      parts.push(
        `**Tapşırıq:** ${sampleEx.title}\n\n${sampleEx.prompt}\n\n` +
          `**1-ci İpucu:** ${sampleEx.hints[0] ?? "Əvvəlcə funksiyanın input/output müqaviləsini və edge case-ləri yaz."}\n` +
          `**Yoxlama addımı:** Practice Lab-da \`${sampleEx.id}\` tapşırığını açaraq real testlərlə yoxla.`,
      );
    }
  } else if (req.action === "explain-mistake") {
    parts.push("### Səhvin Səbəbi və Düzəliş Məntiqi");
    if (exRef) {
      parts.push(
        `**Tapşırıq:** ${exRef.exercise.title}\n` +
          (ctx?.learnerAnswer ? `**Sənin cavabın:** \`${ctx.learnerAnswer}\`\n` : "") +
          (ctx?.errorOutput ? `**Alınan xəta / rəy:** ${ctx.errorOutput}\n` : "") +
          `\n**Konseptual İzah:** ${exRef.exercise.explanation}`,
      );
      if (exRef.exercise.hints.length > 0) {
        parts.push(
          "**Növbəti cəhd üçün ipuclar:**\n" +
            exRef.exercise.hints.map((h, i) => `${i + 1}. ${h}`).join("\n"),
        );
      }
    } else {
      parts.push(
        "Yanlış cavabı düzəltmək üçün 3 addım:\n1. Giriş dəyərlərini kiçik nümunə ilə əl ilə izlə (dry-run).\n2. Sərhəd hallarını (0, boş list, mənfi ədəd, tip fərqi) yoxla.\n3. Səbəbi **Mistake Notebook** bölməsində 1 cümlə ilə qeyd et.",
      );
    }
  } else if (req.action === "review-exercise" && exRef) {
    const ex = exRef.exercise;
    parts.push(`### Tapşırıq üzrə bələdçi: **${ex.title}**`);
    parts.push(
      "Qaydamız: **tam həlli açmadan əvvəl mərhələli ipucu ilə özün tapmaq**.",
    );
    if (ex.hints.length > 0) {
      parts.push(
        "**Mərhələli ipuclar:**\n" + ex.hints.map((h, i) => `${i + 1}. ${h}`).join("\n"),
      );
    }
    if (ex.type === "code") {
      parts.push(
        "**Test edilən müqavilə şərtləri:** " +
          ex.tests.map((t) => `\`${t.name}\``).join(", "),
      );
    }
  } else if (req.action === "explain-code" && (ctx?.codeSnippet || section)) {
    const code = ctx?.codeSnippet || section?.body || "";
    const issues = staticCodeReviewIssues(code);
    parts.push("### Kodun Mühəndislik Təhlili (Code Review Protocol)");
    if (issues.length > 0) {
      parts.push("**Aşkarlanan risklər:**\n" + issues.join("\n"));
    } else {
      parts.push(
        "**Təhlil addımları:**\n" +
          "1. **Input → Output müqaviləsi:** Hansı tiplər və sərhədlər gözlənilir?\n" +
          "2. **Control flow:** Guard clause-lar boş/sıfır/səhv inputları erkən tuturmu?\n" +
          "3. **Side effects & Complexity:** Obyekt mutasiyası və ya gizli $O(n^2)$ dövr varmı?",
      );
    }
  } else if (req.action === "study-plan") {
    const mastery = getSkillMasteryMap(store, db);
    const needsRev = Object.values(mastery).filter((m) => m.status === "needs_review");
    const dem = Object.values(mastery).filter((m) => m.status === "demonstrated");
    const prac = Object.values(mastery).filter((m) => m.status === "practicing");
    parts.push(
      `### Fərdi Öyrənmə Planı (Həftəlik: ${profile.weekly_hours} saat | Gündəlik hədəf: ${profile.daily_goal_minutes} dəq)\n` +
        `- **Demonstrated (Sübut olunmuş):** ${dem.length} / ${store.skills.size}\n` +
        `- **Practicing (Məşqdə):** ${prac.length}\n` +
        `- **Knowledge Gaps / Needs Review:** ${needsRev.length}\n\n` +
        "**Bu gün üçün tövsiyə olunan ardıcıllıq:**\n" +
        "1. Vaxtı çatmış Flashcard-ları və `Needs review` bacarıqlarını təkrarla (5–10 dəq).\n" +
        "2. Aktiv dərsin növbəti bölməsini oxu və 1 kod tapşırığını ipucusuz həll et (20 dəq).\n" +
        "3. Aktiv layihəndə növbəti milestone üçün real kod/test sübutu əlavə et.",
    );
  } else {
    // General chat or lesson-help adapted by level
    if (section) {
      parts.push(`### Cari bölmə: *${section.title}*\n${section.body.slice(0, 1000)}`);
    } else if (lesson) {
      const targetKind =
        level === "beginner"
          ? "analogy"
          : level === "advanced"
            ? "tradeoffs"
            : "explanation";
      const bestSec =
        lesson.sections.find((s) => s.kind === targetKind) ?? lesson.sections[0];
      parts.push(
        `### ${lesson.title} — ${bestSec.title}\n${bestSec.body.slice(0, 1000)}`,
      );
    } else if (project) {
      parts.push(
        `### Layihə: *${project.title}*\n**Problem:** ${project.problem_statement}\n\n` +
          "**Definition of Done:**\n" +
          project.definition_of_done.map((d) => `- ${d}`).join("\n"),
      );
    }

    if (hits.length > 0) {
      parts.push(
        "### Kurikulum bazasından əlaqəli bölmələr\n" +
          hits
            .map(
              (h) =>
                `**${h.lessonTitle} → ${h.sectionTitle}**\n${h.text.slice(0, 650)}${
                  h.text.length > 650 ? "..." : ""
                }`,
            )
            .join("\n\n---\n\n"),
      );
    }
  }

  const followUp = socratic
    ? lesson
      ? `Sokratik yoxlama sualı: "${lesson.title}" mövzusunda real bir edge case və ya uğursuzluq ssenarisini öz sözlərinlə təsvir edə bilərsənmi?`
      : "Sokratik yoxlama sualı: Bu konsepti praktik kodda yoxlamaq üçün ilk yazacağın unit test hansı olardı?"
    : "Növbəti addımda hansı kod hissəsini və ya tapşırığı birlikdə yoxlayaq?";
  parts.push(`\n**Sənə sualım:** ${followUp}`);

  return {
    mode: "demo-no-key",
    providerName: "Local Curriculum Tutor (Demo)",
    modelName: "local-tfidf-pedagogy",
    explanationLevel: level,
    reply: parts.join("\n\n"),
    followUpQuestion: followUp,
    referencedLessons: [...referencedLessonsMap.values()],
    privacyNotice: PRIVACY_NOTICE_OFFLINE,
  };
}

// ---------------------------------------------------------------------------
// Live LLM Provider Callers (OpenAI / Ollama, Gemini, Anthropic)
// ---------------------------------------------------------------------------

// Approximate public USD pricing per 1M tokens (input, output) for cost visibility.
// Returns null for Ollama (local $0) or unknown custom models instead of fabricating numbers.
const MODEL_PRICING_PER_1M: Array<{ match: RegExp; inUsd: number; outUsd: number }> = [
  { match: /^gpt-4o-mini/i, inUsd: 0.15, outUsd: 0.6 },
  { match: /^gpt-4o/i, inUsd: 2.5, outUsd: 10.0 },
  { match: /^gemini-2\.5-flash/i, inUsd: 0.15, outUsd: 0.6 },
  { match: /^gemini-2\.5-pro/i, inUsd: 1.25, outUsd: 10.0 },
  { match: /^claude-3-5-sonnet/i, inUsd: 3.0, outUsd: 15.0 },
  { match: /^claude-3-5-haiku/i, inUsd: 0.8, outUsd: 4.0 },
];

function estimateCostUsd(
  provider: ProviderKind,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  if (provider === "ollama") return 0;
  const entry = MODEL_PRICING_PER_1M.find((p) => p.match.test(model));
  if (!entry) return null;
  const usd = (inputTokens / 1_000_000) * entry.inUsd + (outputTokens / 1_000_000) * entry.outUsd;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

function sanitizeErrorMessage(msg: string, secret?: string): string {
  let clean = msg || "naməlum xəta";
  if (secret && secret.length >= 4) {
    clean = clean.split(secret).join("[REDACTED]");
  }
  return clean.replace(/(key|token|api_key)=[^&\s]+/gi, "$1=[REDACTED]");
}

function formatProviderHttpError(provider: string, status: number): string {
  if (status === 401 || status === 403) {
    return `${provider} API açarı yanlışdır və ya icazəsi yoxdur (HTTP ${status}). Settings bölməsində açarı yoxla.`;
  }
  if (status === 429) {
    return `${provider} sorğu limiti (Rate Limit / HTTP 429) aşılıb. Bir neçə saniyə gözləyin və ya kvotanı yoxlayın.`;
  }
  return `${provider} API HTTP ${status}`;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

async function callLiveProvider(
  cfg: ReturnType<typeof detectProviderConfig>,
  systemPrompt: string,
  userPrompt: string,
  history: ChatTurn[],
): Promise<{ reply: string; usage: TokenUsage | null }> {
  const timeoutMs = Math.max(500, Number(process.env.AI_TIMEOUT_MS) || 20_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const recentTurns = history.slice(-6);

  try {
    if (cfg.provider === "gemini") {
      // Pass API key via x-goog-api-key header (never in URL query string!)
      const url = `${cfg.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(cfg.model)}:generateContent`;
      const contents = [
        ...recentTurns.map((t) => ({
          role: t.role === "assistant" ? "model" : "user",
          parts: [{ text: t.content.slice(0, 2000) }],
        })),
        { role: "user", parts: [{ text: userPrompt }] },
      ];
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": cfg.apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { temperature: 0.3, maxOutputTokens: 1400 },
        }),
      });
      if (!res.ok) throw new Error(formatProviderHttpError("Gemini", res.status));
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      };
      const reply =
        data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ||
        "Model boş cavab qaytardı.";
      const u = data.usageMetadata;
      const usage: TokenUsage | null = u
        ? {
            inputTokens: Number(u.promptTokenCount ?? 0),
            outputTokens: Number(u.candidatesTokenCount ?? 0),
            totalTokens: Number(
              u.totalTokenCount ?? (u.promptTokenCount ?? 0) + (u.candidatesTokenCount ?? 0),
            ),
            estimatedCostUsd: estimateCostUsd(
              cfg.provider,
              cfg.model,
              Number(u.promptTokenCount ?? 0),
              Number(u.candidatesTokenCount ?? 0),
            ),
          }
        : null;
      return { reply, usage };
    }

    if (cfg.provider === "anthropic") {
      const url = `${cfg.baseUrl.replace(/\/$/, "")}/messages`;
      const messages = [
        ...recentTurns.map((t) => ({ role: t.role, content: t.content.slice(0, 2000) })),
        { role: "user" as const, content: userPrompt },
      ];
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: 1400,
          system: systemPrompt,
          messages,
        }),
      });
      if (!res.ok) throw new Error(formatProviderHttpError("Anthropic", res.status));
      const data = (await res.json()) as {
        content?: Array<{ type: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const reply =
        data.content?.map((c) => c.text ?? "").join("") || "Model boş cavab qaytardı.";
      const u = data.usage;
      const usage: TokenUsage | null = u
        ? {
            inputTokens: Number(u.input_tokens ?? 0),
            outputTokens: Number(u.output_tokens ?? 0),
            totalTokens: Number((u.input_tokens ?? 0) + (u.output_tokens ?? 0)),
            estimatedCostUsd: estimateCostUsd(
              cfg.provider,
              cfg.model,
              Number(u.input_tokens ?? 0),
              Number(u.output_tokens ?? 0),
            ),
          }
        : null;
      return { reply, usage };
    }

    // OpenAI-compatible (OpenAI, Ollama, OpenRouter, etc.)
    const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...recentTurns.map((t) => ({ role: t.role, content: t.content.slice(0, 2000) })),
      { role: "user" as const, content: userPrompt },
    ];
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.3,
        max_tokens: 1400,
        messages,
      }),
    });
    if (!res.ok) throw new Error(formatProviderHttpError(cfg.provider.toUpperCase(), res.status));
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const reply = data.choices?.[0]?.message?.content || "Model boş cavab qaytardı.";
    const u = data.usage;
    const usage: TokenUsage | null = u
      ? {
          inputTokens: Number(u.prompt_tokens ?? 0),
          outputTokens: Number(u.completion_tokens ?? 0),
          totalTokens: Number(
            u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
          ),
          estimatedCostUsd: estimateCostUsd(
            cfg.provider,
            cfg.model,
            Number(u.prompt_tokens ?? 0),
            Number(u.completion_tokens ?? 0),
          ),
        }
      : null;
    return { reply, usage };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(`Provayder cavab vaxtı limitini (${timeoutMs} ms) aşdı (Timeout).`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export class DefaultTutorProvider implements TutorProvider {
  getStatus() {
    const cfg = detectProviderConfig();
    return {
      configured: cfg.configured,
      provider: cfg.provider,
      model: cfg.model,
      privacyNotice: cfg.configured ? PRIVACY_NOTICE_LIVE : PRIVACY_NOTICE_OFFLINE,
    };
  }

  getSafeConfig(): SafeMentorConfigView {
    const cfg = detectProviderConfig();
    const stored = readStoredConfig();
    return {
      provider: cfg.provider,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      hasStoredKey: Boolean(stored?.apiKey || cfg.apiKey),
      maskedKey: cfg.provider === "ollama" ? "local-ollama" : maskSecret(stored?.apiKey || cfg.apiKey),
      configured: cfg.configured,
      source: cfg.source,
      privacyNotice: cfg.configured ? PRIVACY_NOTICE_LIVE : PRIVACY_NOTICE_OFFLINE,
    };
  }

  saveConfig(update: {
    provider: ProviderKind;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    clearKey?: boolean;
  }): SafeMentorConfigView {
    const prev = readStoredConfig();
    // Security: NEVER reuse a stored API key when switching to a different provider!
    const sameProvider = prev?.provider === update.provider;
    const nextKey = update.clearKey
      ? ""
      : update.apiKey && update.apiKey.trim().length > 0
        ? update.apiKey.trim()
        : sameProvider
          ? (prev?.apiKey ?? "")
          : "";

    const next: StoredMentorConfig = {
      provider: update.provider,
      model: (update.model ?? "").trim() || DEFAULT_MODELS[update.provider],
      baseUrl: (update.baseUrl ?? "").trim() || DEFAULT_BASE_URLS[update.provider],
      apiKey: nextKey,
    };
    writeStoredConfig(next);
    return this.getSafeConfig();
  }

  private async respond(store: ContentStore, req: MentorRequest): Promise<MentorResponse> {
    const cfg = detectProviderConfig();
    const db = getDb();
    const profile = getProfile(db);
    const level: ExplanationLevel =
      req.context?.explanationLevel ?? profile.explanation_level ?? "intermediate";

    if (!cfg.configured) {
      return buildOfflineDemoResponse(store, req);
    }

    const skillsDoc = loadSkillInstructions();
    const snapshot = buildLearnerSnapshot(store, req.context);
    const systemPrompt =
      `${skillsDoc}\n\n## Current Learner & Platform Context\n${snapshot}\n\n` +
      `Action requested: ${req.action}. Target explanation depth: ${level}. ` +
      `Respond in Azerbaijani by default, keep English technical terms, give hints before full solutions during practice, never claim you executed code, help with projects without doing everything for the learner, and end with one focused question.`;

    // Load recent conversation history for multi-turn memory
    const contextType = req.contextType || (req.context?.lessonId ? "lesson" : "global");
    const contextId = req.contextId || req.context?.lessonId || "main";
    let history: ChatTurn[] = [];
    try {
      const conv = db
        .prepare(
          "SELECT messages_json FROM mentor_conversations WHERE context_type = ? AND context_id = ?",
        )
        .get(contextType, contextId) as { messages_json: string } | undefined;
      if (conv) {
        const parsed = JSON.parse(conv.messages_json) as Array<{ role: "user" | "assistant"; content: string }>;
        history = parsed.filter((m) => m.role === "user" || m.role === "assistant");
      }
    } catch {
      history = [];
    }

    try {
      const { reply, usage } = await callLiveProvider(cfg, systemPrompt, req.message, history);
      const referencedLessons: Array<{ id: string; title: string }> = [];
      if (req.context?.lessonId) {
        const l = store.lessons.get(req.context.lessonId);
        if (l) referencedLessons.push({ id: l.id, title: l.title });
      }
      return {
        mode: "live-ai",
        providerName: cfg.provider,
        modelName: cfg.model,
        explanationLevel: level,
        reply,
        referencedLessons,
        usage,
        fallbackError: null,
        privacyNotice: PRIVACY_NOTICE_LIVE,
      };
    } catch (err) {
      const safeErr = sanitizeErrorMessage((err as Error).message, cfg.apiKey);
      const fallback = buildOfflineDemoResponse(store, req);
      return {
        ...fallback,
        usage: null,
        fallbackError: safeErr,
        reply:
          `> **Xəbərdarlıq:** Canlı AI provayderinə (${cfg.provider}) müraciət zamanı xəta baş verdi (${safeErr}). Aşağıda lokal kurikulum bazasından cavab göstərilir.\n\n` +
          fallback.reply,
      };
    }
  }

  generateLessonHelp(store: ContentStore, req: MentorRequest) {
    return this.respond(store, { ...req, action: "lesson-help" });
  }
  reviewExercise(store: ContentStore, req: MentorRequest) {
    return this.respond(store, { ...req, action: "review-exercise" });
  }
  explainCode(store: ContentStore, req: MentorRequest) {
    return this.respond(store, { ...req, action: "explain-code" });
  }
  createStudyPlan(store: ContentStore, req: MentorRequest) {
    return this.respond(store, { ...req, action: "study-plan" });
  }
  generateExercise(store: ContentStore, req: MentorRequest) {
    return this.respond(store, { ...req, action: "generate-exercise" });
  }
  explainMistake(store: ContentStore, req: MentorRequest) {
    return this.respond(store, { ...req, action: "explain-mistake" });
  }
  reviewProjectFile(store: ContentStore, req: MentorRequest) {
    return this.respond(store, { ...req, action: "review-project-file" });
  }
  chat(store: ContentStore, req: MentorRequest) {
    return this.respond(store, req);
  }
}

export const tutorProvider: TutorProvider = new DefaultTutorProvider();
