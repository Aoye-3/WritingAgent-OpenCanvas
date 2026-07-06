import { useI18n } from "../i18n/I18nProvider";
import { CloseIcon } from "../../shared/icons";
import { AgentBackendRuntimePanel } from "./components/AgentBackendRuntimePanel";
import { ProviderSettingsForm } from "./components/ProviderSettingsForm";
import { SourceUpdatePanel } from "./components/SourceUpdatePanel";
import { useProjectSettings } from "./hooks/useProjectSettings";
import { Button, IconButton, Panel } from "../../shared/ui";

const runtimeBudgetPresets = {
  low: {
    runtimeBudgetProfile: "low",
    evidenceToolLimit: 8,
    bodyDraftWriteLimit: 2,
    modelCallLimit: 18,
    recursionLimit: 80,
    synthesisReserveSteps: 16
  },
  medium: {
    runtimeBudgetProfile: "medium",
    evidenceToolLimit: 12,
    bodyDraftWriteLimit: 3,
    modelCallLimit: 24,
    recursionLimit: 110,
    synthesisReserveSteps: 22
  },
  high: {
    runtimeBudgetProfile: "high",
    evidenceToolLimit: 16,
    bodyDraftWriteLimit: 4,
    modelCallLimit: 32,
    recursionLimit: 140,
    synthesisReserveSteps: 28
  }
} as const;

type ProjectSettingsPanelProps = {
  open: boolean;
  projectId: string;
  onClose: () => void;
};

