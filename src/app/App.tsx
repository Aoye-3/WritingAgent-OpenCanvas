import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchThreadState, renameThread, saveThreadInputs } from "../features/agents/agentClient";
import { AgentSettingsView } from "../features/agents/AgentSettingsView";
import { useAgentCards } from "../features/agents/hooks/useAgentCards";
import type { AgentCard, AgentValues, StoredThread, ThreadStateResponse } from "../features/agents/types";
import { AiDashboardView } from "../features/ai-dashboard/AiDashboardView";
import { useAppNavigation } from "../features/app/useAppNavigation";
import type { GenerateRequest } from "../features/generation/types";
import { I18nProvider, useI18n } from "../features/i18n/I18nProvider";
import { ProjectSettingsPanel } from "../features/settings/ProjectSettingsPanel";
import { StartView } from "../features/start/StartView";
import { HomeView } from "../features/home/HomeView";
import { KnowledgeSettingsView } from "../features/knowledge/KnowledgeSettingsView";
import { ModelConfigView } from "../features/model-config/ModelConfigView";
import { ProjectsView } from "../features/projects/ProjectsView";
import { useProjects } from "../features/projects/hooks/useProjects";
import { WorkspaceView } from "../features/workspace/WorkspaceView";
import { useCanvasState } from "./hooks/useCanvasState";
import { useGenerationRun } from "./hooks/useGenerationRun";
import { useProjectTrash } from "./hooks/useProjectTrash";
import { useThreadSession } from "./hooks/useThreadSession";

export type AppView = "start" | "home" | "workspace" | "projects" | "agentSettings" | "modelConfig" | "aiDashboard" | "knowledgeSettings";

const fallbackAgentCards: AgentCard[] = [
  {
    id: "blog-post",
    category: "writing",
    accent: "blue",
    icon: "pen",
    title: { en: "Blog Post", zh: "博客文章" },
    description: {
      en: "Draft a structured article from topic, audience, tone, and references.",
      zh: "根据主题、受众、语气和参考资料生成结构化文章。"
    },
    identityPrompt: "You are a writing agent.",
    skillRefs: ["blog-post"],
    toolRefs: ["web_search", "knowledge_base", "quick_messages", "clear_context", "canvas_write"],
    outputContract: { type: "article", defaultFormat: "markdown" },
    defaultValues: { topic: "", audience: "", tone: "", language: "", length: "", format: "", keyPoints: "", instruction: "" },
    fields: []
  }
];

const getInitialValues = (agentCard: AgentCard): AgentValues => ({ ...agentCard.defaultValues });

