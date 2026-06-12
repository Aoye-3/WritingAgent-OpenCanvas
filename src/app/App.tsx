import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createProject, fetchProjectFirstHealth, fetchThreadState, renameProject, resetThreadContext, saveThreadInputs, selectThreadModel } from "../features/agents/agentClient";
import { AgentSettingsView } from "../features/agents/AgentSettingsView";
import { useAgentCards } from "../features/agents/hooks/useAgentCards";
import type { AgentCard, AgentValues, ProjectSummary, StoredThread, ThreadStateResponse } from "../features/agents/types";
import { AiDashboardView } from "../features/ai-dashboard/AiDashboardView";
import { useAppNavigation } from "../features/app/useAppNavigation";
import type { GenerateRequest } from "../features/generation/types";
import { I18nProvider, useI18n } from "../features/i18n/I18nProvider";
import { ProjectSettingsPanel } from "../features/settings/ProjectSettingsPanel";
import { getAgentBackendRuntimeStatus, getCanvasSettings } from "../features/settings/settingsClient";
import { StartView } from "../features/start/StartView";
import { HomeView } from "../features/home/HomeView";
import { KnowledgeSettingsView } from "../features/knowledge/KnowledgeSettingsView";
import { ModelConfigView } from "../features/model-config/ModelConfigView";
import { getConfiguredModelApis } from "../features/model-config/modelConfigClient";
import type { AgentBackendRuntimeStatus, ConfiguredModelApiSummary } from "../features/settings/types";
import { ProjectsView } from "../features/projects/ProjectsView";
import { useProjects } from "../features/projects/hooks/useProjects";
import { WorkspaceView } from "../features/workspace/WorkspaceView";
import { CanvasNodeSettingsView } from "../features/canvas/CanvasNodeSettingsView";
import { useCanvasState } from "./hooks/useCanvasState";
import { useGenerationRun } from "./hooks/useGenerationRun";
import { useProjectTrash } from "./hooks/useProjectTrash";
import { useThreadSession } from "./hooks/useThreadSession";
import { buildCanvasWorkflowContext } from "../../shared/canvasWorkflow";
import { assertProjectFirstContract } from "./projectWorkspace";

