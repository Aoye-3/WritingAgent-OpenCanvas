import { useEffect, useMemo, useState } from "react";
import { createThread, fetchThreadState, hardDeleteThread, moveThreadToTrash, restoreThreadFromTrash } from "../features/agents/agentClient";
import { AgentSettingsView } from "../features/agents/AgentSettingsView";
import { useAgentCards } from "../features/agents/hooks/useAgentCards";
import type { AgentCard, AgentValues, CanvasNode, CanvasWriteRequest, StoredOutputVersion, StoredThread, StoredToolEvent, ThreadStateResponse } from "../features/agents/types";
import { AiDashboardView } from "../features/ai-dashboard/AiDashboardView";
import { approveCanvasWriteRequest, createCanvasNode, deleteCanvasNode, fetchCanvas, rejectCanvasWriteRequest, updateCanvasNode, type CanvasNodeDraft, type CanvasNodePatch } from "../features/canvas/canvasClient";
import { useAppNavigation } from "../features/app/useAppNavigation";
import { generateText, generateTextStream } from "../features/generation/generationClient";
import type { CollaborationMessage, GenerateRequest, GenerateResponse } from "../features/generation/types";
import { I18nProvider, useI18n } from "../features/i18n/I18nProvider";
import { ProjectSettingsPanel } from "../features/settings/ProjectSettingsPanel";
import { StartView } from "../features/start/StartView";
import { HomeView } from "../features/home/HomeView";
import { KnowledgeSettingsView } from "../features/knowledge/KnowledgeSettingsView";
import { ProjectsView } from "../features/projects/ProjectsView";
import { useProjects } from "../features/projects/hooks/useProjects";
import { WorkspaceView } from "../features/workspace/WorkspaceView";

