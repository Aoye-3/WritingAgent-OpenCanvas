import { Button, Panel, StatusBadge, TextField } from "../../../shared/ui";
import type { ConfiguredModelApiSummary, ProviderReference } from "../../settings/types";

export function ApiConfigPanel(props: {
  apiKey: string;
  baseURL: string;
  busy: string;
  model: string;
  source?: "remote" | "static";
  providers: ProviderReference[];
  configuredModelApis: ConfiguredModelApiSummary[];
  selectedConfiguredApi?: ConfiguredModelApiSummary;
  provider: ProviderReference;
  zh: boolean;
  onApiKeyChange: (value: string) => void;
  onBaseURLChange: (value: string) => void;
  onFetchModels: () => void;
  onModelChange: (value: string) => void;
  onRemove: () => void;
  onResetURL: () => void;
  onSave: () => void;
  onSelectSaved: (configId: string) => void;
  onValidate: () => void;
}) {
  const { apiKey, baseURL, busy, configuredModelApis, model, provider, providers, selectedConfiguredApi, source, zh } = props;

  return (
    <Panel className="model-api-panel">
      <div className="model-panel-header">
        <div>
          <h2>{zh ? "API 模型绑定" : "API model binding"}</h2>
          <p>{provider.name} / {provider.id}</p>
        </div>
        <StatusBadge tone={source === "remote" ? "success" : "neutral"}>{source ?? "static"}</StatusBadge>
      </div>

      <div className="model-link-row">
        {provider.websites?.docs ? <a href={provider.websites.docs} target="_blank" rel="noreferrer">{zh ? "文档" : "Docs"}</a> : null}
        {provider.websites?.apiKey ? <a href={provider.websites.apiKey} target="_blank" rel="noreferrer">API Key</a> : null}
        {provider.websites?.models ? <a href={provider.websites.models} target="_blank" rel="noreferrer">{zh ? "模型市场" : "Models"}</a> : null}
      </div>

      <TextField
        label="API Key"
        type="password"
        autoComplete="off"
        value={apiKey}
        onChange={(event) => props.onApiKeyChange(event.target.value)}
        placeholder={selectedConfiguredApi?.keyConfigured ? (zh ? `已保存 ${selectedConfiguredApi.keyHint ?? ""}，输入新 Key 可覆盖` : `Saved ${selectedConfiguredApi.keyHint ?? ""}. Enter a new key to replace it.`) : "sk-..."}
      />
      <TextField label={zh ? "API 地址" : "Base URL"} value={baseURL} onChange={(event) => props.onBaseURLChange(event.target.value)} />
      <TextField label={zh ? "绑定模型" : "Bound model"} value={model} onChange={(event) => props.onModelChange(event.target.value)} />

      <SavedApiList
        configs={configuredModelApis}
        providers={providers}
        selectedConfigId={selectedConfiguredApi?.id}
        zh={zh}
        onSelect={props.onSelectSaved}
      />

      <div className="model-config-actions">
        <Button type="button" onClick={props.onResetURL}>{zh ? "重置 API 地址" : "Reset URL"}</Button>
        <Button type="button" onClick={props.onFetchModels} loading={busy === "fetching"}>{zh ? "获取模型列表" : "Fetch models"}</Button>
        <Button type="button" onClick={props.onValidate} loading={busy === "validating"}>{zh ? "检测" : "Validate"}</Button>
        <Button type="button" variant="primary" onClick={props.onSave} loading={busy === "saving"}>{selectedConfiguredApi ? (zh ? "保存绑定" : "Save binding") : (zh ? "新增绑定" : "Add binding")}</Button>
        {selectedConfiguredApi?.updatedAt ? (
          <Button type="button" onClick={props.onRemove} loading={busy === "saving"}>{zh ? "删除绑定" : "Delete binding"}</Button>
        ) : null}
      </div>
    </Panel>
  );
}

function SavedApiList({
  configs,
  providers,
  selectedConfigId,
  zh,
  onSelect
}: {
  configs: ConfiguredModelApiSummary[];
  providers: ProviderReference[];
  selectedConfigId?: string;
  zh: boolean;
  onSelect: (configId: string) => void;
}) {
  const configured = configs.filter((config) => config.keyConfigured);
  const sections = groupConfiguredApis(configured, providers);

  return (
    <section className="saved-api-list" aria-label={zh ? "本地 API 模型列表" : "Local API model list"}>
      <div className="model-panel-header">
        <div>
          <h3>{zh ? "本地 API 模型列表" : "Local API model list"}</h3>
          <p>{zh ? "每一行都是可被 Agent 或知识库调用的 API + 模型绑定。" : "Each row is a callable API + model binding for Agents or knowledge bases."}</p>
        </div>
        <span>{configured.length}</span>
      </div>
      {configured.length > 0 ? (
        <div className="saved-api-sections">
          {sections.map((section) => (
            <div className="saved-api-section" key={section.id}>
              <div className="saved-api-section-title">
                <strong>{section.label}</strong>
                <span>{section.items.length}</span>
              </div>
              <div className="saved-api-table" role="table" aria-label={section.label}>
                <div className="saved-api-table-head" role="row">
                  <span>{zh ? "供应商" : "Provider"}</span>
                  <span>Key</span>
                  <span>{zh ? "API 地址" : "Base URL"}</span>
                  <span>{zh ? "模型" : "Model"}</span>
                  <span>{zh ? "操作" : "Action"}</span>
                </div>
                {section.items.map((config) => (
                  <article className={config.id === selectedConfigId ? "saved-api-row is-active" : "saved-api-row"} key={config.id} role="row">
                    <span>
                      <strong>{config.providerLabel}</strong>
                      <small>{config.providerId}</small>
                    </span>
                    <em>{config.keyHint ?? "configured"}</em>
                    <small>{config.baseURL}</small>
                    <small>{config.modelName} / {config.modelId}</small>
                    <button type="button" onClick={() => onSelect(config.id)}>
                      {zh ? "编辑" : "Edit"}
                    </button>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p>{zh ? "暂无本地 API 模型绑定。选择模型并保存后会显示在这里。" : "No local API model bindings yet. Choose a model and save a binding to list it here."}</p>
      )}
    </section>
  );
}

function groupConfiguredApis(configs: ConfiguredModelApiSummary[], providers: ProviderReference[]) {
  const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
  const labels: Record<string, string> = {
    openai: "OpenAI-compatible",
    "new-api": "New API",
    ollama: "Local runtime",
    gemini: "Gemini",
    anthropic: "Anthropic",
    "aws-bedrock": "AWS Bedrock",
    "azure-openai": "Azure OpenAI",
    "vertex-ai": "Vertex AI"
  };
  const order = ["openai", "new-api", "ollama", "gemini", "anthropic", "azure-openai", "vertex-ai", "aws-bedrock", "other"];
  const grouped = new Map<string, ConfiguredModelApiSummary[]>();

  for (const config of configs) {
    const provider = providerMap.get(config.providerId);
    const key = provider?.type || "other";
    grouped.set(key, [...(grouped.get(key) ?? []), config]);
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([id, items]) => ({
      id,
      label: labels[id] ?? id,
      items: items.sort((a, b) => `${a.providerLabel}:${a.modelName}`.localeCompare(`${b.providerLabel}:${b.modelName}`))
    }));
}
