import type { CanvasEdge, CanvasNode, CanvasNodeKind, CanvasObject, CanvasObjectKind, CanvasWorkflow, CanvasWorkflowRole, CanvasWorkflowStage, CanvasWorkflowSuggestion, CanvasWriteRequest } from "../agents/types";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../../shared/apiClient";

export type CanvasNodeDraft = {
  id?: string;
  kind: CanvasNodeKind;
  title?: string;
  content?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  metadata?: unknown;
};

export type CanvasNodePatch = Partial<CanvasNodeDraft>;

export type CanvasWorkflowPatch = {
  stage?: CanvasWorkflowStage;
  roles?: CanvasWorkflowRole[];
};

export type CanvasNodeWorkflowPatch = {
  stage?: CanvasWorkflowStage;
  roles?: string[];
};

export type CanvasWriteRequestDraft = {
  operation: "create" | "replace" | "append";
  targetNodeId?: string;
  nodeKind?: CanvasNodeKind;
  title?: string;
  content: string;
  rationale?: string;
};

export type CanvasEdgeDraft = {
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
};

export type CanvasObjectDraft = { id?: string; kind: CanvasObjectKind; geometry?: Record<string, unknown>; data?: Record<string, unknown> };
export type CanvasObjectPatch = Partial<Omit<CanvasObjectDraft, "id">>;

export async function fetchCanvas(threadId: string): Promise<{ nodes: CanvasNode[]; edges: CanvasEdge[]; objects: CanvasObject[]; writeRequests: CanvasWriteRequest[]; workflow: CanvasWorkflow; suggestions: CanvasWorkflowSuggestion[] }> {
  return apiGet<{ nodes: CanvasNode[]; edges: CanvasEdge[]; objects: CanvasObject[]; writeRequests: CanvasWriteRequest[]; workflow: CanvasWorkflow; suggestions: CanvasWorkflowSuggestion[] }>(`/api/threads/${encodeURIComponent(threadId)}/canvas`);
}

export async function createCanvasNode(threadId: string, draft: CanvasNodeDraft): Promise<CanvasNode> {
  const payload = await apiPost<{ node: CanvasNode }>(`/api/threads/${encodeURIComponent(threadId)}/canvas/nodes`, draft);
  return payload.node;
}

export async function createCanvasWriteRequest(threadId: string, draft: CanvasWriteRequestDraft): Promise<CanvasWriteRequest> {
  const payload = await apiPost<{ request: CanvasWriteRequest }>(`/api/threads/${encodeURIComponent(threadId)}/canvas/write-requests`, draft);
  return payload.request;
}

export async function createCanvasEdge(threadId: string, draft: CanvasEdgeDraft): Promise<CanvasEdge> {
  const payload = await apiPost<{ edge: CanvasEdge }>(`/api/threads/${encodeURIComponent(threadId)}/canvas/edges`, draft);
  return payload.edge;
}

export async function updateCanvasNode(threadId: string, nodeId: string, patch: CanvasNodePatch): Promise<CanvasNode> {
  const payload = await apiPatch<{ node: CanvasNode }>(`/api/threads/${encodeURIComponent(threadId)}/canvas/nodes/${encodeURIComponent(nodeId)}`, patch);
  return payload.node;
}

export async function updateCanvasWorkflow(threadId: string, patch: CanvasWorkflowPatch): Promise<CanvasWorkflow> {
  const payload = await apiPut<{ workflow: CanvasWorkflow }>(`/api/threads/${encodeURIComponent(threadId)}/canvas/workflow`, patch);
  return payload.workflow;
}

export async function updateCanvasNodeWorkflow(threadId: string, nodeId: string, patch: CanvasNodeWorkflowPatch): Promise<CanvasNode> {
  const payload = await apiPatch<{ node: CanvasNode }>(`/api/threads/${encodeURIComponent(threadId)}/canvas/nodes/${encodeURIComponent(nodeId)}/workflow`, patch);
  return payload.node;
}

export async function acceptCanvasWorkflowSuggestion(threadId: string, suggestionId: string): Promise<CanvasWorkflowSuggestion> {
  const payload = await apiPost<{ suggestion: CanvasWorkflowSuggestion }>(`/api/threads/${encodeURIComponent(threadId)}/canvas/suggestions/${encodeURIComponent(suggestionId)}/accept`);
  return payload.suggestion;
}

export async function ignoreCanvasWorkflowSuggestion(threadId: string, suggestionId: string): Promise<CanvasWorkflowSuggestion> {
  const payload = await apiPost<{ suggestion: CanvasWorkflowSuggestion }>(`/api/threads/${encodeURIComponent(threadId)}/canvas/suggestions/${encodeURIComponent(suggestionId)}/ignore`);
  return payload.suggestion;
}

export async function convertCanvasWorkflowSuggestionToNode(threadId: string, suggestionId: string, kind: CanvasNodeKind = "note"): Promise<{ suggestion: CanvasWorkflowSuggestion; node: CanvasNode }> {
  return apiPost<{ suggestion: CanvasWorkflowSuggestion; node: CanvasNode }>(`/api/threads/${encodeURIComponent(threadId)}/canvas/suggestions/${encodeURIComponent(suggestionId)}/convert-to-node`, { kind });
}

export async function deleteCanvasNode(threadId: string, nodeId: string): Promise<void> {
  await apiDelete<{ ok: true }>(`/api/threads/${encodeURIComponent(threadId)}/canvas/nodes/${encodeURIComponent(nodeId)}`);
}

export async function deleteCanvasEdge(threadId: string, edgeId: string): Promise<void> {
  await apiDelete<{ ok: true }>(`/api/threads/${encodeURIComponent(threadId)}/canvas/edges/${encodeURIComponent(edgeId)}`);
}

export async function createCanvasObject(threadId: string, draft: CanvasObjectDraft): Promise<CanvasObject> {
  const payload = await apiPost<{ object: CanvasObject }>(`/api/threads/${encodeURIComponent(threadId)}/canvas/objects`, draft);
  return payload.object;
}

export async function updateCanvasObject(threadId: string, objectId: string, patch: CanvasObjectPatch): Promise<CanvasObject> {
  const payload = await apiPatch<{ object: CanvasObject }>(`/api/threads/${encodeURIComponent(threadId)}/canvas/objects/${encodeURIComponent(objectId)}`, patch);
  return payload.object;
}

export async function deleteCanvasObject(threadId: string, objectId: string): Promise<void> {
  await apiDelete<{ ok: true }>(`/api/threads/${encodeURIComponent(threadId)}/canvas/objects/${encodeURIComponent(objectId)}`);
}

export async function uploadCanvasAsset(threadId: string, input: { fileName: string; fileBase64: string }): Promise<CanvasObject> {
  const payload = await apiPost<{ object: CanvasObject }>(`/api/threads/${encodeURIComponent(threadId)}/canvas/assets`, input);
  return payload.object;
}

export async function approveCanvasWriteRequest(threadId: string, requestId: string): Promise<void> {
  await apiPost(`/api/threads/${encodeURIComponent(threadId)}/canvas/write-requests/${encodeURIComponent(requestId)}/approve`);
}

export async function rejectCanvasWriteRequest(threadId: string, requestId: string): Promise<void> {
  await apiPost(`/api/threads/${encodeURIComponent(threadId)}/canvas/write-requests/${encodeURIComponent(requestId)}/reject`);
}
