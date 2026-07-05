import { FormEvent, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Button as RadixButton, SegmentedControl, Select, TextField as RadixTextField, Theme } from "@radix-ui/themes";
import type { AppView } from "../../app/App";
import { AppSidebar } from "../../shared/AppSidebar";
import { AddIcon, DocumentIcon, HomeSparkleIcon, MoreIcon, SearchIcon, StarIcon } from "../../shared/icons";
import { Button as LocalButton, IconButton, ModalDialog, TextField } from "../../shared/ui";
import type { AgentCard, ProjectSummary, SkillCatalogItem, SkillFolderItem } from "../agents/types";
import type { GenerateRequest } from "../generation/types";
import { useI18n } from "../i18n/I18nProvider";
import type { ConfiguredModelApiSummary } from "../settings/types";
import { AIComposer, type AIComposerSubmitPayload, type ConversationModelControls } from "../workspace/components/AIComposer";

type HomeTab = "recent" | "pinned" | "all";
type HomeViewMode = "grid" | "list";
type HomeTypeFilter = "all" | "with-assets" | "empty";
type HomeSortMode = "last-viewed" | "name";

type HomeViewProps = {
  activeAgent: AgentCard;
  activeView: AppView;
  agentCards: AgentCard[];
  configuredModels: ConfiguredModelApiSummary[];
  disabledSkillRefs: string[];
  enabledSkillRefs: string[];
  isCreatingFromPrompt?: boolean;
  modelSelectionDisabled?: boolean;
  modelSettings?: ConversationModelControls;
  projects: ProjectSummary[];
  runtimeBudgetProfile?: GenerateRequest["runtimeBudgetProfile"];
  selectedModelConfigId?: string | null;
  skillCatalog: SkillCatalogItem[];
  skillCatalogStatus: "idle" | "loading" | "ready" | "error";
  skillFolders: SkillFolderItem[];
  toolState: GenerateRequest["toolState"];
  onCreateBoardFromPrompt: (payload: AIComposerSubmitPayload) => Promise<unknown>;
  onDeleteThread: (projectId: string) => void;
  onNavigate: (view: AppView) => void;
  onOpenAgent: (agentCard: AgentCard) => void;
  onOpenSettings: () => void;
  onOpenThread: (project: ProjectSummary) => void;
  onRenameThread: (threadId: string, title: string) => Promise<void>;
  onRequestSkillCatalog: () => void;
  onSelectAgent: (agentCardId: string) => void;
  onSelectModel: (configuredModelApiId: string) => Promise<void> | void;
  onTogglePinnedThread: (threadId: string) => void;
  onToggleSkill: (skill: SkillCatalogItem, enabled: boolean) => void;
  onToolStateChange: (toolState: GenerateRequest["toolState"]) => void;
  pinnedThreadIds: string[];
};

const homeCopy = {
  en: {
    all: "All projects",
    allAgents: "All agents",
    allFiles: "All files",
    cancel: "Cancel",
    create: "Create board",
    empty: "No matching projects",
    emptyHint: "Create a board or clear the current filters.",
    grid: "Grid",
    list: "List",
    moveToTrash: "Move to trash",
    name: "Name",
    pinned: "Pinned",
    pin: "Pin",
    projectActions: "Project actions",
    projectTitle: "Project title",
    promptPlaceholder: "Ask OpenCanvas to draft, rewrite, plan, or organize a canvas node...",
    recent: "Recently viewed",
    rename: "Rename",
    renameProject: "Rename project",
    save: "Save",
    saving: "Saving",
    search: "Search projects",
    sortLastViewed: "Last viewed",
    sortName: "Name",
    title: "Describe your idea and make it come to life",
    unpin: "Unpin",
    viewAll: "View all",
    withAssets: "With assets",
    withoutAssets: "No assets"
  },
  zh: {
    all: "全部项目",
    allAgents: "全部 Agent",
    allFiles: "全部文件",
    cancel: "取消",
    create: "创建画板",
    empty: "没有匹配项目",
    emptyHint: "创建一个画板，或清除当前筛选。",
    grid: "网格",
    list: "列表",
    moveToTrash: "移入回收站",
    name: "名称",
    pinned: "已置顶",
    pin: "置顶",
    projectActions: "项目操作",
    projectTitle: "项目标题",
    promptPlaceholder: "让 OpenCanvas 起草、改写、规划或整理一个画板节点...",
    recent: "最近查看",
    rename: "重命名",
    renameProject: "重命名项目",
    save: "保存",
    saving: "保存中",
    search: "搜索项目",
    sortLastViewed: "最近更新",
    sortName: "名称",
    title: "描述你的想法，让它在画板中成形",
    unpin: "取消置顶",
    viewAll: "查看全部",
    withAssets: "有资产",
    withoutAssets: "无资产"
  }
} as const;

