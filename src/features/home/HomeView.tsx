import { FormEvent, useMemo, useState } from "react";
import type { AppView } from "../../app/App";
import { AppSidebar } from "../../shared/AppSidebar";
import { AddIcon, ArrowRightIcon, DocumentIcon, MoreIcon, SearchIcon, SendIcon, TaskIcon } from "../../shared/icons";
import { Button, IconButton, ModalDialog, Panel, TextField } from "../../shared/ui";
import type { AgentCard, StoredThread } from "../agents/types";
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
  onTogglePinnedThread: (threadId: string) => void;
  pinnedThreadIds: string[];
  onRenameThread: (threadId: string, title: string) => Promise<void>;
};

const homeCopy = {
  en: {
    addInput: "Add input",
    agentHint: "Your most useful agents live here. Open one to turn its output into editable canvas nodes.",
    agents: "Recent agents",
    cancel: "Cancel",
    create: "Create board",
    createAgent: "Create agent",
    createAgentHint: "Start from an AgentCard",
    createHint: "Open the AI canvas workspace",
    knowledge: "Knowledge",
    moveToTrash: "Move to trash",
    pin: "Pin",
    projectActions: "Project actions",
    projectTitle: "Project title",
    projects: "Recent projects",
    promptLabel: "Home prompt input",
    promptPlaceholder: "Ask OpenCanvas to draft, rewrite, plan, or organize a canvas node...",
    rename: "Rename",
    renameProject: "Rename project",
    rewrite: "Rewrite draft",
    rewriteHint: "Polish existing text",
    save: "Save",
    saving: "Saving",
    send: "Send",
    tip: "OpenCanvas tip:",
    tipText: "Start with an AgentCard, then save useful AI output as editable canvas nodes.",
    title: "Welcome back. What should we shape on the canvas today?",
    unpin: "Unpin",
    viewAll: "View all"
  },
  zh: {
    addInput: "添加输入",
    agentHint: "常用 Agent 会显示在这里，打开后可把 AI 输出沉淀为可编辑的画板节点。",
    agents: "近期 Agent",
    cancel: "取消",
    create: "创建画板",
    createAgent: "创建 Agent",
    createAgentHint: "从任务卡开始配置能力",
    createHint: "打开 AI 画板工作台",
    knowledge: "知识库",
    moveToTrash: "移入回收站",
    pin: "置顶",
    projectActions: "项目操作",
    projectTitle: "项目标题",
    projects: "近期项目",
    promptLabel: "首页提示词输入",
    promptPlaceholder: "让 OpenCanvas 起草、改写、规划或整理一个画板节点...",
    rename: "重命名",
    renameProject: "重命名项目",
    rewrite: "改写草稿",
    rewriteHint: "润色已有内容",
    save: "保存",
    saving: "保存中",
    send: "发送",
    tip: "OpenCanvas 小技巧：",
    tipText: "从 AgentCard 开始，把 AI 输出沉淀为可编辑的画板节点。",
    title: "欢迎回来。今天要在画板上塑造什么？",
    unpin: "取消置顶",
    viewAll: "查看全部"
  }
} as const;

