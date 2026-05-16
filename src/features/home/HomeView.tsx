import { FormEvent, useMemo, useState } from "react";
import type { AppView } from "../../app/App";
import type { AgentCard, StoredThread } from "../agents/types";
import { BrandIcon, SearchIcon, TaskIcon } from "../../shared/icons";
import { AppSidebar } from "../../shared/AppSidebar";
import { useI18n } from "../i18n/I18nProvider";

type HomeViewProps = {
  activeView: AppView;
  agentCards: AgentCard[];
  recentThreads: StoredThread[];
  onOpenSettings: () => void;
  onOpenAgent: (agentCard: AgentCard) => void;
  onOpenThread: (thread: StoredThread) => void;
  onNavigate: (view: AppView) => void;
  onDeleteThread: (thread: StoredThread) => void;
};

export function HomeView({ activeView, agentCards, recentThreads, onOpenSettings, onOpenAgent, onOpenThread, onNavigate, onDeleteThread }: HomeViewProps) {
  const { locale, setLocale } = useI18n();
  const [homePrompt, setHomePrompt] = useState("");

  const featuredAgents = useMemo(() => {
    const preferred = ["blog-post", "rewrite-polish", "email-writer", "lesson-plan"];
    return preferred
      .map((id) => agentCards.find((agentCard) => agentCard.id === id))
      .filter((agentCard): agentCard is AgentCard => Boolean(agentCard));
  }, [agentCards]);

  const primaryAgent = agentCards[0];

  const submitPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (primaryAgent) onOpenAgent(primaryAgent);
  };

  const quickActions = [
    {
      label: locale === "zh" ? "创建画布" : "Create canvas",
      hint: locale === "zh" ? "打开文档式写作空间" : "Open the document workspace",
      agent: agentCards.find((agent) => agent.id === "blog-post")
    },
    {
      label: locale === "zh" ? "创建 Agent" : "Create agent",
      hint: locale === "zh" ? "从任务卡开始配置能力" : "Start from an AgentCard",
      agent: agentCards.find((agent) => agent.id === "report-outline")
    },
    {
      label: locale === "zh" ? "改写草稿" : "Rewrite draft",
      hint: locale === "zh" ? "润色已有内容" : "Polish existing text",
      agent: agentCards.find((agent) => agent.id === "rewrite-polish")
    }
  ];

  return (
    <main className="view view-home home-app" id="home-view" data-active={activeView === "home"}>
      <div hidden>
      <aside className="home-sidebar" aria-label="Home navigation">
        <div className="home-sidebar-brand">
          <span className="brand-mark" aria-hidden="true"><BrandIcon /></span>
          <span>FacetWrite</span>
        </div>

        <nav className="home-sidebar-nav">
          <button className="home-nav-item is-active" type="button" onClick={() => onNavigate("home")}>
            <HomeGlyph />
            <span>{locale === "zh" ? "家" : "Home"}</span>
          </button>
          <button className="home-nav-item" type="button" onClick={() => onNavigate("projects")}>
            <DocumentGlyph />
            <span>{locale === "zh" ? "项目" : "Projects"}</span>
          </button>
          <button className="home-nav-item" type="button" onClick={() => onNavigate("agentSettings")}>
            <AgentGlyph />
            <span>{locale === "zh" ? "Agent设置" : "Agent settings"}</span>
          </button>
          <button className="home-nav-item" type="button" onClick={() => onNavigate("knowledgeSettings")}>
            <BookGlyph />
            <span>{locale === "zh" ? "知识库设置" : "Knowledge settings"}</span>
          </button>
        </nav>

        <div className="home-sidebar-footer">
          <button className="home-side-pill" type="button">{locale === "zh" ? "本地应用模式" : "Local app mode"}</button>
          <button className="home-side-pill" type="button" onClick={onOpenSettings}>{locale === "zh" ? "项目设置" : "Project settings"}</button>
          <button className="home-side-pill" type="button" onClick={() => setLocale(locale === "en" ? "zh" : "en")}>
            {locale === "zh" ? "Switch to English" : "切换中文"}
          </button>
        </div>
      </aside>
      </div>
      <AppSidebar activeView={activeView} onNavigate={onNavigate} onOpenSettings={onOpenSettings} />

      <section className="home-main-panel">
        <div className="home-tip-bar">
          <strong>{locale === "zh" ? "FacetWrite 小技巧：" : "FacetWrite tip:"}</strong>
          <span>{locale === "zh" ? "先用任务卡确定意图，再让右侧 AI 协作层继续改写和解释。" : "Start with an AgentCard, then use the right AI collaboration layer for revisions and explanation."}</span>
          <button className="button button-secondary button-small" type="button" onClick={() => primaryAgent && onOpenAgent(primaryAgent)}>
            {locale === "zh" ? "开始一个画布" : "Create a canvas"}
          </button>
        </div>

        <div className="home-workspace-card">
          <section className="home-command-center" aria-labelledby="home-title">
            <h1 id="home-title">{locale === "zh" ? "欢迎回来，你想从哪项工作开始？" : "Welcome back. What work should we shape today?"}</h1>

            <form className="home-prompt-box" onSubmit={submitPrompt}>
              <textarea
                aria-label={locale === "zh" ? "首页提示词输入" : "Home prompt input"}
                placeholder={locale === "zh" ? "问问 FacetWrite 什么都行……" : "Ask FacetWrite to draft, rewrite, plan, or explain..."}
                value={homePrompt}
                onChange={(event) => setHomePrompt(event.target.value)}
              />
              <div className="home-prompt-actions">
                <button className="icon-button prompt-tool" type="button" aria-label="Add input">+</button>
                <button className="home-agent-chip" type="button">
                  <SearchIcon />
                  <span>{locale === "zh" ? "知识库" : "Knowledge"}</span>
                  <small>1/3</small>
                </button>
                <button className="home-send-button" type="submit" aria-label={locale === "zh" ? "发送" : "Send"}>
                  ↑
                </button>
              </div>
            </form>

            <div className="home-quick-actions">
              {quickActions.map((action) => (
                <button className="home-quick-action" key={action.label} type="button" onClick={() => action.agent && onOpenAgent(action.agent)}>
                  <span>{action.label}</span>
                  <small>{action.hint}</small>
                  <b>›</b>
                </button>
              ))}
            </div>
          </section>

          <section className="home-section home-projects" aria-label="Recent projects">
            <div className="home-section-header">
              <h2>{locale === "zh" ? "近期项目" : "Recent projects"}</h2>
              <button type="button" onClick={() => onNavigate("projects")}>{locale === "zh" ? "查看全部" : "View all"}</button>
            </div>
            <div className="home-project-list">
              {(recentThreads.length > 0 ? recentThreads.slice(0, 6) : fallbackProjects(locale)).map((item, index) => {
                const isThread = "id" in item;
                const thread = isThread ? item : undefined;
                const agentTitle = isThread ? agentCards.find((agent) => agent.id === item.agentCardId)?.title[locale] ?? item.agentCardId : item.title;
                const updatedAt = isThread ? new Date(item.updatedAt).toLocaleString() : item.updatedAt;
                const assets = isThread ? locale === "zh" ? "1 项资产" : "1 asset" : item.assets;
                return (
                  <button className="home-project-row" key={isThread ? item.id : item.title} type="button" onClick={() => thread && onOpenThread(thread)}>
                    <DocumentGlyph />
                    <span>{agentTitle}</span>
                    {index === 0 ? <em>{locale === "zh" ? "本地项目" : "Local"}</em> : null}
                    <small>{assets}</small>
                    <time>{updatedAt}</time>
                    {thread ? (
                      <span
                        className="home-project-delete"
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteThread(thread);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            onDeleteThread(thread);
                          }
                        }}
                        aria-label={locale === "zh" ? "移入回收站" : "Move to trash"}
                      >
                        ×
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="home-section home-agents" aria-label="Recent agents">
            <div className="home-section-header">
              <div>
                <h2>{locale === "zh" ? "近期代理人" : "Recent agents"}</h2>
                <p>{locale === "zh" ? "常用 Agent 会显示在这里，打开即可进入对应分层工作台。" : "Your most useful agents live here. Open one to enter its layered workspace."}</p>
              </div>
              <button type="button" onClick={() => onNavigate("agentSettings")}>{locale === "zh" ? "查看全部" : "View all"}</button>
            </div>
            <div className="home-agent-card-row">
              {featuredAgents.map((agentCard) => (
                <button className="home-agent-card" key={agentCard.id} type="button" onClick={() => onOpenAgent(agentCard)}>
                  <span className={`task-icon accent-${agentCard.accent}`} aria-hidden="true">
                    <TaskIcon icon={agentCard.icon} />
                  </span>
                  <strong>{agentCard.title[locale]}</strong>
                  <p>{agentCard.description[locale]}</p>
                  <small>{agentCard.outputContract.type}</small>
                </button>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function fallbackProjects(locale: "en" | "zh") {
  return [
    { title: locale === "zh" ? "课程说明草稿" : "Course explainer draft", assets: locale === "zh" ? "7 项资产" : "7 assets", updatedAt: locale === "zh" ? "现在" : "now" },
    { title: locale === "zh" ? "高端客厅文章" : "Premium living room article", assets: locale === "zh" ? "15 项资产" : "15 assets", updatedAt: locale === "zh" ? "7 小时前" : "7 hours ago" },
    { title: locale === "zh" ? "邮件改写任务" : "Email rewrite task", assets: locale === "zh" ? "2 项资产" : "2 assets", updatedAt: locale === "zh" ? "1 天前" : "1 day ago" }
  ];
}

function HomeGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11 12 4l8 7v8H5v-8Z" /><path d="M9 20v-6h6v6" /></svg>;
}

function DocumentGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h7l4 4v12H7z" /><path d="M14 4v5h5" /></svg>;
}

function AgentGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" /><path d="m12 12 8-4.5M12 12v9M12 12 4 7.5" /></svg>;
}

function BookGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h7a4 4 0 0 1 4 4v10H9a4 4 0 0 0-4-4Z" /><path d="M19 5h-3a4 4 0 0 0-4 4v10" /></svg>;
}