export function HomeView({
  activeAgent,
  activeView,
  agentCards,
  configuredModels,
  disabledSkillRefs,
  enabledSkillRefs,
  isCreatingFromPrompt = false,
  modelSelectionDisabled = false,
  modelSettings,
  projects,
  runtimeBudgetProfile,
  selectedModelConfigId,
  skillCatalog,
  skillCatalogStatus,
  skillFolders,
  toolState,
  onCreateBoardFromPrompt,
  onDeleteThread,
  onNavigate,
  onOpenAgent,
  onOpenSettings,
  onOpenThread,
  onRenameThread,
  onRequestSkillCatalog,
  onSelectAgent,
  onSelectModel,
  onTogglePinnedThread,
  onToggleSkill,
  onToolStateChange,
  pinnedThreadIds
}: HomeViewProps) {
  const { locale } = useI18n();
  const copy = homeCopy[locale];
  const [homePrompt, setHomePrompt] = useState("");
  const [activeTab, setActiveTab] = useState<HomeTab>("recent");
  const [agentFilter, setAgentFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<HomeTypeFilter>("all");
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<HomeSortMode>("last-viewed");
  const [viewMode, setViewMode] = useState<HomeViewMode>("grid");
  const [openMenuThreadId, setOpenMenuThreadId] = useState("");
  const [renameProject, setRenameProject] = useState<ProjectSummary | null>(null);
  const [thumbnailRetryToken, setThumbnailRetryToken] = useState(0);

  useEffect(() => {
    if (activeView === "home") {
      setThumbnailRetryToken((token) => token + 1);
    }
  }, [activeView]);

  const filteredProjects = useMemo(() => {
    const term = query.trim().toLowerCase();
    const rank = new Map(pinnedThreadIds.map((id, index) => [id, index]));
    const source = projects.filter((project) => {
      const pinned = pinnedThreadIds.includes(project.id);
      if (activeTab === "pinned" && !pinned) return false;
      if (agentFilter !== "all" && project.agentCardId !== agentFilter) return false;
      if (typeFilter === "with-assets" && (project.assetCount ?? 0) <= 0) return false;
      if (typeFilter === "empty" && (project.assetCount ?? 0) > 0) return false;
      if (!term) return true;
      return `${project.title} ${project.summary} ${project.agentTitle ?? ""} ${project.agentCardId ?? ""}`.toLowerCase().includes(term);
    });
    return source.sort((left, right) => {
      const leftRank = rank.get(left.id);
      const rightRank = rank.get(right.id);
      if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
      if (leftRank !== undefined) return -1;
      if (rightRank !== undefined) return 1;
      if (sortMode === "name") return projectTitle(left, locale).localeCompare(projectTitle(right, locale));
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }, [activeTab, agentFilter, locale, pinnedThreadIds, projects, query, sortMode, typeFilter]);

  const openProjectMenu = (projectId: string) => {
    setOpenMenuThreadId((current) => current === projectId ? "" : projectId);
  };

  return (
    <Theme asChild accentColor="blue" grayColor="slate" radius="large" scaling="100%">
    <main className="view view-home home-app" id="home-view" data-active={activeView === "home"}>
      <AppSidebar activeView={activeView} onNavigate={onNavigate} onOpenSettings={onOpenSettings} />
      <section className="home-main-panel">
        <div className="home-recents-shell">
          <section className="home-ai-region" aria-labelledby="home-title">
            <div className="home-ai-heading">
              <div className="home-title-row">
                <HomeSparkleIcon className="home-title-sparkle" size={34} />
                <h1 id="home-title">{copy.title}</h1>
              </div>
              <RadixButton
                className="home-create-board-button"
                data-testid="home-create-board"
                radius="full"
                size="3"
                type="button"
                variant="surface"
                onClick={() => onOpenAgent(activeAgent)}
              >
                <AddIcon aria-hidden="true" size={16} />
                <span>{copy.create}</span>
              </RadixButton>
            </div>
            <AIComposer
              activeAgent={activeAgent}
              agentCards={agentCards}
              allowedTools={activeAgent.toolRefs}
              className="home-ai-composer"
              configuredModels={configuredModels}
              disabled={isCreatingFromPrompt}
              disabledSkillRefs={disabledSkillRefs}
              enabledSkillRefs={enabledSkillRefs}
              hideResizeHandle
              isSending={isCreatingFromPrompt}
              modelSelectionDisabled={modelSelectionDisabled}
              modelSettings={modelSettings}
              placeholder={copy.promptPlaceholder}
              runtimeBudgetProfile={runtimeBudgetProfile}
              selectedModelConfigId={selectedModelConfigId}
              skillCatalog={skillCatalog}
              skillCatalogStatus={skillCatalogStatus}
              skillFolders={skillFolders}
              submitEmpty
              toolState={toolState}
              value={homePrompt}
              onRequestSkillCatalog={onRequestSkillCatalog}
              onSelectAgent={onSelectAgent}
              onSelectModel={onSelectModel}
              onSubmit={async (payload) => {
                setHomePrompt("");
                await onCreateBoardFromPrompt(payload);
              }}
              onToggleSkill={onToggleSkill}
              onToolStateChange={onToolStateChange}
              onValueChange={setHomePrompt}
            />
            <span className="home-plant-layer" aria-hidden="true" />
          </section>

          <section className="home-recents-section" aria-label={copy.recent}>
            <SegmentedControl.Root className="home-recents-tabs" radius="full" value={activeTab} onValueChange={(value) => setActiveTab(value as HomeTab)}>
              {(["recent", "pinned", "all"] as HomeTab[]).map((tab) => (
                <SegmentedControl.Item key={tab} value={tab}>
                  {tab === "recent" ? copy.recent : tab === "pinned" ? copy.pinned : copy.all}
                </SegmentedControl.Item>
              ))}
            </SegmentedControl.Root>

            <div className="home-recents-toolbar">
              <RadixTextField.Root
                aria-label={copy.search}
                className="home-search-control"
                placeholder={copy.search}
                radius="large"
                size="3"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              >
                <RadixTextField.Slot>
                  <SearchIcon aria-hidden="true" size={16} />
                </RadixTextField.Slot>
              </RadixTextField.Root>
              <Select.Root value={agentFilter} onValueChange={setAgentFilter}>
                <Select.Trigger aria-label={copy.allAgents} className="home-toolbar-select" radius="large" variant="surface" />
                <Select.Content>
                  <Select.Item value="all">{copy.allAgents}</Select.Item>
                  {agentCards.map((agent) => <Select.Item key={agent.id} value={agent.id}>{agent.title[locale]}</Select.Item>)}
                </Select.Content>
              </Select.Root>
              <Select.Root value={typeFilter} onValueChange={(value) => setTypeFilter(value as HomeTypeFilter)}>
                <Select.Trigger aria-label={copy.allFiles} className="home-toolbar-select" radius="large" variant="surface" />
                <Select.Content>
                  <Select.Item value="all">{copy.allFiles}</Select.Item>
                  <Select.Item value="with-assets">{copy.withAssets}</Select.Item>
                  <Select.Item value="empty">{copy.withoutAssets}</Select.Item>
                </Select.Content>
              </Select.Root>
              <Select.Root value={sortMode} onValueChange={(value) => setSortMode(value as HomeSortMode)}>
                <Select.Trigger aria-label={copy.sortLastViewed} className="home-toolbar-select" radius="large" variant="surface" />
                <Select.Content>
                  <Select.Item value="last-viewed">{copy.sortLastViewed}</Select.Item>
                  <Select.Item value="name">{copy.sortName}</Select.Item>
                </Select.Content>
              </Select.Root>
              <SegmentedControl.Root className="home-view-toggle" radius="large" value={viewMode} onValueChange={(value) => setViewMode(value as HomeViewMode)}>
                <SegmentedControl.Item value="grid">{copy.grid}</SegmentedControl.Item>
                <SegmentedControl.Item value="list">{copy.list}</SegmentedControl.Item>
              </SegmentedControl.Root>
              <RadixButton className="home-view-all" radius="full" type="button" variant="ghost" onClick={() => onNavigate("projects")}>{copy.viewAll}</RadixButton>
            </div>

            {filteredProjects.length ? (
              <div className={viewMode === "grid" ? "home-project-grid" : "home-project-table"} data-view-mode={viewMode}>
                {viewMode === "list" ? (
                  <div className="home-project-table-head">
                    <span>{copy.name}</span>
                    <span>Agent</span>
                    <span>{copy.allFiles}</span>
                    <span>{copy.sortLastViewed}</span>
                    <span>{copy.projectActions}</span>
                  </div>
                ) : null}
                {filteredProjects.map((project) => (
                  <HomeProjectItem
                    agentTitle={agentTitle(project, agentCards, locale)}
                    copy={copy}
                    key={project.id}
                    locale={locale}
                    openMenuThreadId={openMenuThreadId}
                    pinned={pinnedThreadIds.includes(project.id)}
                    project={project}
                    thumbnailRetryToken={thumbnailRetryToken}
                    viewMode={viewMode}
                    onDeleteThread={onDeleteThread}
                    onOpenMenu={openProjectMenu}
                    onOpenThread={onOpenThread}
                    onRename={setRenameProject}
                    onTogglePinnedThread={onTogglePinnedThread}
                  />
                ))}
              </div>
            ) : (
              <div className="home-project-empty" role="status">
                <strong>{copy.empty}</strong>
                <p>{copy.emptyHint}</p>
              </div>
            )}
          </section>
        </div>
      </section>

      {renameProject ? (
        <RenameThreadDialog
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
    </Theme>
  );
}

function HomeProjectItem({
  agentTitle,
  copy,
  locale,
  openMenuThreadId,
  pinned,
  project,
  thumbnailRetryToken,
  viewMode,
  onDeleteThread,
  onOpenMenu,
  onOpenThread,
  onRename,
  onTogglePinnedThread
}: {
  agentTitle: string;
  copy: (typeof homeCopy)["en" | "zh"];
  locale: "en" | "zh";
  openMenuThreadId: string;
  pinned: boolean;
  project: ProjectSummary;
  thumbnailRetryToken: number;
  viewMode: HomeViewMode;
  onDeleteThread: (projectId: string) => void;
  onOpenMenu: (projectId: string) => void;
  onOpenThread: (project: ProjectSummary) => void;
  onRename: (project: ProjectSummary) => void;
  onTogglePinnedThread: (threadId: string) => void;
}) {
  const title = projectTitle(project, locale);
  return (
    <article className={viewMode === "grid" ? "home-project-card" : "home-project-row"} data-pinned={pinned}>
      <button className="home-project-open" type="button" onClick={() => onOpenThread(project)}>
        <ProjectCanvasPreviewThumb pinned={pinned} project={project} retryToken={thumbnailRetryToken} />
        <span className="home-project-title-block">
          <strong>{title}</strong>
          <small>{agentTitle}</small>
        </span>
      </button>
      <span className="home-project-assets">{formatProjectAssets(project.assetCount, locale)}</span>
      <time>{new Date(project.updatedAt).toLocaleString()}</time>
      <div className="project-more-wrap">
        <IconButton className="project-more-button" type="button" aria-label={copy.projectActions} onClick={() => onOpenMenu(project.id)}>
          <MoreIcon aria-hidden="true" />
        </IconButton>
        {openMenuThreadId === project.id ? (
          <div className="project-more-menu">
            <button type="button" onClick={() => { onTogglePinnedThread(project.id); onOpenMenu(""); }}>{pinned ? copy.unpin : copy.pin}</button>
            <button type="button" onClick={() => { onRename(project); onOpenMenu(""); }}>{copy.rename}</button>
            <button type="button" onClick={() => { onDeleteThread(project.id); onOpenMenu(""); }}>{copy.moveToTrash}</button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

type PreviewItem = {
  id: string;
  kind: string;
  title?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

function ProjectCanvasPreviewThumb({ pinned, project, retryToken }: { pinned: boolean; project: ProjectSummary; retryToken: number }) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const thumbnailUrl = projectThumbnailUrl(project, retryToken);
  useEffect(() => {
    setThumbnailFailed(false);
  }, [thumbnailUrl]);
  const shouldTryThumbnail = !thumbnailFailed && (project.assetCount > 0 || Boolean(project.canvasPreview));
  if (shouldTryThumbnail) {
    return (
      <span className="home-project-thumb is-cached-thumbnail">
        <img
          alt=""
          loading="lazy"
          src={thumbnailUrl}
          onError={() => setThumbnailFailed(true)}
        />
        <DocumentIcon aria-hidden="true" size={18} />
        {pinned ? <StarIcon aria-hidden="true" size={14} /> : null}
      </span>
    );
  }

  const items = getPreviewItems(project);
  if (!items.length) {
    return (
      <span className="home-project-thumb">
        <span className="home-project-preview-grid" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
        <DocumentIcon aria-hidden="true" size={18} />
        {pinned ? <StarIcon aria-hidden="true" size={14} /> : null}
      </span>
    );
  }

  const bounds = previewBounds(items);
  return (
    <span className="home-project-thumb is-canvas-preview" data-testid="project-canvas-preview">
      <span className="home-project-preview-stage" aria-hidden="true">
        {items.map((item) => (
          <span
            className={`home-project-preview-item is-${previewKindClass(item.kind)}`}
            key={item.id}
            style={previewItemStyle(item, bounds)}
            title={item.title}
          >
            {item.title ? <b /> : null}
          </span>
        ))}
      </span>
      <DocumentIcon aria-hidden="true" size={18} />
      {pinned ? <StarIcon aria-hidden="true" size={14} /> : null}
    </span>
  );
}

function projectThumbnailUrl(project: ProjectSummary, retryToken: number) {
  return `/api/projects/${encodeURIComponent(project.id)}/thumbnail?v=${encodeURIComponent(project.updatedAt)}&r=${retryToken}`;
}

function projectTitle(project: ProjectSummary, locale: "en" | "zh") {
  return project.title || project.agentTitle || (locale === "zh" ? "未命名项目" : "Untitled project");
}

function getPreviewItems(project: ProjectSummary): PreviewItem[] {
  const preview = project.canvasPreview;
  if (!preview) return [];
  return [
    ...preview.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      title: node.title,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height
    })),
    ...preview.objects.flatMap((object) => {
      const box = readPreviewBox(object.geometry);
      return box ? [{ id: object.id, kind: `object-${object.kind}`, ...box }] : [];
    })
  ].slice(0, 16);
}

function previewBounds(items: PreviewItem[]) {
  const minX = Math.min(...items.map((item) => item.x));
  const minY = Math.min(...items.map((item) => item.y));
  const maxX = Math.max(...items.map((item) => item.x + item.width));
  const maxY = Math.max(...items.map((item) => item.y + item.height));
  return {
    minX,
    minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function previewItemStyle(item: PreviewItem, bounds: ReturnType<typeof previewBounds>): CSSProperties {
  const scale = Math.min(84 / bounds.width, 74 / bounds.height);
  return {
    left: `${8 + (item.x - bounds.minX) * scale}%`,
    top: `${10 + (item.y - bounds.minY) * scale}%`,
    width: `${Math.max(5, item.width * scale)}%`,
    height: `${Math.max(5, item.height * scale)}%`
  };
}

function readPreviewBox(value: unknown): Pick<PreviewItem, "x" | "y" | "width" | "height"> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const x = readFinite(record.x);
  const y = readFinite(record.y);
  const width = readFinite(record.width);
  const height = readFinite(record.height);
  if (x !== undefined && y !== undefined && width !== undefined && height !== undefined) {
    return { x, y, width, height };
  }
  const startX = readFinite(record.startX);
  const startY = readFinite(record.startY);
  const endX = readFinite(record.endX);
  const endY = readFinite(record.endY);
  if (startX === undefined || startY === undefined || endX === undefined || endY === undefined) return undefined;
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.max(8, Math.abs(endX - startX)),
    height: Math.max(8, Math.abs(endY - startY))
  };
}

function readFinite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function previewKindClass(kind: string) {
  return kind.replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
}

function agentTitle(project: ProjectSummary, agentCards: AgentCard[], locale: "en" | "zh") {
  return agentCards.find((agent) => agent.id === project.agentCardId)?.title[locale]
    ?? project.agentTitle
    ?? (locale === "zh" ? "项目会话" : "Project conversation");
}

function formatProjectAssets(count: number, locale: "en" | "zh") {
  if (locale === "zh") return `${count} 个资产`;
  return `${count} ${count === 1 ? "asset" : "assets"}`;
}

function RenameThreadDialog({ initialTitle, locale, onClose, onRename }: { initialTitle: string; locale: "en" | "zh"; onClose: () => void; onRename: (title: string) => Promise<void> }) {
  const copy = homeCopy[locale];
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
    <ModalDialog className="rename-dialog" labelledBy="rename-thread-title">
      <form onSubmit={submit}>
        <h2 id="rename-thread-title">{copy.renameProject}</h2>
        <TextField autoFocus maxLength={120} label={copy.projectTitle} value={title} onChange={(event) => setTitle(event.target.value)} />
        <div className="rename-dialog-actions">
          <LocalButton type="button" onClick={onClose} disabled={isSaving}>{copy.cancel}</LocalButton>
          <LocalButton variant="primary" type="submit" disabled={!cleanTitle} loading={isSaving}>{isSaving ? copy.saving : copy.save}</LocalButton>
        </div>
      </form>
    </ModalDialog>
  );
}
