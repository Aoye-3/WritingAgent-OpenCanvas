import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AppView } from "../../app/App";
import { AppSidebar } from "../../shared/AppSidebar";
import { MoreIcon } from "../../shared/icons";
import { Button, EmptyState, ModalDialog, Panel, SelectField, TextField } from "../../shared/ui";
import type { AgentCard, ProjectSummary, StoredThread } from "../agents/types";
import { useI18n } from "../i18n/I18nProvider";

type ProjectsViewProps = {
  activeView: AppView;
  agentCards: AgentCard[];
  projects: ProjectSummary[];
  trashProjects: ProjectSummary[];
  onBatchHardDelete: (threadIds: string[]) => Promise<void>;
  onBatchMoveToTrash: (threadIds: string[]) => Promise<void>;
  onNavigate: (view: AppView) => void;
  onOpenThread: (thread: StoredThread | ProjectSummary) => void;
  onMoveToTrash: (threadId: string) => void;
  onRenameThread: (threadId: string, title: string) => Promise<void>;
  onRestore: (threadId: string) => void;
  onHardDelete: (threadId: string) => void;
  sessionBusy?: boolean;
  sessionError?: string;
};

const projectCopy = {
  en: {
    actions: "Actions",
    agent: "Agent",
    allAgents: "All agents",
    assets: "Assets",
    batchHint: "Select projects for batch actions",
    clear: "Clear",
    create: "Create canvas",
    delete: "Delete",
    deleteSelected: "Delete selected",
    emptyProjects: "No projects yet",
    emptyTrash: "Trash is empty",
    more: "More",
    moveSelected: "Move selected to trash",
    moveToTrash: "Move to trash",
    name: "Name",
    open: "Open",
    rename: "Rename",
    renameProject: "Rename project",
    restore: "Restore",
    save: "Save",
    saving: "Saving",
    search: "Search projects or agents",
    selectAll: "Select all visible projects",
    selected: "selected",
    subtitle: "Manage local threads, canvas assets, and trash.",
    title: "Projects",
    trash: "Trash",
    updated: "Updated",
    viewProjects: "View projects",
    working: "Working"
  },
  zh: {
    actions: "操作",
    agent: "Agent",
    allAgents: "全部 Agent",
    assets: "资产",
    batchHint: "选择项目后可批量操作",
    clear: "清除选择",
    create: "创建画布",
    delete: "永久删除",
    deleteSelected: "批量永久删除",
    emptyProjects: "暂无项目",
    emptyTrash: "回收站为空",
    more: "更多",
    moveSelected: "批量移入回收站",
    moveToTrash: "移入回收站",
    name: "名称",
    open: "打开",
    rename: "重命名",
    renameProject: "重命名项目",
    restore: "恢复",
    save: "保存",
    saving: "保存中",
    search: "搜索项目或 Agent",
    selectAll: "选择全部可见项目",
    selected: "项已选择",
    subtitle: "管理本地线程、画布资产和回收站。",
    title: "项目",
    trash: "回收站",
    updated: "更新时间",
    viewProjects: "查看项目",
    working: "处理中"
  }
} as const;

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
  onHardDelete,
  sessionBusy = false,
  sessionError = ""
}: ProjectsViewProps) {
  const { locale } = useI18n();
  const copy = projectCopy[locale];
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

  const runBatchAction = async () => {
    if (selectedVisibleIds.length === 0 || batchBusy) return;
    setBatchBusy(true);
    try {
      if (showTrash) await onBatchHardDelete(selectedVisibleIds);
      else await onBatchMoveToTrash(selectedVisibleIds);
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
            <h1>{copy.title}</h1>
            <p>{copy.subtitle}</p>
          </div>
          <Button variant="primary" type="button" onClick={() => onNavigate("home")}>{copy.create}</Button>
        </div>
        {sessionError ? <p className="project-open-error" role="alert">{sessionError}</p> : null}

        <div className="management-toolbar">
          <TextField aria-label={copy.search} label={copy.search} value={query} onChange={(event) => setQuery(event.target.value)} />
          <SelectField label={copy.allAgents} value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}>
            <option value="all">{copy.allAgents}</option>
            {agentCards.map((agent) => <option key={agent.id} value={agent.id}>{agent.title[locale]}</option>)}
          </SelectField>
          <Button variant={showTrash ? "primary" : "secondary"} type="button" onClick={() => setShowTrash((value) => !value)}>
            {showTrash ? copy.viewProjects : copy.trash}
          </Button>
        </div>

        <div className="project-batch-bar" data-active={selectedVisibleIds.length > 0}>
          <span>{selectedVisibleIds.length > 0 ? `${selectedVisibleIds.length} ${copy.selected}` : copy.batchHint}</span>
          <Button size="sm" variant={showTrash ? "danger" : "secondary"} type="button" onClick={runBatchAction} disabled={selectedVisibleIds.length === 0} loading={batchBusy}>
            {batchBusy ? copy.working : showTrash ? copy.deleteSelected : copy.moveSelected}
          </Button>
          {selectedVisibleIds.length > 0 ? <Button size="sm" type="button" onClick={() => setSelectedIds([])} disabled={batchBusy}>{copy.clear}</Button> : null}
        </div>

        <Panel className="project-table" aria-label={showTrash ? copy.trash : copy.title}>
          <div className="project-table-head">
            <label className="project-select-cell">
              <input type="checkbox" checked={allVisibleSelected} onChange={() => setSelectedIds(allVisibleSelected ? [] : visibleIds)} disabled={visibleIds.length === 0} aria-label={copy.selectAll} />
            </label>
            <span>{copy.name}</span>
            <span>{copy.agent}</span>
            <span>{copy.assets}</span>
            <span>{copy.updated}</span>
            <span>{copy.actions}</span>
          </div>
          {filtered.map((project) => (
            <article className="project-table-row" key={project.id}>
              <label className="project-select-cell">
                <input type="checkbox" checked={selectedIds.includes(project.id)} onChange={() => toggleSelected(project.id)} aria-label={`${copy.name} ${project.title || agentTitle(project)}`} />
              </label>
              <button type="button" onClick={() => !showTrash && onOpenThread(project)} disabled={showTrash || sessionBusy}>
                <strong>{project.title || agentTitle(project)}</strong>
                <small>{agentTitle(project)} / {project.id}</small>
              </button>
              <span>{agentTitle(project)}</span>
              <span>{project.assetCount ?? 0}</span>
              <time>{new Date(project.updatedAt).toLocaleString()}</time>
              <div className="project-row-actions">
                {showTrash ? (
                  <>
                    <Button size="sm" type="button" onClick={() => onRestore(project.id)}>{copy.restore}</Button>
                    <Button size="sm" variant="danger" type="button" onClick={() => onHardDelete(project.id)}>{copy.delete}</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" type="button" disabled={sessionBusy} loading={sessionBusy} onClick={() => onOpenThread(project)}>{sessionBusy ? copy.working : copy.open}</Button>
                    <div className="project-more-wrap">
                      <Button size="sm" className="project-more-button" type="button" onClick={() => setOpenMenuThreadId((current) => current === project.id ? "" : project.id)}>
                        <MoreIcon aria-hidden="true" size={18} />
                        {copy.more}
                      </Button>
                      {openMenuThreadId === project.id ? (
                        <div className="project-more-menu">
                          <button type="button" onClick={() => { setRenameProject(project); setOpenMenuThreadId(""); }}>{copy.rename}</button>
                          <button type="button" onClick={() => { onMoveToTrash(project.id); setOpenMenuThreadId(""); }}>{copy.moveToTrash}</button>
                        </div>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            </article>
          ))}
          {filtered.length === 0 ? <EmptyState className="empty-management-state" title={showTrash ? copy.emptyTrash : copy.emptyProjects} /> : null}
        </Panel>
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

function RenameProjectDialog({ initialTitle, locale, onClose, onRename }: { initialTitle: string; locale: "en" | "zh"; onClose: () => void; onRename: (title: string) => Promise<void> }) {
  const copy = projectCopy[locale];
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
    <ModalDialog className="rename-dialog" labelledBy="rename-project-title">
      <form onSubmit={submit}>
        <h2 id="rename-project-title">{copy.renameProject}</h2>
        <TextField autoFocus maxLength={120} label={copy.renameProject} value={title} onChange={(event) => setTitle(event.target.value)} />
        <div className="rename-dialog-actions">
          <Button type="button" onClick={onClose} disabled={isSaving}>{locale === "zh" ? "取消" : "Cancel"}</Button>
          <Button variant="primary" type="submit" disabled={!cleanTitle} loading={isSaving}>{isSaving ? copy.saving : copy.save}</Button>
        </div>
      </form>
    </ModalDialog>
  );
}