export function HomeView({
  activeView,
  agentCards,
  recentThreads,
  onOpenSettings,
  onOpenAgent,
  onOpenThread,
  onNavigate,
  onDeleteThread,
  onTogglePinnedThread,
  pinnedThreadIds,
  onRenameThread
}: HomeViewProps) {
  const { locale } = useI18n();
  const copy = homeCopy[locale];
  const [homePrompt, setHomePrompt] = useState("");
  const [openMenuThreadId, setOpenMenuThreadId] = useState("");
  const [renameThread, setRenameThread] = useState<StoredThread | null>(null);

  const featuredAgents = useMemo(() => {
    const preferred = ["blog-post", "rewrite-polish", "email-writer", "lesson-plan"];
    return preferred.map((id) => agentCards.find((agentCard) => agentCard.id === id)).filter((agentCard): agentCard is AgentCard => Boolean(agentCard));
  }, [agentCards]);
  const primaryAgent = agentCards[0];

  const quickActions = [
    { label: copy.create, hint: copy.createHint, agent: agentCards.find((agent) => agent.id === "blog-post") },
    { label: copy.createAgent, hint: copy.createAgentHint, agent: agentCards.find((agent) => agent.id === "report-outline") },
    { label: copy.rewrite, hint: copy.rewriteHint, agent: agentCards.find((agent) => agent.id === "rewrite-polish") }
  ];

  const submitPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (primaryAgent) onOpenAgent(primaryAgent);
  };

  return (
    <main className="view view-home home-app" id="home-view" data-active={activeView === "home"}>
      <AppSidebar activeView={activeView} onNavigate={onNavigate} onOpenSettings={onOpenSettings} />
      <section className="home-main-panel">
        <div className="home-tip-bar">
          <strong>{copy.tip}</strong>
          <span>{copy.tipText}</span>
          <Button data-testid="home-create-board" size="sm" type="button" onClick={() => primaryAgent && onOpenAgent(primaryAgent)}>{copy.create}</Button>
        </div>

        <Panel className="home-workspace-card">
          <section className="home-command-center" aria-labelledby="home-title">
            <h1 id="home-title">{copy.title}</h1>
            <form className="home-prompt-box" onSubmit={submitPrompt}>
              <textarea aria-label={copy.promptLabel} placeholder={copy.promptPlaceholder} value={homePrompt} onChange={(event) => setHomePrompt(event.target.value)} />
              <div className="home-prompt-actions">
                <IconButton className="prompt-tool" type="button" aria-label={copy.addInput}><AddIcon aria-hidden="true" /></IconButton>
                <button className="home-agent-chip" type="button"><SearchIcon aria-hidden="true" /><span>{copy.knowledge}</span><small>1/3</small></button>
                <button className="home-send-button" type="submit" aria-label={copy.send}><SendIcon aria-hidden="true" /></button>
              </div>
            </form>
            <div className="home-quick-actions">
              {quickActions.map((action) => (
                <button className="home-quick-action" data-testid="home-quick-action" key={action.label} type="button" onClick={() => action.agent && onOpenAgent(action.agent)}>
                  <span>{action.label}</span>
                  <small>{action.hint}</small>
                  <b><ArrowRightIcon aria-hidden="true" size={18} /></b>
                </button>
              ))}
            </div>
          </section>

          <section className="home-section home-projects" aria-label={copy.projects}>
            <div className="home-section-header">
              <h2>{copy.projects}</h2>
              <button type="button" onClick={() => onNavigate("projects")}>{copy.viewAll}</button>
            </div>
            <div className="home-project-list">
              {(recentThreads.length > 0 ? recentThreads.slice(0, 6) : fallbackProjects(locale)).map((item) => renderProjectRow(item, { agentCards, copy, locale, onDeleteThread, onOpenThread, onRename: setRenameThread, onTogglePinnedThread, openMenuThreadId, pinnedThreadIds, setOpenMenuThreadId }))}
            </div>
          </section>

          <section className="home-section home-agents" aria-label={copy.agents}>
            <div className="home-section-header">
              <div>
                <h2>{copy.agents}</h2>
                <p>{copy.agentHint}</p>
              </div>
              <button type="button" onClick={() => onNavigate("agentSettings")}>{copy.viewAll}</button>
            </div>
            <div className="home-agent-card-row">
              {featuredAgents.map((agentCard) => (
                <button className="home-agent-card" key={agentCard.id} type="button" onClick={() => onOpenAgent(agentCard)}>
                  <span className={`task-icon accent-${agentCard.accent}`} aria-hidden="true"><TaskIcon icon={agentCard.icon} /></span>
                  <strong>{agentCard.title[locale]}</strong>
                  <p>{agentCard.description[locale]}</p>
                  <small>{agentCard.outputContract.type}</small>
                </button>
              ))}
            </div>
          </section>
        </Panel>
      </section>

      {renameThread ? (
        <RenameThreadDialog
          initialTitle={renameThread.title}
          locale={locale}
          onClose={() => setRenameThread(null)}
          onRename={async (title) => {
            await onRenameThread(renameThread.id, title);
            setRenameThread(null);
          }}
        />
      ) : null}
    </main>
  );
}

