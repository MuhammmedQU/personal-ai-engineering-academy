import React, { useEffect, useState } from "react";
import { api } from "../api.ts";
import { MarkdownView } from "../components/MarkdownView.tsx";
import type { MilestoneView, ProjectView } from "../types.ts";

interface ProjectsPageProps {
  projects: ProjectView[];
  activeProjectId: string | null;
  selectedProjectId: string | null;
  onSelectProject: (id: string) => void;
  onOpenLesson: (lessonId: string) => void;
  onProgressUpdated: () => void;
  onAskMentor: (context: { projectId: string; title: string }) => void;
}

function MilestoneEditor({
  projectId,
  milestone,
  index,
  onSaved,
}: {
  projectId: string;
  milestone: MilestoneView;
  index: number;
  onSaved: () => void;
}) {
  const [checkedTasks, setCheckedTasks] = useState<number[]>(milestone.checkedTasks);
  const [notes, setNotes] = useState<string>(milestone.notes);
  const [evidence, setEvidence] = useState<string>(milestone.evidence);
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const toggleTask = (idx: number) => {
    setCheckedTasks((prev) =>
      prev.includes(idx) ? prev.filter((x) => x !== idx) : [...prev, idx],
    );
  };

  const handleSave = async (markComplete: boolean) => {
    setSaving(true);
    setWarning(null);
    setSaveMessage(null);
    try {
      const res = await api.updateMilestone(projectId, milestone.id, {
        checkedTasks,
        notes,
        evidence,
        markComplete,
      });
      if (res.warning) {
        setWarning(res.warning);
      } else {
        setSaveMessage(
          res.status === "completed"
            ? "Milestone sübutla tamamlandı və portfelə əlavə olundu!"
            : "Milestone irəliləyişi yadda saxlanıldı.",
        );
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`milestone-card ${
        milestone.status === "completed" ? "milestone-completed" : ""
      }`}
    >
      <div className="panel-header-row">
        <div>
          <span className="badge badge-type">Milestone #{index + 1}</span>{" "}
          <span
            className={`badge ${
              milestone.status === "completed"
                ? "badge-success"
                : milestone.status === "in_progress"
                  ? "badge-category"
                  : "badge-muted"
            }`}
          >
            {milestone.status === "completed"
              ? "✓ Sübutla Tamamlanıb"
              : milestone.status === "in_progress"
                ? "İcra edilir"
                : "Başlanmayıb"}
          </span>
          <h3>{milestone.title}</h3>
        </div>
      </div>

      <p>
        <strong>Hədəf:</strong> {milestone.goal}
      </p>

      <div className="milestone-tasks">
        <strong>Tapşırıq Siyahısı (Checklist — {checkedTasks.length}/{milestone.tasks.length}):</strong>
        {milestone.tasks.map((t, idx) => (
          <label key={idx} className="option-label">
            <input
              type="checkbox"
              checked={checkedTasks.includes(idx)}
              onChange={() => toggleTask(idx)}
            />
            <span>{t}</span>
          </label>
        ))}
      </div>

      <div className="form-group">
        <label>
          <strong>Tələb olunan Sübut (Evidence Required):</strong> {milestone.evidence_required}
        </label>
        <textarea
          className="input-textarea font-mono"
          rows={3}
          placeholder="Sübut qeyd edilmədən milestone tamamlanmış sayılmır! (Məs: pytest çıxışı, metrik cədvəli, commit hash, curl cavabı və ya eksperiment nəticəsi)..."
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label>Mühəndislik Qeydləri və Qərarlar:</label>
        <textarea
          className="input-textarea"
          rows={2}
          placeholder="Qarşılaşdığın problemlər, trade-off-lar..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {warning && <div className="feedback-box feedback-fail">{warning}</div>}
      {saveMessage && <div className="feedback-box feedback-pass">{saveMessage}</div>}

      <div className="exercise-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={saving}
          onClick={() => handleSave(false)}
        >
          Qaralama kimi saxla
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={saving}
          onClick={() => handleSave(true)}
        >
          Sübutu Təsdiqlə & Milestone-u Tamamla
        </button>
      </div>
    </div>
  );
}

export function ProjectsPage({
  projects,
  activeProjectId,
  selectedProjectId,
  onSelectProject,
  onOpenLesson,
  onProgressUpdated,
  onAskMentor,
}: ProjectsPageProps) {
  const currentProject =
    projects.find((p) => p.id === selectedProjectId) ??
    projects.find((p) => p.id === activeProjectId) ??
    projects[0] ??
    null;

  // Attached learner project files & AI Senior Engineer code review
  const [attachedFiles, setAttachedFiles] = useState<
    Array<{
      id: number;
      filename: string;
      language: string;
      content: string;
      ai_review: string;
      updated_at: string;
    }>
  >([]);
  const [fileName, setFileName] = useState("");
  const [fileLang, setFileLang] = useState("python");
  const [fileContent, setFileContent] = useState("");
  const [reviewingId, setReviewingId] = useState<number | null>(null);

  const loadFiles = async (projId: string) => {
    const res = await api.getProjectFiles(projId);
    setAttachedFiles(res.files);
  };

  useEffect(() => {
    if (currentProject?.id) {
      loadFiles(currentProject.id);
    }
  }, [currentProject?.id]);

  const handleAttachFile = async () => {
    if (!currentProject || !fileName.trim() || !fileContent.trim()) return;
    await api.saveProjectFile(currentProject.id, {
      filename: fileName.trim(),
      language: fileLang,
      content: fileContent,
    });
    setFileName("");
    setFileContent("");
    await loadFiles(currentProject.id);
    onProgressUpdated();
  };

  const handleLocalFileUpload = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    if (f.name.endsWith(".sql")) setFileLang("sql");
    else if (f.name.endsWith(".yaml") || f.name.endsWith(".yml")) setFileLang("yaml");
    else if (f.name.endsWith(".json")) setFileLang("json");
    else if (f.name.endsWith(".md")) setFileLang("markdown");
    else if (f.name.toLowerCase().includes("dockerfile")) setFileLang("dockerfile");
    else setFileLang("python");
    f.text().then((txt) => setFileContent(txt.slice(0, 45_000)));
  };

  return (
    <div className="projects-page">
      <div className="page-header">
        <div>
          <h1>Mühəndislik Layihələri və Portfel İş Sahəsi ({projects.length} Layihə)</h1>
          <p className="subtitle">
            Hər layihə real mühəndislik spesifikasiyası ilə verilir: problem tərifi, istifadəçi, arxitektura, milestone-lar, test/evaluation planı, failure case-lər, təhlükəsizlik və README strukturu. Heç bir layihə sübut (evidence) qeyd edilmədən tamamlanmış sayılmır.
          </p>
        </div>
      </div>

      {/* Project Selector Cards */}
      <div className="projects-tabs-bar">
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`project-tab-card ${
              currentProject?.id === p.id ? "active" : ""
            }`}
            onClick={() => onSelectProject(p.id)}
          >
            <div className="exercise-badges">
              <span className="badge badge-type">{p.level}</span>
              {p.optional && <span className="badge badge-muted">Seçmə</span>}
              {activeProjectId === p.id && (
                <span className="badge badge-category">Aktiv Hədəf</span>
              )}
            </div>
            <strong>{p.title}</strong>
            <small className="muted">
              {p.completedMilestones}/{p.totalMilestones} milestone · {p.estimated_hours[0]}–
              {p.estimated_hours[1]} saat
            </small>
          </button>
        ))}
      </div>

      {currentProject && (
        <div className="project-detail">
          <div className="panel">
            <div className="panel-header-row">
              <div>
                <div className="exercise-badges">
                  <span className="badge badge-type">{currentProject.level}</span>
                  <span className="badge badge-diff">
                    {currentProject.estimated_hours[0]}–{currentProject.estimated_hours[1]} saat
                  </span>
                  <span
                    className={`badge ${
                      currentProject.isComplete ? "badge-success" : "badge-category"
                    }`}
                  >
                    {currentProject.isComplete
                      ? "✓ Tam Sübutlu Layihə"
                      : `${currentProject.completedMilestones}/${currentProject.totalMilestones} Milestone tamamlanıb`}
                  </span>
                </div>
                <h2>{currentProject.title}</h2>
                <p>{currentProject.summary}</p>
              </div>
              <div className="hero-actions">
                {activeProjectId !== currentProject.id && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={async () => {
                      await api.activateProject(currentProject.id);
                      onProgressUpdated();
                    }}
                  >
                    Aktiv Layihə Kimi Seç
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() =>
                    onAskMentor({
                      projectId: currentProject.id,
                      title: currentProject.title,
                    })
                  }
                >
                  AI Mentordan Layihə Rəyi İstə
                </button>
              </div>
            </div>

            <div className="cards-grid-2">
              <div>
                <h4>Problem Statement</h4>
                <p>{currentProject.problem_statement}</p>
                <h4>Intended User</h4>
                <p>{currentProject.intended_user}</p>
              </div>
              <div>
                <h4>Tələblər (Requirements)</h4>
                <ul>
                  {currentProject.requirements.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <h4>Non-Goals (Scope-dan kənar)</h4>
                <ul>
                  {currentProject.non_goals.map((ng, i) => (
                    <li key={i}>{ng}</li>
                  ))}
                </ul>
              </div>
            </div>

            {currentProject.recommended_lessons.length > 0 && (
              <div className="lesson-prereq-bar">
                <strong>Tövsiyə olunan əlaqəli dərslər:</strong>{" "}
                {currentProject.recommended_lessons.map((lId) => (
                  <button
                    key={lId}
                    type="button"
                    className="link-btn"
                    onClick={() => onOpenLesson(lId)}
                  >
                    {lId}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Architecture */}
          <div className="panel">
            <h3>Sistem Arxitekturası və Data Axını</h3>
            <MarkdownView content={currentProject.architecture} />
          </div>

          {/* Interactive Milestones */}
          <div className="panel">
            <h3>Milestones, Tapşırıqlar və Sübutlar (Evidence Log)</h3>
            <div className="milestones-stack">
              {currentProject.milestones.map((ms, idx) => (
                <MilestoneEditor
                  key={`${currentProject.id}-${ms.id}`}
                  projectId={currentProject.id}
                  milestone={ms}
                  index={idx}
                  onSaved={onProgressUpdated}
                />
              ))}
            </div>
          </div>

          {/* Attached Learner Files & AI Senior Engineer Code Review */}
          <div className="panel">
            <h3>Öz Layihə Fayllarını Əlavə Et və Senior Engineer AI Code Review Al ({attachedFiles.length})</h3>
            <p className="subtitle">
              Yazdığın `.py`, `.sql`, `Dockerfile`, `.yaml` və ya `README.md` faylını kompüterindən yüklə və ya yapışdır — AI Mentor kodu `project-reviewer` protokolu ilə (kritik səhvlər, edge case-lər, təhlükəsizlik, test boşluqları) yoxlayacaq.
            </p>
            <div className="cards-grid-2">
              <div>
                <div className="form-group">
                  <label>Kompüterdən fayl seç (istəyə bağlı)</label>
                  <input type="file" className="input-field" onChange={handleLocalFileUpload} />
                </div>
                <div className="cards-grid-2">
                  <div className="form-group">
                    <label>Fayl adı</label>
                    <input
                      type="text"
                      className="input-field font-mono"
                      placeholder="məs. src/pipeline.py"
                      value={fileName}
                      onChange={(e) => setFileName(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Dil</label>
                    <select
                      className="input-field"
                      value={fileLang}
                      onChange={(e) => setFileLang(e.target.value)}
                    >
                      <option value="python">Python</option>
                      <option value="sql">SQL</option>
                      <option value="dockerfile">Dockerfile</option>
                      <option value="yaml">YAML</option>
                      <option value="json">JSON</option>
                      <option value="markdown">Markdown</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label>Kod məzmunu</label>
                  <textarea
                    className="code-textarea"
                    rows={6}
                    placeholder="Kodunu bura yapışdır..."
                    value={fileContent}
                    onChange={(e) => setFileContent(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!fileName.trim() || !fileContent.trim()}
                  onClick={handleAttachFile}
                >
                  Faylı Layihəyə Əlavə Et
                </button>
              </div>

              <div>
                {attachedFiles.length === 0 ? (
                  <p className="muted">Bu layihəyə hələ fayl əlavə edilməyib.</p>
                ) : (
                  <div className="notes-list">
                    {attachedFiles.map((f) => (
                      <div key={f.id} className="note-card">
                        <div className="panel-header-row">
                          <div>
                            <span className="badge badge-type">{f.language}</span>{" "}
                            <strong className="font-mono">{f.filename}</strong>
                          </div>
                          <div className="exercise-actions" style={{ marginTop: 0 }}>
                            <button
                              type="button"
                              className="btn btn-primary btn-xs"
                              disabled={reviewingId === f.id}
                              onClick={async () => {
                                setReviewingId(f.id);
                                try {
                                  await api.reviewProjectFile(currentProject.id, f.id);
                                  await loadFiles(currentProject.id);
                                  onProgressUpdated();
                                } finally {
                                  setReviewingId(null);
                                }
                              }}
                            >
                              {reviewingId === f.id ? "Yoxlanılır..." : "AI Code Review"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              onClick={async () => {
                                await api.deleteProjectFile(currentProject.id, f.id);
                                await loadFiles(currentProject.id);
                              }}
                            >
                              Sil
                            </button>
                          </div>
                        </div>
                        <pre className="solution-code" style={{ maxHeight: 160 }}>
                          <code>{f.content}</code>
                        </pre>
                        {f.ai_review && (
                          <div className="feedback-box feedback-pass" style={{ marginTop: "0.5rem" }}>
                            <MarkdownView content={f.ai_review} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Evaluation, Failure cases, Security, DoD, README outline */}
          <div className="cards-grid-2">
            <div className="panel">
              <h3>Test & Qiymətləndirmə Planı (Evaluation Plan)</h3>
              <ul>
                {currentProject.test_plan.map((tp, i) => (
                  <li key={i}>{tp}</li>
                ))}
              </ul>
              <h4>Failure Cases (Uğursuzluq Ssenariləri)</h4>
              <ul>
                {currentProject.failure_cases.map((fc, i) => (
                  <li key={i}>{fc}</li>
                ))}
              </ul>
            </div>

            <div className="panel">
              <h3>Privacy & Security</h3>
              <ul>
                {currentProject.privacy_security.map((ps, i) => (
                  <li key={i}>{ps}</li>
                ))}
              </ul>
              <h4>Definition of Done</h4>
              <ul>
                {currentProject.definition_of_done.map((dod, i) => (
                  <li key={i}>{dod}</li>
                ))}
              </ul>
              <h4>README.md Strukturu (Portfel üçün)</h4>
              <ol>
                {currentProject.readme_outline.map((ro, i) => (
                  <li key={i}>{ro}</li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
