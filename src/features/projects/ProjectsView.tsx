import { useMemo, useState } from "react";
import type { AppView } from "../../app/App";
import type { AgentCard, ProjectSummary, StoredThread } from "../agents/types";
import { useI18n } from "../i18n/I18nProvider";
import { AppSidebar } from "../../shared/AppSidebar";

type ProjectsViewProps = {
  activeView: AppView;
  agentCards: AgentCard[];
  projects: ProjectSummary[];
  trashProjects: ProjectSummary[];
  onNavigate: (view: AppView) => void;
  onOpenThread: (thread: StoredThread) => void;
  onMoveToTrash: (threadId: string) => void;
  onRestore: (threadId: string) => void;
  onHardDelete: (threadId: string) => void;
};

export function ProjectsView({
  activeView,
  agentCards,
  projects,
  trashProjects,
  onNavigate,
  onOpenThread,
  onMoveToTrash,
  onRestore,
  onHardDelete
}: ProjectsViewProps) {
  const { locale } = useI18n();
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [showTrash, setShowTrash] = useState(false);
  const source = showTrash ? trashProjects : projects;

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return source.filter((project) => {
      const matchesAgent = agentFilter === "all" || project.agentCardId === agentFilter;
      const matchesText = !term || `${project.title} ${project.agentTitle} ${project.agentCardId}`.toLowerCase().includes(term);
      return matchesAgent && matchesText;
    });
  }, [agentFilter, query, source]);

  return (
    <main className="view management-app" data-active={activeView === "projects"}>
      <ManagementSidebar activeView={activeView} onNavigate={onNavigate} />
      <section className="management-main">
        <div className="management-header">
          <div>
            <h1>{locale === "zh" ? "项目" : "Projects"}</h1>
            <p>{locale === "zh" ? "管理本地线程、画布资产和回收站。" : "Manage local threads, canvas assets, and trash."}</p>
          </div>
          <button className="button button-primary" type="button" onClick={() => onNavigate("home")}>
            {locale === "zh" ? "创建新画布" : "Create canvas"}
          </button>
        </div>

        <div className="management-toolbar">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={locale === "zh" ? "搜索项目或 Agent" : "Search projects or agents"} />
          <select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}>
            <option value="all">{locale === "zh" ? "全部 Agent" : "All agents"}</option>
            {agentCards.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.title[locale]}</option>
            ))}
          </select>
          <button className={showTrash ? "button button-primary" : "button button-secondary"} type="button" onClick={() => setShowTrash((value) => !value)}>
            {showTrash ? (locale === "zh" ? "查看项目" : "View projects") : (locale === "zh" ? "回收站" : "Trash")}
          </button>
        </div>

        <section className="project-table" aria-label={showTrash ? "Trash" : "Projects"}>
          <div className="project-table-head">
            <span>{locale === "zh" ? "名称" : "Name"}</span>
            <span>Agent</span>
            <span>{locale === "zh" ? "资产" : "Assets"}</span>
            <span>{locale === "zh" ? "更新时间" : "Updated"}</span>
            <span>{locale === "zh" ? "操作" : "Actions"}</span>
          </div>
          {filtered.map((project) => (
            <article className="project-table-row" key={project.id}>
              <button type="button" onClick={() => !showTrash && onOpenThread(project)} disabled={showTrash}>
                <strong>{project.agentTitle || project.title}</strong>
                <small>{project.id}</small>
              </button>
              <span>{agentCards.find((agent) => agent.id === project.agentCardId)?.title[locale] ?? project.agentCardId}</span>
              <span>{project.assetCount ?? 0}</span>
              <time>{new Date(project.updatedAt).toLocaleString()}</time>
              <div className="project-row-actions">
                {showTrash ? (
                  <>
                    <button className="button button-secondary button-small" type="button" onClick={() => onRestore(project.id)}>
                      {locale === "zh" ? "恢复" : "Restore"}
                    </button>
                    <button className="button button-danger button-small" type="button" onClick={() => onHardDelete(project.id)}>
                      {locale === "zh" ? "永久删除" : "Delete"}
                    </button>
                  </>
                ) : (
                  <>
                    <button className="button button-secondary button-small" type="button" onClick={() => onOpenThread(project)}>
                      {locale === "zh" ? "打开" : "Open"}
                    </button>
                    <button className="button button-secondary button-small" type="button" onClick={() => onMoveToTrash(project.id)}>
                      {locale === "zh" ? "移入回收站" : "Trash"}
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
          {filtered.length === 0 ? (
            <div className="empty-management-state">{showTrash ? (locale === "zh" ? "回收站为空" : "Trash is empty") : (locale === "zh" ? "暂无项目" : "No projects yet")}</div>
          ) : null}
        </section>
      </section>
    </main>
  );
}

export function ManagementSidebar({ activeView, onNavigate }: { activeView: AppView; onNavigate: (view: AppView) => void }) {
  return <AppSidebar activeView={activeView} onNavigate={onNavigate} className="management-sidebar" />;

  const { locale, setLocale } = useI18n();
  const items: Array<{ view: AppView; label: string }> = [
    { view: "home", label: locale === "zh" ? "家" : "Home" },
    { view: "projects", label: locale === "zh" ? "项目" : "Projects" },
    { view: "agentSettings", label: locale === "zh" ? "Agent设置" : "Agent settings" },
    { view: "knowledgeSettings", label: locale === "zh" ? "知识库设置" : "Knowledge settings" }
  ];

  return (
    <aside className="home-sidebar management-sidebar" aria-label="Management navigation">
      <div className="home-sidebar-brand">
        <span className="brand-mark" aria-hidden="true">F</span>
        <span>FacetWrite</span>
      </div>
      <nav className="home-sidebar-nav">
        {items.map((item) => (
          <button className={activeView === item.view ? "home-nav-item is-active" : "home-nav-item"} key={item.view} type="button" onClick={() => onNavigate(item.view)}>
            <span className="sidebar-dot" aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="home-sidebar-footer">
        <button className="home-side-pill" type="button">{locale === "zh" ? "本地应用模式" : "Local app mode"}</button>
        <button className="home-side-pill" type="button" onClick={() => setLocale(locale === "en" ? "zh" : "en")}>
          {locale === "zh" ? "Switch to English" : "切换中文"}
        </button>
      </div>
    </aside>
  );
}
