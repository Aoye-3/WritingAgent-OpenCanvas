import type { CanvasNode } from "../../../../agents/types";
import type { CanvasNodePatch } from "../../../../canvas/canvasClient";
import type { CanvasLocale, CanvasTextSelection } from "../types";
import { EditableTextNode } from "./EditableTextNode";

type ReferenceNodeRendererProps = {
  isSelected: boolean;
  isResizing: boolean;
  locale: CanvasLocale;
  node: CanvasNode;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
  onTextSelectionChange: (selection?: CanvasTextSelection) => void;
};

export function ReferenceNodeRenderer(props: ReferenceNodeRendererProps) {
  return <EditableTextNode {...props} linksEnabled />;
}
