import { FormEvent, useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { getSettingsStatus, saveSettings, validateSettings } from "./settingsClient";
import type { SettingsStatus } from "./types";

type ProjectSettingsPanelProps = {
  open: boolean;
  onClose: () => void;
};

const fallbackStatus: SettingsStatus = {
  keyConfigured: false,
  providerId: "deepseek",
  providerLabel: "DeepSeek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  systemPrompt: "You are FacetWrite's writing assistant. Generate clear, usable text from the user's prompt.",
  apiHealth: "offline",
  provider: "mock",
  capabilities: {
    chatCompletions: true,
    streaming: true,
    toolCalls: true,
    thinking: true,
    jsonOutput: true
  }
};

const modelPresets = [
  { id: "deepseek-v4-flash", providerId: "deepseek", label: "DeepSeek V4 Flash", baseURL: "https://api.deepseek.com", model: "deepseek-v4-flash" },
  { id: "deepseek-v4-pro", providerId: "deepseek", label: "DeepSeek V4 Pro", baseURL: "https://api.deepseek.com", model: "deepseek-v4-pro" },
  { id: "gpt-4.1-mini", providerId: "openai", label: "OpenAI GPT-4.1 mini", baseURL: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  { id: "compatible", providerId: "openai-compatible", label: "OpenAI-compatible", baseURL: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  { id: "custom", providerId: "openai-compatible", label: "Custom", baseURL: "", model: "" }
] as const;

export function ProjectSettingsPanel({ open, onClose }: ProjectSettingsPanelProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<SettingsStatus>(fallbackStatus);
  const [providerId, setProviderId] = useState<SettingsStatus["providerId"]>("deepseek");
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("https://api.deepseek.com");
  const [model, setModel] = useState("deepseek-v4-flash");
  const [modelPreset, setModelPreset] = useState("deepseek-v4-flash");
  const [systemPrompt, setSystemPrompt] = useState(fallbackStatus.systemPrompt);
  const [message, setMessage] = useState("");
  const [busyState, setBusyState] = useState<"idle" | "saving" | "validating">("idle");

  useEffect(() => {
    if (!open) return;

    getSettingsStatus()
      .then((nextStatus) => {
        setStatus(nextStatus);
        setProviderId(nextStatus.providerId);
        setBaseURL(nextStatus.baseURL);
        setModel(nextStatus.model);
        setModelPreset(resolvePreset(nextStatus.providerId, nextStatus.baseURL, nextStatus.model));
        setSystemPrompt(nextStatus.systemPrompt);
        setMessage("");
      })
      .catch((error: unknown) => {
        setStatus({ ...fallbackStatus, lastError: error instanceof Error ? error.message : "Unable to load settings" });
      });
  }, [open]);

  if (!open) return null;

  const statusRows = [
    [t("settings.keyStatus"), status.keyConfigured ? t("settings.configured") : t("settings.notConfigured")],
    [t("settings.provider"), status.providerLabel],
    [t("settings.baseURL"), status.baseURL],
    [t("settings.model"), status.model],
    [t("settings.apiHealth"), status.apiHealth],
    [t("settings.provider"), status.provider === "mock" ? t("settings.mockFallback") : `${status.provider} ${t("settings.providerReady")}`],
    [t("settings.lastValidated"), status.lastValidated ? new Date(status.lastValidated).toLocaleString() : t("settings.never")]
  ];

  const handleValidate = async () => {
    setBusyState("validating");
    setMessage("");
    try {
      const result = await validateSettings({
        providerId,
        apiKey: apiKey.trim() || undefined,
        baseURL: baseURL.trim() || undefined,
        model: model.trim() || undefined,
        systemPrompt: systemPrompt.trim() || undefined
      });
      setStatus(result);
      setMessage(result.ok ? t("settings.validateSuccess") : `${t("settings.validateFailed")} ${result.message}`);
    } finally {
      setBusyState("idle");
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyState("saving");
    setMessage("");
    try {
      const result = await saveSettings({
        providerId,
        apiKey: apiKey.trim() || undefined,
        baseURL: baseURL.trim() || undefined,
        model: model.trim() || undefined,
        systemPrompt: systemPrompt.trim() || undefined,
        confirmLocalKeyWrite: Boolean(apiKey.trim())
      });
      setStatus(result);
      setProviderId(result.providerId);
      setBaseURL(result.baseURL);
      setModel(result.model);
      setModelPreset(resolvePreset(result.providerId, result.baseURL, result.model));
      setSystemPrompt(result.systemPrompt);
      setApiKey("");
      setMessage(t("settings.saveSuccess"));
    } finally {
      setBusyState("idle");
    }
  };

  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="settings-header">
          <div>
            <p className="eyebrow">{t("app.projectSettings")}</p>
            <h2 id="settings-title">{t("settings.title")}</h2>
            <p>{t("settings.subtitle")}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("settings.close")}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <dl className="settings-status-list">
          {statusRows.map(([label, value]) => (
            <div className="settings-status-row" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        <form className="settings-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>{t("settings.apiKey")}</span>
            <input
              autoComplete="off"
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={t("settings.apiKeyPlaceholder")}
              type="password"
              value={apiKey}
            />
          </label>
          <label className="field">
            <span>{t("settings.modelPreset")}</span>
            <select
              onChange={(event) => {
                const selected = modelPresets.find((preset) => preset.id === event.target.value);
                setModelPreset(event.target.value);
                if (selected && selected.id !== "custom") {
                  setProviderId(selected.providerId);
                  setBaseURL(selected.baseURL);
                  setModel(selected.model);
                }
              }}
              value={modelPreset}
            >
              {modelPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("settings.model")}</span>
            <input
              onChange={(event) => {
                setModelPreset("custom");
                setModel(event.target.value);
              }}
              value={model}
            />
          </label>
          <label className="field">
            <span>{t("settings.baseURL")}</span>
            <input
              onChange={(event) => {
                setModelPreset("custom");
                setBaseURL(event.target.value);
              }}
              value={baseURL}
            />
          </label>
          <label className="field">
            <span>{t("settings.systemPrompt")}</span>
            <textarea
              className="settings-system-prompt"
              onChange={(event) => setSystemPrompt(event.target.value)}
              value={systemPrompt}
            />
            <small>{t("settings.systemPromptHelp")}</small>
          </label>

          <p className="settings-safe-note">{t("settings.safeNote")}</p>
          {status.lastError ? <p className="settings-message is-error">{status.lastError}</p> : null}
          {message ? <p className="settings-message">{message}</p> : null}

          <div className="settings-actions">
            <button className="button button-secondary" disabled={busyState !== "idle"} onClick={handleValidate} type="button">
              {busyState === "validating" ? t("settings.validating") : t("settings.validate")}
            </button>
            <button className="button button-primary" disabled={busyState !== "idle"} type="submit">
              {busyState === "saving" ? t("settings.saving") : t("settings.save")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function resolvePreset(providerId: SettingsStatus["providerId"], baseURL: string, model: string) {
  return modelPresets.find((preset) => preset.providerId === providerId && preset.baseURL === baseURL && preset.model === model)?.id ?? "custom";
}
