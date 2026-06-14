import { useEffect, useState } from "react";
import { fetchAgentRuntimeDashboard } from "../../ai-dashboard/agentRuntimeClient";
import { useI18n } from "../../i18n/I18nProvider";
import { knowledgeClient } from "../../knowledge/knowledgeClient";
import type { KnowledgeBase } from "../../knowledge/types";
import type { AgentRuntimeConfig, AgentSettings } from "../types";

export const tabs = ["prompt", "knowledge", "tools", "mcp", "memory"] as const;
export type SettingsTab = (typeof tabs)[number];

type McpServerSummary = {
  enabled?: boolean;
  name?: string;
  description?: string;
  [key: string]: unknown;
};

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
  if (tab === "prompt") return <AgentPromptTab runtimeConfig={runtimeConfig} settings={settings} onChange={onChange} />;
  if (tab === "knowledge") return <AgentKnowledgeTab settings={settings} onChange={onChange} />;
  if (tab === "tools") return <AgentToolsTab runtimeConfig={runtimeConfig} settings={settings} onChange={onChange} />;
  if (tab === "mcp") return <AgentMcpTab settings={settings} onChange={onChange} />;
  return <AgentMemoryTab settings={settings} onChange={onChange} />;
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
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const selectedBaseIds = new Set(settings.knowledge.baseIds ?? []);
  const setKnowledge = (patch: Partial<AgentSettings["knowledge"]>) => {
    onChange({ ...settings, knowledge: { ...settings.knowledge, ...patch } });
  };

  useEffect(() => {
    knowledgeClient.listBases()
      .then((response) => {
        setBases(response.bases);
        setLoadFailed(false);
      })
      .catch(() => {
        setBases([]);
        setLoadFailed(true);
      });
  }, []);

  const toggleBase = (baseId: string, checked: boolean) => {
    const next = checked
      ? [...selectedBaseIds, baseId]
      : (settings.knowledge.baseIds ?? []).filter((item) => item !== baseId);
    setKnowledge({ baseIds: Array.from(new Set(next)) });
  };

  return (
    <div className="agent-editor-section">
      <label className="toggle-row">
        <span>{text(locale, "enableKnowledge")}</span>
        <input type="checkbox" checked={settings.knowledge.enabled} onChange={(event) => setKnowledge({ enabled: event.target.checked })} />
      </label>
      <label className="field">
        <span>{text(locale, "referenceScope")}</span>
        <input value={settings.knowledge.scope} onChange={(event) => setKnowledge({ scope: event.target.value })} />
      </label>
      <div className="field">
        <span>{text(locale, "knowledgeBases")}</span>
        <div className="skill-catalog-list" data-testid="agent-knowledge-base-list">
          <label className="skill-catalog-row">
            <span>
              <strong>{text(locale, "allKnowledgeBases")}</strong>
              <em>{text(locale, "allKnowledgeBasesNote")}</em>
            </span>
            <input
              type="checkbox"
              checked={(settings.knowledge.baseIds ?? []).length === 0}
              onChange={(event) => {
                if (event.target.checked) setKnowledge({ baseIds: [] });
              }}
            />
          </label>
          {bases.map((base) => (
            <label className="skill-catalog-row" key={base.id}>
              <span>
                <strong>{base.name}</strong>
                <small>{base.items.length} items - {base.embeddingModel}</small>
                <em>{base.description || base.id}</em>
              </span>
              <input type="checkbox" checked={selectedBaseIds.has(base.id)} onChange={(event) => toggleBase(base.id, event.target.checked)} />
            </label>
          ))}
          {bases.length === 0 ? <p className="agent-editor-note">{loadFailed ? text(locale, "knowledgeLoadFailed") : text(locale, "noKnowledgeBases")}</p> : null}
        </div>
      </div>
      <RangeField label={text(locale, "knowledgeDocumentCount")} min={1} max={12} step={1} value={settings.knowledge.documentCount ?? 6} onChange={(value) => setKnowledge({ documentCount: value })} />
      <RangeField label={text(locale, "knowledgeThreshold")} min={0} max={1} step={0.05} value={settings.knowledge.threshold ?? 0.2} onChange={(value) => setKnowledge({ threshold: value })} />
      <label className="toggle-row">
        <span>{text(locale, "rerankKnowledge")}</span>
        <input type="checkbox" checked={settings.knowledge.rerankEnabled ?? false} onChange={(event) => setKnowledge({ rerankEnabled: event.target.checked })} />
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

function AgentMcpTab({ settings, onChange }: TabProps) {
  const { locale } = useI18n();
  const [servers, setServers] = useState<Record<string, McpServerSummary>>({});
  const [loadFailed, setLoadFailed] = useState(false);
  const selected = new Set(settings.mcpRefs ?? []);

  useEffect(() => {
    let active = true;
    fetchAgentRuntimeDashboard()
      .then((dashboard) => {
        if (!active) return;
        setServers(normalizeMcpServers(dashboard.config.mcpServers));
        setLoadFailed(false);
      })
      .catch(() => {
        if (!active) return;
        setServers({});
        setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const toggle = (id: string, checked: boolean) => {
    const next = checked
      ? [...selected, id]
      : (settings.mcpRefs ?? []).filter((item) => item !== id);
    onChange({ ...settings, mcpRefs: Array.from(new Set(next)) });
  };

  const entries = Object.entries(servers).filter(([, server]) => server.enabled !== false);
  return (
    <div className="agent-editor-section">
      <p className="agent-editor-note">{text(locale, "mcpNote")}</p>
      <div className="skill-catalog-list">
        {entries.map(([id, server]) => (
          <label className="tool-catalog-row" key={id}>
            <span>
              <strong>{server.name || id}</strong>
              <small>{id}</small>
              {server.description ? <em>{server.description}</em> : null}
            </span>
            <input type="checkbox" checked={selected.has(id)} onChange={(event) => toggle(id, event.target.checked)} />
          </label>
        ))}
        {entries.length === 0 ? <p className="agent-editor-note">{loadFailed ? text(locale, "mcpLoadFailed") : text(locale, "noMcpServers")}</p> : null}
      </div>
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

function normalizeMcpServers(value: Record<string, unknown>): Record<string, McpServerSummary> {
  return Object.fromEntries(
    Object.entries(value ?? {}).map(([id, server]) => [
      id,
      typeof server === "object" && server ? server as McpServerSummary : {}
    ])
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

export function tabLabel(tab: SettingsTab, locale: "en" | "zh") {
  const labels: Record<SettingsTab, Record<"en" | "zh", string>> = {
    prompt: { en: "Prompt", zh: "提示词" },
    knowledge: { en: "Knowledge", zh: "知识库" },
    tools: { en: "Tools", zh: "工具" },
    mcp: { en: "MCP", zh: "MCP" },
    memory: { en: "Memory", zh: "记忆" }
  };
  return labels[tab][locale];
}

function text(locale: "en" | "zh", key: keyof typeof copy.en) {
  return copy[locale][key];
}

const copy = {
  en: {
    allKnowledgeBases: "All knowledge bases",
    allKnowledgeBasesNote: "Use every enabled knowledge base for this Agent.",
    allowedTools: "Allowed tools",
    approvalRequired: "Approval required",
    autoRunnable: "Auto runnable",
    description: "Description",
    enableKnowledge: "Enable knowledge",
    externalConfig: "External config",
    globalMemory: "Global memory",
    identityPrompt: "Identity prompt",
    knowledgeBases: "Knowledge bases",
    knowledgeDocumentCount: "Documents",
    knowledgeLoadFailed: "Unable to load knowledge bases",
    knowledgeNote: "Knowledge choices stay with the Agent profile.",
    knowledgeThreshold: "Threshold",
    memoryNote: "Memory belongs to the Agent profile; model choice stays with the conversation.",
    mcpLoadFailed: "Unable to load Agent Runtime MCP configuration",
    mcpNote: "Select from already configured Agent Runtime MCP servers. Installing or editing MCP servers lives outside Agent profiles.",
    missingTools: "Missing tools",
    name: "Name",
    noKnowledgeBases: "No knowledge bases configured",
    noMcpServers: "No configured MCP servers available",
    noSkills: "No public skills available",
    outputFormat: "Output format",
    outputType: "Output type",
    referenceScope: "Reference scope",
    rerankKnowledge: "Rerank knowledge",
    skills: "Skills",
    unknownSkills: "Unknown skills"
  },
  zh: {
    allKnowledgeBases: "全部知识库",
    allKnowledgeBasesNote: "此 Agent 可使用全部已启用知识库。",
    allowedTools: "允许工具",
    approvalRequired: "需要审批",
    autoRunnable: "可自动运行",
    description: "描述",
    enableKnowledge: "启用知识库",
    externalConfig: "外部配置",
    globalMemory: "全局记忆",
    identityPrompt: "身份提示词",
    knowledgeBases: "知识库",
    knowledgeDocumentCount: "文档数量",
    knowledgeLoadFailed: "无法加载知识库",
    knowledgeNote: "知识库选择保存在 Agent Profile 中。",
    knowledgeThreshold: "阈值",
    memoryNote: "记忆属于 Agent Profile；模型选择属于会话。",
    mcpLoadFailed: "无法加载 Agent Runtime MCP 配置",
    mcpNote: "只能选择已经配置好的 Agent Runtime MCP server；安装和编辑不属于 Agent Profile。",
    missingTools: "缺失工具",
    name: "名称",
    noKnowledgeBases: "暂无知识库",
    noMcpServers: "暂无可用 MCP server",
    noSkills: "暂无可用技能",
    outputFormat: "输出格式",
    outputType: "输出类型",
    referenceScope: "引用范围",
    rerankKnowledge: "重排知识",
    skills: "技能",
    unknownSkills: "未知技能"
  }
} as const;
