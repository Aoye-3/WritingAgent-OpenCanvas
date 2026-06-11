import { useEffect, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { AppView } from "../../app/App";
import { Topbar } from "../../shared/Topbar";
import type { AgentCard, AgentValues, CanvasEdge, CanvasNode, CanvasNodeKind, CanvasObject, CanvasWorkflow, CanvasWorkflowSuggestion, CanvasWriteRequest, StoredOutputVersion, StoredToolEvent } from "../agents/types";
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

const RIGHT_DRAWER_MIN_WIDTH = 360;
const RIGHT_DRAWER_MAX_WIDTH = 720;

type WorkspaceViewProps = {
  activeAgent: AgentCard;
  activeView: AppView;
  collaborationMessages: CollaborationMessage[];
  editableOutput: string;
  generation: GenerateResponse | null;
  isChatSending: boolean;
  isGenerating: boolean;
  outputVersions: StoredOutputVersion[];
  activeVersionId?: string;
  canvasNodes: CanvasNode[];
  canvasEdges: CanvasEdge[];
  canvasObjects: CanvasObject[];
  canvasWriteRequests: CanvasWriteRequest[];
  canvasWorkflow?: CanvasWorkflow;
  canvasWorkflowSuggestions: CanvasWorkflowSuggestion[];
  selectedCanvasNodeId?: string;
  canUndoCanvas: boolean;
  toolEvents: StoredToolEvent[];
  projectTitle: string;
  onApproveCanvasWriteRequest: (requestId: string) => Promise<{ request: CanvasWriteRequest; node?: CanvasNode }>;
  onAcceptCanvasWorkflowSuggestion: (suggestionId: string) => Promise<void>;
  onChatSend: (text: string, modelOverrides?: GenerateRequest["modelOverrides"], requestContext?: Record<string, unknown>) => Promise<void>;
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
  onAgentValuesChange: (values: AgentValues) => void;
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
  promptPreview: string;
  agentValues: AgentValues;
  toolState: GenerateRequest["toolState"];
};

export function WorkspaceView({
  activeAgent,
  activeView,
  collaborationMessages,
  generation,
  isChatSending,
  canvasNodes,
  canvasEdges,
  canvasObjects,
  canvasWriteRequests,
  canvasWorkflow,
  canvasWorkflowSuggestions,
  selectedCanvasNodeId,
  canUndoCanvas,
  toolEvents,
  projectTitle,
  onApproveCanvasWriteRequest,
  onAcceptCanvasWorkflowSuggestion,
  onChatSend,
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
  onAgentValuesChange,
  onProjectTitleChange,
  onApplyCanvasWriteFromMessage,
  onRejectCanvasWriteRequest,
  onRequestCanvasRangeRewrite,
  onSelectCanvasNode,
  onToolStateChange,
  onUpdateCanvasNode,
  onUpdateCanvasObject,
  onUploadCanvasAsset,
  onUpdateCanvasNodeWorkflow,
  onUpdateCanvasWorkflow,
  onUndoCanvas,
  promptPreview,
  agentValues,
  toolState
}: WorkspaceViewProps) {
  const { locale, t } = useI18n();
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [rightDrawerWidth, setRightDrawerWidth] = useState(RIGHT_DRAWER_MIN_WIDTH);
  const [composerDraft, setComposerDraft] = useState("");
  const [mindChainContext, setMindChainContext] = useState<CanvasMindChainContext | null>(null);
  const [activeCanvasTool, setActiveCanvasTool] = useState<CanvasTool>("select");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveCanvasTool("select");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const providerLabel = generation
    ? generation.usedMock
      ? t("workspace.mockNotice")
      : generation.provider
    : t("workspace.generatedFromPrompt");

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
    <section className="view view-workspace" id="workspace-view" aria-label={`${activeAgent.title[locale]} workspace`}>
      <Topbar
        activeView={activeView}
        contextLabel={`${activeAgent.title[locale]} / Local thread`}
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
          activeAgent={activeAgent}
          agentValues={agentValues}
          collapsed={leftCollapsed}
          labels={{
            clear: t("workspace.clear"),
            coreSettings: t("workspace.coreSettings"),
            customInstruction: t("workspace.customInstruction"),
            outputSpec: t("workspace.outputSpec"),
            projectName: locale === "zh" ? "项目名称" : "Project name",
            projectNamePlaceholder: locale === "zh" ? "输入项目名称" : "Name this project"
          }}
          locale={locale}
          projectTitle={projectTitle}
          onCollapse={() => setLeftCollapsed(true)}
          onExpand={() => setLeftCollapsed(false)}
          onProjectTitleChange={onProjectTitleChange}
          onValuesChange={onAgentValuesChange}
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
          modelOverrides={{
            thinkingMode: activeAgent.settings?.model.thinkingMode,
            reasoningEffort: activeAgent.settings?.model.reasoningEffort
          }}
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
          canvasWriteRequests={canvasWriteRequests}
          collapsed={rightCollapsed}
          isSending={isChatSending}
          inputDraft={composerDraft}
          mindChainContext={mindChainContext}
          messages={collaborationMessages}
          modelSettings={activeAgent.settings?.model}
          onApproveWriteRequest={async (requestId) => { await onApproveCanvasWriteRequest(requestId); }}
          onApplyWriteText={onApplyCanvasWriteFromMessage}
          onRejectWriteRequest={onRejectCanvasWriteRequest}
          onSend={onChatSend}
          onInputDraftConsumed={() => setComposerDraft("")}
          onMindChainContextConsumed={() => setMindChainContext(null)}
          onRemoveMindChainContext={() => setMindChainContext(null)}
          onResizeStart={startRightDrawerResize}
          onToggleCollapsed={() => setRightCollapsed((value) => !value)}
          onToolStateChange={onToolStateChange}
          toolEvents={toolEvents}
          toolState={toolState}
        />
      </WorkspaceLayout>

      <WorkspaceUtilityBar activeTool={activeCanvasTool} onToolChange={setActiveCanvasTool} promptPreview={generation?.prompt ?? promptPreview} />
    </section>
  );
}
