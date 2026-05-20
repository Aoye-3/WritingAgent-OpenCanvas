import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { getConfiguredModelApis } from "../../settings/settingsClient";
import type { ConfiguredModelApiSummary } from "../../settings/types";
import type { AgentRuntimeConfig, AgentSettings } from "../types";

export const tabs = ["model", "prompt", "knowledge", "tools", "quick", "memory"] as const;
export type SettingsTab = (typeof tabs)[number];

export function AgentSettingsTabs({
  runtimeConfig,
  tab,
  settings,
  onChange
}: {
  runtimeConfig: AgentRuntimeConfig | null;
  tab: SettingsTab;
  settings: AgentSettings;
  onChange: (settings: AgentSettings) => void;
}) {
  if (tab === "model") return <AgentModelTab runtimeConfig={runtimeConfig} settings={settings} onChange={onChange} />;
  if (tab === "prompt") return <AgentPromptTab runtimeConfig={runtimeConfig} settings={settings} onChange={onChange} />;
  if (tab === "knowledge") return <AgentKnowledgeTab settings={settings} onChange={onChange} />;
  if (tab === "tools") return <AgentToolsTab runtimeConfig={runtimeConfig} settings={settings} onChange={onChange} />;
  if (tab === "quick") return <AgentQuickMessagesTab settings={settings} onChange={onChange} />;
  return <AgentMemoryTab settings={settings} onChange={onChange} />;
}

function AgentModelTab({ runtimeConfig, settings, onChange }: TabProps) {
  const { locale } = useI18n();
  const setModel = (patch: Partial<AgentSettings["model"]>) => onChange({ ...settings, model: { ...settings.model, ...patch } });
  const providerCapabilities = runtimeConfig?.providerProfile.capabilities;
  const [configuredApis, setConfiguredApis] = useState<ConfiguredModelApiSummary[]>([]);
  const chatConfiguredApis = useMemo(
    () => configuredApis.filter((config) => config.enabled && config.keyConfigured && isChatModelConfig(config)),
    [configuredApis]
  );
  const selectedConfiguredApi = chatConfiguredApis.find((config) => config.id === settings.model.configuredModelApiId)
    ?? chatConfiguredApis.find((config) => config.providerId === settings.model.providerId && config.modelId === settings.model.model);

  useEffect(() => {
    getConfiguredModelApis()
      .then((apiConfigs) => setConfiguredApis(apiConfigs.configs))
      .catch(() => {
        setConfiguredApis([]);
      });
  }, []);

  useEffect(() => {
    if (chatConfiguredApis.length === 0) return;
    if (selectedConfiguredApi) return;
    const nextConfig = chatConfiguredApis[0];
    setModel({
      configuredModelApiId: nextConfig.id,
      providerId: nextConfig.providerId,
      model: nextConfig.modelId,
      responseMode: "normal"
    });
  }, [chatConfiguredApis, selectedConfiguredApi]);

  return (
    <div className="agent-editor-section">
      <label className="field">
        <span>{text(locale, "configuredModelApi")}</span>
        <select
          value={selectedConfiguredApi?.id ?? ""}
          onChange={(event) => {
            const config = chatConfiguredApis.find((candidate) => candidate.id === event.target.value);
            if (!config) return;
            setModel({
              configuredModelApiId: config.id,
              providerId: config.providerId,
              model: config.modelId,
              responseMode: "normal"
            });
          }}
          disabled={chatConfiguredApis.length === 0}
        >
          {chatConfiguredApis.length === 0 ? <option value="">{text(locale, "noSavedApis")}</option> : null}
          {chatConfiguredApis.map((config) => (
            <option value={config.id} key={config.id}>{config.providerLabel} / {config.modelName} ({config.keyHint ?? "key"})</option>
          ))}
        </select>
        {chatConfiguredApis.length === 0 ? <small>{text(locale, "saveProviderApiFirst")}</small> : <small>{text(locale, "modelsFromSavedApi")}</small>}
      </label>
      <label className="field">
        <span>{text(locale, "model")}</span>
        <input value={selectedConfiguredApi?.modelId ?? settings.model.model} readOnly />
      </label>
      {providerCapabilities?.chatPrefixCompletion ? (
        <label className="field">
          <span>{text(locale, "responseMode")}</span>
          <select value={settings.model.responseMode ?? "normal"} onChange={(event) => setModel({ responseMode: event.target.value as AgentSettings["model"]["responseMode"] })}>
            <option value="normal">{text(locale, "normalMode")}</option>
            <option value="prefix_completion">{text(locale, "prefixMode")}</option>
          </select>
        </label>
      ) : null}
      {providerCapabilities?.thinking ? (
        <>
          <label className="toggle-row">
            <span>{text(locale, "thinkMode")}</span>
            <input
              type="checkbox"
              checked={settings.model.thinkingMode === "enabled"}
              onChange={(event) => setModel({ thinkingMode: event.target.checked ? "enabled" : "disabled" })}
            />
          </label>
          {settings.model.thinkingMode === "enabled" ? (
            <label className="field">
              <span>{text(locale, "reasoningEffort")}</span>
              <select value={settings.model.reasoningEffort ?? "high"} onChange={(event) => setModel({ reasoningEffort: event.target.value as AgentSettings["model"]["reasoningEffort"] })}>
                <option value="high">High</option>
                <option value="max">Max</option>
              </select>
              <small>{text(locale, "thinkModeNote")}</small>
            </label>
          ) : null}
        </>
      ) : null}
      <RangeField label="Temperature" min={0} max={2} step={0.1} value={settings.model.temperature} onChange={(value) => setModel({ temperature: value })} />
      <RangeField label="Top-P" min={0} max={1} step={0.05} value={settings.model.topP} onChange={(value) => setModel({ topP: value })} />
      <RangeField label={text(locale, "contextCount")} min={0} max={100} step={1} value={settings.model.contextCount} onChange={(value) => setModel({ contextCount: value })} />
      <label className="toggle-row">
        <span>{text(locale, "maxTokens")}</span>
        <input type="checkbox" checked={settings.model.maxTokensEnabled} onChange={(event) => setModel({ maxTokensEnabled: event.target.checked })} />
      </label>
      <label className="field">
        <span>{text(locale, "tokenLimit")}</span>
        <input type="number" value={settings.model.maxTokens} onChange={(event) => setModel({ maxTokens: Number(event.target.value) })} />
      </label>
      <label className="toggle-row">
        <span>{text(locale, "streaming")}</span>
        <input type="checkbox" checked={settings.model.streaming} onChange={(event) => setModel({ streaming: event.target.checked })} />
      </label>
      <label className="field">
        <span>{text(locale, "toolCallMode")}</span>
        <select value={settings.model.toolCallMode} onChange={(event) => setModel({ toolCallMode: event.target.value as AgentSettings["model"]["toolCallMode"] })}>
          <option value="function">Function</option>
          <option value="auto">Auto</option>
          <option value="none">None</option>
        </select>
      </label>
      <label className="field">
        <span>{text(locale, "maxToolCalls")}</span>
        <input type="number" value={settings.model.maxToolCalls} onChange={(event) => setModel({ maxToolCalls: Number(event.target.value) })} />
      </label>
    </div>
  );
}

