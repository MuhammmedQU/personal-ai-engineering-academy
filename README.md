# AI Engineering Academy — Şəxsi AI Mühəndislik Universiteti

**AI Engineering Academy** — yalnız **bir şəxsi istifadəçi** (sən) üçün yaradılmış, lokal işləyən, sübut-əsaslı (evidence-based) şəxsi AI Mühəndisliyi universiteti, kodlaşdırma laboratoriyası, layihə iş sahəsi, tədris planlayıcısı, bilik bazası və adaptiv AI mentorudur.

Bütün izahlar Azərbaycan dilində sadə və riyazi-mühəndislik baxımından dəqiq verilir, bütün qlobal İngilis texniki terminologiyası qorunur, Python kodları brauzer daxilində təhlükəsiz **Pyodide WebAssembly** sandbox-ında icra olunur, SQL sorğuları təmiz **`:memory:` SQLite** sandbox-ında yoxlanılır və bütün öyrənmə tarixçən lokal `data/academy.sqlite` bazasında qalıcı saxlanılır.

---

## 1. Sürətli Başlanğıc (Run Instructions — Windows PowerShell)

### Tələblər
- **Node.js 24+** (daxili `node:sqlite` və native TypeScript icrası ilə)
- **Python 3.12+** (yalnız `npm run validate:content` ilə kurikulum testlərini yoxlamaq üçün; öyrənən kodu brauzerdə offline Pyodide WASM ilə işləyir)

### İnkişaf Rejimində İşə Salma
```powershell
npm install
npm run dev
```
- UI: **`http://localhost:5173`**
- Lokal API Server: **`http://localhost:3001`**

### Production Rejimində İşə Salma (Tək Port)
```powershell
npm run build
npm start
```
Bu rejimdə frontend, `/pyodide/*` WASM faylları və `/api/*` serveri tək portdan — **`http://localhost:3001`** üzərindən xidmət göstərir.

---

## 2. Doğrulama və Test Əmrləri

```powershell
# 1. Bütün kurikulum YAML fayllarını və 58 Python kod tapşırığının istinad həllərini yoxla:
npm run validate:content

# 2. TypeScript tip yoxlaması (frontend + server):
npm run typecheck

# 3. Avtomatlaşdırılmış unit & inteqrasiya testləri (Vitest — 5 test faylı, 37 test):
npm test

# 4. Production build:
npm run build

# 5. Real proses SQLite restart persistence testi:
node tests/e2e/persistence.mjs

# 6. Real Chrome End-to-End brauzer testi (26 tam istifadəçi ssenarisi):
node tests/e2e/browser.mjs

# 7. Real Chrome Desktop/Tablet/Mobile UX & Accessibility auditi:
node tests/e2e/ux-audit.mjs
```

---

## 3. Şəxsi AI Mentor və API Açarlarının Təhlükəsiz Quraşdırılması

Tətbiq **heç bir API açarı olmadan** tam funksional işləyir: default olaraq **Offline Demo Mentor Rejimində** (`demo`) 42 dərs, lüğət və statik kod/təhlükəsizlik analizatoru üzərində lokal cavablar verir.

Canlı LLM provayderi qoşmağın **2 təhlükəsiz yolu** var:

### Yol A — UI üzərindən (Tövsiyə olunur)
Tətbiqdə **`10. Settings` -> "Şəxsi AI Mentor Provayderi"** bölməsindən provayderi seç (`OpenAI`, `Anthropic Claude`, `Google Gemini`, `Ollama (lokal)` və ya `Offline Demo`) və API açarını daxil et.
- Açar yalnız lokal serverdə `data/local-secrets.json` faylında (`.gitignore` daxilində, `0600` icazə ilə) **write-only** saxlanılır.
- Xam API açarı **HEÇ VAXT** brauzerə, frontend bundle-a, `localStorage`-a və ya GET cavablarına qaytarılmır (yalnız `***xxxx` maskası göstərilir).

### Yol B — `.env` faylı ilə
`.env.example` faylını `.env` kimi kopyala:
```ini
# "demo" (default offline) | "openai" | "anthropic" | "gemini" | "ollama"
AI_PROVIDER=openai
AI_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
AI_MODEL=
AI_BASE_URL=

PORT=3001
DB_PATH=./data/academy.sqlite
```

---

## 4. Platformanın Əsas İmkanları

### A. Tam AI Mühəndisliyi Kurikulumu (8 Track · 31/31 Tam Yazılmış Modul · 45 Tam Dərs · 44 Bacarıq · 287 Tapşırıq & Quiz)
- **Track A — Software Engineering for AI (10 dərs):** Python funksiyalar/müqavilələr, xəta idarəetməsi, data strukturları & mürəkkəblik, `pytest` testləri, HTTP/JSON API klientləri, Advanced Python (OOP/Protocols + Generators/Streaming), Git/Debugging/Structured Logging, SQL & Database Engineering, Linux/CLI/Shell Systems (`chmod`, pipes, `set -euo pipefail`, `tmux`, `nvidia-smi`).
- **Track B — Math & Statistics for AI (5 dərs):** Vektorlar & dot product, matrislər & shape-lər, törəmələr & gradient descent, ehtimal & Bayes, PCA & Statistics/Hypothesis Testing.
- **Track C — Classical Machine Learning (7 dərs):** Problem framing & baselines, data leakage, classification metrics, regression metrics, overfitting & regularization, Gradient Boosting (XGBoost/LightGBM), Unsupervised ML (KMeans & PCA).
- **Track D — Deep Learning (4 dərs):** Neyronlar & backpropagation, PyTorch training loop, Transformers & Self-Attention, Advanced PyTorch Training & Transfer Learning.
- **Track E — Modern AI & LLM Engineering (6 dərs):** Tokens & structured output, embeddings & semantic search, RAG pipeline & evaluation, tool-calling & AI agents, Fine-Tuning (LoRA vs RAG), AI Evaluation, Safety & Reliability.
- **Track F — Production AI / MLOps (4 dərs):** FastAPI model serving, Docker/config/secrets, logging & monitoring, CI/CD, Data/Model Versioning & Canary Rollouts.
- **Track G — Specializations (7 dərs):** Computer Vision (CNN/IoU/NMS), Robotics perception & control (EMA/Kalman/PID), Multilingual NLP & ASR (Fertility/WER), RecSys & Time Series Forecasting, Edge AI Quantization & Adversarial Security, Distributed Data Engineering (Parquet/DuckDB/DDP/FSDP/KV-Cache/vLLM), Multimodal AI (CLIP/VLM) & 3-Pass Research Paper Reading.
- **Track H — Product & Startup Engineering (2 dərs):** Problem discovery, MVP & unit economics, Willingness to Pay, Build vs API & Cohort Iteration.

