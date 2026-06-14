import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { AppView } from "../../app/App";
import { Topbar } from "../../shared/Topbar";
import type { AgentCard, BriefSaveStatus, CanvasEdge, CanvasNode, CanvasNodeKind, CanvasObject, CanvasWorkflow, CanvasWorkflowSuggestion, CanvasWriteRequest, CanvasWriteSuggestion, PlanRun, ProjectBrief, StoredOutputVersion, StoredThread, TaskBrief } from "../agents/types";
import type { CanvasEdgeDraft, CanvasNodeDraft, CanvasNodePatch, CanvasObjectDraft, CanvasObjectPatch, CanvasRangeRewriteDraft } from "../canvas/canvasClient";
import type { CollaborationMessage, GenerateRequest, GenerateResponse } from "../generation/types";
import { useI18n } from "../i18n/I18nProvider";
import { AgentInputDrawer } from "./components/AgentInputDrawer";
import { AICollaborationPanel } from "./components/AICollaborationPanel";
import { WorkspaceLayout } from "./components/WorkspaceLayout";
import { WorkspaceMainCanvas } from "./components/WorkspaceMainCanvas";
import { WorkspaceUtilityBar } from "./components/WorkspaceUtilityBar";
import type { CanvasTool } from "./components/canvas/toolState";
import type { CanvasClipboardPayload } from "../../../shared/canvasClipboard";
import type { CanvasMindChainContext } from "../../../shared/canvasMindChain";
import type { AgentBackendRuntimeStatus, ConfiguredModelApiSummary } from "../settings/types";

const RIGHT_DRAWER_MIN_WIDTH = 360;
const RIGHT_DRAWER_MAX_WIDTH = 720;

