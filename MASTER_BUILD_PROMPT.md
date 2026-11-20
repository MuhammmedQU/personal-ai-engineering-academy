# MASTER BUILD PROMPT — AI Engineering Academy

You are an expert product team operating inside Google Antigravity: principal full-stack engineer, AI/ML engineer, instructional designer, UX designer, QA engineer, and technical writer.

Build a complete, working, locally runnable educational web application called **AI Engineering Academy**. This is not a landing page, static mockup, or chatbot wrapper. It must be a real interactive learning platform that teaches the user AI engineering through structured lessons, exercises, coding practice, projects, progress tracking, and an AI mentor.

## 0. Non-negotiable product goal

The learner must be able to learn by actually using the application you build. It should function as a personal AI engineering school.

The platform must:
- Teach from the learner's real current level, not assume they are a beginner.
- Explain concepts simply in Azerbaijani while retaining English technical terminology.
- Teach programming logic and engineering judgment, not just syntax or code copying.
- Combine theory, diagrams, worked examples, coding exercises, quizzes, projects, debugging, and review.
- Use AI as a tutor and coding assistant, while requiring the learner to understand, test, and verify generated code.
- Track mastery based on demonstrated ability, not merely lesson completion.
- Work without an AI API key in a meaningful offline/demo mode. AI-specific features should gracefully indicate when an API key is required.
- Never fake execution, test results, model performance, citations, or progress.

## 1. First inspect, then plan, then implement

Before coding:
1. Inspect the existing repository, package manager, framework, current files, and available tools.
2. Do not overwrite a working project or remove existing functionality without a reason.
3. Create a concise implementation plan and architecture.
4. Identify missing requirements and make sensible defaults; do not ask the user a long list of questions.
5. Implement the application end-to-end.
6. Run it, run available checks, fix errors, and verify the main user journeys.
7. Finish with exact run instructions, environment variables, implemented features, limitations, and any checks not completed.

Do not stop after generating a plan or wireframes. Build the product.

## 2. Suggested technical architecture

Prefer a simple, maintainable stack compatible with the existing repository. If the repo is empty, use:

- Frontend: React + TypeScript + Vite.
- Styling: Tailwind CSS if already available; otherwise clean CSS modules or a small design system.
- Backend: Python FastAPI OR a suitable existing backend already in the repo.
- Database: SQLite for local-first MVP, with a clear path to PostgreSQL later.
- ORM/migrations: SQLAlchemy + Alembic if using FastAPI.
- Authentication: optional for the first local version; do not block learning behind sign-up.
- Code execution: do NOT execute arbitrary learner code on the backend without a sandbox. For the MVP, use browser-based safe exercises or clearly marked simulated execution. If a real execution environment is implemented, isolate it in a restricted sandbox with time, memory, network, and filesystem limits.
- AI provider: implement a provider abstraction. Use environment variables for API keys. Never hardcode secrets. Do not assume a particular provider unless the user configures one.
- Tests: add meaningful frontend/backend tests for critical flows.

If Antigravity has browser or terminal tools, use them to inspect, run, and verify the app. Do not claim verification unless actually performed.

## 3. Product experience and navigation

Create a polished, responsive interface suitable for desktop and mobile. The UI language should default to Azerbaijani. Keep technical vocabulary such as Python, Machine Learning, Gradient Descent, Embeddings, RAG, API, and Deployment in English, with Azerbaijani explanations.

Main navigation:
1. Dashboard
2. Learning Path
3. Lessons
4. Practice Lab
5. Projects
6. AI Mentor
7. Progress & Portfolio
8. Settings

### Dashboard
Show:
- Current learning stage.
- Next recommended lesson.
- Current project and next milestone.
- Weekly learning activity.
- Skills map: Strong / In progress / Needs work.
- Recent mistakes to revisit.
- A clear "Continue learning" action.
Do not invent progress for a new user. Start with an honest onboarding state.

### Onboarding and diagnostic
Ask a short diagnostic (maximum 8 questions per screen) covering:
- Python and programming logic.
- Software engineering: Git, testing, APIs, SQL.
- Math: linear algebra, calculus basics, probability, statistics.
- Classical ML: splitting, leakage, overfitting, metrics, algorithms.
- Deep learning: tensors, neural networks, loss, backpropagation.
- LLM engineering: API, structured output, embeddings, RAG, tool calling.
- Deployment: Docker, environment variables, monitoring.
- Learning goals and available weekly time.

Allow "I don't know". Do not shame the learner. Do not infer mastery from self-rating alone. Follow the diagnostic with a short practical check where appropriate.

After onboarding, generate:
- Strong topics.
- Partial topics.
- Missing topics.
- First three learning actions.
- A flexible study plan, not a false guarantee of job readiness.

### Learning path
Create a visual roadmap with these tracks:

