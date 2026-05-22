import { Panel } from "../../../shared/ui";
import type { ConfiguredModelApiSummary, ProviderReference } from "../../settings/types";

export function ConfiguredApiListPanel({
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
    <Panel className="configured-api-panel">
      <div className="model-panel-header">
        <div>
          <h2>{zh ? "已配置 API 模型" : "Configured API models"}</h2>
          <p>{zh ? "可被 Agent 或知识库调用的本地 API + 模型绑定。" : "Callable local API + model bindings for Agents and knowledge bases."}</p>
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
                {section.items.map((config) => (
                  <button
                    className={config.id === selectedConfigId ? "saved-api-row is-active" : "saved-api-row"}
                    key={config.id}
                    type="button"
                    onClick={() => onSelect(config.id)}
                  >
                    <span>
                      <strong>{config.modelName}</strong>
                      <small>{config.providerLabel}</small>
                    </span>
                    <small>{config.baseURL}</small>
                    <em>{config.modelType ?? "chat"}</em>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="configured-api-empty">
          {zh ? "暂无已配置 API 模型。选择供应商和模型后保存，会显示在这里。" : "No configured API models yet. Pick a provider and model, then save the binding."}
        </p>
      )}
    </Panel>
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