type WorkspaceViewProps = {
  activeAgent: AgentCard;
  agentCards: AgentCard[];
  activeView: AppView;
  collaborationMessages: CollaborationMessage[];
  editableOutput: string;
  generation: GenerateResponse | null;
  isChatSending: boolean;
  isGenerating: boolean;
  activeVersionId?: string;
  canvasNodes: CanvasNode[];
  canvasEdges: CanvasEdge[];
  canvasObjects: CanvasObject[];
  canvasWriteRequests: CanvasWriteRequest[];
  canvasWriteSuggestions: CanvasWriteSuggestion[];
  canvasWorkflow?: CanvasWorkflow;
  canvasWorkflowSuggestions: CanvasWorkflowSuggestion[];
  selectedCanvasNodeId?: string;
  canUndoCanvas: boolean;
  plans: PlanRun[];
  projectTitle: string;
  configuredModels: ConfiguredModelApiSummary[];
  runtimeStatus?: AgentBackendRuntimeStatus;
  selectedModelConfigId?: string | null;
  currentThreadId: string;
  projectThreads: StoredThread[];
  sessionBusy: boolean;
  sessionError: string;
  onSelectModel: (configuredModelApiId: string) => Promise<void>;
  onCreateConversation: () => Promise<void>;
  onResetContext: () => Promise<void>;
  onSelectThread: (threadId: string) => Promise<void>;
  onApproveCanvasWriteRequest: (requestId: string) => Promise<{ request: CanvasWriteRequest; node?: CanvasNode }>;
  onAcceptCanvasWorkflowSuggestion: (suggestionId: string) => Promise<void>;
  onChatSend: (text: string, modelOverrides?: GenerateRequest["modelOverrides"], requestContext?: Record<string, unknown>) => Promise<unknown>;
  onStopChatSend: () => void;
  onConvertCanvasWorkflowSuggestionToNode: (suggestionId: string, kind?: CanvasNodeKind) => Promise<void>;
  onCreateCanvasEdge: (draft: CanvasEdgeDraft) => Promise<CanvasEdge | undefined>;
  onCreateCanvasNode: (draft: CanvasNodeDraft) => Promise<unknown>;
  onCreateCanvasObject: (draft: CanvasObjectDraft) => Promise<unknown>;
  onDeleteCanvasEdge: (edgeId: string) => Promise<void>;
  onDeleteCanvasNode: (nodeId: string) => Promise<void>;
  onDeleteCanvasObject: (objectId: string) => Promise<void>;
  onPasteCanvas: (payload: CanvasClipboardPayload, center: { x: number; y: number }) => Promise<void>;
  onConvertCanvasText: (objectId: string, kind: Extract<CanvasNodeKind, "document" | "reference" | "note">) => Promise<void>;
  onIgnoreCanvasWorkflowSuggestion: (suggestionId: string) => Promise<void>;
  onEditableOutputChange: (value: string) => void;
  onGenerate: () => Promise<void>;
  onGoHome: () => void;
  onOpenSettings: () => void;
  onSelectAgent: (agentCardId: string) => void;
  onProjectTitleChange: (title: string) => Promise<void>;
  onApplyCanvasWriteFromMessage: (text: string) => Promise<void>;
  onRejectCanvasWriteRequest: (requestId: string) => Promise<void>;
  onRequestCanvasRangeRewrite: (draft: CanvasRangeRewriteDraft) => Promise<CanvasWriteRequest>;
  onRestoreVersion: (version: StoredOutputVersion) => void;
  onSelectCanvasNode: (nodeId?: string) => void;
  onToolStateChange: (toolState: GenerateRequest["toolState"]) => void;
  onUpdateCanvasNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
  onUpdateCanvasObject: (objectId: string, patch: CanvasObjectPatch) => Promise<unknown>;
  onUploadCanvasAsset: (input: { fileName: string; fileBase64: string }) => Promise<unknown>;
  onUpdateCanvasNodeWorkflow: (nodeId: string, patch: { stage?: CanvasWorkflow["stage"]; roles?: string[] }) => Promise<unknown>;
  onUpdateCanvasWorkflow: (patch: { stage?: CanvasWorkflow["stage"]; roles?: CanvasWorkflow["roles"] }) => Promise<unknown>;
  onUndoCanvas: () => Promise<void>;
  onPlansChanged: () => Promise<void>;
  onProjectBriefChange: (brief: ProjectBrief) => void;
  onTaskBriefChange: (brief: TaskBrief) => void;
  onRetryProjectBrief: () => Promise<void>;
  onRetryTaskBrief: () => Promise<void>;
  promptPreview: string;
  projectBrief: ProjectBrief;
  taskBrief: TaskBrief;
  projectBriefStatus: BriefSaveStatus;
  taskBriefStatus: BriefSaveStatus;
  toolState: GenerateRequest["toolState"];
};