export type AppView = "start" | "home" | "workspace" | "projects" | "agentSettings" | "modelConfig" | "aiDashboard" | "knowledgeSettings" | "canvasNodeSettings";

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
  const [activeProjectId, setActiveProjectId] = useState("");
  const [configuredModels, setConfiguredModels] = useState<ConfiguredModelApiSummary[]>([]);
  const [runtimeStatus, setRuntimeStatus] = useState<AgentBackendRuntimeStatus>();
  const [selectedModelConfigId, setSelectedModelConfigId] = useState<string | null>(null);
  const [projectInputs, setProjectInputs] = useState<Record<string, AgentValues>>({});
  const activeProjectIdRef = useRef("");
  const inputRevisionRef = useRef<Record<string, number>>({});
  const [toolState, setToolState] = useState<GenerateRequest["toolState"]>({ web_search: true, knowledge_base: false, canvas_write: true });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [canvasUndoDepth, setCanvasUndoDepth] = useState(20);

  const applyThreadState = (state: ThreadStateResponse) => {
    const agentCard = activeAgent;
    const nextProjectInputs = state.projectInputs ?? {};
    inputRevisionRef.current = Object.fromEntries(
      Object.entries(state.projectInputRevisions ?? {}).map(([agentCardId, revision]) => [`${state.thread.projectId}:${agentCardId}`, revision])
    );
    setProjectInputs(nextProjectInputs);
    setAgentValues({ ...getInitialValues(agentCard), ...(nextProjectInputs[agentCard.id] ?? {}) });
    setActiveProjectId(state.thread.projectId);
    setSelectedModelConfigId(state.thread.configuredModelApiId ?? null);
    setActiveProjectTitle(state.project?.title ?? state.thread.title);
    threadSession.setThreadId(state.thread.id);
    generationRun.setOutputVersions(state.outputVersions);
    generationRun.setToolEvents(state.toolEvents);
    canvasState.applyCanvasState(state.canvasNodes ?? [], state.canvasWriteRequests ?? [], state.canvasEdges ?? [], state.canvasWorkflow, state.canvasWorkflowSuggestions ?? [], state.canvasObjects ?? []);
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
    ensureThreadId: () => threadSession.ensureThreadForProject(activeProjectId),
    onRefreshProjectSurfaces: refreshProjectSurfaces,
    undoDepth: canvasUndoDepth
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
    const chainNodeIds = selectedCanvasNode?.kind === "role"
      ? canvasState.canvasEdges
        .filter((edge) => edge.sourceNodeId === selectedCanvasNode.id)
        .map((edge) => edge.targetNodeId)
      : selectedCanvasNode ? [selectedCanvasNode.id] : undefined;
    const workflowContext = canvasState.canvasWorkflow ? buildCanvasWorkflowContext({
      workflow: canvasState.canvasWorkflow,
      nodes: canvasState.canvasNodes
        .filter((node) => node.kind !== "note")
        .map((node) => ({
          id: node.id,
          kind: node.kind,
          title: node.title,
          content: node.content,
          metadata: node.metadata
        })),
      edges: canvasState.canvasEdges,
      chainNodeIds
    }) : undefined;
    const contextNodeIds = new Set(workflowContext?.nodes.map((node) => node.id));
    const selectedAndRelatedNodeIds = new Set(selectedCanvasNode ? [
      selectedCanvasNode.id,
      ...canvasState.canvasEdges.filter((edge) => edge.sourceNodeId === selectedCanvasNode.id).map((edge) => edge.targetNodeId)
    ] : []);
    const contextNodes = canvasState.canvasWorkflow
      ? canvasState.canvasNodes.filter((node) => contextNodeIds.has(node.id))
      : canvasState.canvasNodes.filter((node) => node.kind !== "note" && selectedAndRelatedNodeIds.has(node.id));
    if (contextNodes.length > 0 || (selectedCanvasNode && selectedCanvasNode.kind !== "note")) {
      values.canvas = {
        nodes: contextNodes.map((node) => ({
          id: node.id,
          kind: node.kind,
          title: node.title,
          workflow: (node.metadata as { workflow?: unknown } | undefined)?.workflow,
          preview: node.content.slice(0, 600),
          content: node.kind === "reference" ? node.content : undefined
        })),
        workflow: canvasState.canvasWorkflow ? {
          stage: canvasState.canvasWorkflow.stage,
          roles: workflowContext?.roles ?? []
        } : undefined,
        selectedNode: selectedCanvasNode && selectedCanvasNode.kind !== "note" ? {
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
    canvasState.applyCanvasState(state.canvasNodes ?? [], state.canvasWriteRequests ?? [], state.canvasEdges ?? [], state.canvasWorkflow, state.canvasWorkflowSuggestions ?? [], state.canvasObjects ?? []);
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
    currentProjectId: activeProjectId,
    ensureThreadId: () => threadSession.ensureThreadForProject(activeProjectId),
    onPersistThreadId: threadSession.persistThreadId,
    onRefreshThreadState: refreshThreadState,
    onFetchAndApplyThreadState: fetchThreadState,
    onApplyThreadState: applyThreadState,
    onApproveCanvasWriteRequest: async (requestId) => { await canvasState.handleApproveCanvasWriteRequest(requestId); },
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
    getCanvasSettings().then((settings) => setCanvasUndoDepth(settings.undoDepth)).catch(() => undefined);
    getConfiguredModelApis().then((result) => setConfiguredModels(result.configs.filter((model) => model.enabled && model.keyConfigured && model.modelType === "chat"))).catch(() => setConfiguredModels([]));
  }, [refreshProjects, refreshRecentThreads]);

  useEffect(() => {
    const refresh = () => { void getAgentBackendRuntimeStatus().then(setRuntimeStatus).catch(() => setRuntimeStatus(undefined)); };
    refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => window.clearInterval(timer);
  }, []);

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
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  useEffect(() => {
    if (view !== "workspace" || !threadSession.threadId) return;
    const saveTimer = window.setTimeout(() => {
      const targetProjectId = activeProjectId;
      const revisionKey = `${targetProjectId}:${activeAgent.id}`;
      const revision = (inputRevisionRef.current[revisionKey] ?? 0) + 1;
      inputRevisionRef.current[revisionKey] = revision;
      void saveThreadInputs(threadSession.threadId, activeAgent.id, agentValues, revision)
        .then(() => {
          if (targetProjectId !== activeProjectIdRef.current) return;
          setProjectInputs((current) => ({ ...current, [activeAgent.id]: agentValues }));
          return refreshProjectSurfaces();
        })
        .catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(saveTimer);
  }, [activeAgent.id, activeProjectId, agentValues, refreshProjectSurfaces, threadSession.threadId, view]);

  const handleActiveProjectTitleChange = useCallback(async (title: string) => {
    if (!activeProjectId) return;
    const project = await renameProject(activeProjectId, title);
    setActiveProjectTitle(project.title);
    await refreshProjectSurfaces();
  }, [activeProjectId, refreshProjectSurfaces]);

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
    const projectTitle = locale === "zh" ? "新项目" : "New Project";
    threadSession.setThreadId("");
    setActiveAgent(agentCard);
    setAgentValues(getInitialValues(agentCard));
    setActiveProjectTitle(projectTitle);
    generationRun.resetGeneration();
    canvasState.resetCanvas();
    setToolState({ web_search: true, knowledge_base: false, canvas_write: true });
    const project = await createProject(projectTitle);
    setActiveProjectId(project.id);
    setProjectInputs({});
    setSelectedModelConfigId(null);
    await threadSession.openProject(project.id);
  };

  const openRecentThread = async (thread: StoredThread | ProjectSummary) => {
    if ("projectId" in thread) {
      await threadSession.restoreThread(thread.id);
      return;
    }
    setActiveProjectId(thread.id);
    setActiveProjectTitle(thread.title);
    await threadSession.openProject(thread.id);
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
        sessionBusy={threadSession.sessionBusy}
        sessionError={threadSession.sessionError}
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
      <CanvasNodeSettingsView activeView={view} onNavigate={setView} />
      <WorkspaceView
        activeAgent={activeAgent}
        agentCards={agentCards}
        activeView={view}
        agentValues={agentValues}
        collaborationMessages={generationRun.collaborationMessages}
        editableOutput={generationRun.editableOutput}
        generation={generationRun.generation}
        isChatSending={generationRun.isChatSending}
        isGenerating={generationRun.isGenerating}
        activeVersionId={generationRun.activeVersionId}
        canvasNodes={canvasState.canvasNodes}
        canvasEdges={canvasState.canvasEdges}
        canvasObjects={canvasState.canvasObjects}
        canvasWriteRequests={canvasState.canvasWriteRequests}
        canvasWorkflow={canvasState.canvasWorkflow}
        canvasWorkflowSuggestions={canvasState.canvasWorkflowSuggestions}
        selectedCanvasNodeId={canvasState.selectedCanvasNodeId}
        canUndoCanvas={canvasState.canUndoCanvas}
        toolEvents={generationRun.toolEvents}
        projectTitle={activeProjectTitle}
        configuredModels={configuredModels}
        runtimeStatus={runtimeStatus}
        selectedModelConfigId={selectedModelConfigId}
        currentThreadId={threadSession.threadId}
        projectThreads={threadSession.projectThreads}
        sessionBusy={threadSession.sessionBusy}
        sessionError={threadSession.sessionError}
        onCreateConversation={async () => { if (activeProjectId) await threadSession.createConversation(activeProjectId); }}
        onResetContext={async () => { if (threadSession.threadId) await resetThreadContext(threadSession.threadId); }}
        onSelectThread={async (threadId) => { await threadSession.restoreThread(threadId); }}
        onSelectModel={async (configuredModelApiId) => {
          if (!threadSession.threadId || !configuredModelApiId) return;
          const thread = await selectThreadModel(threadSession.threadId, configuredModelApiId);
          setSelectedModelConfigId(thread.configuredModelApiId ?? null);
        }}
        onAgentValuesChange={setAgentValues}
        onSelectAgent={(agentCardId) => {
          const nextAgent = agentCards.find((agent) => agent.id === agentCardId);
          if (!nextAgent) return;
          setActiveAgent(nextAgent);
          setAgentValues({ ...getInitialValues(nextAgent), ...(projectInputs[nextAgent.id] ?? {}) });
        }}
        onProjectTitleChange={handleActiveProjectTitleChange}
        onApproveCanvasWriteRequest={canvasState.handleApproveCanvasWriteRequest}
        onChatSend={generationRun.handleChatSend}
        onCreateCanvasEdge={canvasState.handleCreateCanvasEdge}
        onCreateCanvasNode={canvasState.handleCreateCanvasNode}
        onCreateCanvasObject={canvasState.handleCreateCanvasObject}
        onAcceptCanvasWorkflowSuggestion={canvasState.handleAcceptCanvasWorkflowSuggestion}
        onConvertCanvasWorkflowSuggestionToNode={canvasState.handleConvertCanvasWorkflowSuggestionToNode}
        onDeleteCanvasEdge={canvasState.handleDeleteCanvasEdge}
        onDeleteCanvasObject={canvasState.handleDeleteCanvasObject}
        onDeleteCanvasNode={canvasState.handleDeleteCanvasNode}
        onIgnoreCanvasWorkflowSuggestion={canvasState.handleIgnoreCanvasWorkflowSuggestion}
        onPasteCanvas={canvasState.handlePasteCanvas}
        onConvertCanvasText={canvasState.handleConvertCanvasText}
        onEditableOutputChange={generationRun.setEditableOutput}
        onGenerate={generationRun.handleGenerate}
        onGoHome={() => setView("home")}
        onOpenSettings={() => setSettingsOpen(true)}
        onRejectCanvasWriteRequest={canvasState.handleRejectCanvasWriteRequest}
        onRequestCanvasRangeRewrite={canvasState.handleRequestCanvasRangeRewrite}
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
        onUpdateCanvasObject={canvasState.handleUpdateCanvasObject}
        onUploadCanvasAsset={canvasState.handleUploadCanvasAsset}
        onUpdateCanvasNodeWorkflow={canvasState.handleUpdateCanvasNodeWorkflow}
        onUpdateCanvasWorkflow={canvasState.handleUpdateCanvasWorkflow}
        onUndoCanvas={canvasState.undoCanvas}
        promptPreview={promptPreview}
        toolState={toolState}
      />
      <ProjectSettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export function App() {
  const [contractState, setContractState] = useState<"checking" | "ready" | "error">("checking");
  const [contractError, setContractError] = useState("");

  useEffect(() => {
    let active = true;
    fetchProjectFirstHealth()
      .then((health) => {
        assertProjectFirstContract(health);
        if (active) setContractState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setContractError(error instanceof Error ? error.message : "Unable to verify the FacetWrite backend.");
        setContractState("error");
      });
    return () => { active = false; };
  }, []);

  if (contractState !== "ready") {
    return (
      <main className="backend-contract-gate" role={contractState === "error" ? "alert" : "status"}>
        <strong>{contractState === "error" ? "FacetWrite backend unavailable" : "Checking FacetWrite backend..."}</strong>
        {contractError ? <p>{contractError}</p> : null}
      </main>
    );
  }

  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}
