import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createProject, fetchProjectFirstHealth, fetchThreadState, renameProject, resetThreadContext, saveProjectBrief, saveProjectThumbnail, saveTaskBrief, selectThreadModel } from "../features/agents/agentClient";
import { AgentSettingsView } from "../features/agents/AgentSettingsView";
import { useAgentCards } from "../features/agents/hooks/useAgentCards";
import type { AgentCard, BriefSaveStatus, ProjectBrief, ProjectSummary, StoredThread, TaskBrief, ThreadStateResponse } from "../features/agents/types";
import { AiDashboardView } from "../features/ai-dashboard/AiDashboardView";
import { useAppNavigation } from "../features/app/useAppNavigation";
import type { GenerateRequest } from "../features/generation/types";
import { I18nProvider, useI18n } from "../features/i18n/I18nProvider";
import { ProjectSettingsPanel } from "../features/settings/ProjectSettingsPanel";
import { SourceUpdateView } from "../features/settings/SourceUpdateView";
import { getAgentBackendRuntimeStatus, getCanvasSettings, getProjectRuntimeSettings } from "../features/settings/settingsClient";
import { StartView } from "../features/start/StartView";
import { HomeView } from "../features/home/HomeView";
import { KnowledgeSettingsView } from "../features/knowledge/KnowledgeSettingsView";
import { ModelConfigView } from "../features/model-config/ModelConfigView";
import { getConfiguredModelApis } from "../features/model-config/modelConfigClient";
import type { AgentBackendRuntimeStatus, ConfiguredModelApiSummary } from "../features/settings/types";
import { ProjectsView } from "../features/projects/ProjectsView";
import { useProjects } from "../features/projects/hooks/useProjects";
import { WorkspaceView } from "../features/workspace/WorkspaceView";
import type { AIComposerSubmitPayload } from "../features/workspace/components/AIComposer";
import { isThinkingSupportedModel, thinkingOverridesFromChoice } from "../features/workspace/components/AIComposer";
import { useSkillCatalogControls } from "../features/workspace/hooks/useSkillCatalogControls";
import { CanvasNodeSettingsView } from "../features/canvas/CanvasNodeSettingsView";
import { useCanvasState } from "./hooks/useCanvasState";
import { useGenerationRun } from "./hooks/useGenerationRun";
import { useProjectTrash } from "./hooks/useProjectTrash";
import { useThreadSession } from "./hooks/useThreadSession";
import { buildCanvasWorkflowContext } from "../../shared/canvasWorkflow";
import { assertProjectFirstContract } from "./projectWorkspace";
import { captureProjectThumbnail } from "./projectThumbnailCapture";

export type AppView = "start" | "home" | "workspace" | "projects" | "agentSettings" | "modelConfig" | "aiDashboard" | "knowledgeSettings" | "canvasNodeSettings" | "sourceUpdate";

const fallbackAgentCards: AgentCard[] = [
  {
    id: "chat-agent",
    category: "chat",
    accent: "blue",
    icon: "bot",
    title: { en: "ChatAgent", zh: "ChatAgent" },
    description: {
      en: "A neutral base Agent for prompts, tools, knowledge, memory, and MCP selections.",
      zh: "A neutral base Agent for prompts, tools, knowledge, memory, and MCP selections."
    },
    identityPrompt: "You are ChatAgent, a neutral assistant that follows the user's current instruction.",
    skillRefs: [],
    toolRefs: ["web_search", "knowledge_base", "clear_context", "canvas_write"],
    outputContract: { type: "chat", defaultFormat: "markdown" }
  }
];

const projectBriefLabels: Record<keyof ProjectBrief, string> = {
  goal: "Project goal",
  audience: "Target audience",
  background: "Background and known facts",
  standingConstraints: "Standing constraints and expression principles"
};
const taskBriefLabels: Record<keyof TaskBrief, string> = {
  objective: "Task objective",
  deliverableType: "Expected deliverable",
  deliverableDetails: "Deliverable supplemental details",
  mustCover: "Must cover",
  temporaryConstraints: "Temporary constraints and supplemental requirements"
};

function sameBrief(left: object, right: object) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function briefPreviewLines<T extends object>(brief: T, labels: Record<keyof T, string>) {
  return Object.entries(labels).flatMap(([key, label]) => {
    const value = brief[key as keyof T];
    return typeof value === "string" && value.trim() ? [`- ${label}: ${value.trim()}`] : [];
  });
}

