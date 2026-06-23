import type { CanvasNode, CanvasWriteRequest } from "../../../../agents/types";
import type { CanvasNodePatch, CanvasRangeRewriteDraft } from "../../../../canvas/canvasClient";
import { isKnownCanvasKind, readDiagramMetadata } from "../nodeLayout";
import type { CanvasLocale, CanvasTextSelection } from "../types";
import { DocumentNodeRenderer } from "./DocumentNodeRenderer";
import { FallbackNodeRenderer } from "./FallbackNodeRenderer";
import { NoteNodeRenderer } from "./NoteNodeRenderer";
import { ReferenceNodeRenderer } from "./ReferenceNodeRenderer";
import { RoleNodeRenderer } from "./RoleNodeRenderer";
import { PlanNodeRenderer } from "./PlanNodeRenderer";
import { DiagramNodeRenderer } from "./DiagramNodeRenderer";
import { FileDocumentNodeRenderer } from "./FileDocumentNodeRenderer";
import { ClarificationNodeRenderer } from "./ClarificationNodeRenderer";

type CanvasNodeRendererProps = {
  isSelected: boolean;
  isResizing: boolean;
  locale: CanvasLocale;
  node: CanvasNode;
  onOpenDocumentPreview: (node: CanvasNode) => void;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
  agentCardId?: string;
  modelOverrides?: CanvasRangeRewriteDraft["modelOverrides"];
  pendingRequest?: CanvasWriteRequest;
  onApproveWriteRequest: (requestId: string) => Promise<{ request: CanvasWriteRequest; node?: CanvasNode }>;
  onRejectWriteRequest: (requestId: string) => Promise<unknown>;
  onRequestRangeRewrite: (draft: CanvasRangeRewriteDraft) => Promise<CanvasWriteRequest>;
  onTextSelectionChange: (selection?: CanvasTextSelection) => void;
};

export function CanvasNodeRenderer(props: CanvasNodeRendererProps) {
  if (readDiagramMetadata(props.node.metadata)) return <DiagramNodeRenderer {...props} />;

  if (!isKnownCanvasKind(props.node.kind)) {
    return <FallbackNodeRenderer isSelected={props.isSelected} locale={props.locale} node={props.node} onUpdateNode={props.onUpdateNode} />;
  }

  if (props.node.kind === "document") return <DocumentNodeRenderer {...props} />;
  if (props.node.kind === "file_document") return <FileDocumentNodeRenderer locale={props.locale} node={props.node} onOpenDocumentPreview={props.onOpenDocumentPreview} />;
  if (props.node.kind === "clarification") return <ClarificationNodeRenderer locale={props.locale} node={props.node} onUpdateNode={props.onUpdateNode} />;
  if (props.node.kind === "note") return <NoteNodeRenderer {...props} />;
  if (props.node.kind === "role") return <RoleNodeRenderer {...props} />;
  if (props.node.kind === "plan") return <PlanNodeRenderer node={props.node} />;
  return <ReferenceNodeRenderer {...props} />;
}