export function ProjectSettingsPanel({ open, projectId, onClose }: ProjectSettingsPanelProps) {
  const { locale, t } = useI18n();
  const settings = useProjectSettings(open, projectId, {
    validateSuccess: t("settings.validateSuccess"),
    validateFailed: t("settings.validateFailed"),
    saveSuccess: t("settings.saveSuccess")
  });

  if (!open) return null;

  const statusRows = [
    [t("settings.keyStatus"), settings.status.keyConfigured ? t("settings.configured") : t("settings.notConfigured")],
    [t("settings.provider"), settings.status.providerLabel],
    [t("settings.baseURL"), settings.status.baseURL],
    [t("settings.model"), settings.status.model],
    [t("settings.apiHealth"), settings.status.apiHealth],
    [t("settings.provider"), settings.status.provider === "mock" ? t("settings.mockFallback") : `${settings.status.provider} ${t("settings.providerReady")}`],
    [t("settings.lastValidated"), settings.status.lastValidated ? new Date(settings.status.lastValidated).toLocaleString() : t("settings.never")]
  ];

  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="settings-header">
          <div>
            <p className="eyebrow">{t("app.projectSettings")}</p>
            <h2 id="settings-title">{t("settings.title")}</h2>
            <p>{t("settings.subtitle")}</p>
          </div>
          <IconButton type="button" onClick={onClose} aria-label={t("settings.close")}>
            <CloseIcon aria-hidden="true" />
          </IconButton>
        </div>

        <dl className="settings-status-list ui-panel">
          {statusRows.map(([label, value]) => (
            <div className="settings-status-row" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        <AgentBackendRuntimePanel config={settings.agentBackendConfig} status={settings.agentBackendStatus} />
        <SourceUpdatePanel />

        <Panel className="settings-canvas-panel" aria-labelledby="settings-runtime-budget-title">
          <form onSubmit={settings.handleRuntimeSettingsSubmit}>
            <div>
              <h3 id="settings-runtime-budget-title">{locale === "zh" ? "Agent 运行预算" : "Agent run budget"}</h3>
              <p>{locale === "zh" ? "设置当前项目的默认运行档位、证据收集次数和正文草稿写入次数。" : "Set this project's default run profile, evidence collection limit, and body draft write limit."}</p>
            </div>
            <label className="settings-field">
              <span>{locale === "zh" ? "默认档位" : "Default profile"}</span>
              <select
                value={settings.runtimeSettings.runtimeBudgetProfile}
                onChange={(event) => {
                  const profile = event.currentTarget.value as keyof typeof runtimeBudgetPresets;
                  settings.updateRuntimeSettings(runtimeBudgetPresets[profile]);
                }}
              >
                <option value="low">{locale === "zh" ? "低" : "Low"}</option>
                <option value="medium">{locale === "zh" ? "中" : "Medium"}</option>
                <option value="high">{locale === "zh" ? "高" : "High"}</option>
              </select>
            </label>
            <RuntimeNumberField label={locale === "zh" ? "证据工具次数" : "Evidence tools"} value={settings.runtimeSettings.evidenceToolLimit} min={1} max={50} onChange={(evidenceToolLimit) => settings.updateRuntimeSettings({ evidenceToolLimit })} />
            <RuntimeNumberField label={locale === "zh" ? "正文草稿写入次数" : "Body draft writes"} value={settings.runtimeSettings.bodyDraftWriteLimit} min={1} max={12} onChange={(bodyDraftWriteLimit) => settings.updateRuntimeSettings({ bodyDraftWriteLimit })} />
            <RuntimeNumberField label={locale === "zh" ? "模型轮次" : "Model calls"} value={settings.runtimeSettings.modelCallLimit} min={3} max={80} onChange={(modelCallLimit) => settings.updateRuntimeSettings({ modelCallLimit })} />
            <RuntimeNumberField label={locale === "zh" ? "递归步数" : "Recursion steps"} value={settings.runtimeSettings.recursionLimit} min={20} max={240} onChange={(recursionLimit) => settings.updateRuntimeSettings({ recursionLimit })} />
            <RuntimeNumberField label={locale === "zh" ? "综合预留步数" : "Synthesis reserve"} value={settings.runtimeSettings.synthesisReserveSteps} min={4} max={80} onChange={(synthesisReserveSteps) => settings.updateRuntimeSettings({ synthesisReserveSteps })} />
            <Button disabled={settings.busyState !== "idle" || !projectId} type="submit" variant="secondary">
              {settings.busyState === "saving" ? t("settings.saving") : t("settings.save")}
            </Button>
          </form>
        </Panel>

        <Panel className="settings-canvas-panel" aria-labelledby="settings-canvas-title">
          <form onSubmit={settings.handleCanvasSettingsSubmit}>
            <div>
              <h3 id="settings-canvas-title">Canvas</h3>
              <p>{t("settings.canvasDescription")}</p>
            </div>
            <label className="settings-field">
              <span>{t("settings.canvasUndoDepth")}</span>
              <input
                min={1}
                max={200}
                type="number"
                value={settings.canvasUndoDepth}
                onChange={(event) => settings.setCanvasUndoDepth(Number(event.currentTarget.value))}
              />
            </label>
            <Button disabled={settings.busyState !== "idle"} type="submit" variant="secondary">
              {settings.busyState === "saving" ? t("settings.saving") : t("settings.save")}
            </Button>
          </form>
        </Panel>

        <ProviderSettingsForm
          apiKey={settings.apiKey}
          baseURL={settings.baseURL}
          busyState={settings.busyState}
          labels={{
            apiKey: t("settings.apiKey"),
            apiKeyPlaceholder: t("settings.apiKeyPlaceholder"),
            baseURL: t("settings.baseURL"),
            model: t("settings.model"),
            modelPreset: t("settings.modelPreset"),
            safeNote: t("settings.safeNote"),
            save: t("settings.save"),
            saving: t("settings.saving"),
            systemPrompt: t("settings.systemPrompt"),
            systemPromptHelp: t("settings.systemPromptHelp"),
            validate: t("settings.validate"),
            validating: t("settings.validating")
          }}
          message={settings.message}
          model={settings.model}
          modelPreset={settings.modelPreset}
          onApiKeyChange={settings.setApiKey}
          onBaseURLChange={settings.setBaseURL}
          onModelChange={settings.setModel}
          onModelPresetChange={settings.setModelPreset}
          onProviderIdChange={settings.setProviderId}
          onSubmit={settings.handleSubmit}
          onSystemPromptChange={settings.setSystemPrompt}
          onValidate={settings.handleValidate}
          providerId={settings.providerId}
          status={settings.status}
          systemPrompt={settings.systemPrompt}
        />

        <Panel className="settings-danger-zone" aria-labelledby="settings-dev-server-title">
          <div>
            <h3 id="settings-dev-server-title">{t("settings.devServerTitle")}</h3>
            <p>{t("settings.devServerDescription")}</p>
          </div>
          <Button
            disabled={settings.busyState !== "idle"}
            onClick={settings.handleShutdownDevServer}
            type="button"
            variant="danger"
          >
            {settings.busyState === "stopping" ? t("settings.stoppingDevServer") : t("settings.stopDevServer")}
          </Button>
        </Panel>
      </section>
    </div>
  );
}

function RuntimeNumberField({
  label,
  value,
  min,
  max,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input
        min={min}
        max={max}
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}
