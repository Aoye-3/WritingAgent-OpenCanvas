import type { CanvasEdge, CanvasNode, CanvasNodeKind, CanvasWorkflow, CanvasWorkflowSuggestion } from "../../agents/types";
import type { CanvasEdgeDraft, CanvasNodeDraft, CanvasNodePatch } from "../../canvas/canvasClient";
import { DocumentCanvas } from "./DocumentCanvas";

type WorkspaceMainCanvasProps = {
  canUndo: boolean;
  edges: CanvasEdge[];
  nodes: CanvasNode[];
  providerLabel: string;
  workflow?: CanvasWorkflow;
  suggestions: CanvasWorkflowSuggestion[];
  selectedNodeId?: string;
  onAcceptSuggestion: (suggestionId: string) => Promise<void>;
  onConvertSuggestionToNode: (suggestionId: string, kind?: CanvasNodeKind) => Promise<void>;
  onCreateEdge: (draft: CanvasEdgeDraft) => Promise<CanvasEdge | undefined>;
  onCreateNode: (draft: CanvasNodeDraft) => Promise<unknown>;
  onDeleteEdge: (edgeId: string) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onIgnoreSuggestion: (suggestionId: string) => Promise<void>;
  onSendMindChainToChat: (text: string) => void;
  onSelectNode: (nodeId?: string) => void;
  onUndo: () => Promise<void>;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
  onUpdateNodeWorkflow: (nodeId: string, patch: { stage?: CanvasWorkflow["stage"]; roles?: string[] }) => Promise<unknown>;
  onUpdateWorkflow: (patch: { stage?: CanvasWorkflow["stage"]; roles?: CanvasWorkflow["roles"] }) => Promise<unknown>;
};

export function WorkspaceMainCanvas(props: WorkspaceMainCanvasProps) {
  return (
    <main className="output-area canvas-output-area" aria-label="Document canvas">
      <DocumentCanvas
        canUndo={props.canUndo}
        edges={props.edges}
        nodes={props.nodes}
        providerLabel={props.providerLabel}
        workflow={props.workflow}
        suggestions={props.suggestions}
        selectedNodeId={props.selectedNodeId}
        onAcceptSuggestion={props.onAcceptSuggestion}
        onConvertSuggestionToNode={props.onConvertSuggestionToNode}
        onCreateEdge={props.onCreateEdge}
        onCreateNode={props.onCreateNode}
        onDeleteEdge={props.onDeleteEdge}
        onDeleteNode={props.onDeleteNode}
        onIgnoreSuggestion={props.onIgnoreSuggestion}
        onSendMindChainToChat={props.onSendMindChainToChat}
        onSelectNode={props.onSelectNode}
        onUndo={props.onUndo}
        onUpdateNode={props.onUpdateNode}
        onUpdateNodeWorkflow={props.onUpdateNodeWorkflow}
        onUpdateWorkflow={props.onUpdateWorkflow}
      />
    </main>
  );
}
