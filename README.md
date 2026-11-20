# AI Engineering Academy
### Şəxsi AI Mühəndislik Universiteti və İnteraktiv Kodlaşdırma Platforması

AI Engineering Academy — proqramlaşdırma əsaslarından Advanced AI Engineering səviyyəsinə qədər öyrənmək üçün hazırlanmış şəxsi, sübut-əsaslı (evidence-based) tədris və mühəndislik platformasıdır.

Platforma interaktiv dərsləri, Python və SQL laboratoriyalarını, AI Mentor-u, praktiki mühəndislik layihələrini və fərdi öyrənmə izləmə sistemini vahid mühitdə birləşdirir.

Layihənin əsas məqsədi sadəcə nəzəri bilik vermək deyil, istifadəçinin real tapşırıqlar və layihələr vasitəsilə mühəndislik bacarıqlarını inkişaf etdirməsidir.

## Əsas xüsusiyyətlər

- **AI Engineering Curriculum:** 8 tədris istiqaməti, 31 modul və 45 dərs.
- **Interactive Practice Lab:** 58 Python kodlaşdırma tapşırığı və müxtəlif quiz növləri.
- **Python Sandbox:** Pyodide və WebAssembly vasitəsilə brauzerdə Python 3.12 icrası.
- **SQL Sandbox:** İzolyasiya olunmuş SQLite mühitində SQL sorğularının yoxlanılması.
- **AI Mentor:** OpenAI, Anthropic Claude, Google Gemini, Ollama və Offline Demo dəstəyi.
- **Project Lab:** Real mühəndislik problemlərinə əsaslanan 8 praktiki layihə.
- **Evidence-Based Mastery:** Bacarıqların yalnız real tapşırıqların uğurlu icrası ilə təsdiqlənməsi.
- **Spaced Repetition:** SM-2 alqoritmi əsasında flashcard və təkrar sistemi.
- **Study Planner:** Gündəlik hədəflər, streak və öyrənmə planı.
- **Knowledge Base:** Şəxsi qeydlər, texniki lüğət, kod nümunələri və səhvlər dəftəri.
- **Progress Tracking:** Öyrənmə tarixçəsi və bacarıqların inkişafının izlənməsi.
- **Backup & Restore:** JSON formatında məlumatların ehtiyat nüsxəsinin yaradılması və bərpası.

## Texnologiyalar

| Sahə | Texnologiyalar |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | Node.js, Hono |
| Database | SQLite |
| Python Execution | Pyodide, WebAssembly |
| SQL Execution | SQLite, Worker Threads |
| AI Integration | OpenAI, Anthropic, Google Gemini, Ollama |
| Validation | Zod |
| Testing | Vitest, Chrome E2E |
| Mathematics Rendering | KaTeX |
| Diagrams | Mermaid |

## Tədris istiqamətləri

Platforma 8 əsas istiqaməti əhatə edir:

1. Software Engineering for AI
2. Mathematics & Statistics for AI
3. Classical Machine Learning
4. Deep Learning
5. Modern AI & LLM Engineering
6. Production AI & MLOps
7. AI Specializations
8. Product & Startup Engineering

Mövzular Python, Data Structures, Algorithms, Machine Learning, Neural Networks, Transformers, RAG, AI Agents, Model Serving, Docker və MLOps kimi sahələri əhatə edir.

## İnteraktiv kodlaşdırma laboratoriyası

### Python Sandbox

- Pyodide vasitəsilə brauzerdə Python 3.12.
- `input()` və `print()` dəstəyi.
- Web Worker timeout qoruması.
- Kod qaralamalarının saxlanılması.
- AI Mentor vasitəsilə xəta izahı.

### SQL Sandbox

- İzolyasiya olunmuş SQLite `:memory:` bazası.
- Worker Threads daxilində sorğuların icrası.
- 4 MiB yaddaş limiti.
- 3 saniyəlik timeout.
- Təhlükəli SQL əməliyyatlarına qarşı məhdudiyyətlər.

## Praktiki mühəndislik layihələri

Platformada 8 praktiki layihə mövcuddur:

