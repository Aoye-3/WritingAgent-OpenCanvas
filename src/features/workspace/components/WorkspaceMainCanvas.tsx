import type { ReactNode } from "react";
import type { CanvasEdge, CanvasNode, CanvasNodeKind, CanvasObject, CanvasWorkflow, CanvasWorkflowSuggestion, CanvasWriteRequest } from "../../agents/types";
import type { CanvasEdgeDraft, CanvasNodeDraft, CanvasNodePatch, CanvasNodePositionUpdate, CanvasObjectDraft, CanvasObjectPatch, CanvasRangeRewriteDraft } from "../../canvas/canvasClient";
import { DocumentCanvas } from "./DocumentCanvas";
import type { CanvasTool } from "./canvas/toolState";
import type { CanvasClipboardPayload } from "../../../../shared/canvasClipboard";
import type { CanvasMindChainContext } from "../../../../shared/canvasMindChain";
import type { ClaimCandidate, CreateClaimFromSelectionInput } from "../../../../shared/claimReview";
import type { ClaimReviewDocument } from "../claims/useClaimReview";

type WorkspaceMainCanvasProps = {
  activeTool: CanvasTool;
  canUndo: boolean;
  threadId: string;
  edges: CanvasEdge[];
  nodes: CanvasNode[];
  objects: CanvasObject[];
  providerLabel: string;
  workflow?: CanvasWorkflow;
  suggestions: CanvasWorkflowSuggestion[];
  selectedNodeId?: string;
  writeRequests: CanvasWriteRequest[];
  agentCardId?: string;
  modelOverrides?: CanvasRangeRewriteDraft["modelOverrides"];
  onAcceptSuggestion: (suggestionId: string) => Promise<void>;
  onConvertSuggestionToNode: (suggestionId: string, kind?: CanvasNodeKind) => Promise<void>;
  onCreateEdge: (draft: CanvasEdgeDraft) => Promise<CanvasEdge | undefined>;
  onCreateNode: (draft: CanvasNodeDraft) => Promise<unknown>;
  onCreateObject: (draft: CanvasObjectDraft) => Promise<unknown>;
  onDeleteEdge: (edgeId: string) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onDeleteObject: (objectId: string) => Promise<void>;
  onPaste: (payload: CanvasClipboardPayload, center: { x: number; y: number }) => Promise<void>;
  onConvertText: (objectId: string, kind: Extract<CanvasNodeKind, "document" | "reference" | "note">) => Promise<void>;
  onIgnoreSuggestion: (suggestionId: string) => Promise<void>;
  onAttachMindChain: (context: CanvasMindChainContext) => void;
  onSendMindChainToChat: (text: string) => void;
  onSelectNode: (nodeId?: string) => void;
  onUndo: () => Promise<void>;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
  onUpdateNodePositions: (updates: CanvasNodePositionUpdate[]) => Promise<unknown>;
  onRequestRangeRewrite: (draft: CanvasRangeRewriteDraft) => Promise<CanvasWriteRequest>;
  onApproveWriteRequest: (requestId: string) => Promise<{ request: CanvasWriteRequest; node?: CanvasNode }>;
  onRejectWriteRequest: (requestId: string) => Promise<unknown>;
  onUpdateObject: (objectId: string, patch: CanvasObjectPatch) => Promise<unknown>;
  onUploadAsset: (input: { fileName: string; fileBase64: string }) => Promise<unknown>;
  onUpdateNodeWorkflow: (nodeId: string, patch: { stage?: CanvasWorkflow["stage"]; roles?: string[] }) => Promise<unknown>;
  onUpdateWorkflow: (patch: { mode?: CanvasWorkflow["mode"]; stage?: CanvasWorkflow["stage"]; roles?: CanvasWorkflow["roles"] }) => Promise<unknown>;
  onToolChange: (tool: CanvasTool) => void;
  claimSourceFocus?: ClaimCandidate | null;
  onClaimDocumentPreviewChange?: (document: ClaimReviewDocument | null) => void;
  onCreateClaimFromSelection?: (input: Omit<CreateClaimFromSelectionInput, "sourceNodeId" | "sourceDocumentPath" | "sourceFileName">) => Promise<unknown>;
  onExtractClaims?: () => Promise<unknown>;
  claimPanel?: ReactNode;
};

export function WorkspaceMainCanvas(props: WorkspaceMainCanvasProps) {
  return (
    <main className="output-area canvas-output-area" aria-label="Document canvas">
      <DocumentCanvas
        activeTool={props.activeTool}
        canUndo={props.canUndo}
        threadId={props.threadId}
        edges={props.edges}
        nodes={props.nodes}
        objects={props.objects}
        providerLabel={props.providerLabel}
        workflow={props.workflow}
        suggestions={props.suggestions}
        selectedNodeId={props.selectedNodeId}
        writeRequests={props.writeRequests}
        agentCardId={props.agentCardId}
        modelOverrides={props.modelOverrides}
        onAcceptSuggestion={props.onAcceptSuggestion}
        onConvertSuggestionToNode={props.onConvertSuggestionToNode}
        onCreateEdge={props.onCreateEdge}
        onCreateNode={props.onCreateNode}
        onCreateObject={props.onCreateObject}
        onDeleteEdge={props.onDeleteEdge}
        onDeleteNode={props.onDeleteNode}
        onDeleteObject={props.onDeleteObject}
        onPaste={props.onPaste}
        onConvertText={props.onConvertText}
        onIgnoreSuggestion={props.onIgnoreSuggestion}
        onAttachMindChain={props.onAttachMindChain}
        onSendMindChainToChat={props.onSendMindChainToChat}
        onSelectNode={props.onSelectNode}
        onUndo={props.onUndo}
        onUpdateNode={props.onUpdateNode}
        onUpdateNodePositions={props.onUpdateNodePositions}
        onRequestRangeRewrite={props.onRequestRangeRewrite}
        onApproveWriteRequest={props.onApproveWriteRequest}
        onRejectWriteRequest={props.onRejectWriteRequest}
        onUpdateObject={props.onUpdateObject}
        onUploadAsset={props.onUploadAsset}
        onUpdateNodeWorkflow={props.onUpdateNodeWorkflow}
        onUpdateWorkflow={props.onUpdateWorkflow}
        onToolChange={props.onToolChange}
        claimSourceFocus={props.claimSourceFocus}
        onClaimDocumentPreviewChange={props.onClaimDocumentPreviewChange}
        onCreateClaimFromSelection={props.onCreateClaimFromSelection}
        onExtractClaims={props.onExtractClaims}
        claimPanel={props.claimPanel}
      />
    </main>
  );
}