function AgentPromptTab({ runtimeConfig, settings, onChange }: TabProps) {
  const { locale } = useI18n();
  const setPrompt = (patch: Partial<AgentSettings["prompt"]>) => onChange({ ...settings, prompt: { ...settings.prompt, ...patch } });
  const missingSkills = runtimeConfig?.missingSkillRefs ?? [];
  const selectedSkillRefs = new Set(settings.prompt.skillRefs);
  const availableSkills = runtimeConfig?.availableSkills ?? [];
  const toggleSkillRef = (skillId: string, checked: boolean) => {
    const next = checked
      ? [...settings.prompt.skillRefs, skillId]
      : settings.prompt.skillRefs.filter((skillRef) => skillRef !== skillId);
    setPrompt({ skillRefs: Array.from(new Set(next)) });
  };

  return (
    <div className="agent-editor-section">
      <label className="field">
        <span>{text(locale, "name")}</span>
        <input value={settings.prompt.name} onChange={(event) => setPrompt({ name: event.target.value })} />
      </label>
      <label className="field">
        <span>{text(locale, "description")}</span>
        <textarea value={settings.prompt.description} onChange={(event) => setPrompt({ description: event.target.value })} />
      </label>
      <label className="field">
        <span>{text(locale, "identityPrompt")}</span>
        <textarea className="agent-prompt-textarea" value={settings.prompt.identityPrompt} onChange={(event) => setPrompt({ identityPrompt: event.target.value })} />
      </label>
      <label className="field">
        <span>{text(locale, "outputType")}</span>
        <input value={settings.prompt.outputType} onChange={(event) => setPrompt({ outputType: event.target.value })} />
      </label>
      <label className="field">
        <span>{text(locale, "outputFormat")}</span>
        <input value={settings.prompt.outputFormat} onChange={(event) => setPrompt({ outputFormat: event.target.value })} />
      </label>
      <div className="field">
        <span>{text(locale, "skills")}</span>
        <div className="skill-catalog-list">
          {availableSkills.length ? availableSkills.map((skill) => (
            <label className="skill-catalog-row" key={skill.id}>
              <span>
                <strong>{skill.name}</strong>
                <small>{skill.id}</small>
                <em>{skill.description}</em>
                {skill.allowedTools.length ? <span className="skill-tool-refs">{text(locale, "allowedTools")}: {skill.allowedTools.join(", ")}</span> : null}
              </span>
              <input type="checkbox" checked={selectedSkillRefs.has(skill.id)} onChange={(event) => toggleSkillRef(skill.id, event.target.checked)} />
            </label>
          )) : (
            <p className="agent-editor-note">{text(locale, "noSkills")}</p>
          )}
        </div>
      </div>
      {missingSkills.length ? <p className="settings-message">{text(locale, "unknownSkills")}: {missingSkills.join(", ")}</p> : null}
    </div>
  );
}

