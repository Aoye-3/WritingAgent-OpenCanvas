import { FormEvent, useEffect, useState } from "react";
import { getDeerFlowConfigOverview, getDeerFlowRuntimeStatus, getSettingsStatus, saveSettings, validateSettings } from "../settingsClient";
import { fallbackDeerFlowConfig, fallbackDeerFlowStatus, fallbackStatus, resolvePreset } from "../settingsDefaults";
import type { DeerFlowConfigOverview, DeerFlowRuntimeStatus, SettingsStatus } from "../types";

export function useProjectSettings(open: boolean, copy: {
  validateSuccess: string;
  validateFailed: string;
  saveSuccess: string;
}) {
  const [status, setStatus] = useState<SettingsStatus>(fallbackStatus);
  const [providerId, setProviderId] = useState<SettingsStatus["providerId"]>("deepseek");
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("https://api.deepseek.com");
  const [model, setModel] = useState("deepseek-v4-flash");
  const [modelPreset, setModelPreset] = useState("deepseek-v4-flash");
  const [systemPrompt, setSystemPrompt] = useState(fallbackStatus.systemPrompt);
  const [deerFlowStatus, setDeerFlowStatus] = useState<DeerFlowRuntimeStatus>(fallbackDeerFlowStatus);
  const [deerFlowConfig, setDeerFlowConfig] = useState<DeerFlowConfigOverview>(fallbackDeerFlowConfig);
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
    Promise.all([getDeerFlowRuntimeStatus(), getDeerFlowConfigOverview()])
      .then(([nextStatus, nextConfig]) => {
        setDeerFlowStatus(nextStatus);
        setDeerFlowConfig(nextConfig);
      })
      .catch((error: unknown) => {
        const messageText = error instanceof Error ? error.message : "Unable to load DeerFlow status";
        setDeerFlowStatus({ ...fallbackDeerFlowStatus, lastError: messageText });
        setDeerFlowConfig({ ...fallbackDeerFlowConfig, lastError: messageText });
      });
  }, [open]);

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
      setMessage(result.ok ? copy.validateSuccess : `${copy.validateFailed} ${result.message}`);
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
      setMessage(copy.saveSuccess);
    } finally {
      setBusyState("idle");
    }
  };

  return {
    apiKey,
    baseURL,
    busyState,
    deerFlowConfig,
    deerFlowStatus,
    message,
    model,
    modelPreset,
    providerId,
    status,
    systemPrompt,
    handleSubmit,
    handleValidate,
    setApiKey,
    setBaseURL,
    setModel,
    setModelPreset,
    setProviderId,
    setSystemPrompt
  };
}
