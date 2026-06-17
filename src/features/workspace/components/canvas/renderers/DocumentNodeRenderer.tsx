import type { CanvasNode, CanvasWriteRequest } from "../../../../agents/types";
import type { CanvasNodePatch, CanvasRangeRewriteDraft } from "../../../../canvas/canvasClient";
import type { CanvasLocale, CanvasTextSelection } from "../types";
import { CollaborativeDocumentNode } from "./CollaborativeDocumentNode";

type DocumentNodeRendererProps = {
  isSelected: boolean;
  isResizing: boolean;
  locale: CanvasLocale;
  node: CanvasNode;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
  agentCardId?: string;
  modelOverrides?: CanvasRangeRewriteDraft["modelOverrides"];
  pendingRequest?: CanvasWriteRequest;
  onApproveWriteRequest: (requestId: string) => Promise<{ request: CanvasWriteRequest; node?: CanvasNode }>;
  onRejectWriteRequest: (requestId: string) => Promise<unknown>;
  onRequestRangeRewrite: (draft: CanvasRangeRewriteDraft) => Promise<CanvasWriteRequest>;
  onTextSelectionChange: (selection?: CanvasTextSelection) => void;
};

export function DocumentNodeRenderer(props: DocumentNodeRendererProps) {
  return <CollaborativeDocumentNode {...props} />;
}