### B. İrəli Səviyyə Kodlaşdırma Laboratoriyası (`4. Practice Lab`)
1. **İnteraktiv Tapşırıqlar:** 7 tapşırıq növü (`code`, `mcq`, `multi`, `numeric`, `text`, `order`, `explain`), **58 brauzerdə test olunan Python kod tapşırığı**, mərhələli ipuclar (`>=2` hint) və həllin izahı.
2. **Python 3.12 Sandbox (Pyodide WASM):** `stdin` (`input()`), `stdout`, sonsuz dövrə qarşı Web Worker timeout qoruması, 4-space formatlama, saxlanılmış kod qaralamaları (`code_drafts`) və bir kliklə AI Mentordan xəta izahı. *(Lokal PyTorch/CUDA/Docker mühiti üçün bax: [`docs/LOCAL_ML_ENVIRONMENT.md`](docs/LOCAL_ML_ENVIRONMENT.md).)*
3. **SQL Sandbox (Isolated `:memory:` SQLite Worker):** Hər sorğu ayrıca `worker_threads` daxilində təmiz `:memory:` SQLite bazasında 4 MiB yaddaş və 3 saniyəlik sərt timeout ilə icra olunur; `ATTACH`/`DETACH`/`LOAD_EXTENSION` bloklanır və sonsuz `WITH RECURSIVE` sorğuları serveri dondurmadan dayandırılır.

### C. Layihə Laboratoriyası (`5. Projects` — 8 Real Mühəndislik Layihəsi)
`tabular-ml-prediction`, `model-serving-api`, `pdf-knowledge-assistant`, `tool-using-ai-workflow`, `focused-startup-mvp`, `cv-robotics-explorer`, `transformer-lora-finetuning`, `edge-ai-sql-telemetry`.
- Hər layihədə problem tərifi, arxitektura, milestone checklist-ləri, **məcburi sübut (Evidence) qapısı**, test/eval planı, failure case-lər, təhlükəsizlik və GitHub README strukturu var.
- Öz layihə fayllarını yapışdır və ya kompüterdən yüklə və qalıcı **Senior AI Engineer Code Review** al.

### D. Şəxsi AI Mentor (`6. AI Mentor`)
- 3 izah səviyyəsi: **Başlanğıc (Beginner)**, **Orta (Intermediate)**, **İrəli (Advanced)**.
- **Sokratik Rejim** açarı (həlli birbaşa vermək əvəzinə yönləndirici suallarla düşündürür).
- 6 ixtisaslaşmış aksiya: `generateLessonHelp()`, `reviewExercise()`, `explainCode()`, `createStudyPlan()`, `generateExercise()`, `explainMistake()`.
- Sənin real kurikulum irəliləyişini, qeydlərini, səhvlərini və bacarıq statusunu kontekst kimi oxuyur.

### E. Tədris Planlayıcısı, Bilik Bazası və Yaddaş Sistemi (`8. Study Planner` & `9. Knowledge & Flashcards`)
- **Sübut-Əsaslı Bacarıq Ustalığı:** `not_started` -> `introduced` -> `practicing` -> `demonstrated` -> `needs_review` (quiz və diaqnostika heç vaxt `demonstrated` vermir; 2 fərqli ipucusuz tapşırıq həlli tələb olunur).
- **SM-2 Spaced Repetition Flashcards:** Başladığın dərslərin texniki terminləri avtomatik karta çevrilir + öz kartlarını yarada bilərsən.
- **Mistake Notebook (Səhvlər Dəftəri):** Uğursuz cəhdləri toplayır və hər səhv üçün çıxardığın dərsi (`takeaway`) qeyd etməyə imkan verir.
- **Code Snippets, Personal Glossary, PDF/Məqalə Resursları və Qlobal Axtarış (`/api/search`).**
- **Streak, Gündəlik Hədəf, 30 Günlük Təqvim Heatmap və Tam JSON Backup/Restore (`10. Settings`).**

---

## 5. Təhlükəsizlik və Məxfilik Prinsipi (Yalnız Tək İstifadəçi)
- Çoxistifadəçili qeydiyyat, ödəniş, abunəlik və ya telemetriya yoxdur.
- `localOnlyGuard`: yalnız `localhost` / `127.0.0.1` Host/Origin sorğularını qəbul edir (CSRF və DNS rebinding qoruması).
- Bütün API girişləri Zod sxemləri ilə yoxlanılır; SQLite sorğuları 100% parametrləşdirilmişdir.
- Bütün verilənlər bazası miqrasiyaları qeyri-destruktivdir — mövcud irəliləyişin qorunur.
