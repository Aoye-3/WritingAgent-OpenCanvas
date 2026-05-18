import type { CanvasNode } from "../../agents/types";
import type { CanvasNodeDraft, CanvasNodePatch } from "../../canvas/canvasClient";
import { DocumentCanvas } from "./DocumentCanvas";

type WorkspaceMainCanvasProps = {
  nodes: CanvasNode[];
  providerLabel: string;
  selectedNodeId?: string;
  onCreateNode: (draft: CanvasNodeDraft) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onSelectNode: (nodeId?: string) => void;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<void>;
};

export function WorkspaceMainCanvas(props: WorkspaceMainCanvasProps) {
  return (
    <main className="output-area canvas-output-area" aria-label="Document canvas">
      <DocumentCanvas
        nodes={props.nodes}
        providerLabel={props.providerLabel}
        selectedNodeId={props.selectedNodeId}
        onCreateNode={props.onCreateNode}
        onDeleteNode={props.onDeleteNode}
        onSelectNode={props.onSelectNode}
        onUpdateNode={props.onUpdateNode}
      />
    </main>
  );
}
