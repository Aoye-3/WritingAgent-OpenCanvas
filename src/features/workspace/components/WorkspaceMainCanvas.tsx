import type { CanvasEdge, CanvasNode, CanvasNodeKind, CanvasObject, CanvasWorkflow, CanvasWorkflowSuggestion } from "../../agents/types";
import type { CanvasEdgeDraft, CanvasNodeDraft, CanvasNodePatch, CanvasObjectDraft, CanvasObjectPatch } from "../../canvas/canvasClient";
import { DocumentCanvas } from "./DocumentCanvas";
import type { CanvasTool } from "./canvas/toolState";

type WorkspaceMainCanvasProps = {
  activeTool: CanvasTool;
  canUndo: boolean;
  edges: CanvasEdge[];
  nodes: CanvasNode[];
  objects: CanvasObject[];
  providerLabel: string;
  workflow?: CanvasWorkflow;
  suggestions: CanvasWorkflowSuggestion[];
  selectedNodeId?: string;
  onAcceptSuggestion: (suggestionId: string) => Promise<void>;
  onConvertSuggestionToNode: (suggestionId: string, kind?: CanvasNodeKind) => Promise<void>;
  onCreateEdge: (draft: CanvasEdgeDraft) => Promise<CanvasEdge | undefined>;
  onCreateNode: (draft: CanvasNodeDraft) => Promise<unknown>;
  onCreateObject: (draft: CanvasObjectDraft) => Promise<unknown>;
  onDeleteEdge: (edgeId: string) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onDeleteObject: (objectId: string) => Promise<void>;
  onIgnoreSuggestion: (suggestionId: string) => Promise<void>;
  onSendMindChainToChat: (text: string) => void;
  onSelectNode: (nodeId?: string) => void;
  onUndo: () => Promise<void>;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
  onUpdateObject: (objectId: string, patch: CanvasObjectPatch) => Promise<unknown>;
  onUploadAsset: (input: { fileName: string; fileBase64: string }) => Promise<unknown>;
  onUpdateNodeWorkflow: (nodeId: string, patch: { stage?: CanvasWorkflow["stage"]; roles?: string[] }) => Promise<unknown>;
  onUpdateWorkflow: (patch: { stage?: CanvasWorkflow["stage"]; roles?: CanvasWorkflow["roles"] }) => Promise<unknown>;
  onToolChange: (tool: CanvasTool) => void;
};

export function WorkspaceMainCanvas(props: WorkspaceMainCanvasProps) {
  return (
    <main className="output-area canvas-output-area" aria-label="Document canvas">
      <DocumentCanvas
        activeTool={props.activeTool}
        canUndo={props.canUndo}
        edges={props.edges}
        nodes={props.nodes}
        objects={props.objects}
        providerLabel={props.providerLabel}
        workflow={props.workflow}
        suggestions={props.suggestions}
        selectedNodeId={props.selectedNodeId}
        onAcceptSuggestion={props.onAcceptSuggestion}
        onConvertSuggestionToNode={props.onConvertSuggestionToNode}
        onCreateEdge={props.onCreateEdge}
        onCreateNode={props.onCreateNode}
        onCreateObject={props.onCreateObject}
        onDeleteEdge={props.onDeleteEdge}
        onDeleteNode={props.onDeleteNode}
        onDeleteObject={props.onDeleteObject}
        onIgnoreSuggestion={props.onIgnoreSuggestion}
        onSendMindChainToChat={props.onSendMindChainToChat}
        onSelectNode={props.onSelectNode}
        onUndo={props.onUndo}
        onUpdateNode={props.onUpdateNode}
        onUpdateObject={props.onUpdateObject}
        onUploadAsset={props.onUploadAsset}
        onUpdateNodeWorkflow={props.onUpdateNodeWorkflow}
        onUpdateWorkflow={props.onUpdateWorkflow}
        onToolChange={props.onToolChange}
      />
    </main>
  );
}