export function WorkspaceView({
  activeAgent,
  agentCards,
  activeView,
  collaborationMessages,
  generation,
  isChatSending,
  isGenerating,
  canvasNodes,
  canvasEdges,
  canvasObjects,
  canvasWriteRequests,
  canvasWriteSuggestions,
  canvasWorkflow,
  canvasWorkflowSuggestions,
  selectedCanvasNodeId,
  canUndoCanvas,
  plans,
  projectTitle,
  configuredModels,
  runtimeStatus,
  selectedModelConfigId,
  currentThreadId,
  projectThreads,
  sessionBusy,
  sessionError,
  onSelectModel,
    onCreateConversation,
    onResetContext,
  onSelectThread,
  onApproveCanvasWriteRequest,
  onAcceptCanvasWorkflowSuggestion,
  onChatSend,
  onStopChatSend,
  onConvertCanvasWorkflowSuggestionToNode,
  onCreateCanvasEdge,
  onCreateCanvasNode,
  onCreateCanvasObject,
  onDeleteCanvasEdge,
  onDeleteCanvasNode,
  onDeleteCanvasObject,
  onPasteCanvas,
  onConvertCanvasText,
  onIgnoreCanvasWorkflowSuggestion,
  onGoHome,
  onOpenSettings,
  onSelectAgent,
  onProjectTitleChange,
  onApplyCanvasWriteFromMessage,
  onRejectCanvasWriteRequest,
  onRequestCanvasRangeRewrite,
  onSelectCanvasNode,
  onToolStateChange,
  onPlansChanged,
  onProjectBriefChange,
  onTaskBriefChange,
  onRetryProjectBrief,
  onRetryTaskBrief,
  onUpdateCanvasNode,
  onUpdateCanvasObject,
  onUploadCanvasAsset,
  onUpdateCanvasNodeWorkflow,
  onUpdateCanvasWorkflow,
  onUndoCanvas,
  promptPreview,
  projectBrief,
  taskBrief,
  projectBriefStatus,
  taskBriefStatus,
  toolState
}: WorkspaceViewProps) {
  const { locale, t } = useI18n();
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [rightDrawerWidth, setRightDrawerWidth] = useState(RIGHT_DRAWER_MIN_WIDTH);
  const [composerDraft, setComposerDraft] = useState("");
  const [mindChainContext, setMindChainContext] = useState<CanvasMindChainContext | null>(null);
  const [activeCanvasTool, setActiveCanvasTool] = useState<CanvasTool>("select");
  const focusedPlanProjectionRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveCanvasTool("select");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const projected = [...plans]
      .filter((plan) => plan.canvasNodeId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (!projected?.canvasNodeId) return;
    if (!canvasNodes.some((node) => node.id === projected.canvasNodeId)) return;
    const focusKey = `${projected.id}:${projected.canvasNodeId}`;
    if (focusedPlanProjectionRef.current === focusKey) return;
    focusedPlanProjectionRef.current = focusKey;
    onSelectCanvasNode(projected.canvasNodeId);
  }, [canvasNodes, onSelectCanvasNode, plans]);

  const providerLabel = runtimeStatus?.reachable
    ? `Agent Runtime / ${runtimeStatus.deploymentMode}`
    : locale === "zh" ? "Agent Runtime 不可用" : "Agent Runtime unavailable";

  const selectedConfiguredModel = configuredModels.find((model) => model.id === selectedModelConfigId);

  const startRightDrawerResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = rightDrawerWidth;
    const maxWidth = Math.max(RIGHT_DRAWER_MIN_WIDTH, Math.min(RIGHT_DRAWER_MAX_WIDTH, window.innerWidth - 520));
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      const nextWidth = Math.min(maxWidth, Math.max(RIGHT_DRAWER_MIN_WIDTH, startWidth + delta));
      setRightDrawerWidth(nextWidth);
    };

    const stopResize = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  };

  return (
    <section className="view view-workspace" id="workspace-view" aria-label={`${projectTitle} workspace`}>
      <Topbar
        activeView={activeView}
        contextLabel={`${projectTitle} / ${projectThreads.find((thread) => thread.id === currentThreadId)?.title ?? "New conversation"}`}
        onGoHome={onGoHome}
        onOpenSettings={onOpenSettings}
        actions={
          <>
            <span className="provider-chip ui-status-badge ui-status-primary">{providerLabel}</span>
            <button className="button button-secondary ui-button ui-button-secondary" type="button" onClick={() => document.querySelector(".prompt-card")?.scrollIntoView({ behavior: "smooth", block: "nearest" })}>
              {t("app.previewPrompt")}
            </button>
          </>
        }
      />

      <WorkspaceLayout leftCollapsed={leftCollapsed} rightCollapsed={rightCollapsed} rightDrawerWidth={rightDrawerWidth}>
        <AgentInputDrawer
          collapsed={leftCollapsed}
          locale={locale}
          projectTitle={projectTitle}
          projectBrief={projectBrief}
          taskBrief={taskBrief}
          projectBriefStatus={projectBriefStatus}
          taskBriefStatus={taskBriefStatus}
          onCollapse={() => setLeftCollapsed(true)}
          onExpand={() => setLeftCollapsed(false)}
          onProjectTitleChange={onProjectTitleChange}
          onProjectBriefChange={onProjectBriefChange}
          onTaskBriefChange={onTaskBriefChange}
          onRetryProjectBrief={onRetryProjectBrief}
          onRetryTaskBrief={onRetryTaskBrief}
        />

        <WorkspaceMainCanvas
          activeTool={activeCanvasTool}
          canUndo={canUndoCanvas}
          edges={canvasEdges}
          objects={canvasObjects}
          nodes={canvasNodes}
          providerLabel={providerLabel}
          workflow={canvasWorkflow}
          suggestions={canvasWorkflowSuggestions}
          selectedNodeId={selectedCanvasNodeId}
          writeRequests={canvasWriteRequests}
          agentCardId={activeAgent.id}
          onAcceptSuggestion={onAcceptCanvasWorkflowSuggestion}
          onConvertSuggestionToNode={onConvertCanvasWorkflowSuggestionToNode}
          onCreateEdge={onCreateCanvasEdge}
          onCreateNode={onCreateCanvasNode}
          onCreateObject={onCreateCanvasObject}
          onDeleteEdge={onDeleteCanvasEdge}
          onDeleteNode={onDeleteCanvasNode}
          onDeleteObject={onDeleteCanvasObject}
          onPaste={onPasteCanvas}
          onConvertText={onConvertCanvasText}
          onIgnoreSuggestion={onIgnoreCanvasWorkflowSuggestion}
          onAttachMindChain={setMindChainContext}
          onSendMindChainToChat={setComposerDraft}
          onSelectNode={onSelectCanvasNode}
          onUndo={onUndoCanvas}
          onUpdateNode={onUpdateCanvasNode}
          onRequestRangeRewrite={onRequestCanvasRangeRewrite}
          onApproveWriteRequest={onApproveCanvasWriteRequest}
          onRejectWriteRequest={onRejectCanvasWriteRequest}
          onUpdateObject={onUpdateCanvasObject}
          onUploadAsset={onUploadCanvasAsset}
          onUpdateNodeWorkflow={onUpdateCanvasNodeWorkflow}
          onUpdateWorkflow={onUpdateCanvasWorkflow}
          onToolChange={setActiveCanvasTool}
        />

        <AICollaborationPanel
          allowedTools={activeAgent.toolRefs}
          activeAgent={activeAgent}
          agentCards={agentCards}
          canvasWriteRequests={canvasWriteRequests}
          canvasWriteSuggestions={canvasWriteSuggestions}
          collapsed={rightCollapsed}
          isSending={isChatSending}
          modelSelectionDisabled={isGenerating || isChatSending}
          inputDraft={composerDraft}
          mindChainContext={mindChainContext}
          messages={collaborationMessages}
          plans={plans}
          projectThreads={projectThreads}
          currentThreadId={currentThreadId}
          sessionBusy={sessionBusy}
          sessionError={sessionError}
          configuredModels={configuredModels}
          selectedModelConfigId={selectedModelConfigId}
          modelSettings={{
            providerId: selectedConfiguredModel?.providerId,
            thinkingMode: selectedConfiguredModel?.providerId === "deepseek" && selectedConfiguredModel.modelId === "deepseek-reasoner" ? "enabled" : undefined
          }}
          onApproveWriteRequest={async (requestId) => { await onApproveCanvasWriteRequest(requestId); }}
            onCreateConversation={onCreateConversation}
            onResetContext={onResetContext}
          onApplyWriteText={onApplyCanvasWriteFromMessage}
          onRejectWriteRequest={onRejectCanvasWriteRequest}
          onSend={onChatSend}
          onStopSending={onStopChatSend}
          onSelectAgent={onSelectAgent}
          onSelectModel={onSelectModel}
          onSelectThread={onSelectThread}
          onInputDraftConsumed={() => setComposerDraft("")}
          onMindChainContextConsumed={() => setMindChainContext(null)}
          onRemoveMindChainContext={() => setMindChainContext(null)}
          onResizeStart={startRightDrawerResize}
          onToggleCollapsed={() => setRightCollapsed((value) => !value)}
          onToolStateChange={onToolStateChange}
          onPlansChanged={onPlansChanged}
          onFocusPlanArtifact={onSelectCanvasNode}
          toolState={toolState}
        />
      </WorkspaceLayout>

      <WorkspaceUtilityBar activeTool={activeCanvasTool} onToolChange={setActiveCanvasTool} promptPreview={generation?.prompt ?? promptPreview} />
    </section>
  );
}