function renderProjectRow(
  item: StoredThread | ReturnType<typeof fallbackProjects>[number],
  context: {
    agentCards: AgentCard[];
    copy: (typeof homeCopy)["en" | "zh"];
    locale: "en" | "zh";
    onDeleteThread: (thread: StoredThread) => void;
    onOpenThread: (thread: StoredThread) => void;
    onRename: (thread: StoredThread) => void;
    onTogglePinnedThread: (threadId: string) => void;
    openMenuThreadId: string;
    pinnedThreadIds: string[];
    setOpenMenuThreadId: (value: string | ((current: string) => string)) => void;
  }
) {
  const { agentCards, copy, locale, onDeleteThread, onOpenThread, onRename, onTogglePinnedThread, openMenuThreadId, pinnedThreadIds, setOpenMenuThreadId } = context;
  const isThread = "id" in item;
  const thread = isThread ? item : undefined;
  const agentTitle = isThread ? agentCards.find((agent) => agent.id === item.agentCardId)?.title[locale] ?? item.agentCardId : item.title;
  const projectTitle = isThread ? item.title || agentTitle : item.title;
  const updatedAt = isThread ? new Date(item.updatedAt).toLocaleString() : item.updatedAt;
  const assets = isThread ? (locale === "zh" ? "1 个节点" : "1 node") : item.assets;

  return (
    <article className="home-project-row" key={isThread ? item.id : item.title}>
      <button className="home-project-open" type="button" onClick={() => thread && onOpenThread(thread)}>
        <DocumentIcon aria-hidden="true" />
        <span>{projectTitle}</span>
      </button>
      {isThread ? <small className="home-project-agent">{agentTitle}</small> : null}
      <small>{assets}</small>
      <time>{updatedAt}</time>
      {thread ? (
        <div className="project-more-wrap">
          <IconButton className="project-more-button" type="button" aria-label={copy.projectActions} onClick={() => setOpenMenuThreadId((current) => current === thread.id ? "" : thread.id)}>
            <MoreIcon aria-hidden="true" />
          </IconButton>
          {openMenuThreadId === thread.id ? (
            <div className="project-more-menu">
              <button type="button" onClick={() => { onTogglePinnedThread(thread.id); setOpenMenuThreadId(""); }}>{pinnedThreadIds.includes(thread.id) ? copy.unpin : copy.pin}</button>
              <button type="button" onClick={() => { onRename(thread); setOpenMenuThreadId(""); }}>{copy.rename}</button>
              <button type="button" onClick={() => { onDeleteThread(thread); setOpenMenuThreadId(""); }}>{copy.moveToTrash}</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
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
          <Button type="button" onClick={onClose} disabled={isSaving}>{copy.cancel}</Button>
          <Button variant="primary" type="submit" disabled={!cleanTitle} loading={isSaving}>{isSaving ? copy.saving : copy.save}</Button>
        </div>
      </form>
    </ModalDialog>
  );
}

function fallbackProjects(locale: "en" | "zh") {
  return [
    { title: locale === "zh" ? "课程说明画板" : "Course explainer board", assets: locale === "zh" ? "7 个节点" : "7 nodes", updatedAt: locale === "zh" ? "现在" : "now" },
    { title: locale === "zh" ? "高端客厅文章" : "Premium living room article", assets: locale === "zh" ? "15 个节点" : "15 nodes", updatedAt: locale === "zh" ? "7 小时前" : "7 hours ago" },
    { title: locale === "zh" ? "邮件改写任务" : "Email rewrite task", assets: locale === "zh" ? "2 个节点" : "2 nodes", updatedAt: locale === "zh" ? "1 天前" : "1 day ago" }
  ];
}
