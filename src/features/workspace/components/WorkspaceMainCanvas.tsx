import type { CanvasEdge, CanvasNode } from "../../agents/types";
import type { CanvasEdgeDraft, CanvasNodeDraft, CanvasNodePatch } from "../../canvas/canvasClient";
import { DocumentCanvas } from "./DocumentCanvas";

type WorkspaceMainCanvasProps = {
  canUndo: boolean;
  edges: CanvasEdge[];
  nodes: CanvasNode[];
  providerLabel: string;
  selectedNodeId?: string;
  onCreateEdge: (draft: CanvasEdgeDraft) => Promise<CanvasEdge | undefined>;
  onCreateNode: (draft: CanvasNodeDraft) => Promise<unknown>;
  onDeleteEdge: (edgeId: string) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onSendMindChainToChat: (text: string) => void;
  onSelectNode: (nodeId?: string) => void;
  onUndo: () => Promise<void>;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
};

export function WorkspaceMainCanvas(props: WorkspaceMainCanvasProps) {
  return (
    <main className="output-area canvas-output-area" aria-label="Document canvas">
      <DocumentCanvas
        canUndo={props.canUndo}
        edges={props.edges}
        nodes={props.nodes}
        providerLabel={props.providerLabel}
        selectedNodeId={props.selectedNodeId}
        onCreateEdge={props.onCreateEdge}
        onCreateNode={props.onCreateNode}
        onDeleteEdge={props.onDeleteEdge}
        onDeleteNode={props.onDeleteNode}
        onSendMindChainToChat={props.onSendMindChainToChat}
        onSelectNode={props.onSelectNode}
        onUndo={props.onUndo}
        onUpdateNode={props.onUpdateNode}
      />
    </main>
  );
}