export type AppView = "start" | "home" | "workspace" | "projects" | "agentSettings" | "aiDashboard" | "knowledgeSettings";

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
  const [activeAgent, setActiveAgent] = useState<AgentCard>(fallbackAgentCards[0]);
  const [threadId, setThreadId] = useState<string>("");
  const [agentValues, setAgentValues] = useState<AgentValues>(() => getInitialValues(fallbackAgentCards[0]));
  const [toolState, setToolState] = useState<GenerateRequest["toolState"]>({ knowledge_base: true, canvas_write: true });
  const [generation, setGeneration] = useState<GenerateResponse | null>(null);
  const [editableOutput, setEditableOutput] = useState("");
  const [collaborationMessages, setCollaborationMessages] = useState<CollaborationMessage[]>([]);
  const [canvasNodes, setCanvasNodes] = useState<CanvasNode[]>([]);
  const [canvasWriteRequests, setCanvasWriteRequests] = useState<CanvasWriteRequest[]>([]);
  const [selectedCanvasNodeId, setSelectedCanvasNodeId] = useState<string | undefined>();
  const [outputVersions, setOutputVersions] = useState<StoredOutputVersion[]>([]);
  const [toolEvents, setToolEvents] = useState<StoredToolEvent[]>([]);
  const { projects, recentThreads, refreshProjectSurfaces, refreshProjects, refreshRecentThreads, trashProjects } = useProjects();
  const [activeVersionId, setActiveVersionId] = useState<string | undefined>();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isChatSending, setIsChatSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    refreshRecentThreads();
    refreshProjects();
  }, [refreshProjects, refreshRecentThreads]);

  useEffect(() => {
    const firstAgent = agentCards[0];
    if (!firstAgent || activeAgent.id !== fallbackAgentCards[0].id) return;
    setActiveAgent(firstAgent);
    setAgentValues(getInitialValues(firstAgent));
  }, [activeAgent.id, agentCards]);

  const promptPreview = useMemo(() => {
    const pairs = activeAgent.fields
      .map((field) => [field.label[locale], String(agentValues[field.id] ?? "")] as const)
      .filter(([, value]) => value.trim().length > 0);
    const tools = activeAgent.toolRefs.filter((tool) => toolState?.[tool as keyof NonNullable<GenerateRequest["toolState"]>]);

    if (pairs.length === 0 && tools.length === 0) {
      return locale === "zh"
        ? "填写左侧结构化输入，或在底部 Command Bar 切换工具后，这里会显示组装后的 Agent Prompt。"
        : "Fill the left structured inputs or toggle tools in the Command Bar to preview the assembled Agent prompt.";
    }

    return [
      `AgentCard: ${activeAgent.title[locale]}`,
      `Skills: ${activeAgent.skillRefs.join(", ")}`,
      tools.length ? `Enabled tools: ${tools.join(", ")}` : "",
      ...pairs.map(([label, value]) => `${label}: ${value}`)
    ].filter(Boolean).join("\n");
  }, [activeAgent, agentValues, locale, toolState]);

  const startApp = () => {
    setView("home");
  };

  const openWorkspace = async (agentCard: AgentCard) => {
    setActiveAgent(agentCard);
    setAgentValues(getInitialValues(agentCard));
    setGeneration(null);
    setEditableOutput("");
    setCollaborationMessages([]);
    setOutputVersions([]);
    setToolEvents([]);
    setCanvasNodes([]);
    setCanvasWriteRequests([]);
    setSelectedCanvasNodeId(undefined);
    setActiveVersionId(undefined);
    setToolState({ knowledge_base: true, canvas_write: true });
    setView("workspace");
    try {
      const thread = await createThread(agentCard.id);
      setThreadId(thread.threadId);
      window.localStorage.setItem("facetwrite:lastThreadId", thread.threadId);
      await refreshProjectSurfaces();
    } catch {
      const nextThreadId = `thread_${crypto.randomUUID()}`;
      setThreadId(nextThreadId);
      window.localStorage.setItem("facetwrite:lastThreadId", nextThreadId);
    }
  };

  const openRecentThread = async (thread: StoredThread) => {
    await restoreThread(thread.id);
  };

  const restoreThread = async (nextThreadId: string) => {
    try {
      const state = await fetchThreadState(nextThreadId);
      applyThreadState(state);
      setView("workspace");
      window.localStorage.setItem("facetwrite:lastThreadId", nextThreadId);
      return true;
    } catch {
      window.localStorage.removeItem("facetwrite:lastThreadId");
      return false;
    }
  };

  const applyThreadState = (state: ThreadStateResponse) => {
    const agentCard = agentCards.find((card) => card.id === state.thread.agentCardId) ?? fallbackAgentCards[0];
    setActiveAgent(agentCard);
    setAgentValues(getInitialValues(agentCard));
    setThreadId(state.thread.id);
    setOutputVersions(state.outputVersions);
    setToolEvents(state.toolEvents);
    setCanvasNodes(state.canvasNodes ?? []);
    setCanvasWriteRequests(state.canvasWriteRequests ?? []);
    setSelectedCanvasNodeId((state.canvasNodes ?? [])[0]?.id);
    const latestVersion = state.outputVersions[0];
    setActiveVersionId(latestVersion?.id);
    setEditableOutput(latestVersion?.content ?? "");
    setCollaborationMessages(state.messages.map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      usedMock: message.usedMock
    })));
    setGeneration(latestVersion ? {
      text: latestVersion.content,
      prompt: "",
      provider: latestVersion.provider,
      usedMock: latestVersion.usedMock,
      threadId: state.thread.id,
      runId: latestVersion.runId
    } : null);
  };

  const refreshThreadState = async (nextThreadId: string) => {
    const state = await fetchThreadState(nextThreadId);
    setOutputVersions(state.outputVersions);
    setToolEvents(state.toolEvents);
    setActiveVersionId(state.outputVersions[0]?.id);
    setCanvasNodes(state.canvasNodes ?? []);
    setCanvasWriteRequests(state.canvasWriteRequests ?? []);
    await refreshProjectSurfaces();
  };

  const handleMoveToTrash = async (thread: StoredThread | string) => {
    const nextThreadId = typeof thread === "string" ? thread : thread.id;
    await moveThreadToTrash(nextThreadId);
    if (window.localStorage.getItem("facetwrite:lastThreadId") === nextThreadId) {
      window.localStorage.removeItem("facetwrite:lastThreadId");
    }
    await refreshProjectSurfaces();
  };

  const handleRestoreThread = async (nextThreadId: string) => {
    await restoreThreadFromTrash(nextThreadId);
    await refreshProjectSurfaces();
  };

  const handleHardDeleteThread = async (nextThreadId: string) => {
    await hardDeleteThread(nextThreadId);
    if (window.localStorage.getItem("facetwrite:lastThreadId") === nextThreadId) {
      window.localStorage.removeItem("facetwrite:lastThreadId");
    }
    await refreshProjectSurfaces();
  };

  const handleAgentSaved = (agentCard: AgentCard) => {
    updateAgentCard(agentCard);
    if (activeAgent.id === agentCard.id) {
      setActiveAgent(agentCard);
    }
  };

  const ensureThreadId = () => {
    if (threadId) return threadId;
    const nextThreadId = `thread_${crypto.randomUUID()}`;
    setThreadId(nextThreadId);
    return nextThreadId;
  };

  const selectedCanvasNode = canvasNodes.find((node) => node.id === selectedCanvasNodeId);

  const canvasContext = {
    nodes: canvasNodes.map((node) => ({
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

  const contextValues = {
    writingStyle: locale === "zh" ? "清晰、友好、适合学生" : "Friendly, clear, and suitable for students",
    knowledgeSource: locale === "zh" ? "课程笔记：气候与环境" : "Course Notes: Climate and Environment",
    currentDraft: editableOutput,
    canvas: canvasContext
  };

  const refreshCanvas = async (nextThreadId = threadId) => {
    if (!nextThreadId) return;
    const canvas = await fetchCanvas(nextThreadId);
    setCanvasNodes(canvas.nodes);
    setCanvasWriteRequests(canvas.writeRequests);
    setSelectedCanvasNodeId((current) => current && canvas.nodes.some((node) => node.id === current) ? current : canvas.nodes[0]?.id);
  };

  const handleCreateCanvasNode = async (draft: CanvasNodeDraft) => {
    const nextThreadId = ensureThreadId();
    const node = await createCanvasNode(nextThreadId, draft);
    setCanvasNodes((current) => [...current, node]);
    setSelectedCanvasNodeId(node.id);
    await refreshProjectSurfaces();
  };

  const handleUpdateCanvasNode = async (nodeId: string, patch: CanvasNodePatch) => {
    const nextThreadId = ensureThreadId();
    const node = await updateCanvasNode(nextThreadId, nodeId, patch);
    setCanvasNodes((current) => current.map((item) => item.id === node.id ? node : item));
    await refreshProjectSurfaces();
  };

  const handleDeleteCanvasNode = async (nodeId: string) => {
    const nextThreadId = ensureThreadId();
    await deleteCanvasNode(nextThreadId, nodeId);
    setCanvasNodes((current) => current.filter((node) => node.id !== nodeId));
    setSelectedCanvasNodeId((current) => current === nodeId ? undefined : current);
    await refreshProjectSurfaces();
  };

  const handleApproveCanvasWriteRequest = async (requestId: string) => {
    const nextThreadId = ensureThreadId();
    await approveCanvasWriteRequest(nextThreadId, requestId);
    await refreshCanvas(nextThreadId);
    await refreshProjectSurfaces();
  };

  const handleRejectCanvasWriteRequest = async (requestId: string) => {
    const nextThreadId = ensureThreadId();
    await rejectCanvasWriteRequest(nextThreadId, requestId);
    await refreshCanvas(nextThreadId);
    await refreshProjectSurfaces();
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const payload: GenerateRequest = {
        mode: "structured",
        agentCardId: activeAgent.id,
        threadId: ensureThreadId(),
        locale,
        structuredValues: agentValues,
        contextValues,
        toolState,
        selectedCanvasNodeId
      };
      setEditableOutput("");
      const result = activeAgent.settings?.model.streaming
        ? await generateTextStream(payload, {
            onToken: (token) => setEditableOutput((current) => current + token),
            onToolEvent: (event) => setToolEvents((current) => [{
              id: crypto.randomUUID(),
              threadId: threadId || payload.threadId || "",
              runId: "pending",
              eventType: String((event as { eventType?: unknown }).eventType ?? "tool_event"),
              payload: (event as { payload?: unknown }).payload ?? event,
              createdAt: new Date().toISOString()
            }, ...current])
          })
        : await generateText(payload);
      setGeneration(result);
      setThreadId(result.threadId);
      window.localStorage.setItem("facetwrite:lastThreadId", result.threadId);
      setEditableOutput(result.text);
      await refreshThreadState(result.threadId);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleChatSend = async (text: string) => {
    setIsChatSending(true);

    try {
      const payload: GenerateRequest = {
        mode: "chat",
        agentCardId: activeAgent.id,
        threadId: ensureThreadId(),
        locale,
        structuredValues: agentValues,
        contextValues,
        chatInstruction: text,
        toolState: { ...toolState, quick_messages: true, canvas_write: true },
        selectedCanvasNodeId
      };
      const result = activeAgent.settings?.model.streaming
        ? await generateTextStream(payload, {
            onToken: (token) => setEditableOutput((current) => current || token ? current + token : token),
            onToolEvent: (event) => setToolEvents((current) => [{
              id: crypto.randomUUID(),
              threadId: threadId || payload.threadId || "",
              runId: "pending",
              eventType: String((event as { eventType?: unknown }).eventType ?? "tool_event"),
              payload: (event as { payload?: unknown }).payload ?? event,
              createdAt: new Date().toISOString()
            }, ...current])
          })
        : await generateText(payload);
      setThreadId(result.threadId);
      setGeneration(result);
      window.localStorage.setItem("facetwrite:lastThreadId", result.threadId);
      const state = await fetchThreadState(result.threadId);
      applyThreadState(state);
      await refreshProjectSurfaces();
    } finally {
      setIsChatSending(false);
    }
  };

  const restoreVersion = (version: StoredOutputVersion) => {
    setEditableOutput(version.content);
    setActiveVersionId(version.id);
    setGeneration({
      text: version.content,
      prompt: generation?.prompt ?? "",
      provider: version.provider,
      usedMock: version.usedMock,
      threadId: version.threadId,
      runId: version.runId
    });
  };

  return (
    <div className="app-shell" data-view={view}>
      <StartView active={view === "start"} onStart={startApp} onOpenSettings={() => setSettingsOpen(true)} />
      <HomeView
        activeView={view}
        agentCards={agentCards}
        recentThreads={recentThreads}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAgent={openWorkspace}
        onOpenThread={openRecentThread}
        onNavigate={setView}
        onDeleteThread={handleMoveToTrash}
      />
      <ProjectsView
        activeView={view}
        agentCards={agentCards}
        projects={projects}
        trashProjects={trashProjects}
        onHardDelete={handleHardDeleteThread}
        onMoveToTrash={handleMoveToTrash}
        onNavigate={setView}
        onOpenThread={openRecentThread}
        onRestore={handleRestoreThread}
      />
      <AgentSettingsView
        activeView={view}
        agentCards={agentCards}
        onAgentSaved={handleAgentSaved}
        onNavigate={setView}
        onOpenAgent={openWorkspace}
      />
      <AiDashboardView activeView={view} onNavigate={setView} />
      <KnowledgeSettingsView activeView={view} onNavigate={setView} />
      <WorkspaceView
        activeAgent={activeAgent}
        activeView={view}
        agentValues={agentValues}
        collaborationMessages={collaborationMessages}
        editableOutput={editableOutput}
        generation={generation}
        isChatSending={isChatSending}
        isGenerating={isGenerating}
        outputVersions={outputVersions}
        activeVersionId={activeVersionId}
        canvasNodes={canvasNodes}
        canvasWriteRequests={canvasWriteRequests}
        selectedCanvasNodeId={selectedCanvasNodeId}
        toolEvents={toolEvents}
        onAgentValuesChange={setAgentValues}
        onApproveCanvasWriteRequest={handleApproveCanvasWriteRequest}
        onChatSend={handleChatSend}
        onCreateCanvasNode={handleCreateCanvasNode}
        onDeleteCanvasNode={handleDeleteCanvasNode}
        onEditableOutputChange={setEditableOutput}
        onGenerate={handleGenerate}
        onGoHome={() => setView("home")}
        onOpenSettings={() => setSettingsOpen(true)}
        onRejectCanvasWriteRequest={handleRejectCanvasWriteRequest}
        onRestoreVersion={restoreVersion}
        onSelectCanvasNode={setSelectedCanvasNodeId}
        onToolStateChange={setToolState}
        onUpdateCanvasNode={handleUpdateCanvasNode}
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
