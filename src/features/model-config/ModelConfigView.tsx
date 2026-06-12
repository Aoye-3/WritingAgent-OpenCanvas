import { useEffect, useState } from "react";
import type { AppView } from "../../app/App";
import { AppSidebar } from "../../shared/AppSidebar";
import { EmptyState, StatusBadge } from "../../shared/ui";
import { useI18n } from "../i18n/I18nProvider";
import { ApiConfigPanel } from "./components/ApiConfigPanel";
import { ConfiguredApiListPanel } from "./components/ConfiguredApiListPanel";
import { ProviderListPanel } from "./components/ProviderListPanel";
import { useModelConfig } from "./hooks/useModelConfig";
import { getModelRuntimeSyncStatus, retryModelRuntimeSync, type ModelRuntimeSyncEntry } from "./modelConfigClient";

type ModelConfigViewProps = {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
};

export function ModelConfigView({ activeView, onNavigate }: ModelConfigViewProps) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const state = useModelConfig(activeView, zh);
  const [runtimeSync, setRuntimeSync] = useState<ModelRuntimeSyncEntry[]>([]);

  useEffect(() => {
    if (activeView !== "modelConfig") return;
    void getModelRuntimeSyncStatus().then((result) => setRuntimeSync(result.models)).catch(() => setRuntimeSync([]));
  }, [activeView, state.configuredModelApis.length]);
  const degradedCount = runtimeSync.filter((model) => model.status === "failed" || model.status === "unsupported").length;

  return (
    <main className="view management-app model-config-app" data-active={activeView === "modelConfig"}>
      <AppSidebar activeView={activeView} onNavigate={onNavigate} className="management-sidebar" />
      <section className="management-main model-config-main">
        <div className="management-header">
          <div>
            <h1>{zh ? "模型配置" : "Model Config"}</h1>
            <p>{zh ? "管理供应商 API、静态模型引用，并按需拉取远程模型列表。" : "Manage provider APIs, static model references, and remote model listing."}</p>
          </div>
          {state.status ? <StatusBadge tone={state.status.keyConfigured ? "success" : "warning"}>{state.status.keyConfigured ? (zh ? "已配置 Key" : "Key configured") : (zh ? "未配置 Key" : "No key")}</StatusBadge> : null}
        </div>

        {state.busy === "loading" ? <EmptyState title={zh ? "正在读取模型配置..." : "Loading model configuration..."} /> : null}
        {state.message ? <p className="settings-message">{state.message}</p> : null}
        {state.error ? <p className="settings-message is-error">{state.error}</p> : null}
        <p className={`settings-message${degradedCount > 0 ? " is-error" : ""}`}>
          {degradedCount > 0
            ? (zh ? `${degradedCount} 个模型尚未同步到 AgentBackend，生成已被阻止。` : `${degradedCount} model(s) are not synchronized with AgentBackend; generation is blocked.`)
            : (zh ? "AgentBackend 模型同步状态正常。" : "AgentBackend model synchronization is healthy.")}
          {" "}
          <button type="button" onClick={() => void retryModelRuntimeSync().then((result) => setRuntimeSync(result.models)).catch(() => void getModelRuntimeSyncStatus().then((result) => setRuntimeSync(result.models)))}>
            {zh ? "重试同步" : "Retry sync"}
          </button>
        </p>

        {state.selectedProvider ? (
          <div className="model-config-grid">
            <ConfiguredApiListPanel
              configs={state.configuredModelApis}
              providers={state.providers}
              selectedConfigId={state.selectedConfiguredApi?.id}
              zh={zh}
              onSelect={state.selectConfiguredApi}
            />
            <ProviderListPanel providers={state.providers} selectedProviderId={state.selectedProvider.id} zh={zh} onSelect={state.selectProvider} />
            <ApiConfigPanel
              apiKey={state.apiKey}
              baseURL={state.baseURL}
              busy={state.busy}
              model={state.model}
              provider={state.selectedProvider}
              providers={state.providers}
              configuredModelApis={state.configuredModelApis}
              models={state.filteredModels}
              query={state.query}
              selectedConfiguredApi={state.selectedConfiguredApi}
              source={state.modelSource[state.selectedProvider.id]}
              zh={zh}
              onApiKeyChange={state.setApiKey}
              onBaseURLChange={state.setBaseURL}
              onFetchModels={state.fetchModels}
              onModelChange={state.setModel}
              onRemove={state.remove}
              onResetURL={() => state.setBaseURL(state.selectedProvider?.apiHost ?? "")}
              onSave={state.save}
              onSelectSaved={state.selectConfiguredApi}
              onQueryChange={state.setQuery}
              onUseModel={state.useModel}
              onValidate={state.validate}
            />
          </div>
        ) : null}
      </section>
    </main>
  );
}