A. Software Engineering for AI
- Python fluency: data types, conditions, loops, functions, modules, exceptions, files.
- Data structures and algorithmic complexity.
- OOP, composition, type hints.
- Virtual environments, package management.
- Git/GitHub, debugging, logging, pytest.
- HTTP, REST, JSON, API clients.
- SQL, relational databases.
- FastAPI and backend fundamentals.

B. Math & Statistics for AI
- Vectors, matrices, dot product, matrix multiplication, norms.
- Derivatives, partial derivatives, chain rule, gradients.
- Probability, conditional probability, Bayes' rule.
- Mean, variance, distributions, sampling, confidence intervals.
- Loss functions, gradient descent, learning rate, optimization.
Every equation must define its symbols and include a small numerical example.

C. Classical Machine Learning
- Problem framing, baselines, data quality, data leakage.
- Train/validation/test split, cross-validation.
- Regression and classification.
- Linear/logistic regression, decision trees, random forests, gradient boosting.
- Clustering: KMeans.
- Dimensionality reduction: PCA.
- Preprocessing, feature engineering.
- Metrics: accuracy, precision, recall, F1, ROC-AUC, MAE, RMSE.
- Overfitting, underfitting, regularization, bias-variance.
- Error analysis and interpretability.
Use scikit-learn for practice.

D. Deep Learning
- Tensors and tensor shapes.
- Neurons, layers, activation functions, loss.
- Forward pass, backpropagation, optimizers.
- Training loops, batches, epochs, learning rate.
- Validation and regularization.
- CNN, attention, Transformers.
Use PyTorch as the primary framework.

E. Modern AI & LLM Engineering
- Tokens, context windows, model limits.
- Prompting as specification.
- Structured outputs and validation.
- Tool/function calling.
- Embeddings and semantic search.
- RAG: ingestion, chunking, retrieval, reranking, generation, citations.
- Vector and hybrid search.
- Fine-tuning vs prompting vs RAG.
- Agents vs deterministic workflows.
- State, memory, permissions, human approval.
- Evaluation, hallucination tests, regression tests.
- Latency, cost, caching, rate limits, privacy, security.

F. Production AI / MLOps
- Backend integration.
- Docker and reproducible environments.
- Deployment and CI/CD.
- Data/model versioning.
- Monitoring quality, latency, errors, drift, cost.
- Logging, secrets, access control.
- Load and failure testing.

G. Specializations
- Computer Vision.
- NLP and speech.
- Recommendation systems.
- Time series.
- Robotics and autonomous systems.
- Edge AI and embedded systems.
- AI security.
Specializations should be optional and selected based on interest and projects.

H. Product & Startup Engineering
- Find a specific user problem.
- Interview potential users.
- Define an MVP and measurable success criteria.
- Build vs buy vs API decisions.
- Estimate inference, hosting, and support costs.
- Test willingness to pay.
- Privacy, legal, and safety review.
- Iterate from real feedback.

Each track must contain modules, lessons, prerequisites, estimated effort ranges (not guarantees), practical tasks, and mastery criteria. Avoid fabricating exact lesson counts if content has not been authored.

## 4. Lesson player — core learning experience

Each lesson must include:
1. Learning objectives.
2. Why the concept matters.
3. Simple Azerbaijani explanation.
4. English technical terms and definitions.
5. Analogy or mental model.
6. Diagram or flow visualization when useful.
7. A worked example with small numbers.
8. Code example with explanation of important lines.
9. Common mistakes and debugging hints.
10. Engineering trade-offs and real-world limitations.
11. Short comprehension check.
12. Hands-on exercise.
13. Mastery criteria.
14. Links to prerequisites and next lesson.

Use progressive disclosure. Do not overwhelm the learner with a wall of text. Keep lessons broken into readable sections.

A learner should be able to:
- Mark a section as understood / unclear.
- Ask the AI mentor about the current section.
- Take a quiz.
- Submit an exercise.
- Save notes.
- Bookmark a lesson.
- Return to the last position.

## 5. Practice Lab

Build a practice area with:
- Python concept exercises.
- Read and explain this code tasks.
- Predict the output tasks.
- Debug this code tasks.
- ML metric calculation tasks.
- Math exercises for vectors, matrices, probability, and gradients.
- Small data analysis tasks.
- LLM/RAG architecture reasoning tasks.

For each exercise:
- State the task clearly.
- Provide hints in stages.
- Do not reveal the solution immediately by default.
- Give feedback explaining why an answer is right or wrong.
- Include test cases or expected reasoning where possible.
- Track attempts and recurring mistakes.

Do not run arbitrary code unsafely. If there is no sandbox, implement answer checking for constrained tasks and explain limitations.

## 6. AI Mentor

Implement an AI mentor interface that knows:
- The learner's profile and diagnostic.
- Current learning path and lesson.
- Demonstrated mastery and weak areas.
- Current project and prior attempts.
- The teaching rules in `skills/ai-engineering-tutor/SKILL.md`.

