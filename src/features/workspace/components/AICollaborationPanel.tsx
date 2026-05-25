import type { PointerEvent as ReactPointerEvent } from "react";
import type { CanvasWriteRequest, StoredToolEvent } from "../../agents/types";
import type { AgentSettings } from "../../agents/types";
import type { CollaborationMessage, GenerateRequest } from "../../generation/types";
import { AICollaborationDrawer } from "./AICollaborationDrawer";

type AICollaborationPanelProps = {
  allowedTools: string[];
  canvasWriteRequests: CanvasWriteRequest[];
  collapsed: boolean;
  inputDraft: string;
  isSending: boolean;
  messages: CollaborationMessage[];
  modelSettings?: AgentSettings["model"];
  onApproveWriteRequest: (requestId: string) => Promise<void>;
  onApplyWriteText: (text: string) => Promise<void>;
  onRejectWriteRequest: (requestId: string) => Promise<void>;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSend: (text: string, modelOverrides?: GenerateRequest["modelOverrides"]) => Promise<void>;
  onInputDraftConsumed: () => void;
  onToggleCollapsed: () => void;
  onToolStateChange: (toolState: GenerateRequest["toolState"]) => void;
  toolEvents: StoredToolEvent[];
  toolState: GenerateRequest["toolState"];
};

export function AICollaborationPanel(props: AICollaborationPanelProps) {
  return <AICollaborationDrawer {...props} />;
}
