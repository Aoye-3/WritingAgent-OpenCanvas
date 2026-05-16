import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AppView } from "../../app/App";
import type { AgentCard, ProjectSummary, StoredThread } from "../agents/types";
import { useI18n } from "../i18n/I18nProvider";
import { AppSidebar } from "../../shared/AppSidebar";

type ProjectsViewProps = {
  activeView: AppView;
  agentCards: AgentCard[];
  projects: ProjectSummary[];
  trashProjects: ProjectSummary[];
  onBatchHardDelete: (threadIds: string[]) => Promise<void>;
  onBatchMoveToTrash: (threadIds: string[]) => Promise<void>;
  onNavigate: (view: AppView) => void;
  onOpenThread: (thread: StoredThread) => void;
  onMoveToTrash: (threadId: string) => void;
  onRenameThread: (threadId: string, title: string) => Promise<void>;
  onRestore: (threadId: string) => void;
  onHardDelete: (threadId: string) => void;
};

export function ProjectsView({
  activeView,
  agentCards,
  projects,
  trashProjects,
  onBatchHardDelete,
  onBatchMoveToTrash,
  onNavigate,
  onOpenThread,
  onMoveToTrash,
  onRenameThread,
  onRestore,
  onHardDelete
}: ProjectsViewProps) {
  const { locale } = useI18n();
  const [query, setQuery] = useState("");
  const [agentFilter, setAgentFilter] = useState("all");
  const [showTrash, setShowTrash] = useState(false);
  const [openMenuThreadId, setOpenMenuThreadId] = useState("");
  const [renameProject, setRenameProject] = useState<ProjectSummary | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const source = showTrash ? trashProjects : projects;

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return source.filter((project) => {
      const matchesAgent = agentFilter === "all" || project.agentCardId === agentFilter;
      const matchesText = !term || `${project.title} ${project.agentTitle} ${project.agentCardId}`.toLowerCase().includes(term);
      return matchesAgent && matchesText;
    });
  }, [agentFilter, query, source]);

  const visibleIds = useMemo(() => filtered.map((project) => project.id), [filtered]);
  const selectedVisibleIds = selectedIds.filter((id) => visibleIds.includes(id));
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleIds.length === visibleIds.length;
  const agentTitle = (project: ProjectSummary) => agentCards.find((agent) => agent.id === project.agentCardId)?.title[locale] ?? project.agentTitle ?? project.agentCardId;

  useEffect(() => {
    setSelectedIds([]);
    setOpenMenuThreadId("");
  }, [showTrash]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => visibleIds.includes(id)));
  }, [visibleIds]);

  const toggleSelected = (threadId: string) => {
    setSelectedIds((current) => current.includes(threadId) ? current.filter((id) => id !== threadId) : [...current, threadId]);
  };

  const toggleAllVisible = () => {
    setSelectedIds(allVisibleSelected ? [] : visibleIds);
  };

  const runBatchAction = async () => {
    if (selectedVisibleIds.length === 0 || batchBusy) return;
    setBatchBusy(true);
    try {
      if (showTrash) {
        await onBatchHardDelete(selectedVisibleIds);
      } else {
        await onBatchMoveToTrash(selectedVisibleIds);
      }
      setSelectedIds([]);
    } finally {
      setBatchBusy(false);
    }
  };

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
            {locale === "zh" ? "创建画布" : "Create canvas"}
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

        <div className="project-batch-bar" data-active={selectedVisibleIds.length > 0}>
          <span>
            {selectedVisibleIds.length > 0
              ? `${selectedVisibleIds.length} ${locale === "zh" ? "项已选择" : "selected"}`
              : (locale === "zh" ? "选择项目后可批量操作" : "Select projects for batch actions")}
          </span>
          <button className={showTrash ? "button button-danger button-small" : "button button-secondary button-small"} type="button" onClick={runBatchAction} disabled={selectedVisibleIds.length === 0 || batchBusy}>
            {batchBusy
              ? (locale === "zh" ? "处理中" : "Working")
              : showTrash
                ? (locale === "zh" ? "批量永久删除" : "Delete selected")
                : (locale === "zh" ? "批量移入回收站" : "Move selected to trash")}
          </button>
          {selectedVisibleIds.length > 0 ? (
            <button className="button button-secondary button-small" type="button" onClick={() => setSelectedIds([])} disabled={batchBusy}>
              {locale === "zh" ? "清除选择" : "Clear"}
            </button>
          ) : null}
        </div>

        <section className="project-table" aria-label={showTrash ? "Trash" : "Projects"}>
          <div className="project-table-head">
            <label className="project-select-cell">
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} disabled={visibleIds.length === 0} aria-label={locale === "zh" ? "选择全部可见项目" : "Select all visible projects"} />
            </label>
            <span>{locale === "zh" ? "名称" : "Name"}</span>
            <span>Agent</span>
            <span>{locale === "zh" ? "资产" : "Assets"}</span>
            <span>{locale === "zh" ? "更新时间" : "Updated"}</span>
            <span>{locale === "zh" ? "操作" : "Actions"}</span>
          </div>
          {filtered.map((project) => (
            <article className="project-table-row" key={project.id}>
              <label className="project-select-cell">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(project.id)}
                  onChange={() => toggleSelected(project.id)}
                  aria-label={`${locale === "zh" ? "选择" : "Select"} ${project.title || agentTitle(project)}`}
                />
              </label>
              <button type="button" onClick={() => !showTrash && onOpenThread(project)} disabled={showTrash}>
                <strong>{project.title || agentTitle(project)}</strong>
                <small>{agentTitle(project)} / {project.id}</small>
              </button>
              <span>{agentTitle(project)}</span>
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
                    <div className="project-more-wrap">
                      <button
                        className="button button-secondary button-small project-more-button"
                        type="button"
                        onClick={() => setOpenMenuThreadId((current) => current === project.id ? "" : project.id)}
                      >
                        {locale === "zh" ? "更多" : "More"}
                      </button>
                      {openMenuThreadId === project.id ? (
                        <div className="project-more-menu">
                          <button type="button" onClick={() => { setRenameProject(project); setOpenMenuThreadId(""); }}>
                            {locale === "zh" ? "重命名" : "Rename"}
                          </button>
                          <button type="button" onClick={() => { onMoveToTrash(project.id); setOpenMenuThreadId(""); }}>
                            {locale === "zh" ? "移入回收站" : "Trash"}
                          </button>
                        </div>
                      ) : null}
                    </div>
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
      {renameProject ? (
        <RenameProjectDialog
          initialTitle={renameProject.title}
          locale={locale}
          onClose={() => setRenameProject(null)}
          onRename={async (title) => {
            await onRenameThread(renameProject.id, title);
            setRenameProject(null);
          }}
        />
      ) : null}
    </main>
  );
}

