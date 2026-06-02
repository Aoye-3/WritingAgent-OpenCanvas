import { useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { AppView } from "../../app/App";
import { Topbar } from "../../shared/Topbar";
import type { AgentCard, AgentValues, CanvasEdge, CanvasNode, CanvasNodeKind, CanvasWorkflow, CanvasWorkflowSuggestion, CanvasWriteRequest, StoredOutputVersion, StoredToolEvent } from "../agents/types";
import type { CanvasEdgeDraft, CanvasNodeDraft, CanvasNodePatch } from "../canvas/canvasClient";
import type { CollaborationMessage, GenerateRequest, GenerateResponse } from "../generation/types";
import { useI18n } from "../i18n/I18nProvider";
import { AgentInputDrawer } from "./components/AgentInputDrawer";
import { AICollaborationPanel } from "./components/AICollaborationPanel";
import { WorkspaceLayout } from "./components/WorkspaceLayout";
import { WorkspaceMainCanvas } from "./components/WorkspaceMainCanvas";
import { WorkspaceUtilityBar } from "./components/WorkspaceUtilityBar";

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
  canvasWriteRequests: CanvasWriteRequest[];
  canvasWorkflow?: CanvasWorkflow;
  canvasWorkflowSuggestions: CanvasWorkflowSuggestion[];
  selectedCanvasNodeId?: string;
  canUndoCanvas: boolean;
  toolEvents: StoredToolEvent[];
  projectTitle: string;
  onApproveCanvasWriteRequest: (requestId: string) => Promise<void>;
  onAcceptCanvasWorkflowSuggestion: (suggestionId: string) => Promise<void>;
  onChatSend: (text: string, modelOverrides?: GenerateRequest["modelOverrides"]) => Promise<void>;
  onConvertCanvasWorkflowSuggestionToNode: (suggestionId: string, kind?: CanvasNodeKind) => Promise<void>;
  onCreateCanvasEdge: (draft: CanvasEdgeDraft) => Promise<CanvasEdge | undefined>;
  onCreateCanvasNode: (draft: CanvasNodeDraft) => Promise<unknown>;
  onDeleteCanvasEdge: (edgeId: string) => Promise<void>;
  onDeleteCanvasNode: (nodeId: string) => Promise<void>;
  onIgnoreCanvasWorkflowSuggestion: (suggestionId: string) => Promise<void>;
  onEditableOutputChange: (value: string) => void;
  onGenerate: () => Promise<void>;
  onGoHome: () => void;
  onOpenSettings: () => void;
  onAgentValuesChange: (values: AgentValues) => void;
  onProjectTitleChange: (title: string) => Promise<void>;
  onApplyCanvasWriteFromMessage: (text: string) => Promise<void>;
  onRejectCanvasWriteRequest: (requestId: string) => Promise<void>;
  onRestoreVersion: (version: StoredOutputVersion) => void;
  onSelectCanvasNode: (nodeId?: string) => void;
  onToolStateChange: (toolState: GenerateRequest["toolState"]) => void;
  onUpdateCanvasNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
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
  onDeleteCanvasEdge,
  onDeleteCanvasNode,
  onIgnoreCanvasWorkflowSuggestion,
  onGoHome,
  onOpenSettings,
  onAgentValuesChange,
  onProjectTitleChange,
  onApplyCanvasWriteFromMessage,
  onRejectCanvasWriteRequest,
  onSelectCanvasNode,
  onToolStateChange,
  onUpdateCanvasNode,
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
          canUndo={canUndoCanvas}
          edges={canvasEdges}
          nodes={canvasNodes}
          providerLabel={providerLabel}
          workflow={canvasWorkflow}
          suggestions={canvasWorkflowSuggestions}
          selectedNodeId={selectedCanvasNodeId}
          onAcceptSuggestion={onAcceptCanvasWorkflowSuggestion}
          onConvertSuggestionToNode={onConvertCanvasWorkflowSuggestionToNode}
          onCreateEdge={onCreateCanvasEdge}
          onCreateNode={onCreateCanvasNode}
          onDeleteEdge={onDeleteCanvasEdge}
          onDeleteNode={onDeleteCanvasNode}
          onIgnoreSuggestion={onIgnoreCanvasWorkflowSuggestion}
          onSendMindChainToChat={setComposerDraft}
          onSelectNode={onSelectCanvasNode}
          onUndo={onUndoCanvas}
          onUpdateNode={onUpdateCanvasNode}
          onUpdateNodeWorkflow={onUpdateCanvasNodeWorkflow}
          onUpdateWorkflow={onUpdateCanvasWorkflow}
        />

        <AICollaborationPanel
          allowedTools={activeAgent.toolRefs}
          canvasWriteRequests={canvasWriteRequests}
          collapsed={rightCollapsed}
          isSending={isChatSending}
          inputDraft={composerDraft}
          messages={collaborationMessages}
          modelSettings={activeAgent.settings?.model}
          onApproveWriteRequest={onApproveCanvasWriteRequest}
          onApplyWriteText={onApplyCanvasWriteFromMessage}
          onRejectWriteRequest={onRejectCanvasWriteRequest}
          onSend={onChatSend}
          onInputDraftConsumed={() => setComposerDraft("")}
          onResizeStart={startRightDrawerResize}
          onToggleCollapsed={() => setRightCollapsed((value) => !value)}
          onToolStateChange={onToolStateChange}
          toolEvents={toolEvents}
          toolState={toolState}
        />
      </WorkspaceLayout>

      <WorkspaceUtilityBar promptPreview={generation?.prompt ?? promptPreview} />
    </section>
  );
}