function AppContent() {
  const { locale } = useI18n();
  const { view, setView } = useAppNavigation("start");
  const { agentCards, updateAgentCard } = useAgentCards(fallbackAgentCards);
  const { handleBatchHardDelete, handleBatchMoveToTrash, handleRenameThread, handleTogglePinnedThread, pinnedThreadIds, projects, refreshProjectSurfaces, refreshProjects, refreshRecentThreads, trashProjects } = useProjects();
  const [activeAgent, setActiveAgent] = useState<AgentCard>(fallbackAgentCards[0]);
  const [projectBrief, setProjectBrief] = useState<ProjectBrief>({});
  const [taskBrief, setTaskBrief] = useState<TaskBrief>({});
  const [projectBriefStatus, setProjectBriefStatus] = useState<BriefSaveStatus>("idle");
  const [taskBriefStatus, setTaskBriefStatus] = useState<BriefSaveStatus>("idle");
  const [activeProjectTitle, setActiveProjectTitle] = useState(locale === "zh" ? "新项目" : "New Project");
  const [activeProjectId, setActiveProjectId] = useState("");
  const [configuredModels, setConfiguredModels] = useState<ConfiguredModelApiSummary[]>([]);
  const [runtimeStatus, setRuntimeStatus] = useState<AgentBackendRuntimeStatus>();
  const [selectedModelConfigId, setSelectedModelConfigId] = useState<string | null>(null);
  const activeProjectIdRef = useRef("");
  const activeThreadIdRef = useRef("");
  const projectBriefRef = useRef<ProjectBrief>({});
  const taskBriefRef = useRef<TaskBrief>({});
  const projectBriefRevisionRef = useRef(0);
  const taskBriefRevisionRef = useRef(0);
  const projectBriefDirtyRef = useRef(false);
  const taskBriefDirtyRef = useRef(false);
  const projectBriefSavePromiseRef = useRef<Promise<void> | null>(null);
  const taskBriefSavePromiseRef = useRef<Promise<void> | null>(null);
  const [toolState, setToolState] = useState<GenerateRequest["toolState"]>({ web_search: true, knowledge_base: false, canvas_write: true });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [canvasUndoDepth, setCanvasUndoDepth] = useState(20);
  const [runtimeBudgetProfile, setRuntimeBudgetProfile] = useState<GenerateRequest["runtimeBudgetProfile"]>("low");
  const [pendingHomeComposerPayload, setPendingHomeComposerPayload] = useState<AIComposerSubmitPayload | null>(null);

  const applyThreadState = (state: ThreadStateResponse) => {
    activeProjectIdRef.current = state.thread.projectId;
    activeThreadIdRef.current = state.thread.id;
    projectBriefRef.current = state.projectBrief.brief;
    taskBriefRef.current = state.taskBrief.brief;
    projectBriefRevisionRef.current = state.projectBrief.revision;
    taskBriefRevisionRef.current = state.taskBrief.revision;
    projectBriefDirtyRef.current = false;
    taskBriefDirtyRef.current = false;
    setProjectBrief(state.projectBrief.brief);
    setTaskBrief(state.taskBrief.brief);
    setProjectBriefStatus(state.projectBrief.revision ? "saved" : "idle");
    setTaskBriefStatus(state.taskBrief.revision ? "saved" : "idle");
    setActiveProjectId(state.thread.projectId);
    setSelectedModelConfigId(state.thread.configuredModelApiId ?? null);
    setActiveProjectTitle(state.project?.title ?? state.thread.title);
    threadSession.setThreadId(state.thread.id);
    generationRun.setOutputVersions(state.outputVersions);
    generationRun.setToolEvents(state.toolEvents);
    generationRun.setRunTimelineEvents(state.runTimelineEvents ?? []);
    generationRun.setAgentClarifications(state.agentClarifications ?? []);
    generationRun.setCanvasWriteSuggestions(state.canvasWriteSuggestions ?? []);
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
  const skillControls = useSkillCatalogControls({ activeAgent, currentThreadId: threadSession.threadId });

  const canvasState = useCanvasState({
    ensureThreadId: () => threadSession.ensureThreadForProject(activeProjectId),
    onRefreshProjectSurfaces: refreshProjectSurfaces,
    undoDepth: canvasUndoDepth
  });

  const selectedCanvasNode = canvasState.canvasNodes.find((node) => node.id === canvasState.selectedCanvasNodeId);
  const getContextValues = () => {
    const values: Record<string, unknown> = {};
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
    if (canvasState.canvasWorkflow || contextNodes.length > 0 || (selectedCanvasNode && selectedCanvasNode.kind !== "note")) {
      values.canvas = {
        nodes: contextNodes.map((node) => ({
          id: node.id,
          kind: node.kind,
          title: node.title,
          preview: node.content.slice(0, 600),
          content: node.kind === "reference" ? node.content : undefined
        })),
        workflow: canvasState.canvasWorkflow ? {
          mode: canvasState.canvasWorkflow.mode,
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
    generationRun.setRunTimelineEvents(state.runTimelineEvents ?? []);
    generationRun.setAgentClarifications(state.agentClarifications ?? []);
    generationRun.setCanvasWriteSuggestions(state.canvasWriteSuggestions ?? []);
    generationRun.setActiveVersionId(state.outputVersions[0]?.id);
    generationRun.applyCollaborationMessagesFromThreadState(state);
    canvasState.applyCanvasState(state.canvasNodes ?? [], state.canvasWriteRequests ?? [], state.canvasEdges ?? [], state.canvasWorkflow, state.canvasWorkflowSuggestions ?? [], state.canvasObjects ?? []);
    setActiveProjectTitle(state.thread.title);
    await refreshProjectSurfaces();
  };

  const applyLiveThreadState = (state: ThreadStateResponse) => {
    if (activeThreadIdRef.current && state.thread.id !== activeThreadIdRef.current) return;
    activeProjectIdRef.current = state.thread.projectId;
    activeThreadIdRef.current = state.thread.id;
    generationRun.setToolEvents(state.toolEvents);
    generationRun.setRunTimelineEvents(state.runTimelineEvents ?? []);
    generationRun.setAgentClarifications(state.agentClarifications ?? []);
    generationRun.setCanvasWriteSuggestions(state.canvasWriteSuggestions ?? []);
    generationRun.setPlans(state.plans ?? []);
    canvasState.applyCanvasState(state.canvasNodes ?? [], state.canvasWriteRequests ?? [], state.canvasEdges ?? [], state.canvasWorkflow, state.canvasWorkflowSuggestions ?? [], state.canvasObjects ?? []);
  };

  const updateProjectBrief = useCallback((brief: ProjectBrief) => {
    projectBriefRef.current = brief;
    projectBriefDirtyRef.current = true;
    setProjectBrief(brief);
    setProjectBriefStatus("idle");
  }, []);

  const updateTaskBrief = useCallback((brief: TaskBrief) => {
    taskBriefRef.current = brief;
    taskBriefDirtyRef.current = true;
    setTaskBrief(brief);
    setTaskBriefStatus("idle");
  }, []);

  const saveProjectBriefNow = useCallback(async () => {
    while (projectBriefDirtyRef.current && activeProjectId) {
      if (projectBriefSavePromiseRef.current) {
        await projectBriefSavePromiseRef.current;
        continue;
      }
      const projectId = activeProjectId;
      const snapshot = projectBriefRef.current;
      const revision = projectBriefRevisionRef.current + 1;
      setProjectBriefStatus("saving");
      const savePromise = saveProjectBrief(projectId, snapshot, revision)
        .then((saved) => {
          if (projectId !== activeProjectIdRef.current) return;
          projectBriefRevisionRef.current = saved.revision;
          projectBriefDirtyRef.current = !sameBrief(snapshot, projectBriefRef.current);
          setProjectBriefStatus(projectBriefDirtyRef.current ? "idle" : "saved");
          void refreshProjectSurfaces().catch(() => undefined);
        })
        .catch((error) => {
          if (projectId === activeProjectIdRef.current) setProjectBriefStatus("error");
          throw error;
        });
      projectBriefSavePromiseRef.current = savePromise;
      try {
        await savePromise;
      } finally {
        if (projectBriefSavePromiseRef.current === savePromise) projectBriefSavePromiseRef.current = null;
      }
    }
  }, [activeProjectId, refreshProjectSurfaces]);

  const saveTaskBriefNow = useCallback(async () => {
    while (taskBriefDirtyRef.current && threadSession.threadId) {
      if (taskBriefSavePromiseRef.current) {
        await taskBriefSavePromiseRef.current;
        continue;
      }
      const threadId = threadSession.threadId;
      const snapshot = taskBriefRef.current;
      const revision = taskBriefRevisionRef.current + 1;
      setTaskBriefStatus("saving");
      const savePromise = saveTaskBrief(threadId, snapshot, revision)
        .then((saved) => {
          if (threadId !== activeThreadIdRef.current) return;
          taskBriefRevisionRef.current = saved.revision;
          taskBriefDirtyRef.current = !sameBrief(snapshot, taskBriefRef.current);
          setTaskBriefStatus(taskBriefDirtyRef.current ? "idle" : "saved");
        })
        .catch((error) => {
          if (threadId === activeThreadIdRef.current) setTaskBriefStatus("error");
          throw error;
        });
      taskBriefSavePromiseRef.current = savePromise;
      try {
        await savePromise;
      } finally {
        if (taskBriefSavePromiseRef.current === savePromise) taskBriefSavePromiseRef.current = null;
      }
    }
  }, [threadSession.threadId]);

  const flushBriefs = useCallback(async () => {
    await Promise.all([saveProjectBriefNow(), saveTaskBriefNow()]);
  }, [saveProjectBriefNow, saveTaskBriefNow]);

  const saveActiveProjectThumbnail = useCallback(async () => {
    const projectId = activeProjectIdRef.current;
    if (!projectId || view !== "workspace") return;
    const thumbnail = await captureProjectThumbnail();
    if (!thumbnail) return;
    await saveProjectThumbnail(projectId, thumbnail);
    await refreshProjects();
  }, [refreshProjects, view]);

  const leaveWorkspace = useCallback(async () => {
    const thumbnailSave = saveActiveProjectThumbnail().catch(() => undefined);
    if (activeProjectIdRef.current) await flushBriefs();
    await thumbnailSave;
  }, [flushBriefs, saveActiveProjectThumbnail]);

  const beginWorkspaceLeave = useCallback(() => {
    const thumbnailSave = saveActiveProjectThumbnail().catch(() => undefined);
    const briefSave = activeProjectIdRef.current ? flushBriefs().catch(() => undefined) : Promise.resolve();
    return Promise.allSettled([thumbnailSave, briefSave]);
  }, [flushBriefs, saveActiveProjectThumbnail]);

  const generationRun = useGenerationRun({
    activeAgent,
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
    onApplyLiveThreadState: applyLiveThreadState,
    onApplyLiveCanvasNode: canvasState.applyLiveCanvasNode,
    onApproveCanvasWriteRequest: async (requestId) => { await canvasState.handleApproveCanvasWriteRequest(requestId); },
    getPendingCanvasWriteRequestIds: () => canvasState.canvasWriteRequests.map((request) => request.id),
    onRefreshProjectSurfaces: refreshProjectSurfaces,
    beforeGenerate: flushBriefs
  });
  const activePlanPollingKey = useMemo(() => {
    const activePlans = generationRun.plans.filter((plan) => plan.status === "running" || plan.status === "paused" || plan.status === "awaiting_approval");
    return activePlans.map((plan) => `${plan.id}:${plan.status}:${plan.currentStepId ?? ""}:${plan.updatedAt}`).join("|");
  }, [generationRun.plans]);

  useEffect(() => {
    if (!pendingHomeComposerPayload || view !== "workspace" || !activeProjectId || !threadSession.threadId) return;
    const payload = pendingHomeComposerPayload;
    let cancelled = false;
    setPendingHomeComposerPayload(null);
    void (async () => {
      if (payload.selectedModelConfigId) {
        const thread = await selectThreadModel(threadSession.threadId, payload.selectedModelConfigId);
        if (cancelled) return;
        setSelectedModelConfigId(thread.configuredModelApiId ?? null);
      }
      const model = configuredModels.find((item) => item.id === payload.selectedModelConfigId);
      const modelOverrides = isThinkingSupportedModel(model) ? thinkingOverridesFromChoice(payload.thinkingChoice) : undefined;
      const requestContext = {
        ...(payload.enabledSkillRefs.length ? { transientSkillRefs: payload.enabledSkillRefs } : {}),
        ...(payload.disabledSkillRefs.length ? { disabledSkillRefs: payload.disabledSkillRefs } : {}),
        ...(payload.runtimeBudgetProfile ? { runtimeBudgetProfile: payload.runtimeBudgetProfile } : {})
      };
      await generationRun.handleChatSend(payload.text, modelOverrides, requestContext);
      skillControls.clearSkillOverrides();
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeProjectId, configuredModels, generationRun, pendingHomeComposerPayload, skillControls, threadSession.threadId, view]);

  useEffect(() => {
    if (!threadSession.threadId || !activePlanPollingKey) return;
    let cancelled = false;
    const refreshActivePlans = () => {
      if (!threadSession.threadId || cancelled) return;
      void refreshThreadState(threadSession.threadId).catch(() => undefined);
    };
    const timer = window.setInterval(refreshActivePlans, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activePlanPollingKey, threadSession.threadId]);

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
  }, [activeAgent.id, agentCards, view]);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
    if (activeProjectId) {
      void getProjectRuntimeSettings(activeProjectId)
        .then((settings) => setRuntimeBudgetProfile(settings.runtimeBudgetProfile))
        .catch(() => setRuntimeBudgetProfile("low"));
    }
  }, [activeProjectId]);

  useEffect(() => {
    activeThreadIdRef.current = threadSession.threadId;
  }, [threadSession.threadId]);

  useEffect(() => {
    if (view !== "workspace" || !projectBriefDirtyRef.current) return;
    const timer = window.setTimeout(() => { void saveProjectBriefNow().catch(() => undefined); }, 350);
    return () => window.clearTimeout(timer);
  }, [projectBrief, saveProjectBriefNow, view]);

  useEffect(() => {
    if (view !== "workspace" || !taskBriefDirtyRef.current) return;
    const timer = window.setTimeout(() => { void saveTaskBriefNow().catch(() => undefined); }, 350);
    return () => window.clearTimeout(timer);
  }, [saveTaskBriefNow, taskBrief, view]);

  const handleActiveProjectTitleChange = useCallback(async (title: string) => {
    if (!activeProjectId) return;
    const project = await renameProject(activeProjectId, title);
    setActiveProjectTitle(project.title);
    await refreshProjectSurfaces();
  }, [activeProjectId, refreshProjectSurfaces]);

  const promptPreview = useMemo(() => {
    const tools = activeAgent.toolRefs.filter((tool) => toolState?.[tool as keyof NonNullable<GenerateRequest["toolState"]>]);
    const projectLines = briefPreviewLines(projectBrief, projectBriefLabels);
    const taskLines = briefPreviewLines(taskBrief, taskBriefLabels);

    if (projectLines.length === 0 && taskLines.length === 0 && tools.length === 0) {
      return locale === "zh"
        ? "填写左侧 Project Brief 或 Current Task Brief 后，这里会显示生成时自动注入的上下文。"
        : "Fill the Project Brief or Current Task Brief to preview the context automatically injected at generation time.";
    }

    return [
      `AgentCard: ${activeAgent.title[locale]}`,
      `Skills: ${activeAgent.skillRefs.join(", ")}`,
      tools.length ? `Enabled tools: ${tools.join(", ")}` : "",
      projectLines.length ? `# Project Brief\n${projectLines.join("\n")}` : "",
      taskLines.length ? `# Current Task Brief\n${taskLines.join("\n")}` : ""
    ].filter(Boolean).join("\n");
  }, [activeAgent, locale, projectBrief, taskBrief, toolState]);

  const openWorkspace = async (
    agentCard: AgentCard,
    options: { runtimeBudgetProfile?: GenerateRequest["runtimeBudgetProfile"]; toolState?: GenerateRequest["toolState"] } = {}
  ) => {
    await leaveWorkspace();
    const projectTitle = locale === "zh" ? "新项目" : "New Project";
    threadSession.setThreadId("");
    setActiveAgent(agentCard);
    projectBriefRef.current = {};
    taskBriefRef.current = {};
    projectBriefDirtyRef.current = false;
    taskBriefDirtyRef.current = false;
    setProjectBrief({});
    setTaskBrief({});
    setProjectBriefStatus("idle");
    setTaskBriefStatus("idle");
    setActiveProjectTitle(projectTitle);
    generationRun.resetGeneration();
    canvasState.resetCanvas();
    setToolState(options.toolState ?? { web_search: true, knowledge_base: false, canvas_write: true });
    setRuntimeBudgetProfile(options.runtimeBudgetProfile ?? "low");
    const project = await createProject(projectTitle);
    setActiveProjectId(project.id);
    setSelectedModelConfigId(null);
    await threadSession.openProject(project.id);
  };

  const openWorkspaceFromPrompt = async (payload: AIComposerSubmitPayload) => {
    const nextAgent = agentCards.find((agent) => agent.id === payload.agentId) ?? activeAgent;
    await openWorkspace(nextAgent, {
      runtimeBudgetProfile: payload.runtimeBudgetProfile,
      toolState: payload.toolState
    });
    if (payload.text) {
      setPendingHomeComposerPayload(payload);
    }
  };

  const openRecentThread = async (thread: StoredThread | ProjectSummary) => {
    await leaveWorkspace();
    if ("projectId" in thread) {
      await threadSession.restoreThread(thread.id);
      return;
    }
    setActiveProjectId(thread.id);
    setActiveProjectTitle(thread.title);
    await threadSession.openProject(thread.id);
  };

  const selectedConfiguredModel = configuredModels.find((model) => model.id === selectedModelConfigId);
  const homeModelSettings = {
    providerId: selectedConfiguredModel?.providerId,
    modelId: selectedConfiguredModel?.modelId,
    modelName: selectedConfiguredModel?.modelName,
    supportsThinking: selectedConfiguredModel?.supportsThinking
  };

  const handleAgentSaved = (agentCard: AgentCard) => {
    updateAgentCard(agentCard);
    if (activeAgent.id === agentCard.id) {
      setActiveAgent(agentCard);
    }
  };

  const navigateFromWorkspace = (nextView: AppView) => {
    if (view !== "workspace") {
      setView(nextView);
      return;
    }
    void beginWorkspaceLeave();
    setView(nextView);
  };

  useEffect(() => {
    if (view !== "workspace") return;
    const handleBeforeUnload = () => {
      void saveActiveProjectThumbnail().catch(() => undefined);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [saveActiveProjectThumbnail, view]);

  return (
    <div className="app-shell" data-view={view}>
      <StartView active={view === "start"} onStart={() => setView("home")} onOpenSettings={() => setSettingsOpen(true)} />
      <HomeView
        activeAgent={activeAgent}
        activeView={view}
        agentCards={agentCards}
        configuredModels={configuredModels}
        disabledSkillRefs={skillControls.disabledSkillRefs}
        enabledSkillRefs={skillControls.enabledSkillRefs}
        isCreatingFromPrompt={Boolean(pendingHomeComposerPayload)}
        modelSelectionDisabled={false}
        modelSettings={homeModelSettings}
        projects={projects}
        runtimeBudgetProfile={runtimeBudgetProfile}
        selectedModelConfigId={selectedModelConfigId}
        skillCatalog={skillControls.skillCatalog}
        skillCatalogStatus={skillControls.skillCatalogStatus}
        skillFolders={skillControls.skillFolders}
        toolState={toolState}
        onCreateBoardFromPrompt={openWorkspaceFromPrompt}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAgent={openWorkspace}
        onOpenThread={openRecentThread}
        onNavigate={navigateFromWorkspace}
        onDeleteThread={projectTrash.handleMoveToTrash}
        onRequestSkillCatalog={skillControls.requestSkillCatalog}
        onSelectAgent={(agentCardId) => {
          const nextAgent = agentCards.find((agent) => agent.id === agentCardId);
          if (nextAgent) setActiveAgent(nextAgent);
        }}
        onSelectModel={(configuredModelApiId) => {
          setSelectedModelConfigId(configuredModelApiId || null);
        }}
        onTogglePinnedThread={handleTogglePinnedThread}
        onToggleSkill={skillControls.toggleMessageSkill}
        onToolStateChange={setToolState}
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
        onNavigate={navigateFromWorkspace}
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
        onNavigate={navigateFromWorkspace}
        onOpenAgent={openWorkspace}
      />
      <AiDashboardView activeView={view} onNavigate={navigateFromWorkspace} />
      <ModelConfigView activeView={view} onNavigate={navigateFromWorkspace} />
      <KnowledgeSettingsView activeView={view} onNavigate={navigateFromWorkspace} />
      <CanvasNodeSettingsView activeView={view} onNavigate={navigateFromWorkspace} />
      <SourceUpdateView activeView={view} onNavigate={navigateFromWorkspace} />
      <WorkspaceView
        activeAgent={activeAgent}
        agentCards={agentCards}
        activeView={view}
        projectBrief={projectBrief}
        taskBrief={taskBrief}
        projectBriefStatus={projectBriefStatus}
        taskBriefStatus={taskBriefStatus}
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
        canvasWriteSuggestions={generationRun.canvasWriteSuggestions}
        agentClarifications={generationRun.agentClarifications}
        canvasWorkflow={canvasState.canvasWorkflow}
        canvasWorkflowSuggestions={canvasState.canvasWorkflowSuggestions}
        selectedCanvasNodeId={canvasState.selectedCanvasNodeId}
        canUndoCanvas={canvasState.canUndoCanvas}
        plans={generationRun.plans}
        projectTitle={activeProjectTitle}
        configuredModels={configuredModels}
        runtimeStatus={runtimeStatus}
        selectedModelConfigId={selectedModelConfigId}
        currentThreadId={threadSession.threadId}
        projectThreads={threadSession.projectThreads}
        sessionBusy={threadSession.sessionBusy}
        sessionError={threadSession.sessionError}
        disabledSkillRefs={skillControls.disabledSkillRefs}
        enabledSkillRefs={skillControls.enabledSkillRefs}
        skillCatalog={skillControls.skillCatalog}
        skillFolders={skillControls.skillFolders}
        skillCatalogStatus={skillControls.skillCatalogStatus}
        onCreateConversation={async () => { if (activeProjectId) { await flushBriefs(); await threadSession.createConversation(activeProjectId); } }}
        onResetContext={async () => { if (threadSession.threadId) await resetThreadContext(threadSession.threadId); }}
        onSelectThread={async (threadId) => { await flushBriefs(); await threadSession.restoreThread(threadId); }}
        onSelectModel={async (configuredModelApiId) => {
          if (!threadSession.threadId || !configuredModelApiId) return;
          const thread = await selectThreadModel(threadSession.threadId, configuredModelApiId);
          setSelectedModelConfigId(thread.configuredModelApiId ?? null);
        }}
        onSelectAgent={(agentCardId) => {
          const nextAgent = agentCards.find((agent) => agent.id === agentCardId);
          if (!nextAgent) return;
          setActiveAgent(nextAgent);
        }}
        onRequestSkillCatalog={skillControls.requestSkillCatalog}
        onCreateSkillFolder={skillControls.handleCreateSkillFolder}
        onDeleteSkillFolder={skillControls.handleDeleteSkillFolder}
        onMoveSkillToFolder={skillControls.handleMoveSkillToFolder}
        onRenameSkillFolder={skillControls.handleRenameSkillFolder}
        onSkillOverridesConsumed={skillControls.clearSkillOverrides}
        onToggleSkill={skillControls.toggleMessageSkill}
        onProjectTitleChange={handleActiveProjectTitleChange}
        onProjectBriefChange={updateProjectBrief}
        onTaskBriefChange={updateTaskBrief}
        onRetryProjectBrief={saveProjectBriefNow}
        onRetryTaskBrief={saveTaskBriefNow}
        onApproveCanvasWriteRequest={canvasState.handleApproveCanvasWriteRequest}
        onChatSend={generationRun.handleChatSend}
        onQueueChatInput={generationRun.queueChatInput}
        onRequestQueuedInputIntervention={generationRun.requestQueuedInputIntervention}
        onStopChatSend={generationRun.stopChatGeneration}
        onPlansChanged={async () => { if (threadSession.threadId) await refreshThreadState(threadSession.threadId); }}
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
        onGoHome={() => navigateFromWorkspace("home")}
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
        onUpdateCanvasNodePositions={canvasState.handleUpdateCanvasNodePositions}
        onUpdateCanvasObject={canvasState.handleUpdateCanvasObject}
        onUploadCanvasAsset={canvasState.handleUploadCanvasAsset}
        onUpdateCanvasWorkflow={canvasState.handleUpdateCanvasWorkflow}
        onUndoCanvas={canvasState.undoCanvas}
        promptPreview={promptPreview}
        toolState={toolState}
        runtimeBudgetProfile={runtimeBudgetProfile}
      />
      <ProjectSettingsPanel open={settingsOpen} projectId={activeProjectId} onClose={() => setSettingsOpen(false)} />
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
