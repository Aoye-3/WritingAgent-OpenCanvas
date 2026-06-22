import { FormEvent, useEffect, useState } from "react";
import { getAgentBackendConfigOverview, getAgentBackendRuntimeStatus, getCanvasSettings, getProjectRuntimeSettings, getSettingsStatus, saveCanvasSettings, saveProjectRuntimeSettings, saveSettings, shutdownDevServer, validateSettings } from "../settingsClient";
import { fallbackAgentBackendConfig, fallbackAgentBackendStatus, fallbackStatus, resolvePreset } from "../settingsDefaults";
import type { AgentBackendConfigOverview, AgentBackendRuntimeStatus, ProjectRuntimeSettings, SettingsStatus } from "../types";

const fallbackRuntimeSettings: ProjectRuntimeSettings = {
  runtimeBudgetProfile: "medium",
  evidenceToolLimit: 8,
  bodyDraftWriteLimit: 3,
  modelCallLimit: 20,
  recursionLimit: 80,
  synthesisReserveSteps: 16
};

export function useProjectSettings(open: boolean, projectId: string, copy: {
  validateSuccess: string;
  validateFailed: string;
  saveSuccess: string;
}) {
  const [status, setStatus] = useState<SettingsStatus>(fallbackStatus);
  const [providerId, setProviderId] = useState<SettingsStatus["providerId"]>("deepseek");
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("https://api.deepseek.com");
  const [model, setModel] = useState("deepseek-v4-flash");
  const [modelPreset, setModelPreset] = useState("deepseek:deepseek-v4-flash");
  const [systemPrompt, setSystemPrompt] = useState(fallbackStatus.systemPrompt);
  const [agentBackendStatus, setAgentBackendStatus] = useState<AgentBackendRuntimeStatus>(fallbackAgentBackendStatus);
  const [agentBackendConfig, setAgentBackendConfig] = useState<AgentBackendConfigOverview>(fallbackAgentBackendConfig);
  const [canvasUndoDepth, setCanvasUndoDepth] = useState(20);
  const [runtimeSettings, setRuntimeSettings] = useState<ProjectRuntimeSettings>(fallbackRuntimeSettings);
  const [message, setMessage] = useState("");
  const [busyState, setBusyState] = useState<"idle" | "saving" | "validating" | "stopping">("idle");

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
    Promise.all([getAgentBackendRuntimeStatus(), getAgentBackendConfigOverview()])
      .then(([nextStatus, nextConfig]) => {
        setAgentBackendStatus(nextStatus);
        setAgentBackendConfig(nextConfig);
      })
      .catch((error: unknown) => {
        const messageText = error instanceof Error ? error.message : "Unable to load Agent Runtime status";
        setAgentBackendStatus({ ...fallbackAgentBackendStatus, lastError: messageText });
        setAgentBackendConfig({ ...fallbackAgentBackendConfig, lastError: messageText });
      });
    getCanvasSettings()
      .then((canvasSettings) => setCanvasUndoDepth(canvasSettings.undoDepth))
      .catch(() => setCanvasUndoDepth(20));
    if (projectId) {
      getProjectRuntimeSettings(projectId)
        .then(setRuntimeSettings)
        .catch(() => setRuntimeSettings(fallbackRuntimeSettings));
    }
  }, [open, projectId]);

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

  const handleShutdownDevServer = async () => {
    const confirmed = window.confirm("Stop the local development server now?");
    if (!confirmed) return;

    setBusyState("stopping");
    setMessage("");
    try {
      await shutdownDevServer();
      setMessage("Development server is shutting down. This page will disconnect shortly.");
    } finally {
      setBusyState("idle");
    }
  };

  const handleCanvasSettingsSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyState("saving");
    setMessage("");
    try {
      const saved = await saveCanvasSettings({ undoDepth: canvasUndoDepth });
      setCanvasUndoDepth(saved.undoDepth);
      setMessage(copy.saveSuccess);
    } finally {
      setBusyState("idle");
    }
  };

  const handleRuntimeSettingsSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId) return;
    setBusyState("saving");
    setMessage("");
    try {
      const saved = await saveProjectRuntimeSettings(projectId, runtimeSettings);
      setRuntimeSettings(saved);
      setMessage(copy.saveSuccess);
    } finally {
      setBusyState("idle");
    }
  };

  const updateRuntimeSettings = (patch: Partial<ProjectRuntimeSettings>) => {
    setRuntimeSettings((current) => ({ ...current, ...patch }));
  };

  return {
    apiKey,
    baseURL,
    busyState,
    agentBackendConfig,
    agentBackendStatus,
    canvasUndoDepth,
    runtimeSettings,
    message,
    model,
    modelPreset,
    providerId,
    status,
    systemPrompt,
    handleSubmit,
    handleCanvasSettingsSubmit,
    handleRuntimeSettingsSubmit,
    handleShutdownDevServer,
    handleValidate,
    setApiKey,
    setBaseURL,
    setModel,
    setModelPreset,
    setProviderId,
    setSystemPrompt,
    setCanvasUndoDepth,
    updateRuntimeSettings
  };
}
