import React, { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { BootstrapData } from "../types.ts";

interface SettingsPageProps {
  data: BootstrapData;
  onUpdated: () => void;
}

interface BackupEntry {
  filename: string;
  reason: string;
  sizeBytes: number;
  createdAt: string;
}

const REASON_LABELS: Record<string, { label: string; badge: string }> = {
  manual: { label: "Əl ilə (manual)", badge: "badge-type" },
  "pre-reset": { label: "Sıfırlama öncəsi (avto)", badge: "badge-danger" },
  "pre-import": { label: "İmport öncəsi (avto)", badge: "badge-category" },
  "pre-restore": { label: "Bərpa öncəsi (avto)", badge: "badge-category" },
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export function SettingsPage({ data, onUpdated }: SettingsPageProps) {
  const [name, setName] = useState(data.profile.name);
  const [goalId, setGoalId] = useState(data.profile.goalId);
  const [weeklyHours, setWeeklyHours] = useState(data.profile.weeklyHours);
  const [dailyGoalMinutes, setDailyGoalMinutes] = useState(data.profile.dailyGoalMinutes ?? 30);
  const [explanationLevel, setExplanationLevel] = useState<
    "beginner" | "intermediate" | "advanced"
  >(data.profile.explanationLevel ?? "intermediate");
  const [socraticMode, setSocraticMode] = useState(data.profile.socraticMode ?? true);
  const [remindersEnabled, setRemindersEnabled] = useState(data.profile.remindersEnabled);
  const [theme, setTheme] = useState<"dark" | "light">(data.profile.theme);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Server-side AI Provider config (API key is write-only, stored locally in data/local-secrets.json)
  const [provider, setProvider] = useState<"demo" | "openai" | "gemini" | "anthropic" | "ollama">(
    data.mentorConfig?.provider ?? "demo",
  );
  const [model, setModel] = useState(data.mentorConfig?.model ?? "");
  const [baseUrl, setBaseUrl] = useState(data.mentorConfig?.baseUrl ?? "");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [savingProvider, setSavingProvider] = useState(false);
  const [providerMsg, setProviderMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Automatic & Manual Server Backup Management
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(true);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<BackupEntry | null>(null);
  const [restoreAck, setRestoreAck] = useState(false);
  const [backupStatus, setBackupStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const [importJsonText, setImportJsonText] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  const loadBackups = async () => {
    setLoadingBackups(true);
    try {
      const res = await api.listBackups();
      setBackups(res.backups);
    } catch (e) {
      setBackupStatus({
        kind: "err",
        text: `Ehtiyat nüsxələrin siyahısı yüklənmədi: ${(e as Error).message}`,
      });
    } finally {
      setLoadingBackups(false);
    }
  };

  useEffect(() => {
    loadBackups();
  }, []);

  // Sync local form state when profile changes (e.g. after backup restore)
  useEffect(() => {
    setName(data.profile.name);
    setGoalId(data.profile.goalId);
    setWeeklyHours(data.profile.weeklyHours);
    setDailyGoalMinutes(data.profile.dailyGoalMinutes ?? 30);
    setExplanationLevel(data.profile.explanationLevel ?? "intermediate");
    setSocraticMode(data.profile.socraticMode ?? true);
    setRemindersEnabled(data.profile.remindersEnabled);
    setTheme(data.profile.theme);
  }, [data.profile]);

  const handleSaveSettings = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api.updateSettings({
        name,
        goalId,
        weeklyHours,
        dailyGoalMinutes,
        explanationLevel,
        socraticMode,
        remindersEnabled,
        theme,
      });
      setMsg({ kind: "ok", text: "Tənzimləmələr yadda saxlanıldı." });
      onUpdated();
    } catch (e) {
      setMsg({ kind: "err", text: `Saxlama xətası: ${(e as Error).message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProvider = async (clearKey = false) => {
    setSavingProvider(true);
    setProviderMsg(null);
    try {
      const safe = await api.saveMentorConfig({
        provider,
        model: model.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
        apiKey: apiKeyInput.trim() || undefined,
        clearKey,
      });
      setApiKeyInput("");
      setModel(safe.model);
      setBaseUrl(safe.baseUrl);
      setProviderMsg({
        kind: "ok",
        text: clearKey
          ? "Saxlanılmış API açarı silindi."
          : `AI Mentor provayderi yeniləndi: ${safe.provider} (${safe.model}). Açar yalnız lokal serverdə saxlanılır.`,
      });
      onUpdated();
    } catch (e) {
      setProviderMsg({ kind: "err", text: `Provayder xətası: ${(e as Error).message}` });
    } finally {
      setSavingProvider(false);
    }
  };

  const handleCreateManualBackup = async () => {
    setCreatingBackup(true);
    setBackupStatus(null);
    try {
      const res = await api.createBackup();
      setBackupStatus({
        kind: "ok",
        text: `Əl ilə ehtiyat nüsxəsi yaradıldı: ${res.filename}`,
      });
      await loadBackups();
    } catch (e) {
      setBackupStatus({
        kind: "err",
        text: `Backup yaradılarkən xəta baş verdi: ${(e as Error).message}`,
      });
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleStartRestore = (entry: BackupEntry) => {
    setSelectedBackup(entry);
    setRestoreAck(false);
    setBackupStatus(null);
  };

  const handleConfirmRestore = async () => {
    if (!selectedBackup || !restoreAck) return;
    setRestoringBackup(true);
    setBackupStatus(null);
    try {
      const res = await api.restoreBackup(selectedBackup.filename);
      setSelectedBackup(null);
      setRestoreAck(false);
      setBackupStatus({
        kind: "ok",
        text:
          `Ehtiyat nüsxə uğurla bərpa olundu: ${res.restoredFrom}.` +
          (res.safetySnapshot
            ? ` Əvvəlki vəziyyətiniz avtomatik qorundu: ${res.safetySnapshot}.`
            : ""),
      });
      await loadBackups();
      onUpdated();
    } catch (e) {
      setBackupStatus({
        kind: "err",
        text: `Bərpa zamanı xəta baş verdi: ${(e as Error).message}`,
      });
    } finally {
      setRestoringBackup(false);
    }
  };

  const handleExport = async () => {
    try {
      const backup = await api.exportBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ai-engineering-academy-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setBackupStatus({ kind: "err", text: `Export xətası: ${(e as Error).message}` });
    }
  };

  const handleImport = async () => {
    if (!importJsonText.trim()) return;
    setBackupStatus(null);
    try {
      const parsed = JSON.parse(importJsonText);
      const res = await api.importBackup(parsed);
      setBackupStatus({
        kind: "ok",
        text:
          "JSON ehtiyat nüsxəsi uğurla bərpa olundu." +
          (res.safetySnapshot
            ? ` Əvvəlki vəziyyət avtomatik qorundu: ${res.safetySnapshot}.`
            : ""),
      });
      setImportJsonText("");
      await loadBackups();
      onUpdated();
    } catch (e) {
      setBackupStatus({ kind: "err", text: `JSON bərpa xətası: ${(e as Error).message}` });
    }
  };

  const handleReset = async () => {
    try {
      const res = await api.resetAll();
      setConfirmReset(false);
      setMsg({
        kind: "ok",
        text:
          "Bütün irəliləyiş sıfırlandı." +
          (res.safetySnapshot
            ? ` Avtomatik qoruyucu nüsxə saxlanıldı: ${res.safetySnapshot}`
            : ""),
      });
      await loadBackups();
      onUpdated();
    } catch (e) {
      setMsg({ kind: "err", text: `Sıfırlama xətası: ${(e as Error).message}` });
    }
  };

  return (
    <div className="settings-page">
      <div className="page-header">
        <div>
          <h1>Tənzimləmələr, AI Provayder Konfiqurasiyası və Ehtiyat Nüsxə</h1>
          <p className="subtitle">
            Şəxsi öyrənmə ritmi, AI Mentor provayder seçimi (OpenAI, Anthropic, Gemini, Ollama, Offline Demo), görünüş rejimi və SQLite məlumatlarının tam ehtiyat nüsxə idarəetməsi.
          </p>
        </div>
      </div>

      <div className="cards-grid-2">
        <div className="panel">
          <h3>Öyrənən Profili və Tədris Parametrləri</h3>
          <div className="form-group">
            <label htmlFor="settings-name">Ad</label>
            <input
              id="settings-name"
              type="text"
              className="input-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="settings-goal">Əsas Hədəf (Goal)</label>
            <select
              id="settings-goal"
              className="input-field"
              value={goalId}
              onChange={(e) => setGoalId(e.target.value)}
            >
              <option value="broad-ai-engineering">Geniş AI Engineering bünövrəsi</option>
              <option value="llm-apps">LLM tətbiqləri qurmaq (RAG, agents)</option>
              <option value="ml-engineering">ML engineering</option>
              <option value="production">Production / MLOps</option>
              <option value="robotics-cv">Robotics, drones, computer vision</option>
              <option value="startup">AI startup / məhsul qurmaq</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="theme-select">Görünüş Rejimi (Theme)</label>
            <select
              id="theme-select"
              className="input-field"
              value={theme}
              onChange={(e) => setTheme(e.target.value as "dark" | "light")}
            >
              <option value="dark">Dark (Tünd texniki iş mühiti)</option>
              <option value="light">Light (Açıq rejim)</option>
            </select>
          </div>

          <div className="cards-grid-2">
            <div className="form-group">
              <label htmlFor="settings-weekly-hours">Həftəlik Vaxt Büdcəsi (saat)</label>
              <input
                id="settings-weekly-hours"
                type="number"
                min={2}
                max={40}
                className="input-field"
                value={weeklyHours}
                onChange={(e) => setWeeklyHours(Number(e.target.value) || 8)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="settings-daily-goal">Gündəlik Hədəf (dəqiqə)</label>
              <input
                id="settings-daily-goal"
                type="number"
                min={10}
                max={360}
                className="input-field"
                value={dailyGoalMinutes}
                onChange={(e) => setDailyGoalMinutes(Number(e.target.value) || 30)}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="settings-level">Default AI İzah Səviyyəsi (Explanation Depth)</label>
            <select
              id="settings-level"
              className="input-field"
              value={explanationLevel}
              onChange={(e) =>
                setExplanationLevel(e.target.value as "beginner" | "intermediate" | "advanced")
              }
            >
              <option value="beginner">Beginner (Sadə analogiya və intuisiya)</option>
              <option value="intermediate">Intermediate (Riyaziyyat + kod + müqavilə)</option>
              <option value="advanced">Advanced (Big-O, VRAM, production trade-offs)</option>
            </select>
          </div>

          <div className="form-group">
            <label className="option-label">
              <input
                type="checkbox"
                checked={socraticMode}
                onChange={(e) => setSocraticMode(e.target.checked)}
              />
              <span>AI Mentor Sokratik sual rejimini aktiv saxla</span>
            </label>
          </div>

          <div className="form-group">
            <label className="option-label">
              <input
                type="checkbox"
                checked={remindersEnabled}
                onChange={(e) => setRemindersEnabled(e.target.checked)}
              />
              <span>Spaced Review təkrar xatırlatmalarını Dashboard-da göstər</span>
            </label>
          </div>

          {msg && (
            <div className={`feedback-box ${msg.kind === "ok" ? "feedback-pass" : "feedback-fail"}`}>
              {msg.text}
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary"
            disabled={saving}
            onClick={handleSaveSettings}
          >
            {saving ? "Saxlanılır..." : "Dəyişiklikləri Yadda Saxla"}
          </button>
        </div>

        <div className="panel">
          <h3>AI Mentor Provayder Quraşdırılması (Server-Side Secrets)</h3>
          <p>
            Cari status:{" "}
            <strong className={data.mentorStatus.configured ? "text-success" : ""}>
              {data.mentorStatus.configured
                ? `Canlı AI (${data.mentorStatus.provider} / ${data.mentorStatus.model})`
                : "Offline Demo Mentor Rejimi (API key aktiv deyil)"}
            </strong>
          </p>
          <p className="muted">
            API açarınız yalnız bu kompüterdəki gitignored <code>data/local-secrets.json</code> (və ya <code>.env</code>) faylında saxlanılır, <strong>heç vaxt brauzerə və ya frontend koduna göndərilmir</strong>.
          </p>

          <div className="cards-grid-2">
            <div className="form-group">
              <label htmlFor="mentor-provider-select">Provayder</label>
              <select
                id="mentor-provider-select"
                className="input-field"
                value={provider}
                onChange={(e) =>
                  setProvider(
                    e.target.value as "demo" | "openai" | "gemini" | "anthropic" | "ollama",
                  )
                }
              >
                <option value="demo">Offline Demo Mentor (API açarsız)</option>
                <option value="openai">OpenAI (GPT-4o / o3-mini)</option>
                <option value="gemini">Google Gemini (gemini-2.5-flash)</option>
                <option value="anthropic">Anthropic Claude (claude-3-5-sonnet)</option>
                <option value="ollama">Lokal Ollama (http://localhost:11434/v1)</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="mentor-model-input">Model adı (boş qalsa default)</label>
              <input
                id="mentor-model-input"
                type="text"
                className="input-field font-mono"
                placeholder="gpt-4o-mini / gemini-2.5-flash / llama3.1"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
          </div>

          {provider !== "demo" && (
            <>
              <div className="form-group">
                <label htmlFor="mentor-baseurl-input">
                  Custom Base URL (istəyə bağlı — Ollama və ya proxy üçün)
                </label>
                <input
                  id="mentor-baseurl-input"
                  type="text"
                  className="input-field font-mono"
                  placeholder="https://api.openai.com/v1"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </div>

              {provider !== "ollama" && (
                <div className="form-group">
                  <label htmlFor="mentor-apikey-input">
                    API Key (Write-only{" "}
                    {data.mentorConfig?.maskedKey
                      ? `— hazırda saxlanılıb: ${data.mentorConfig.maskedKey}`
                      : "— saxlanılmayıb"}
                    )
                  </label>
                  <input
                    id="mentor-apikey-input"
                    type="password"
                    className="input-field font-mono"
                    placeholder="Yeni açar daxil et (köhnəni qorumaq üçün boş burax)..."
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                  />
                </div>
              )}
            </>
          )}

          {providerMsg && (
            <div
              className={`feedback-box ${
                providerMsg.kind === "ok" ? "feedback-pass" : "feedback-fail"
              }`}
            >
              {providerMsg.text}
            </div>
          )}

          <div className="exercise-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={savingProvider}
              onClick={() => handleSaveProvider(false)}
            >
              {savingProvider ? "Saxlanılır..." : "Provayder Konfiqurasiyasını Saxla"}
            </button>
            {data.mentorConfig?.hasStoredKey && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={savingProvider}
                onClick={() => handleSaveProvider(true)}
              >
                Saxlanılmış Açarı Sil
              </button>
            )}
          </div>

          <hr className="divider" />
          <h3>İrəliləyişi Sıfırla</h3>
          <p className="muted">
            Sıfırlamadan əvvəl cari məlumatların avtomatik olaraq <code>pre-reset</code> ehtiyat nüsxəsi kimi qorunur.
          </p>
          {!confirmReset ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirmReset(true)}
            >
              Bütün öyrənmə tarixçəsini sıfırla...
            </button>
          ) : (
            <div className="exercise-actions">
              <button type="button" className="btn btn-danger btn-sm" onClick={handleReset}>
                Bəli, bütün irəliləyişi sil
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setConfirmReset(false)}
              >
                Ləğv et
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Complete Backup Management Panel */}
      <div className="panel" id="backup-management-panel">
        <div className="panel-header-row">
          <div>
            <h3>Ehtiyat Nüsxə İdarəetməsi (Avtomatik və Əl ilə Backups)</h3>
            <p className="subtitle" style={{ marginBottom: 0 }}>
              Hər sıfırlama, bərpa və import öncəsi avtomatik təhlükəsizlik kopyası saxlanılır. Təsadüfi silinmənin qarşısını almaq üçün ehtiyat nüsxələr buradan silinə bilməz.
            </p>
          </div>
          <div className="exercise-actions" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={creatingBackup}
              onClick={handleCreateManualBackup}
            >
              {creatingBackup ? "Yaradılır..." : "+ Əl ilə Backup Yarat"}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleExport}>
              JSON Backup Endir (Export)
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={loadingBackups}
              onClick={loadBackups}
            >
              Yenilə
            </button>
          </div>
        </div>

        {backupStatus && (
          <div
            className={`feedback-box ${
              backupStatus.kind === "ok" ? "feedback-pass" : "feedback-fail"
            }`}
            role="status"
          >
            {backupStatus.text}
          </div>
        )}

        {/* Strong Restoration Confirmation Box */}
        {selectedBackup && (
          <div className="hints-box" role="alertdialog" aria-label="Ehtiyat nüsxə bərpa təsdiqi">
            <h4>Bərpa Təsdiqi Tələb Olunur</h4>
            <p>
              Aşağıdakı ehtiyat nüsxəni aktiv verilənlər bazasına bərpa etmək üzrəsən:
            </p>
            <ul>
              <li>
                <strong>Fayl:</strong> <code className="font-mono">{selectedBackup.filename}</code>
              </li>
              <li>
                <strong>Yaradılma tarixi:</strong> {formatDateTime(selectedBackup.createdAt)}
              </li>
              <li>
                <strong>Səbəb:</strong>{" "}
                {REASON_LABELS[selectedBackup.reason]?.label ?? selectedBackup.reason} ·{" "}
                <strong>Ölçü:</strong> {formatFileSize(selectedBackup.sizeBytes)}
              </li>
            </ul>
            <p className="muted">
              Təhlükəsizlik zəmanəti: bərpa başlamazdan əvvəl cari vəziyyətiniz avtomatik olaraq yeni{" "}
              <code>pre-restore</code> ehtiyat nüsxəsi kimi saxlanacaq.
            </p>
            <label className="option-label" style={{ marginBottom: "0.75rem" }}>
              <input
                type="checkbox"
                checked={restoreAck}
                onChange={(e) => setRestoreAck(e.target.checked)}
              />
              <span>
                Təsdiqləyirəm: cari aktiv baza seçilmiş ehtiyat nüsxəsi ilə əvəz olunsun (əvvəlki vəziyyət avtomatik qorunacaq).
              </span>
            </label>
            <div className="exercise-actions" style={{ marginTop: 0 }}>
              <button
                type="button"
                className="btn btn-warning btn-sm"
                disabled={!restoreAck || restoringBackup}
                onClick={handleConfirmRestore}
              >
                {restoringBackup ? "Bərpa olunur..." : "Bəli, bu nüsxəni bərpa et"}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={restoringBackup}
                onClick={() => {
                  setSelectedBackup(null);
                  setRestoreAck(false);
                }}
              >
                Ləğv et
              </button>
            </div>
          </div>
        )}

        {loadingBackups ? (
          <p className="muted">Ehtiyat nüsxələr yüklənir...</p>
        ) : backups.length === 0 ? (
          <p className="muted">
            Hələ serverdə saxlanılmış ehtiyat nüsxə yoxdur. İlk təhlükəsizlik kopyasını yaratmaq üçün{" "}
            <strong>+ Əl ilə Backup Yarat</strong> düyməsini kliklə.
          </p>
        ) : (
          <div className="table-responsive" style={{ marginTop: "0.75rem" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Yaradılma Tarixi</th>
                  <th>Səbəb (Reason)</th>
                  <th>Ölçü</th>
                  <th>Fayl Adı</th>
                  <th>Əməliyyat</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => {
                  const meta = REASON_LABELS[b.reason] ?? {
                    label: b.reason,
                    badge: "badge-muted",
                  };
                  const isSelected = selectedBackup?.filename === b.filename;
                  return (
                    <tr key={b.filename}>
                      <td>{formatDateTime(b.createdAt)}</td>
                      <td>
                        <span className={`badge ${meta.badge}`}>{meta.label}</span>
                      </td>
                      <td>{formatFileSize(b.sizeBytes)}</td>
                      <td className="font-mono" style={{ fontSize: "0.82rem" }}>
                        {b.filename}
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`btn btn-xs ${isSelected ? "btn-primary" : "btn-secondary"}`}
                          disabled={restoringBackup}
                          onClick={() => handleStartRestore(b)}
                        >
                          {isSelected ? "Seçildi" : "Bərpa et..."}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <hr className="divider" />
        <h4>Xarici JSON Fayldan Bərpa (Manual JSON Import)</h4>
        <div className="form-group">
          <label htmlFor="settings-import-json">JSON ehtiyat nüsxəsi mətni</label>
          <textarea
            id="settings-import-json"
            className="input-textarea font-mono"
            rows={3}
            placeholder="Bərpa etmək üçün əvvəlcədən endirilmiş JSON backup məzmununu bura yapışdır..."
            value={importJsonText}
            onChange={(e) => setImportJsonText(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!importJsonText.trim()}
          onClick={handleImport}
        >
          JSON Backup Bərpa Et (Import)
        </button>
      </div>
    </div>
  );
}
