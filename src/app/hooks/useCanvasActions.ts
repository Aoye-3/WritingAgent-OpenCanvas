import type { Dispatch, SetStateAction } from "react";
import type { CanvasEdge, CanvasNode, CanvasNodeKind, CanvasWriteRequest } from "../../features/agents/types";
import {
  approveCanvasWriteRequest,
  createCanvasEdge,
  createCanvasNode,
  createCanvasWriteRequest,
  deleteCanvasEdge,
  deleteCanvasNode,
  rejectCanvasWriteRequest,
  updateCanvasNode,
  type CanvasEdgeDraft,
  type CanvasNodeDraft,
  type CanvasNodePatch,
  type CanvasWriteRequestDraft
} from "../../features/canvas/canvasClient";
import { createInverseCanvasNodePatch, type CanvasHistoryEntry } from "../../../shared/canvasHistory";

type UseCanvasActionsOptions = {
  canvasEdges: CanvasEdge[];
  canvasNodes: CanvasNode[];
  ensureThreadId: () => Promise<string>;
  onRefreshProjectSurfaces: () => Promise<void>;
  onRefreshCanvas: (threadId: string) => Promise<void>;
  popHistory: () => CanvasHistoryEntry | undefined;
  pushHistory: (entry: CanvasHistoryEntry) => void;
  setCanvasEdges: Dispatch<SetStateAction<CanvasEdge[]>>;
  setCanvasNodes: Dispatch<SetStateAction<CanvasNode[]>>;
  setCanvasWriteRequests: Dispatch<SetStateAction<CanvasWriteRequest[]>>;
  setSelectedCanvasNodeId: Dispatch<SetStateAction<string | undefined>>;
};

type HistoryOptions = { recordHistory?: boolean };

