import type { CanvasNode } from "../../../../agents/types";
import type { CanvasNodePatch } from "../../../../canvas/canvasClient";
import type { CanvasLocale, CanvasTextSelection } from "../types";
import { EditableTextNode } from "./EditableTextNode";

type NoteNodeRendererProps = {
  isSelected: boolean;
  isResizing: boolean;
  locale: CanvasLocale;
  node: CanvasNode;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
  onTextSelectionChange: (selection?: CanvasTextSelection) => void;
};

export function NoteNodeRenderer(props: NoteNodeRendererProps) {
  return <EditableTextNode {...props} />;
}