- Tabular ML Prediction
- Model Serving API
- PDF Knowledge Assistant
- Tool-Using AI Workflow
- Focused Startup MVP
- Computer Vision & Robotics Explorer
- Transformer LoRA Fine-Tuning
- Edge AI & SQL Telemetry

Hər layihədə arxitektura, mərhələlər, test planı, failure cases, təhlükəsizlik tələbləri və GitHub README strukturu nəzərdə tutulub.

## AI Mentor

AI Mentor istifadəçinin real öyrənmə kontekstindən istifadə edərək fərdi kömək göstərir.

Dəstəklənən provayderlər:

- OpenAI
- Anthropic Claude
- Google Gemini
- Ollama
- Offline Demo

Əsas imkanlar:

- Kodun təhlili və izahı.
- Tapşırıqların yoxlanılması.
- Səhvlərin izahı.
- Fərdi dərs və çalışma planlarının yaradılması.
- Yeni tapşırıqların hazırlanması.
- Sokratik öyrənmə rejimi.

## Təhlükəsizlik və məlumatların qorunması

- Platforma ilkin olaraq şəxsi, single-user istifadə üçün hazırlanıb.
- API girişləri Zod sxemləri ilə yoxlanılır.
- SQL sorğuları parametrləşdirilmiş şəkildə işlədilir.
- Python və SQL icrası məhdudlaşdırılmış sandbox mühitlərində aparılır.
- API açarları frontend koduna daxil edilmir.
- Şəxsi verilənlər bazası və lokal secret faylları Git vasitəsilə paylaşılmamalıdır.
- Mövcud öyrənmə məlumatlarını qorumaq üçün qeyri-destruktiv database migrations istifadə olunur.

## Lokal quraşdırma

### Tələblər

- Node.js 24+
- Python 3.12+ (yalnız kurikulum məzmununun yoxlanılması üçün)

### Quraşdırma

```bash
git clone https://github.com/MuhammedQU/personal-ai-engineering-academy.git

cd personal-ai-engineering-academy

npm install
```

### Development rejimi

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3001`

### Production build

```bash
npm run build
npm start
```

Production rejimində frontend və API eyni port üzərindən xidmət göstərir.

## Test və keyfiyyət yoxlamaları

Layihədə aşağıdakı yoxlama əmrləri mövcuddur:

```bash
npm run validate:content
npm run typecheck
npm test
npm run build
node tests/e2e/persistence.mjs
node tests/e2e/browser.mjs
node tests/e2e/ux-audit.mjs
```

Əvvəlki yoxlamalarda:

- 37/37 automated test uğurlu olub.
- TypeScript typecheck uğurlu olub.
- Production build uğurlu olub.
- SQLite persistence testi uğurlu olub.
- Chrome E2E testləri uğurlu olub.

Qeyd: Bunlar əvvəlki test nəticələridir. Son dəyişikliklərdən sonra nəticələr yenidən yoxlanmalıdır.

## Lokal AI provayderinin konfiqurasiyası

Tətbiq API açarı olmadan Offline Demo rejimində işləyə bilər.

Canlı AI provayderindən istifadə etmək üçün `.env.example` faylını `.env` kimi kopyalayıb uyğun dəyişənləri konfiqurasiya et.

API açarlarını heç vaxt GitHub-a yükləmə.

## Məhdudiyyətlər

- Pyodide mühiti əsasən Python Standard Library üçün nəzərdə tutulub.
- PyTorch, CUDA və digər ağır ML kitabxanaları üçün lokal Python mühiti tələb olunur.
- Docker və GPU əsaslı eksperimentlər lokal mühəndislik mühitində aparılmalıdır.

Əlavə məlumat: `docs/LOCAL_ML_ENVIRONMENT.md`

## Layihənin statusu

AI Engineering Academy aktiv inkişaf etdirilən şəxsi mühəndislik və öyrənmə layihəsidir.

**Müəllif:** Muhammed

**Repository:** https://github.com/MuhammedQU/personal-ai-engineering-academy

**License:** Hələ müəyyən edilməyib.