export function useCanvasActions({
  canvasEdges,
  canvasNodes,
  ensureThreadId,
  onRefreshCanvas,
  onRefreshProjectSurfaces,
  popHistory,
  pushHistory,
  setCanvasEdges,
  setCanvasNodes,
  setCanvasWriteRequests,
  setSelectedCanvasNodeId
}: UseCanvasActionsOptions) {
  const handleCreateCanvasNode = async (draft: CanvasNodeDraft, options: HistoryOptions = {}) => {
    const threadId = await ensureThreadId();
    const node = await createCanvasNode(threadId, draft);
    setCanvasNodes((current) => [...current, node]);
    setSelectedCanvasNodeId(node.id);
    if (options.recordHistory !== false) pushHistory({ kind: "deleteNode", nodeId: node.id });
    await onRefreshProjectSurfaces();
    return node;
  };

  const handleCreateCanvasWriteRequest = async (draft: CanvasWriteRequestDraft) => {
    const threadId = await ensureThreadId();
    const request = await createCanvasWriteRequest(threadId, draft);
    setCanvasWriteRequests((current) => [request, ...current]);
    await onRefreshProjectSurfaces();
    return request;
  };

  const handleUpdateCanvasNode = async (nodeId: string, patch: CanvasNodePatch, options: HistoryOptions = {}) => {
    const threadId = await ensureThreadId();
    const previous = canvasNodes.find((node) => node.id === nodeId);
    const node = await updateCanvasNode(threadId, nodeId, patch);
    setCanvasNodes((current) => current.map((item) => item.id === node.id ? node : item));
    if (previous && options.recordHistory !== false) {
      pushHistory({ kind: "updateNode", nodeId, patch: createInverseCanvasNodePatch(previous, patch) });
    }
    await onRefreshProjectSurfaces();
    return node;
  };

  const handleDeleteCanvasNode = async (nodeId: string, options: HistoryOptions = {}) => {
    const threadId = await ensureThreadId();
    const previous = canvasNodes.find((node) => node.id === nodeId);
    const attachedEdges = canvasEdges.filter((edge) => edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId);
    await deleteCanvasNode(threadId, nodeId);
    setCanvasNodes((current) => current.filter((node) => node.id !== nodeId));
    setCanvasEdges((current) => current.filter((edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId));
    setSelectedCanvasNodeId((current) => current === nodeId ? undefined : current);
    if (previous && options.recordHistory !== false) pushHistory({ kind: "restoreNode", node: previous, edges: attachedEdges });
    await onRefreshProjectSurfaces();
  };

  const handleCreateCanvasEdge = async (draft: CanvasEdgeDraft, options: HistoryOptions = {}) => {
    const threadId = await ensureThreadId();
    const existing = canvasEdges.find((edge) => edge.sourceNodeId === draft.sourceNodeId && edge.targetNodeId === draft.targetNodeId);
    if (existing) return existing;
    const edge = await createCanvasEdge(threadId, draft);
    setCanvasEdges((current) => [...current, edge]);
    if (options.recordHistory !== false) pushHistory({ kind: "deleteEdge", edgeId: edge.id });
    await onRefreshProjectSurfaces();
    return edge;
  };

  const handleDeleteCanvasEdge = async (edgeId: string, options: HistoryOptions = {}) => {
    const threadId = await ensureThreadId();
    const previous = canvasEdges.find((edge) => edge.id === edgeId);
    await deleteCanvasEdge(threadId, edgeId);
    setCanvasEdges((current) => current.filter((edge) => edge.id !== edgeId));
    if (previous && options.recordHistory !== false) pushHistory({ kind: "restoreEdge", edge: previous });
    await onRefreshProjectSurfaces();
  };

  const handleConvertCanvasNode = async (nodeId: string, kind: CanvasNodeKind) => {
    return handleUpdateCanvasNode(nodeId, { kind });
  };

  const undoCanvas = async () => {
    const entry = popHistory();
    if (!entry) return;
    if (entry.kind === "deleteNode") {
      await handleDeleteCanvasNode(entry.nodeId, { recordHistory: false });
    } else if (entry.kind === "restoreNode") {
      await handleCreateCanvasNode({
        id: entry.node.id,
        kind: entry.node.kind,
        title: entry.node.title,
        content: entry.node.content,
        x: entry.node.x,
        y: entry.node.y,
        width: entry.node.width,
        height: entry.node.height,
        metadata: entry.node.metadata
      }, { recordHistory: false });
      for (const edge of entry.edges) {
        await handleCreateCanvasEdge({ sourceNodeId: edge.sourceNodeId, targetNodeId: edge.targetNodeId, label: edge.label }, { recordHistory: false });
      }
    } else if (entry.kind === "updateNode") {
      await handleUpdateCanvasNode(entry.nodeId, entry.patch, { recordHistory: false });
    } else if (entry.kind === "deleteEdge") {
      await handleDeleteCanvasEdge(entry.edgeId, { recordHistory: false });
    } else {
      await handleCreateCanvasEdge({ sourceNodeId: entry.edge.sourceNodeId, targetNodeId: entry.edge.targetNodeId, label: entry.edge.label }, { recordHistory: false });
    }
  };

  const handleApproveCanvasWriteRequest = async (requestId: string) => {
    const threadId = await ensureThreadId();
    await approveCanvasWriteRequest(threadId, requestId);
    await onRefreshCanvas(threadId);
    await onRefreshProjectSurfaces();
  };

  const handleRejectCanvasWriteRequest = async (requestId: string) => {
    const threadId = await ensureThreadId();
    await rejectCanvasWriteRequest(threadId, requestId);
    await onRefreshCanvas(threadId);
    await onRefreshProjectSurfaces();
  };

  return {
    handleApproveCanvasWriteRequest,
    handleConvertCanvasNode,
    handleCreateCanvasEdge,
    handleCreateCanvasNode,
    handleCreateCanvasWriteRequest,
    handleDeleteCanvasEdge,
    handleDeleteCanvasNode,
    handleRejectCanvasWriteRequest,
    handleUpdateCanvasNode,
    undoCanvas
  };
}
