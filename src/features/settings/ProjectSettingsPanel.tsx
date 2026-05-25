import { useI18n } from "../i18n/I18nProvider";
import { CloseIcon } from "../../shared/icons";
import { AgentBackendRuntimePanel } from "./components/AgentBackendRuntimePanel";
import { ProviderSettingsForm } from "./components/ProviderSettingsForm";
import { useProjectSettings } from "./hooks/useProjectSettings";
import { Button, IconButton, Panel } from "../../shared/ui";

type ProjectSettingsPanelProps = {
  open: boolean;
  onClose: () => void;
};

export function ProjectSettingsPanel({ open, onClose }: ProjectSettingsPanelProps) {
  const { t } = useI18n();
  const settings = useProjectSettings(open, {
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
