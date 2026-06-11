import type { CanvasNode, CanvasWriteRequest } from "../../../../agents/types";
import type { CanvasNodePatch, CanvasRangeRewriteDraft } from "../../../../canvas/canvasClient";
import { isKnownCanvasKind } from "../nodeLayout";
import type { CanvasLocale } from "../types";
import { DocumentNodeRenderer } from "./DocumentNodeRenderer";
import { FallbackNodeRenderer } from "./FallbackNodeRenderer";
import { NoteNodeRenderer } from "./NoteNodeRenderer";
import { ReferenceNodeRenderer } from "./ReferenceNodeRenderer";
import { RoleNodeRenderer } from "./RoleNodeRenderer";

type CanvasNodeRendererProps = {
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
};

export function CanvasNodeRenderer(props: CanvasNodeRendererProps) {
  if (!isKnownCanvasKind(props.node.kind)) {
    return <FallbackNodeRenderer locale={props.locale} node={props.node} onUpdateNode={props.onUpdateNode} />;
  }

  if (props.node.kind === "document") return <DocumentNodeRenderer {...props} />;
  if (props.node.kind === "note") return <NoteNodeRenderer {...props} />;
  if (props.node.kind === "role") return <RoleNodeRenderer {...props} />;
  return <ReferenceNodeRenderer {...props} />;
}
