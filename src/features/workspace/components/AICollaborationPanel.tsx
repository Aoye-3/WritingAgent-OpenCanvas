import type { PointerEvent as ReactPointerEvent } from "react";
import type { AgentCard, CanvasWriteRequest, StoredThread, StoredToolEvent } from "../../agents/types";
import type { AgentSettings } from "../../agents/types";
import type { CollaborationMessage, GenerateRequest } from "../../generation/types";
import type { CanvasMindChainContext } from "../../../../shared/canvasMindChain";
import { AICollaborationDrawer } from "./AICollaborationDrawer";

type AICollaborationPanelProps = {
  allowedTools: string[];
  activeAgent: AgentCard;
  agentCards: AgentCard[];
  canvasWriteRequests: CanvasWriteRequest[];
  collapsed: boolean;
  inputDraft: string;
  mindChainContext: CanvasMindChainContext | null;
  isSending: boolean;
  messages: CollaborationMessage[];
  projectThreads: StoredThread[];
  currentThreadId: string;
  sessionBusy: boolean;
  sessionError: string;
  modelSettings?: AgentSettings["model"];
  onApproveWriteRequest: (requestId: string) => Promise<void>;
  onCreateConversation: () => Promise<void>;
  onApplyWriteText: (text: string) => Promise<void>;
  onRejectWriteRequest: (requestId: string) => Promise<void>;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSend: (text: string, modelOverrides?: GenerateRequest["modelOverrides"], requestContext?: Record<string, unknown>) => Promise<void>;
  onSelectAgent: (agentCardId: string) => void;
  onSelectThread: (threadId: string) => Promise<void>;
  onInputDraftConsumed: () => void;
  onMindChainContextConsumed: () => void;
  onRemoveMindChainContext: () => void;
  onToggleCollapsed: () => void;
  onToolStateChange: (toolState: GenerateRequest["toolState"]) => void;
  toolEvents: StoredToolEvent[];
  toolState: GenerateRequest["toolState"];
};

export function AICollaborationPanel(props: AICollaborationPanelProps) {
  return <AICollaborationDrawer {...props} />;
}