function AppContent() {
  const { locale } = useI18n();
  const { view, setView } = useAppNavigation("start");
  const { agentCards, updateAgentCard } = useAgentCards(fallbackAgentCards);
  const { handleBatchHardDelete, handleBatchMoveToTrash, handleRenameThread, handleTogglePinnedThread, pinnedThreadIds, projects, recentThreads, refreshProjectSurfaces, refreshProjects, refreshRecentThreads, trashProjects } = useProjects();
  const [activeAgent, setActiveAgent] = useState<AgentCard>(fallbackAgentCards[0]);
  const [agentValues, setAgentValues] = useState<AgentValues>(() => getInitialValues(fallbackAgentCards[0]));
  const [activeProjectTitle, setActiveProjectTitle] = useState(fallbackAgentCards[0].title[locale]);
  const [toolState, setToolState] = useState<GenerateRequest["toolState"]>({ knowledge_base: true, canvas_write: true });
  const [settingsOpen, setSettingsOpen] = useState(false);

  const applyThreadState = (state: ThreadStateResponse) => {
    const agentCard = agentCards.find((card) => card.id === state.thread.agentCardId) ?? fallbackAgentCards[0];
    setActiveAgent(agentCard);
    setAgentValues({ ...getInitialValues(agentCard), ...(state.structuredValues ?? {}) });
    setActiveProjectTitle(state.thread.title);
    threadSession.setThreadId(state.thread.id);
    generationRun.setOutputVersions(state.outputVersions);
    generationRun.setToolEvents(state.toolEvents);
    canvasState.applyCanvasState(state.canvasNodes ?? [], state.canvasWriteRequests ?? []);
    const latestVersion = state.outputVersions[0];
    generationRun.setActiveVersionId(latestVersion?.id);
    generationRun.setEditableOutput(latestVersion?.content ?? "");
    generationRun.applyCollaborationMessagesFromThreadState(state);
    generationRun.setGeneration(latestVersion ? {
      text: latestVersion.content,
      prompt: "",
      provider: latestVersion.provider,
      usedMock: latestVersion.usedMock,
      threadId: state.thread.id,
      runId: latestVersion.runId
    } : null);
  };

  const threadSession = useThreadSession({
    onApplyThreadState: applyThreadState,
    onRefreshProjectSurfaces: refreshProjectSurfaces,
    onNavigate: setView
  });

  const canvasState = useCanvasState({
    ensureThreadId: () => threadSession.ensureThreadForAgent(activeAgent.id),
    onRefreshProjectSurfaces: refreshProjectSurfaces
  });

  const selectedCanvasNode = canvasState.canvasNodes.find((node) => node.id === canvasState.selectedCanvasNodeId);
  const getContextValues = () => {
    const structuredInputs = Object.fromEntries(
      activeAgent.fields
        .map((field) => [field.id, agentValues[field.id]] as const)
        .filter(([, value]) => typeof value === "string" ? value.trim().length > 0 : Boolean(value))
    );
    const values: Record<string, unknown> = {};
    if (Object.keys(structuredInputs).length > 0) {
      values.structuredInputs = structuredInputs;
    }
    if (generationRun.editableOutput.trim()) {
      values.currentDraft = generationRun.editableOutput;
    }
    if (canvasState.canvasNodes.length > 0 || selectedCanvasNode) {
      values.canvas = {
        nodes: canvasState.canvasNodes.map((node) => ({
          id: node.id,
          kind: node.kind,
          title: node.title,
          preview: node.content.slice(0, 600)
        })),
        selectedNode: selectedCanvasNode ? {
          id: selectedCanvasNode.id,
          kind: selectedCanvasNode.kind,
          title: selectedCanvasNode.title,
          content: selectedCanvasNode.content
        } : null
      };
    }
    return values;
  };

  const refreshThreadState = async (threadId: string) => {
    const state = await fetchThreadState(threadId);
    generationRun.setOutputVersions(state.outputVersions);
    generationRun.setToolEvents(state.toolEvents);
    generationRun.setActiveVersionId(state.outputVersions[0]?.id);
    canvasState.applyCanvasState(state.canvasNodes ?? [], state.canvasWriteRequests ?? []);
    setActiveProjectTitle(state.thread.title);
    await refreshProjectSurfaces();
  };

  const generationRun = useGenerationRun({
    activeAgent,
    agentValues,
    locale,
    toolState,
    selectedCanvasNodeId: canvasState.selectedCanvasNodeId,
    getContextValues,
    currentThreadId: threadSession.threadId,
    ensureThreadId: () => threadSession.ensureThreadForAgent(activeAgent.id),
    onPersistThreadId: threadSession.persistThreadId,
    onRefreshThreadState: refreshThreadState,
    onFetchAndApplyThreadState: fetchThreadState,
    onApplyThreadState: applyThreadState,
    onApproveCanvasWriteRequest: canvasState.handleApproveCanvasWriteRequest,
    getPendingCanvasWriteRequestIds: () => canvasState.canvasWriteRequests.map((request) => request.id),
    onRefreshProjectSurfaces: refreshProjectSurfaces
  });

  const projectTrash = useProjectTrash({
    onClearPersistedThreadId: threadSession.clearPersistedThreadId,
    onRefreshProjectSurfaces: refreshProjectSurfaces
  });

  useEffect(() => {
    refreshRecentThreads();
    refreshProjects();
  }, [refreshProjects, refreshRecentThreads]);

  useEffect(() => {
    if (view === "projects") {
      void refreshProjects();
    }
  }, [refreshProjects, view]);

  useEffect(() => {
    const firstAgent = agentCards[0];
    if (!firstAgent || view === "workspace" || activeAgent.id !== fallbackAgentCards[0].id) return;
    setActiveAgent(firstAgent);
    setAgentValues(getInitialValues(firstAgent));
  }, [activeAgent.id, agentCards, view]);

  useEffect(() => {
    if (view !== "workspace" || !threadSession.threadId) return;
    const saveTimer = window.setTimeout(() => {
      void saveThreadInputs(threadSession.threadId, agentValues).then(() => refreshProjectSurfaces()).catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(saveTimer);
  }, [agentValues, refreshProjectSurfaces, threadSession.threadId, view]);

  const handleActiveProjectTitleChange = useCallback(async (title: string) => {
    if (!threadSession.threadId) return;
    const thread = await renameThread(threadSession.threadId, title);
    setActiveProjectTitle(thread.title);
    await refreshProjectSurfaces();
  }, [refreshProjectSurfaces, threadSession.threadId]);

  const promptPreview = useMemo(() => {
    const pairs = activeAgent.fields
      .map((field) => [field.label[locale], String(agentValues[field.id] ?? "")] as const)
      .filter(([, value]) => value.trim().length > 0);
    const tools = activeAgent.toolRefs.filter((tool) => toolState?.[tool as keyof NonNullable<GenerateRequest["toolState"]>]);

    if (pairs.length === 0 && tools.length === 0) {
      return locale === "zh"
        ? "填写左侧结构化输入后，这里会显示组装后的 Agent Prompt。底部栏仅作为后续功能区。"
        : "Fill the left structured inputs to preview the assembled Agent prompt. The bottom bar is reserved for future tools.";
    }

    return [
      `AgentCard: ${activeAgent.title[locale]}`,
      `Skills: ${activeAgent.skillRefs.join(", ")}`,
      tools.length ? `Enabled tools: ${tools.join(", ")}` : "",
      ...pairs.map(([label, value]) => `${label}: ${value}`)
    ].filter(Boolean).join("\n");
  }, [activeAgent, agentValues, locale, toolState]);

  const openWorkspace = async (agentCard: AgentCard) => {
    threadSession.setThreadId("");
    setActiveAgent(agentCard);
    setAgentValues(getInitialValues(agentCard));
    setActiveProjectTitle(agentCard.title[locale]);
    generationRun.resetGeneration();
    canvasState.resetCanvas();
    setToolState({ knowledge_base: true, canvas_write: true });
    setView("workspace");
    await threadSession.createThreadForAgent(agentCard.id);
  };

  const openRecentThread = async (thread: StoredThread) => {
    await threadSession.restoreThread(thread.id);
  };

  const handleAgentSaved = (agentCard: AgentCard) => {
    updateAgentCard(agentCard);
    if (activeAgent.id === agentCard.id) {
      setActiveAgent(agentCard);
    }
  };

  return (
    <div className="app-shell" data-view={view}>
      <StartView active={view === "start"} onStart={() => setView("home")} onOpenSettings={() => setSettingsOpen(true)} />
      <HomeView
        activeView={view}
        agentCards={agentCards}
        recentThreads={recentThreads}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAgent={openWorkspace}
        onOpenThread={openRecentThread}
        onNavigate={setView}
        onDeleteThread={projectTrash.handleMoveToTrash}
        onTogglePinnedThread={handleTogglePinnedThread}
        pinnedThreadIds={pinnedThreadIds}
        onRenameThread={handleRenameThread}
      />
      <ProjectsView
        activeView={view}
        agentCards={agentCards}
        onBatchHardDelete={handleBatchHardDelete}
        onBatchMoveToTrash={handleBatchMoveToTrash}
        projects={projects}
        trashProjects={trashProjects}
        onHardDelete={projectTrash.handleHardDeleteThread}
        onMoveToTrash={projectTrash.handleMoveToTrash}
        onNavigate={setView}
        onOpenThread={openRecentThread}
        onRenameThread={handleRenameThread}
        onRestore={projectTrash.handleRestoreThread}
      />
      <AgentSettingsView
        activeView={view}
        agentCards={agentCards}
        onAgentSaved={handleAgentSaved}
        onNavigate={setView}
        onOpenAgent={openWorkspace}
      />
      <AiDashboardView activeView={view} onNavigate={setView} />
      <ModelConfigView activeView={view} onNavigate={setView} />
      <KnowledgeSettingsView activeView={view} onNavigate={setView} />
      <WorkspaceView
        activeAgent={activeAgent}
        activeView={view}
        agentValues={agentValues}
        collaborationMessages={generationRun.collaborationMessages}
        editableOutput={generationRun.editableOutput}
        generation={generationRun.generation}
        isChatSending={generationRun.isChatSending}
        isGenerating={generationRun.isGenerating}
        outputVersions={generationRun.outputVersions}
        activeVersionId={generationRun.activeVersionId}
        canvasNodes={canvasState.canvasNodes}
        canvasWriteRequests={canvasState.canvasWriteRequests}
        selectedCanvasNodeId={canvasState.selectedCanvasNodeId}
        toolEvents={generationRun.toolEvents}
        projectTitle={activeProjectTitle}
        onAgentValuesChange={setAgentValues}
        onProjectTitleChange={handleActiveProjectTitleChange}
        onApproveCanvasWriteRequest={canvasState.handleApproveCanvasWriteRequest}
        onChatSend={generationRun.handleChatSend}
        onCreateCanvasNode={canvasState.handleCreateCanvasNode}
        onDeleteCanvasNode={canvasState.handleDeleteCanvasNode}
        onEditableOutputChange={generationRun.setEditableOutput}
        onGenerate={generationRun.handleGenerate}
        onGoHome={() => setView("home")}
        onOpenSettings={() => setSettingsOpen(true)}
        onRejectCanvasWriteRequest={canvasState.handleRejectCanvasWriteRequest}
        onApplyCanvasWriteFromMessage={async (text) => {
          const request = await canvasState.handleCreateCanvasWriteRequest({
            operation: canvasState.selectedCanvasNodeId ? "append" : "create",
            targetNodeId: canvasState.selectedCanvasNodeId,
            nodeKind: "document",
            title: activeAgent.title[locale],
            content: text,
            rationale: locale === "zh" ? "用户确认写入 Canvas。" : "Confirmed by the user for Canvas."
          });
          await canvasState.handleApproveCanvasWriteRequest(request.id);
        }}
        onRestoreVersion={generationRun.restoreVersion}
        onSelectCanvasNode={canvasState.setSelectedCanvasNodeId}
        onToolStateChange={setToolState}
        onUpdateCanvasNode={canvasState.handleUpdateCanvasNode}
        promptPreview={promptPreview}
        toolState={toolState}
      />
      <ProjectSettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}
