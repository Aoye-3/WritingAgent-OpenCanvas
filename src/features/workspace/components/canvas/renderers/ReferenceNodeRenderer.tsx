import type { CanvasNode } from "../../../../agents/types";
import type { CanvasNodePatch } from "../../../../canvas/canvasClient";
import type { CanvasLocale } from "../types";
import { EditableTextNode } from "./EditableTextNode";

type ReferenceNodeRendererProps = {
  isResizing: boolean;
  locale: CanvasLocale;
  node: CanvasNode;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
};

export function ReferenceNodeRenderer(props: ReferenceNodeRendererProps) {
  return <EditableTextNode {...props} />;
}