function AgentKnowledgeTab({ settings, onChange }: TabProps) {
  const { locale } = useI18n();
  return (
    <div className="agent-editor-section">
      <label className="toggle-row">
        <span>{text(locale, "enableKnowledge")}</span>
        <input type="checkbox" checked={settings.knowledge.enabled} onChange={(event) => onChange({ ...settings, knowledge: { ...settings.knowledge, enabled: event.target.checked } })} />
      </label>
      <label className="field">
        <span>{text(locale, "referenceScope")}</span>
        <input value={settings.knowledge.scope} onChange={(event) => onChange({ ...settings, knowledge: { ...settings.knowledge, scope: event.target.value } })} />
      </label>
      <p className="agent-editor-note">{text(locale, "knowledgeNote")}</p>
    </div>
  );
}

function AgentToolsTab({ runtimeConfig, settings, onChange }: TabProps) {
  const { locale } = useI18n();
  const tools = runtimeConfig?.availableTools ?? [];
  return (
    <div className="agent-editor-section">
      {runtimeConfig?.missingToolRefs.length ? <p className="settings-message">{text(locale, "missingTools")}: {runtimeConfig.missingToolRefs.join(", ")}</p> : null}
      {tools.map((tool) => {
        const policy = runtimeConfig?.toolPolicies.find((item) => item.name === tool.name);
        return (
          <label className="tool-catalog-row" key={tool.name}>
            <span>
              <strong>{tool.label}</strong>
              <small>{tool.name}</small>
              <em>{tool.description}</em>
              <span className="tool-catalog-badges">
                <Badge label={riskLabel(tool.riskLevel, locale)} tone={tool.riskLevel} />
                {tool.requiresApproval ? <Badge label={text(locale, "approvalRequired")} tone="high" /> : null}
                {tool.requiresExternalConfig ? <Badge label={text(locale, "externalConfig")} tone="medium" /> : null}
                {policy?.canAutoRun ? <Badge label={text(locale, "autoRunnable")} tone="low" /> : null}
              </span>
            </span>
            <input
              type="checkbox"
              checked={settings.tools[tool.name] !== false}
              onChange={(event) => onChange({ ...settings, tools: { ...settings.tools, [tool.name]: event.target.checked } })}
            />
          </label>
        );
      })}
    </div>
  );
}

function AgentQuickMessagesTab({ settings, onChange }: TabProps) {
  const { locale } = useI18n();
  return (
    <div className="agent-editor-section">
      {settings.quickMessages.map((message, index) => (
        <div className="quick-message-row" key={`${message}-${index}`}>
          <input
            value={message}
            onChange={(event) => {
              const next = [...settings.quickMessages];
              next[index] = event.target.value;
              onChange({ ...settings, quickMessages: next });
            }}
          />
          <button className="icon-button" type="button" onClick={() => onChange({ ...settings, quickMessages: settings.quickMessages.filter((_, itemIndex) => itemIndex !== index) })}>x</button>
        </div>
      ))}
      <button className="button button-secondary" type="button" onClick={() => onChange({ ...settings, quickMessages: [...settings.quickMessages, ""] })}>
        {text(locale, "addPhrase")}
      </button>
    </div>
  );
}

function AgentMemoryTab({ settings, onChange }: TabProps) {
  const { locale } = useI18n();
  return (
    <div className="agent-editor-section">
      <label className="toggle-row">
        <span>{text(locale, "globalMemory")}</span>
        <input type="checkbox" checked={settings.memory.enabled} onChange={(event) => onChange({ ...settings, memory: { enabled: event.target.checked } })} />
      </label>
      <p className="agent-editor-note">{text(locale, "memoryNote")}</p>
    </div>
  );
}

type TabProps = {
  runtimeConfig?: AgentRuntimeConfig | null;
  settings: AgentSettings;
  onChange: (settings: AgentSettings) => void;
};