export function ManagementSidebar({ activeView, onNavigate }: { activeView: AppView; onNavigate: (view: AppView) => void }) {
  return <AppSidebar activeView={activeView} onNavigate={onNavigate} className="management-sidebar" />;
}

function RenameProjectDialog({
  initialTitle,
  locale,
  onClose,
  onRename
}: {
  initialTitle: string;
  locale: "en" | "zh";
  onClose: () => void;
  onRename: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [isSaving, setIsSaving] = useState(false);
  const cleanTitle = title.trim();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!cleanTitle || isSaving) return;
    setIsSaving(true);
    try {
      await onRename(cleanTitle);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rename-dialog-backdrop" role="presentation">
      <form className="rename-dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-label={locale === "zh" ? "重命名项目" : "Rename project"}>
        <h2>{locale === "zh" ? "重命名项目" : "Rename project"}</h2>
        <label className="field">
          <span>{locale === "zh" ? "项目标题" : "Project title"}</span>
          <input autoFocus maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <div className="rename-dialog-actions">
          <button className="button button-secondary" type="button" onClick={onClose} disabled={isSaving}>
            {locale === "zh" ? "取消" : "Cancel"}
          </button>
          <button className="button button-primary" type="submit" disabled={!cleanTitle || isSaving}>
            {isSaving ? (locale === "zh" ? "保存中" : "Saving") : (locale === "zh" ? "保存" : "Save")}
          </button>
        </div>
      </form>
    </div>
  );
}
