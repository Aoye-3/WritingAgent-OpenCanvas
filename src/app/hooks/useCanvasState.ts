import { useState } from "react";
import type { CanvasNode, CanvasWriteRequest } from "../../features/agents/types";
import {
  approveCanvasWriteRequest,
  createCanvasWriteRequest,
  createCanvasNode,
  deleteCanvasNode,
  fetchCanvas,
  rejectCanvasWriteRequest,
  updateCanvasNode,
  type CanvasNodeDraft,
  type CanvasNodePatch,
  type CanvasWriteRequestDraft
} from "../../features/canvas/canvasClient";

type UseCanvasStateOptions = {
  ensureThreadId: () => Promise<string>;
  onRefreshProjectSurfaces: () => Promise<void>;
};

export function useCanvasState({ ensureThreadId, onRefreshProjectSurfaces }: UseCanvasStateOptions) {
  const [canvasNodes, setCanvasNodes] = useState<CanvasNode[]>([]);
  const [canvasWriteRequests, setCanvasWriteRequests] = useState<CanvasWriteRequest[]>([]);
  const [selectedCanvasNodeId, setSelectedCanvasNodeId] = useState<string | undefined>();

  const resetCanvas = () => {
    setCanvasNodes([]);
    setCanvasWriteRequests([]);
    setSelectedCanvasNodeId(undefined);
  };

  const applyCanvasState = (nodes: CanvasNode[] = [], writeRequests: CanvasWriteRequest[] = []) => {
    setCanvasNodes(nodes);
    setCanvasWriteRequests(writeRequests);
    setSelectedCanvasNodeId(nodes[0]?.id);
  };

  const refreshCanvas = async (threadId: string) => {
    const canvas = await fetchCanvas(threadId);
    setCanvasNodes(canvas.nodes);
    setCanvasWriteRequests(canvas.writeRequests);
    setSelectedCanvasNodeId((current) => current && canvas.nodes.some((node) => node.id === current) ? current : canvas.nodes[0]?.id);
  };

  const handleCreateCanvasNode = async (draft: CanvasNodeDraft) => {
    const threadId = await ensureThreadId();
    const node = await createCanvasNode(threadId, draft);
    setCanvasNodes((current) => [...current, node]);
    setSelectedCanvasNodeId(node.id);
    await onRefreshProjectSurfaces();
  };

  const handleCreateCanvasWriteRequest = async (draft: CanvasWriteRequestDraft) => {
    const threadId = await ensureThreadId();
    const request = await createCanvasWriteRequest(threadId, draft);
    setCanvasWriteRequests((current) => [request, ...current]);
    await onRefreshProjectSurfaces();
    return request;
  };

  const handleUpdateCanvasNode = async (nodeId: string, patch: CanvasNodePatch) => {
    const threadId = await ensureThreadId();
    const node = await updateCanvasNode(threadId, nodeId, patch);
    setCanvasNodes((current) => current.map((item) => item.id === node.id ? node : item));
    await onRefreshProjectSurfaces();
  };

  const handleDeleteCanvasNode = async (nodeId: string) => {
    const threadId = await ensureThreadId();
    await deleteCanvasNode(threadId, nodeId);
    setCanvasNodes((current) => current.filter((node) => node.id !== nodeId));
    setSelectedCanvasNodeId((current) => current === nodeId ? undefined : current);
    await onRefreshProjectSurfaces();
  };

  const handleApproveCanvasWriteRequest = async (requestId: string) => {
    const threadId = await ensureThreadId();
    await approveCanvasWriteRequest(threadId, requestId);
    await refreshCanvas(threadId);
    await onRefreshProjectSurfaces();
  };

  const handleRejectCanvasWriteRequest = async (requestId: string) => {
    const threadId = await ensureThreadId();
    await rejectCanvasWriteRequest(threadId, requestId);
    await refreshCanvas(threadId);
    await onRefreshProjectSurfaces();
  };

  return {
    canvasNodes,
    canvasWriteRequests,
    selectedCanvasNodeId,
    setCanvasNodes,
    setCanvasWriteRequests,
    setSelectedCanvasNodeId,
    resetCanvas,
    applyCanvasState,
    refreshCanvas,
    handleCreateCanvasNode,
    handleCreateCanvasWriteRequest,
    handleUpdateCanvasNode,
    handleDeleteCanvasNode,
    handleApproveCanvasWriteRequest,
    handleRejectCanvasWriteRequest
  };
}