Mentor behaviors:
- Answer in Azerbaijani by default.
- Explain simply without sacrificing accuracy.
- Ask one useful question at a time.
- Use the current lesson context.
- Give hints before full answers when the learner is practicing.
- Correct misconceptions respectfully.
- Never claim it executed code unless a real execution tool did.
- Never fabricate sources or documentation links.
- When current tool/library behavior matters, direct the learner to official docs or use configured retrieval.
- Avoid giving a huge roadmap when the learner asked a specific question.
- Distinguish AI application engineering, ML engineering, AI research, and AI infrastructure.
- Explain that using an LLM API is not the same as training a model.

### AI provider integration
Create a clean interface such as:
- `TutorProvider`
- `generateLessonHelp()`
- `reviewExercise()`
- `explainCode()`
- `createStudyPlan()`

Use server-side environment variables, never expose API keys to the browser. Include:
- `.env.example`
- provider setup instructions
- friendly missing-key state
- request timeout and error handling
- basic rate limiting if backend supports it
- privacy notice about sending learner content to an external provider

Do not build a fake "AI" that merely returns random canned answers. If no API key exists, provide a clearly labelled demo mentor with limited sample interactions.

## 7. Projects and portfolio

Create a project workspace with milestones, task checklists, notes, and evidence.

Seed these project templates:
1. Tabular ML prediction project:
   - define problem, dataset, baseline, preprocessing, train/evaluate, error analysis.
2. Model serving API:
   - package a model behind FastAPI, validate inputs, tests, deploy locally.
3. PDF knowledge assistant:
   - ingestion, chunking, embeddings, retrieval, RAG, citations, evaluation.
4. Tool-using AI workflow:
   - structured output, tools, permission checks, human approval, logs.
5. Focused startup MVP:
   - user problem, interviews, scope, prototype, evaluation, cost estimate.
6. Optional robotics/computer vision project:
   - image/object detection or robot simulation; hardware not required initially.

For every project include:
- Problem statement.
- Intended user.
- Requirements and non-goals.
- Architecture.
- Milestones.
- Test/evaluation plan.
- Failure cases.
- Privacy/security considerations.
- Definition of done.
- README outline.
Do not claim a project is complete until evidence is recorded.

## 8. Progress and mastery engine

Persist:
- diagnostic answers,
- lesson progress,
- exercise attempts,
- quiz results,
- notes and bookmarks,
- skill mastery status,
- project milestones,
- weekly activity.

Use statuses:
- Not started
- Introduced
- Practicing
- Demonstrated
- Needs review

A concept can become "Demonstrated" only after the learner solves a new task, explains the reasoning, or debugs an example—not just after opening a lesson or clicking "complete".

Add spaced review:
- Bring back concepts the learner repeatedly misses.
- Do not over-notify or gamify excessively.
- Allow learner to control reminders.

## 9. Data model

Design a clean schema for:
- UserProfile
- DiagnosticAttempt
- Skill
- Track
- Module
- Lesson
- LessonProgress
- Exercise
- ExerciseAttempt
- Quiz
- QuizAttempt
- Project
- ProjectMilestone
- Note
- Bookmark
- MentorConversation (store only what is necessary; explain retention)
- StudySession

Seed a small amount of high-quality initial content rather than empty placeholder pages. Keep content data separate from UI components.

## 10. UX and design quality

Design direction:
- Modern technical learning workspace.
- Clear hierarchy and readable typography.
- Calm, professional colors; avoid excessive gradients and gamification.
- Responsive layouts.
- Good empty, loading, error, and success states.
- Accessible keyboard navigation and labels.
- Avoid fake charts and fake progress.
- Dashboard should feel useful, not decorative.
- Use diagrams and interactive widgets where they genuinely aid understanding.
- Include dark/light mode if straightforward.

## 11. Content quality rules

- Be accurate and practical.
- Avoid "become an expert in 3 months" promises.
- Distinguish foundational knowledge from optional specialization.
- Explain why a topic is needed and when it is used.
- Include common failure modes.
- Use current, official docs for fast-changing libraries and APIs.
- Make source references visible when external facts are included.
- Do not teach outdated APIs as current.
- Do not make the user memorize every line of code.
- Do not imply Python syntax alone is enough to become an AI Engineer.
- Do not imply all ML is obsolete or that AI can safely solve every engineering task.

## 12. Definition of done

The application is not complete until:
- It starts locally using documented commands.
- Onboarding and diagnostic work.
- Dashboard renders honest empty and populated states.
- Learning path navigation works.
- At least one complete sample lesson exists in each of these areas: Python engineering, math for ML, classical ML, LLM/RAG, production deployment.
- At least 10 useful exercises exist across these topics.
- Quiz submission and feedback work.
- Progress persists after refresh.
- Project milestones can be updated.
- AI mentor has a real provider integration path and a clearly labelled no-key demo state.
- API keys are not exposed client-side.
- Main flows have been manually tested.
- Build/lint/tests have been run where available.
- No core button is decorative or inert.

Now inspect the repository and build the complete application. Do not stop at the plan.