function Badge({ label, tone }: { label: string; tone: "low" | "medium" | "high" }) {
  return <span className={`tool-badge tool-badge-${tone}`}>{label}</span>;
}

function RangeField({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
  return (
    <label className="field range-field">
      <span>{label}: {value}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function riskLabel(riskLevel: "low" | "medium" | "high", locale: "en" | "zh") {
  const labels = {
    low: { en: "Low risk", zh: "低风险" },
    medium: { en: "Medium risk", zh: "中风险" },
    high: { en: "High risk", zh: "高风险" }
  };
  return labels[riskLevel][locale];
}

function isChatModelConfig(config: ConfiguredModelApiSummary) {
  const type = config.modelType?.toLowerCase();
  return !type || type === "chat" || type === "vision";
}

export function tabLabel(tab: SettingsTab, locale: "en" | "zh") {
  const labels: Record<SettingsTab, Record<"en" | "zh", string>> = {
    model: { en: "Model", zh: "模型设置" },
    prompt: { en: "Prompt", zh: "提示词设置" },
    knowledge: { en: "Knowledge", zh: "知识库设置" },
    tools: { en: "Tools", zh: "工具设置" },
    quick: { en: "Quick phrases", zh: "常用短语" },
    memory: { en: "Memory", zh: "全局记忆" }
  };
  return labels[tab][locale];
}

function text(locale: "en" | "zh", key: keyof typeof copy.en) {
  return (copy[locale] as Partial<Record<keyof typeof copy.en, string>>)[key] ?? copy.en[key];
}

const copy = {
  en: {
    addPhrase: "Add phrase",
    allowedTools: "Allowed tools",
    approvalRequired: "Approval required",
    autoRunnable: "Auto runnable",
    contextCount: "Context count",
    configuredModelApi: "Configured API model",
    description: "Description",
    enableKnowledge: "Enable knowledge base",
    externalConfig: "External config",
    globalMemory: "Global memory",
    identityPrompt: "Identity prompt",
    knowledgeNote: "This MVP saves knowledge settings and injects prompt hints; retrieval comes later.",
    maxTokens: "Max tokens",
    maxToolCalls: "Max tool calls",
    memoryNote: "This stage only saves the toggle and writes memory state into the prompt.",
    missingTools: "AgentCard references missing tools",
    modelsFromSavedApi: "Agent models are limited to saved local API + model bindings.",
    model: "Model",
    name: "Name",
    noSavedApis: "No saved API models",
    noSavedModels: "No saved models",
    noSkills: "No skills are available yet",
    normalMode: "Normal chat",
    outputFormat: "Output format",
    outputType: "Output type",
    prefixMode: "Prefix completion",
    referenceScope: "Reference scope",
    responseMode: "Response mode",
    saveProviderApiFirst: "Save an API + model binding in Model Config before assigning models to Agents.",
    skills: "Skills",
    streaming: "Streaming",
    tokenLimit: "Token limit",
    thinkMode: "Think mode",
    thinkModeNote: "Can be combined with tool calls on DeepSeek. The runtime preserves provider-private reasoning state without showing it in chat.",
    toolCallMode: "Tool call mode",
    unknownSkills: "Unknown skill refs",
    reasoningEffort: "Reasoning effort"
  },
  zh: {
    addPhrase: "添加短语",
    allowedTools: "允许工具",
    approvalRequired: "需要审批",
    autoRunnable: "可自动运行",
    contextCount: "上下文数量",
    configuredModelApi: "已配置 API 模型",
    description: "描述",
    enableKnowledge: "启用知识库",
    externalConfig: "外部配置",
    globalMemory: "全局记忆",
    identityPrompt: "身份提示词",
    knowledgeNote: "当前 MVP 会保存知识库配置并注入 Prompt，真实检索后续接入。",
    maxTokens: "最大 Token 数",
    maxToolCalls: "最大工具调用次数",
    memoryNote: "当前阶段只保存开关并写入 Prompt 状态。",
    missingTools: "AgentCard 引用了缺失工具",
    model: "模型",
    name: "名称",
    noSkills: "暂无可用技能",
    normalMode: "普通对话",
    outputFormat: "输出格式",
    outputType: "输出类型",
    prefixMode: "前缀续写",
    referenceScope: "引用范围",
    responseMode: "响应模式",
    skills: "技能",
    streaming: "流式输出",
    tokenLimit: "Token 上限",
    thinkMode: "Think 模式",
    thinkModeNote: "包含工具调用时会自动关闭，以避免 reasoning 与工具参数混线。",
    toolCallMode: "工具调用方式",
    unknownSkills: "未知技能引用",
    reasoningEffort: "推理强度"
  }
} as const;
