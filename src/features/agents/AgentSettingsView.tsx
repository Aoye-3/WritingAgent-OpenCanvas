import { useEffect, useMemo, useState } from "react";
import type { AppView } from "../../app/App";
import { fetchAgentRuntimeConfig, saveAgentSettings } from "./agentClient";
import type { AgentCard, AgentRuntimeConfig, AgentSettings } from "./types";
import { useI18n } from "../i18n/I18nProvider";
import { ManagementSidebar } from "../projects/ProjectsView";

type AgentSettingsViewProps = {
  activeView: AppView;
  agentCards: AgentCard[];
  onNavigate: (view: AppView) => void;
  onOpenAgent: (agentCard: AgentCard) => void;
  onAgentSaved: (agentCard: AgentCard) => void;
};

const tabs = ["model", "prompt", "knowledge", "tools", "quick", "memory"] as const;
type SettingsTab = (typeof tabs)[number];

export function AgentSettingsView({ activeView, agentCards, onNavigate, onOpenAgent, onAgentSaved }: AgentSettingsViewProps) {
  const { locale } = useI18n();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [selectedId, setSelectedId] = useState(agentCards[0]?.id ?? "");
  const [activeTab, setActiveTab] = useState<SettingsTab>("model");
  const [runtimeConfig, setRuntimeConfig] = useState<AgentRuntimeConfig | null>(null);
  const [draft, setDraft] = useState<AgentSettings | null>(agentCards[0]?.settings ?? null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);

  const selectedAgent = agentCards.find((agent) => agent.id === selectedId) ?? agentCards[0];

  useEffect(() => {
    if (selectedAgent && !selectedId) {
      setSelectedId(selectedAgent.id);
    }
  }, [selectedAgent, selectedId]);

  useEffect(() => {
    if (!selectedAgent) return;
    let active = true;
    setLoadingConfig(true);
    setMessage("");
    fetchAgentRuntimeConfig(selectedAgent.id)
      .then((config) => {
        if (!active) return;
        setRuntimeConfig(config);
        setDraft(config.settings);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setRuntimeConfig(null);
        setDraft(selectedAgent.settings ?? null);
        setMessage(error instanceof Error ? error.message : text(locale, "runtimeLoadFailed"));
      })
      .finally(() => {
        if (active) setLoadingConfig(false);
      });
    return () => {
      active = false;
    };
  }, [selectedAgent?.id, locale]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return agentCards.filter((agent) => {
      const matchesCategory = category === "all" || agent.category === category;
      const matchesTerm = !term || `${agent.title.en} ${agent.title.zh} ${agent.description.en} ${agent.id}`.toLowerCase().includes(term);
      return matchesCategory && matchesTerm;
    });
  }, [agentCards, category, query]);

  const openSettings = (agent: AgentCard) => {
    setSelectedId(agent.id);
    setActiveTab("model");
    setMessage("");
  };

  const updateDraft = (next: AgentSettings) => {
    setDraft(next);
    setMessage("");
  };

  const handleSave = async () => {
    if (!selectedAgent || !draft) return;
    setSaving(true);
    try {
      const result = await saveAgentSettings(selectedAgent.id, draft);
      onAgentSaved(result.agentCard);
      const config = await fetchAgentRuntimeConfig(selectedAgent.id);
      setRuntimeConfig(config);
      setDraft(config.settings);
      setMessage(text(locale, "saved"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="view management-app" data-active={activeView === "agentSettings"}>
      <ManagementSidebar activeView={activeView} onNavigate={onNavigate} />
      <section className="management-main agent-settings-main">
        <div className="management-header">
          <div>
            <h1>{text(locale, "title")}</h1>
            <p>{text(locale, "subtitle")}</p>
          </div>
          <button className="button button-primary" type="button" onClick={() => selectedAgent && onOpenAgent(selectedAgent)}>
            {text(locale, "useAgent")}
          </button>
        </div>

        <div className="management-toolbar">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text(locale, "search")} />
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">{text(locale, "allCategories")}</option>
            <option value="writing">{text(locale, "writing")}</option>
            <option value="rewrite">{text(locale, "rewrite")}</option>
            <option value="summarise">{text(locale, "summarise")}</option>
            <option value="education">{text(locale, "education")}</option>
          </select>
        </div>

        <div className="agent-settings-layout">
          <section className="agent-gallery" aria-label="Agent gallery">
            {filtered.map((agent) => (
              <button className={agent.id === selectedAgent?.id ? "agent-gallery-card is-selected" : "agent-gallery-card"} key={agent.id} type="button" onClick={() => openSettings(agent)}>
                <span className={`agent-gallery-icon accent-${agent.accent}`}>{agent.title[locale].slice(0, 1)}</span>
                <strong>{agent.title[locale]}</strong>
                <p>{agent.description[locale]}</p>
                <small>{agent.skillRefs.join(", ")}</small>
              </button>
            ))}
          </section>

          <aside className="agent-editor-panel" aria-label="Agent settings editor">
            {selectedAgent && draft ? (
              <>
                <div className="agent-editor-header">
                  <div>
                    <p className="eyebrow">{selectedAgent.id}</p>
                    <h2>{selectedAgent.title[locale]}</h2>
                    <p className="agent-editor-note">{text(locale, "editorNote")}</p>
                  </div>
                  <button className="button button-primary button-small" type="button" onClick={handleSave} disabled={saving || loadingConfig}>
                    {saving ? text(locale, "saving") : text(locale, "save")}
                  </button>
                </div>
                <nav className="agent-editor-tabs" aria-label="Agent settings sections">
                  {tabs.map((tab) => (
                    <button className={activeTab === tab ? "is-active" : ""} key={tab} type="button" onClick={() => setActiveTab(tab)}>
                      {tabLabel(tab, locale)}
                    </button>
                  ))}
                </nav>
                <SettingsTabPanel runtimeConfig={runtimeConfig} tab={activeTab} settings={draft} onChange={updateDraft} />
                {runtimeConfig?.deprecatedToolRefs.length ? <p className="settings-message">{text(locale, "deprecatedTools")}: {runtimeConfig.deprecatedToolRefs.join(", ")}</p> : null}
                {message ? <p className="settings-message">{message}</p> : null}
              </>
            ) : (
              <div className="empty-management-state">{text(locale, "empty")}</div>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}

function SettingsTabPanel({
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
  const { locale } = useI18n();
  const setModel = (patch: Partial<AgentSettings["model"]>) => onChange({ ...settings, model: { ...settings.model, ...patch } });
  const setPrompt = (patch: Partial<AgentSettings["prompt"]>) => onChange({ ...settings, prompt: { ...settings.prompt, ...patch } });
  const providerCapabilities = runtimeConfig?.providerProfile.capabilities;

  if (tab === "model") {
    return (
      <div className="agent-editor-section">
        <label className="field">
          <span>Provider</span>
          <select value={settings.model.providerId} onChange={(event) => setModel({ providerId: event.target.value as AgentSettings["model"]["providerId"], responseMode: "normal" })}>
            <option value="deepseek">DeepSeek</option>
            <option value="openai">OpenAI</option>
            <option value="openai-compatible">OpenAI-compatible</option>
          </select>
        </label>
        <label className="field">
          <span>{text(locale, "model")}</span>
          <input value={settings.model.model} onChange={(event) => setModel({ model: event.target.value })} placeholder="deepseek-chat" />
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

  if (tab === "prompt") {
    const missingSkills = runtimeConfig?.missingSkillRefs ?? [];
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
        <label className="field">
          <span>Skill refs</span>
          <input value={settings.prompt.skillRefs.join(", ")} onChange={(event) => setPrompt({ skillRefs: splitRefs(event.target.value) })} />
        </label>
        {runtimeConfig?.availableSkills.length ? (
          <p className="agent-editor-note">{text(locale, "availableSkills")}: {runtimeConfig.availableSkills.map((skill) => skill.id).join(", ")}</p>
        ) : null}
        {missingSkills.length ? <p className="settings-message">{text(locale, "unknownSkills")}: {missingSkills.join(", ")}</p> : null}
      </div>
    );
  }

  if (tab === "knowledge") {
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

  if (tab === "tools") {
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

  if (tab === "quick") {
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

function splitRefs(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function riskLabel(riskLevel: "low" | "medium" | "high", locale: "en" | "zh") {
  const labels = {
    low: { en: "Low risk", zh: "低风险" },
    medium: { en: "Medium risk", zh: "中风险" },
    high: { en: "High risk", zh: "高风险" }
  };
  return labels[riskLevel][locale];
}

function tabLabel(tab: SettingsTab, locale: "en" | "zh") {
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
  return copy[locale][key];
}

const copy = {
  en: {
    title: "Agent settings",
    subtitle: "Configure local AgentCards, skills, tools, and collaboration prompts.",
    useAgent: "Use selected Agent",
    search: "Search agents",
    allCategories: "All categories",
    writing: "Writing",
    rewrite: "Rewrite",
    summarise: "Summarise",
    education: "Education",
    editorNote: "Model, prompt, skills, tools, and quick phrases affect generation. Tool availability is resolved from the backend catalog.",
    save: "Save",
    saving: "Saving",
    saved: "Agent settings saved",
    empty: "Select an Agent to configure",
    runtimeLoadFailed: "Unable to load Agent runtime config",
    deprecatedTools: "Deprecated tools were ignored",
    model: "Model",
    responseMode: "Response mode",
    normalMode: "Normal chat",
    prefixMode: "Prefix completion",
    contextCount: "Context count",
    maxTokens: "Max tokens",
    tokenLimit: "Token limit",
    streaming: "Streaming",
    toolCallMode: "Tool call mode",
    maxToolCalls: "Max tool calls",
    name: "Name",
    description: "Description",
    identityPrompt: "Identity prompt",
    outputType: "Output type",
    outputFormat: "Output format",
    availableSkills: "Available skills",
    unknownSkills: "Unknown skill refs",
    enableKnowledge: "Enable knowledge base",
    referenceScope: "Reference scope",
    knowledgeNote: "This MVP saves knowledge settings and injects prompt hints; retrieval comes later.",
    missingTools: "AgentCard references missing tools",
    approvalRequired: "Approval required",
    externalConfig: "External config",
    autoRunnable: "Auto runnable",
    addPhrase: "Add phrase",
    globalMemory: "Global memory",
    memoryNote: "This stage only saves the toggle and writes memory state into the prompt."
  },
  zh: {
    title: "Agent 设置",
    subtitle: "配置本地 AgentCard、技能、工具与协作提示词。",
    useAgent: "使用当前 Agent",
    search: "搜索 Agent",
    allCategories: "全部类型",
    writing: "写作",
    rewrite: "改写",
    summarise: "摘要",
    education: "教育",
    editorNote: "模型、提示词、技能、工具和常用短语会真实影响生成。工具可用性由后端 catalog 统一解析。",
    save: "保存",
    saving: "保存中",
    saved: "已保存 Agent 设置",
    empty: "选择一个 Agent 开始配置",
    runtimeLoadFailed: "无法加载 Agent 运行配置",
    deprecatedTools: "已忽略废弃工具",
    model: "模型",
    responseMode: "响应模式",
    normalMode: "普通对话",
    prefixMode: "前缀续写",
    contextCount: "上下文数量",
    maxTokens: "最大 Token 数",
    tokenLimit: "Token 上限",
    streaming: "流式输出",
    toolCallMode: "工具调用方式",
    maxToolCalls: "最大工具调用次数",
    name: "名称",
    description: "描述",
    identityPrompt: "身份提示词",
    outputType: "输出类型",
    outputFormat: "输出格式",
    availableSkills: "可用技能",
    unknownSkills: "未知技能引用",
    enableKnowledge: "启用知识库",
    referenceScope: "引用范围",
    knowledgeNote: "当前 MVP 会保存知识库配置并注入 Prompt，真实检索后续接入。",
    missingTools: "AgentCard 引用了缺失工具",
    approvalRequired: "需要审批",
    externalConfig: "外部配置",
    autoRunnable: "可自动运行",
    addPhrase: "添加短语",
    globalMemory: "全局记忆",
    memoryNote: "当前阶段只保存开关并写入 Prompt 状态。"
  }
} as const;
