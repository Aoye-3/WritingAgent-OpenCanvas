import type { CanvasNode } from "../../../../agents/types";
import type { CanvasNodePatch } from "../../../../canvas/canvasClient";
import { isKnownCanvasKind } from "../nodeLayout";
import type { CanvasLocale } from "../types";
import { DocumentNodeRenderer } from "./DocumentNodeRenderer";
import { FallbackNodeRenderer } from "./FallbackNodeRenderer";
import { NoteNodeRenderer } from "./NoteNodeRenderer";
import { ReferenceNodeRenderer } from "./ReferenceNodeRenderer";

type CanvasNodeRendererProps = {
  isResizing: boolean;
  locale: CanvasLocale;
  node: CanvasNode;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
};

export function CanvasNodeRenderer(props: CanvasNodeRendererProps) {
  if (!isKnownCanvasKind(props.node.kind)) {
    return <FallbackNodeRenderer locale={props.locale} node={props.node} onUpdateNode={props.onUpdateNode} />;
  }

  if (props.node.kind === "document") return <DocumentNodeRenderer {...props} />;
  if (props.node.kind === "note") return <NoteNodeRenderer {...props} />;
  return <ReferenceNodeRenderer {...props} />;
}
