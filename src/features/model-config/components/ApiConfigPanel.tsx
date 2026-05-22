import { Button, EmptyState, Panel, StatusBadge, TextField } from "../../../shared/ui";
import type { ConfiguredModelApiSummary, ModelReference, ProviderReference } from "../../settings/types";

export function ApiConfigPanel(props: {
  apiKey: string;
  baseURL: string;
  busy: string;
  model: string;
  models: ModelReference[];
  query: string;
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
  onQueryChange: (value: string) => void;
  onRemove: () => void;
  onResetURL: () => void;
  onSave: () => void;
  onSelectSaved: (configId: string) => void;
  onUseModel: (model: ModelReference) => void;
  onValidate: () => void;
}) {
  const { apiKey, baseURL, busy, model, models, provider, query, selectedConfiguredApi, source, zh } = props;

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
        placeholder={selectedConfiguredApi?.keyConfigured ? (zh ? `已保存 ${selectedConfiguredApi.keyHint ?? ""}，输入新 Key 可替换` : `Saved ${selectedConfiguredApi.keyHint ?? ""}. Enter a new key to replace it.`) : "sk-..."}
      />
      <TextField label={zh ? "API 地址" : "Base URL"} value={baseURL} onChange={(event) => props.onBaseURLChange(event.target.value)} />
      <TextField label={zh ? "绑定模型" : "Bound model"} value={model} onChange={(event) => props.onModelChange(event.target.value)} />

      <ModelPickerSection
        models={models}
        query={query}
        selectedModel={model}
        zh={zh}
        onQueryChange={props.onQueryChange}
        onUseModel={props.onUseModel}
      />

      <div className="model-config-actions">
        <Button type="button" onClick={props.onResetURL}>{zh ? "重置 API 地址" : "Reset URL"}</Button>
        <Button type="button" onClick={props.onFetchModels} loading={busy === "fetching"}>{zh ? "获取模型列表" : "Fetch models"}</Button>
        <Button type="button" onClick={props.onValidate} loading={busy === "validating"}>{zh ? "验证" : "Validate"}</Button>
        <Button type="button" variant="primary" onClick={props.onSave} loading={busy === "saving"}>{selectedConfiguredApi ? (zh ? "保存绑定" : "Save binding") : (zh ? "新增绑定" : "Add binding")}</Button>
        {selectedConfiguredApi?.updatedAt ? (
          <Button type="button" onClick={props.onRemove} loading={busy === "saving"}>{zh ? "删除绑定" : "Delete binding"}</Button>
        ) : null}
      </div>
    </Panel>
  );
}

function ModelPickerSection({
  models,
  query,
  selectedModel,
  zh,
  onQueryChange,
  onUseModel
}: {
  models: ModelReference[];
  query: string;
  selectedModel: string;
  zh: boolean;
  onQueryChange: (value: string) => void;
  onUseModel: (model: ModelReference) => void;
}) {
  return (
    <section className="binding-model-list" aria-label={zh ? "供应商模型列表" : "Provider model list"}>
      <div className="model-panel-header">
        <div>
          <h3>{zh ? "供应商模型列表" : "Provider models"}</h3>
          <p>{zh ? "从当前供应商的静态或远程模型中选择一个，填入上方绑定。" : "Choose from the current provider's static or fetched models to fill the binding."}</p>
        </div>
        <span>{models.length}</span>
      </div>
      <TextField label={zh ? "搜索模型" : "Search models"} value={query} onChange={(event) => onQueryChange(event.target.value)} />
      <div className="model-reference-list is-embedded">
        {models.length > 0 ? models.map((item) => (
          <button className={item.id === selectedModel ? "model-reference-row is-selected" : "model-reference-row"} key={`${item.provider}:${item.id}`} type="button" onClick={() => onUseModel(item)}>
            <span>
              <strong>{item.name}</strong>
              <small>{item.id}</small>
            </span>
            <em>{item.group}</em>
            <b>{item.modelType ?? "chat"}</b>
          </button>
        )) : (
          <EmptyState title={zh ? "暂无模型" : "No models"}>
            {zh ? "尝试获取远程模型列表，或切换供应商。" : "Fetch remote models or switch provider."}
          </EmptyState>
        )}
      </div>
    </section>
  );
}
