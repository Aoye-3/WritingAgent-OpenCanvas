import type { CanvasNode, CanvasNodeKind, CanvasWriteRequest } from "../agents/types";
import { apiDelete, apiGet, apiPatch, apiPost } from "../../shared/apiClient";

export type CanvasNodeDraft = {
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

export type CanvasWriteRequestDraft = {
  operation: "create" | "replace" | "append";
  targetNodeId?: string;
  nodeKind?: CanvasNodeKind;
  title?: string;
  content: string;
  rationale?: string;
};

export async function fetchCanvas(threadId: string): Promise<{ nodes: CanvasNode[]; writeRequests: CanvasWriteRequest[] }> {
  return apiGet<{ nodes: CanvasNode[]; writeRequests: CanvasWriteRequest[] }>(`/api/threads/${encodeURIComponent(threadId)}/canvas`);
}

export async function createCanvasNode(threadId: string, draft: CanvasNodeDraft): Promise<CanvasNode> {
  const payload = await apiPost<{ node: CanvasNode }>(`/api/threads/${encodeURIComponent(threadId)}/canvas/nodes`, draft);
  return payload.node;
}

export async function createCanvasWriteRequest(threadId: string, draft: CanvasWriteRequestDraft): Promise<CanvasWriteRequest> {
  const payload = await apiPost<{ request: CanvasWriteRequest }>(`/api/threads/${encodeURIComponent(threadId)}/canvas/write-requests`, draft);
  return payload.request;
}

export async function updateCanvasNode(threadId: string, nodeId: string, patch: CanvasNodePatch): Promise<CanvasNode> {
  const payload = await apiPatch<{ node: CanvasNode }>(`/api/threads/${encodeURIComponent(threadId)}/canvas/nodes/${encodeURIComponent(nodeId)}`, patch);
  return payload.node;
}

export async function deleteCanvasNode(threadId: string, nodeId: string): Promise<void> {
  await apiDelete<{ ok: true }>(`/api/threads/${encodeURIComponent(threadId)}/canvas/nodes/${encodeURIComponent(nodeId)}`);
}

export async function approveCanvasWriteRequest(threadId: string, requestId: string): Promise<void> {
  await apiPost(`/api/threads/${encodeURIComponent(threadId)}/canvas/write-requests/${encodeURIComponent(requestId)}/approve`);
}

export async function rejectCanvasWriteRequest(threadId: string, requestId: string): Promise<void> {
  await apiPost(`/api/threads/${encodeURIComponent(threadId)}/canvas/write-requests/${encodeURIComponent(requestId)}/reject`);
}
