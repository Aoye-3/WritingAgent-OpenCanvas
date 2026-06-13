import type { PointerEvent as ReactPointerEvent } from "react";
import type { AgentCard, CanvasWriteRequest, CanvasWriteSuggestion, PlanRun, StoredThread, StoredToolEvent } from "../../agents/types";
import type { CollaborationMessage, GenerateRequest } from "../../generation/types";
import type { CanvasMindChainContext } from "../../../../shared/canvasMindChain";
import { AICollaborationDrawer, type ConversationModelControls } from "./AICollaborationDrawer";
import type { ConfiguredModelApiSummary } from "../../settings/types";

type AICollaborationPanelProps = {
  allowedTools: string[];
  activeAgent: AgentCard;
  agentCards: AgentCard[];
  canvasWriteRequests: CanvasWriteRequest[];
  canvasWriteSuggestions: CanvasWriteSuggestion[];
  collapsed: boolean;
  inputDraft: string;
  mindChainContext: CanvasMindChainContext | null;
  isSending: boolean;
  modelSelectionDisabled: boolean;
  messages: CollaborationMessage[];
  plans: PlanRun[];
  projectThreads: StoredThread[];
  currentThreadId: string;
  sessionBusy: boolean;
  sessionError: string;
  configuredModels: ConfiguredModelApiSummary[];
  selectedModelConfigId?: string | null;
  modelSettings?: ConversationModelControls;
  onApproveWriteRequest: (requestId: string) => Promise<void>;
  onCreateConversation: () => Promise<void>;
  onResetContext: () => Promise<void>;
  onApplyWriteText: (text: string) => Promise<void>;
  onRejectWriteRequest: (requestId: string) => Promise<void>;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSend: (text: string, modelOverrides?: GenerateRequest["modelOverrides"], requestContext?: Record<string, unknown>) => Promise<unknown>;
  onStopSending: () => void;
  onSelectAgent: (agentCardId: string) => void;
  onSelectModel: (configuredModelApiId: string) => Promise<void>;
  onSelectThread: (threadId: string) => Promise<void>;
  onInputDraftConsumed: () => void;
  onMindChainContextConsumed: () => void;
  onRemoveMindChainContext: () => void;
  onToggleCollapsed: () => void;
  onToolStateChange: (toolState: GenerateRequest["toolState"]) => void;
  toolEvents: StoredToolEvent[];
  toolState: GenerateRequest["toolState"];
  onPlansChanged: () => Promise<void>;
  onFocusPlanArtifact: (targetId: string) => void;
};

export function AICollaborationPanel(props: AICollaborationPanelProps) {
  return <AICollaborationDrawer {...props} />;
}
