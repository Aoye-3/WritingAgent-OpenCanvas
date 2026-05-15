import { useI18n } from "../i18n/I18nProvider";
import { DeerFlowRuntimePanel } from "./components/DeerFlowRuntimePanel";
import { ProviderSettingsForm } from "./components/ProviderSettingsForm";
import { useProjectSettings } from "./hooks/useProjectSettings";

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

        <DeerFlowRuntimePanel config={settings.deerFlowConfig} status={settings.deerFlowStatus} />

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
      </section>
    </div>
  );
}
