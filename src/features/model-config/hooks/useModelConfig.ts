import { useEffect, useMemo, useState } from "react";
import type { AppView } from "../../../app/App";
import {
  createConfiguredModelApi,
  deleteConfiguredModelApi,
  getConfiguredModelApis,
  getProviderApiConfigs,
  getProviderModels,
  getProviderReferences,
  saveConfiguredModelApi,
  saveProviderApiConfig
} from "../modelConfigClient";
import { getSettingsStatus, validateSettings } from "../../settings/settingsClient";
import type { ConfiguredModelApiSummary, ModelReference, ProviderApiConfigSummary, ProviderReference, SettingsStatus } from "../../settings/types";

type BusyState = "idle" | "loading" | "fetching" | "validating" | "saving";

export function useModelConfig(activeView: AppView, zh: boolean) {
  const [providers, setProviders] = useState<ProviderReference[]>([]);
  const [savedApiConfigs, setSavedApiConfigs] = useState<ProviderApiConfigSummary[]>([]);
  const [configuredModelApis, setConfiguredModelApis] = useState<ConfiguredModelApiSummary[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("deepseek");
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [model, setModel] = useState("");
  const [remoteModels, setRemoteModels] = useState<Record<string, ModelReference[]>>({});
  const [modelSource, setModelSource] = useState<Record<string, "remote" | "static">>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<BusyState>("idle");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (activeView !== "modelConfig") return;
    setBusy("loading");
    Promise.all([getProviderReferences(), getSettingsStatus(), getProviderApiConfigs(), getConfiguredModelApis()])
      .then(([references, nextStatus, apiConfigs, configuredApis]) => {
        setProviders(references.providers);
        setStatus(nextStatus);
        setSavedApiConfigs(apiConfigs.configs);
        setConfiguredModelApis(configuredApis.configs);

        const activeConfig = configuredApis.configs.find((config) => config.id === configuredApis.activeConfigId) ?? configuredApis.configs[0];
        const currentProviderId = activeConfig?.providerId || apiConfigs.activeProviderId || nextStatus.providerId || references.providers[0]?.id || "deepseek";
        const selected = references.providers.find((provider) => provider.id === currentProviderId) ?? references.providers[0];
        const saved = apiConfigs.configs.find((config) => config.providerId === selected?.id);
        setSelectedConfigId(activeConfig?.id ?? "");
        setSelectedProviderId(selected?.id ?? currentProviderId);
        setBaseURL(activeConfig?.baseURL || saved?.baseURL || nextStatus.baseURL || selected?.apiHost || "");
        setModel(activeConfig?.modelId || saved?.defaultModel || nextStatus.model || selected?.defaultModel || selected?.models[0]?.id || "");
        setError("");
      })
      .catch((nextError: unknown) => {
        setError(nextError instanceof Error ? nextError.message : "Unable to load model configuration");
      })
      .finally(() => setBusy("idle"));
  }, [activeView]);

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0];
  const selectedApiConfig = savedApiConfigs.find((config) => config.providerId === selectedProvider?.id);
  const selectedConfiguredApi = configuredModelApis.find((config) => config.id === selectedConfigId);
  const models = selectedProvider ? (remoteModels[selectedProvider.id] ?? selectedProvider.models) : [];
  const filteredModels = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    if (!cleanQuery) return models;
    return models.filter((item) => [item.id, item.name, item.group, item.modelType].some((value) => value?.toLowerCase().includes(cleanQuery)));
  }, [models, query]);

  const refreshSavedApiConfigs = async () => {
    const [apiConfigs, configuredApis] = await Promise.all([getProviderApiConfigs(), getConfiguredModelApis()]);
    setSavedApiConfigs(apiConfigs.configs);
    setConfiguredModelApis(configuredApis.configs);
    return apiConfigs;
  };

  const selectProvider = (provider: ProviderReference) => {
    setSelectedProviderId(provider.id);
    setApiKey("");
    setSelectedConfigId("");
    setMessage("");
    setError("");
    const providerBinding = configuredModelApis.find((config) => config.providerId === provider.id && config.keyConfigured)
      ?? configuredModelApis.find((config) => config.providerId === provider.id);
    setBaseURL(providerBinding?.baseURL || provider.apiHost);
    setModel(provider.defaultModel || provider.models[0]?.id || providerBinding?.modelId || "");
    setMessage(providerBinding?.keyConfigured
      ? (zh ? "已选供应商。保存新模型绑定时会复用该供应商已保存的 API Key。" : "Provider selected. New model bindings will reuse this provider's saved API key.")
      : "");
  };

  const selectProviderById = (providerId: string) => {
    const provider = providers.find((candidate) => candidate.id === providerId);
    if (provider) selectProvider(provider);
  };

  const useModel = (nextModel: ModelReference) => {
    setSelectedProviderId(nextModel.provider);
    setModel(nextModel.id);
    setSelectedConfigId("");
    const provider = providers.find((candidate) => candidate.id === nextModel.provider);
    const saved = savedApiConfigs.find((config) => config.providerId === nextModel.provider);
    if (provider) setBaseURL(saved?.baseURL || provider.apiHost);
    setMessage(zh ? "已填充模型配置，保存后生效。" : "Model configuration filled. Save to apply it.");
  };

  const selectConfiguredApi = (configId: string) => {
    const config = configuredModelApis.find((candidate) => candidate.id === configId);
    if (!config) return;
    setSelectedConfigId(config.id);
    setSelectedProviderId(config.providerId);
    setApiKey("");
    setBaseURL(config.baseURL);
    setModel(config.modelId);
    setMessage("");
    setError("");
  };

  const fetchModels = async () => {
    if (!selectedProvider) return;
    setBusy("fetching");
    setMessage("");
    setError("");
    try {
      const result = await getProviderModels({
        providerId: selectedProvider.id,
        apiKey: apiKey.trim() || undefined,
        baseURL: baseURL.trim() || undefined
      });
      setRemoteModels((current) => ({ ...current, [selectedProvider.id]: result.models }));
      setModelSource((current) => ({ ...current, [selectedProvider.id]: result.source }));
      setMessage(result.source === "remote"
        ? (zh ? "已获取远程模型列表。" : "Remote model list fetched.")
        : (zh ? "远程拉取失败，已回退到静态模型列表。" : "Remote fetch failed. Static model list is shown."));
      setError(result.error ?? "");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to fetch provider models");
    } finally {
      setBusy("idle");
    }
  };

  const validate = async () => {
    if (!selectedProvider) return;
    setBusy("validating");
    setMessage("");
    setError("");
    try {
      const result = await validateSettings({
        providerId: selectedProvider.id,
        apiKey: apiKey.trim() || undefined,
        baseURL: baseURL.trim() || undefined,
        model: model.trim() || undefined
      });
      setStatus(result);
      setMessage(result.message);
      if (!result.ok) setError(result.message);
    } finally {
      setBusy("idle");
    }
  };

  const save = async () => {
    if (!selectedProvider) return;
    setBusy("saving");
    setMessage("");
    setError("");
    try {
      const modelRef = models.find((item) => item.id === model.trim());
      const payload = {
        providerId: selectedProvider.id,
	        modelId: model.trim() || selectedProvider.defaultModel || selectedProvider.models[0]?.id || "",
	        modelName: modelRef?.name,
	        modelType: modelRef?.modelType,
        supportsThinking: modelRef?.supportsThinking,
	        apiKey: apiKey.trim() || undefined,
        baseURL: baseURL.trim() || undefined,
        enabled: true,
        confirmLocalKeyWrite: Boolean(apiKey.trim())
      };
      const saved = selectedConfigId
        ? await saveConfiguredModelApi(selectedConfigId, payload)
        : await createConfiguredModelApi(payload);
      setSelectedConfigId(saved.id);
      await saveProviderApiConfig(selectedProvider.id, {
        baseURL: saved.baseURL,
        defaultModel: saved.modelId,
        enabled: true
      }).catch(() => undefined);
      await refreshSavedApiConfigs();
      setStatus(await getSettingsStatus());
      setApiKey("");
      setMessage(zh ? "模型 API 配置已保存。" : "Model API configuration saved.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to save model configuration");
    } finally {
      setBusy("idle");
    }
  };

  const remove = async () => {
    if (!selectedProvider || !selectedConfigId) return;
    setBusy("saving");
    setMessage("");
    setError("");
    try {
      await deleteConfiguredModelApi(selectedConfigId);
      await refreshSavedApiConfigs();
      setStatus(await getSettingsStatus());
      setApiKey("");
      setSelectedConfigId("");
      setBaseURL(selectedProvider.apiHost);
      setModel(selectedProvider.defaultModel || selectedProvider.models[0]?.id || "");
      setMessage(zh ? "已删除本地 API 配置。" : "Local API configuration deleted.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to delete provider API configuration");
    } finally {
      setBusy("idle");
    }
  };

  return {
    apiKey,
    baseURL,
    busy,
    error,
    filteredModels,
    message,
    model,
    modelSource,
    providers,
    query,
    savedApiConfigs,
    selectedApiConfig,
    configuredModelApis,
    selectedConfigId,
    selectedConfiguredApi,
    selectedProvider,
    status,
    fetchModels,
    remove,
    save,
    selectProvider,
    selectProviderById,
    selectConfiguredApi,
    setApiKey,
    setBaseURL,
    setModel,
    setQuery,
    useModel,
    validate
  };
}
