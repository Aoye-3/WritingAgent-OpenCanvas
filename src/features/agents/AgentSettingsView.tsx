import { useEffect, useMemo, useState } from "react";
import type { AppView } from "../../app/App";
import { AgentSettingsTabs, tabs, tabLabel, type SettingsTab } from "./components/AgentSettingsTabs";
import { useAgentRuntimeConfig } from "./hooks/useAgentRuntimeConfig";
import type { AgentCard } from "./types";
import { useI18n } from "../i18n/I18nProvider";
import { ManagementSidebar } from "../projects/ProjectsView";

type AgentSettingsViewProps = {
  activeView: AppView;
  agentCards: AgentCard[];
  onNavigate: (view: AppView) => void;
  onOpenAgent: (agentCard: AgentCard) => void;
  onAgentSaved: (agentCard: AgentCard) => void;
};

export function AgentSettingsView({ activeView, agentCards, onNavigate, onOpenAgent, onAgentSaved }: AgentSettingsViewProps) {
  const { locale } = useI18n();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [selectedId, setSelectedId] = useState(agentCards[0]?.id ?? "");
  const [activeTab, setActiveTab] = useState<SettingsTab>("model");
  const selectedAgent = agentCards.find((agent) => agent.id === selectedId) ?? agentCards[0];
  const runtime = useAgentRuntimeConfig(
    selectedAgent,
    {
      runtimeLoadFailed: text(locale, "runtimeLoadFailed"),
      saved: text(locale, "saved")
    },
    onAgentSaved
  );

  useEffect(() => {
    if (selectedAgent && !selectedId) {
      setSelectedId(selectedAgent.id);
    }
  }, [selectedAgent, selectedId]);

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
            {selectedAgent && runtime.draft ? (
              <>
                <div className="agent-editor-header">
                  <div>
                    <p className="eyebrow">{selectedAgent.id}</p>
                    <h2>{selectedAgent.title[locale]}</h2>
                    <p className="agent-editor-note">{text(locale, "editorNote")}</p>
                  </div>
                  <button className="button button-primary button-small" type="button" onClick={runtime.saveDraft} disabled={runtime.saving || runtime.loadingConfig}>
                    {runtime.saving ? text(locale, "saving") : text(locale, "save")}
                  </button>
                </div>
                <nav className="agent-editor-tabs" aria-label="Agent settings sections">
                  {tabs.map((tab) => (
                    <button className={activeTab === tab ? "is-active" : ""} key={tab} type="button" onClick={() => setActiveTab(tab)}>
                      {tabLabel(tab, locale)}
                    </button>
                  ))}
                </nav>
                <AgentSettingsTabs runtimeConfig={runtime.runtimeConfig} tab={activeTab} settings={runtime.draft} onChange={runtime.updateDraft} />
                {runtime.runtimeConfig?.deprecatedToolRefs.length ? <p className="settings-message">{text(locale, "deprecatedTools")}: {runtime.runtimeConfig.deprecatedToolRefs.join(", ")}</p> : null}
                {runtime.message ? <p className="settings-message">{runtime.message}</p> : null}
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

function text(locale: "en" | "zh", key: keyof typeof copy.en) {
  return copy[locale][key];
}

const copy = {
  en: {
    allCategories: "All categories",
    deprecatedTools: "Deprecated tools were ignored",
    editorNote: "Model, prompt, skills, tools, and quick phrases affect generation. Tool availability is resolved from the backend catalog.",
    education: "Education",
    empty: "Select an Agent to configure",
    rewrite: "Rewrite",
    runtimeLoadFailed: "Unable to load Agent runtime config",
    save: "Save",
    saved: "Agent settings saved",
    saving: "Saving",
    search: "Search agents",
    subtitle: "Configure local AgentCards, skills, tools, and collaboration prompts.",
    summarise: "Summarise",
    title: "Agent settings",
    useAgent: "Use selected Agent",
    writing: "Writing"
  },
  zh: {
    allCategories: "全部类型",
    deprecatedTools: "已忽略废弃工具",
    editorNote: "模型、提示词、技能、工具和常用短语会影响生成。工具可用性由后端 catalog 统一解析。",
    education: "教育",
    empty: "选择一个 Agent 开始配置",
    rewrite: "改写",
    runtimeLoadFailed: "无法加载 Agent 运行配置",
    save: "保存",
    saved: "已保存 Agent 设置",
    saving: "保存中",
    search: "搜索 Agent",
    subtitle: "配置本地 AgentCard、技能、工具与协作提示词。",
    summarise: "摘要",
    title: "Agent 设置",
    useAgent: "使用当前 Agent",
    writing: "写作"
  }
} as const;
