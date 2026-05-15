import { modelPresets } from "../settingsDefaults";
import type { SettingsStatus } from "../types";
import type { FormEvent } from "react";

type ProviderSettingsFormProps = {
  apiKey: string;
  baseURL: string;
  busyState: "idle" | "saving" | "validating";
  message: string;
  model: string;
  modelPreset: string;
  providerId: SettingsStatus["providerId"];
  status: SettingsStatus;
  systemPrompt: string;
  labels: Record<string, string>;
  onApiKeyChange: (value: string) => void;
  onBaseURLChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onModelPresetChange: (value: string) => void;
  onProviderIdChange: (value: SettingsStatus["providerId"]) => void;
  onSystemPromptChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onValidate: () => void;
};

export function ProviderSettingsForm(props: ProviderSettingsFormProps) {
  return (
    <form className="settings-form" onSubmit={props.onSubmit}>
      <label className="field">
        <span>{props.labels.apiKey}</span>
        <input
          autoComplete="off"
          onChange={(event) => props.onApiKeyChange(event.target.value)}
          placeholder={props.labels.apiKeyPlaceholder}
          type="password"
          value={props.apiKey}
        />
      </label>
      <label className="field">
        <span>{props.labels.modelPreset}</span>
        <select
          onChange={(event) => {
            const selected = modelPresets.find((preset) => preset.id === event.target.value);
            props.onModelPresetChange(event.target.value);
            if (selected && selected.id !== "custom") {
              props.onProviderIdChange(selected.providerId);
              props.onBaseURLChange(selected.baseURL);
              props.onModelChange(selected.model);
            }
          }}
          value={props.modelPreset}
        >
          {modelPresets.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.label}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{props.labels.model}</span>
        <input
          onChange={(event) => {
            props.onModelPresetChange("custom");
            props.onModelChange(event.target.value);
          }}
          value={props.model}
        />
      </label>
      <label className="field">
        <span>{props.labels.baseURL}</span>
        <input
          onChange={(event) => {
            props.onModelPresetChange("custom");
            props.onBaseURLChange(event.target.value);
          }}
          value={props.baseURL}
        />
      </label>
      <label className="field">
        <span>{props.labels.systemPrompt}</span>
        <textarea
          className="settings-system-prompt"
          onChange={(event) => props.onSystemPromptChange(event.target.value)}
          value={props.systemPrompt}
        />
        <small>{props.labels.systemPromptHelp}</small>
      </label>

      <p className="settings-safe-note">{props.labels.safeNote}</p>
      {props.status.lastError ? <p className="settings-message is-error">{props.status.lastError}</p> : null}
      {props.message ? <p className="settings-message">{props.message}</p> : null}

      <div className="settings-actions">
        <button className="button button-secondary" disabled={props.busyState !== "idle"} onClick={props.onValidate} type="button">
          {props.busyState === "validating" ? props.labels.validating : props.labels.validate}
        </button>
        <button className="button button-primary" disabled={props.busyState !== "idle"} type="submit">
          {props.busyState === "saving" ? props.labels.saving : props.labels.save}
        </button>
      </div>
    </form>
  );
}
