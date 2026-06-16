import type { Dispatch, SetStateAction } from "react";
import type { CanvasEdge, CanvasNode, CanvasNodeKind, CanvasObject, CanvasWorkflow, CanvasWorkflowSuggestion, CanvasWriteRequest } from "../../features/agents/types";
import {
  acceptCanvasWorkflowSuggestion,
  approveCanvasWriteRequest,
  convertCanvasWorkflowSuggestionToNode,
  createCanvasEdge,
  createCanvasNode,
  createCanvasObject,
  createCanvasWriteRequest,
  deleteCanvasEdge,
  deleteCanvasNode,
  deleteCanvasObject,
  ignoreCanvasWorkflowSuggestion,
  rejectCanvasWriteRequest,
  requestCanvasRangeRewrite,
  updateCanvasNode,
  updateCanvasNodePositions,
  updateCanvasObject,
  updateCanvasNodeWorkflow,
  updateCanvasWorkflow,
  uploadCanvasAsset,
  type CanvasEdgeDraft,
  type CanvasNodeDraft,
  type CanvasNodeWorkflowPatch,
  type CanvasNodePatch,
  type CanvasNodePositionUpdate,
  type CanvasObjectDraft,
  type CanvasObjectPatch,
  type CanvasWorkflowPatch,
  type CanvasWriteRequestDraft
} from "../../features/canvas/canvasClient";
import type { CanvasRangeRewriteDraft } from "../../features/canvas/canvasClient";
import { createInverseCanvasNodePatch, createInverseCanvasObjectPatch, type CanvasHistoryEntry, type CanvasHistoryNode, type CanvasHistoryNodePatch } from "../../../shared/canvasHistory";
import { removeCanvasNodeFromState } from "./canvasActions/state";
import { placeCanvasClipboardPayload, type CanvasClipboardPayload } from "../../../shared/canvasClipboard";
import type { CanvasPoint, CanvasTextObject } from "../../../shared/canvasObjects";

type UseCanvasActionsOptions = {
  canvasEdges: CanvasEdge[];
  canvasNodes: CanvasNode[];
  canvasObjects: CanvasObject[];
  canvasWriteRequests: CanvasWriteRequest[];
  ensureThreadId: () => Promise<string>;
  onRefreshProjectSurfaces: () => Promise<void>;
  onRefreshCanvas: (threadId: string) => Promise<void>;
  popHistory: () => CanvasHistoryEntry | undefined;
  pushHistory: (entry: CanvasHistoryEntry) => void;
  setCanvasEdges: Dispatch<SetStateAction<CanvasEdge[]>>;
  setCanvasNodes: Dispatch<SetStateAction<CanvasNode[]>>;
  setCanvasObjects: Dispatch<SetStateAction<CanvasObject[]>>;
  setCanvasWorkflow: Dispatch<SetStateAction<CanvasWorkflow | undefined>>;
  setCanvasWorkflowSuggestions: Dispatch<SetStateAction<CanvasWorkflowSuggestion[]>>;
  setCanvasWriteRequests: Dispatch<SetStateAction<CanvasWriteRequest[]>>;
  setSelectedCanvasNodeId: Dispatch<SetStateAction<string | undefined>>;
};

type HistoryOptions = { recordHistory?: boolean };

export function useCanvasActions({
  canvasEdges,
  canvasNodes,
  canvasObjects,
  canvasWriteRequests,
  ensureThreadId,
  onRefreshCanvas,
  onRefreshProjectSurfaces,
  popHistory,
  pushHistory,
  setCanvasEdges,
  setCanvasNodes,
  setCanvasObjects,
  setCanvasWorkflow,
  setCanvasWorkflowSuggestions,
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
    if (previous && previous.kind !== "plan" && options.recordHistory !== false) {
      pushHistory({ kind: "updateNode", nodeId, patch: createInverseCanvasNodePatch(previous as CanvasHistoryNode, patch as CanvasHistoryNodePatch) });
    }
    await onRefreshProjectSurfaces();
    return node;
  };

  const handleUpdateCanvasNodePositions = async (updates: CanvasNodePositionUpdate[], options: HistoryOptions = {}) => {
    if (updates.length === 0) return [];
    const threadId = await ensureThreadId();
    const previousById = new Map(canvasNodes.map((node) => [node.id, node]));
    const nodes = await updateCanvasNodePositions(threadId, updates);
    const updatedById = new Map(nodes.map((node) => [node.id, node]));
    setCanvasNodes((current) => current.map((item) => updatedById.get(item.id) ?? item));
    const inverse = updates.flatMap((update) => {
      const previous = previousById.get(update.nodeId);
      return previous && previous.kind !== "plan" ? [{ nodeId: update.nodeId, x: previous.x, y: previous.y }] : [];
    });
    if (inverse.length > 0 && options.recordHistory !== false) pushHistory({ kind: "updateNodes", patches: inverse });
    await onRefreshProjectSurfaces();
    return nodes;
  };

  const handleDeleteCanvasNode = async (nodeId: string, options: HistoryOptions = {}) => {
    const threadId = await ensureThreadId();
    const previous = canvasNodes.find((node) => node.id === nodeId);
    const attachedEdges = canvasEdges.filter((edge) => edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId);
    await deleteCanvasNode(threadId, nodeId);
    setCanvasNodes((current) => removeCanvasNodeFromState({ nodeId, nodes: current, edges: canvasEdges }).nodes);
    setCanvasEdges((current) => removeCanvasNodeFromState({ nodeId, nodes: canvasNodes, edges: current }).edges);
    setSelectedCanvasNodeId((current) => removeCanvasNodeFromState({ nodeId, nodes: canvasNodes, edges: canvasEdges, selectedNodeId: current }).selectedNodeId);
    if (previous && previous.kind !== "plan" && options.recordHistory !== false) pushHistory({ kind: "restoreNode", node: previous as CanvasHistoryNode, edges: attachedEdges });
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

  const handleCreateCanvasObject = async (draft: CanvasObjectDraft, options: HistoryOptions = {}) => {
    const threadId = await ensureThreadId();
    const object = await createCanvasObject(threadId, draft);
    setCanvasObjects((current) => [...current, object]);
    if (options.recordHistory !== false) pushHistory({ kind: "deleteObject", objectId: object.id });
    await onRefreshProjectSurfaces();
    return object;
  };

  const handleUpdateCanvasObject = async (objectId: string, patch: CanvasObjectPatch, options: HistoryOptions = {}) => {
    const threadId = await ensureThreadId();
    const previous = canvasObjects.find((object) => object.id === objectId);
    const object = await updateCanvasObject(threadId, objectId, patch);
    setCanvasObjects((current) => current.map((item) => item.id === object.id ? object : item));
    if (previous && options.recordHistory !== false) pushHistory({
      kind: "updateObject",
      objectId,
      patch: createInverseCanvasObjectPatch(previous, patch)
    });
    await onRefreshProjectSurfaces();
    return object;
  };

  const handleDeleteCanvasObject = async (objectId: string, options: HistoryOptions = {}) => {
    const threadId = await ensureThreadId();
    const previous = canvasObjects.find((object) => object.id === objectId);
    if (!previous) return;
    await deleteCanvasObject(threadId, objectId);
    setCanvasObjects((current) => current.filter((object) => object.id !== objectId));
    if (options.recordHistory !== false && previous.kind !== "asset") pushHistory({ kind: "restoreObject", object: previous });
    await onRefreshProjectSurfaces();
  };

  const handleUploadCanvasAsset = async (input: { fileName: string; fileBase64: string }) => {
    const threadId = await ensureThreadId();
    const object = await uploadCanvasAsset(threadId, input);
    setCanvasObjects((current) => [...current, object]);
    pushHistory({ kind: "deleteObject", objectId: object.id });
    await onRefreshProjectSurfaces();
    return object;
  };

  const handleRequestCanvasRangeRewrite = async (draft: CanvasRangeRewriteDraft) => {
    const threadId = await ensureThreadId();
    const request = await requestCanvasRangeRewrite(threadId, draft);
    setCanvasWriteRequests((current) => [request, ...current.filter((item) => item.id !== request.id)]);
    return request;
  };

  const handlePasteCanvas = async (payload: CanvasClipboardPayload, center: CanvasPoint) => {
    const placed = placeCanvasClipboardPayload(payload, center);
    const nodeIds = new Map<string, string>();
    const createdNodeIds: string[] = [];
    const createdObjectIds: string[] = [];
    const createdEdgeIds: string[] = [];
    for (const item of placed.nodes) {
      const node = await handleCreateCanvasNode(item.draft, { recordHistory: false });
      nodeIds.set(item.sourceId, node.id);
      createdNodeIds.push(node.id);
    }
    for (const item of placed.objects) {
      const object = await handleCreateCanvasObject(item.draft, { recordHistory: false });
      createdObjectIds.push(object.id);
    }
    for (const edge of placed.edges) {
      const sourceNodeId = nodeIds.get(edge.sourceId);
      const targetNodeId = nodeIds.get(edge.targetId);
      if (!sourceNodeId || !targetNodeId) continue;
      const created = await handleCreateCanvasEdge({ sourceNodeId, targetNodeId, label: edge.label }, { recordHistory: false });
      if (created) createdEdgeIds.push(created.id);
    }
    pushHistory({ kind: "deleteGroup", nodeIds: createdNodeIds, objectIds: createdObjectIds, edgeIds: createdEdgeIds });
  };

  const handleConvertCanvasText = async (objectId: string, kind: Extract<CanvasNodeKind, "document" | "reference" | "note">) => {
    const object = canvasObjects.find((item): item is CanvasTextObject => item.id === objectId && item.kind === "text");
    if (!object) return;
    const node = await handleCreateCanvasNode({
      kind,
      title: kind[0].toUpperCase() + kind.slice(1),
      content: object.data.text,
      x: object.geometry.x,
      y: object.geometry.y,
    }, { recordHistory: false });
    try {
      await handleDeleteCanvasObject(object.id, { recordHistory: false });
      pushHistory({ kind: "restoreTextConversion", nodeId: node.id, object });
    } catch (error) {
      await handleDeleteCanvasNode(node.id, { recordHistory: false });
      throw error;
    }
  };

  const handleUpdateCanvasWorkflow = async (patch: CanvasWorkflowPatch) => {
    const threadId = await ensureThreadId();
    const workflow = await updateCanvasWorkflow(threadId, patch);
    setCanvasWorkflow(workflow);
    await onRefreshCanvas(threadId);
    await onRefreshProjectSurfaces();
    return workflow;
  };

  const handleUpdateCanvasNodeWorkflow = async (nodeId: string, patch: CanvasNodeWorkflowPatch) => {
    const threadId = await ensureThreadId();
    const node = await updateCanvasNodeWorkflow(threadId, nodeId, patch);
    setCanvasNodes((current) => current.map((item) => item.id === node.id ? node : item));
    await onRefreshProjectSurfaces();
    return node;
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
    } else if (entry.kind === "updateNodes") {
      await handleUpdateCanvasNodePositions(entry.patches, { recordHistory: false });
    } else if (entry.kind === "deleteEdge") {
      await handleDeleteCanvasEdge(entry.edgeId, { recordHistory: false });
    } else if (entry.kind === "restoreEdge") {
      await handleCreateCanvasEdge({ sourceNodeId: entry.edge.sourceNodeId, targetNodeId: entry.edge.targetNodeId, label: entry.edge.label }, { recordHistory: false });
    } else if (entry.kind === "deleteObject") {
      await handleDeleteCanvasObject(entry.objectId, { recordHistory: false });
    } else if (entry.kind === "restoreObject") {
      await handleCreateCanvasObject(entry.object, { recordHistory: false });
    } else if (entry.kind === "updateObject") {
      await handleUpdateCanvasObject(entry.objectId, entry.patch, { recordHistory: false });
    } else if (entry.kind === "deleteGroup") {
      for (const edgeId of entry.edgeIds) await handleDeleteCanvasEdge(edgeId, { recordHistory: false });
      for (const nodeId of entry.nodeIds) await handleDeleteCanvasNode(nodeId, { recordHistory: false });
      for (const objectId of entry.objectIds) await handleDeleteCanvasObject(objectId, { recordHistory: false });
    } else {
      await handleDeleteCanvasNode(entry.nodeId, { recordHistory: false });
      await handleCreateCanvasObject(entry.object, { recordHistory: false });
    }
  };

  const handleApproveCanvasWriteRequest = async (requestId: string) => {
    const threadId = await ensureThreadId();
    const request = canvasWriteRequests.find((item) => item.id === requestId);
    const previous = request?.targetNodeId ? canvasNodes.find((node) => node.id === request.targetNodeId) : undefined;
    const result = await approveCanvasWriteRequest(threadId, requestId);
    if (request?.operation === "replace_range" && previous && result.request.status === "approved" && result.node) {
      pushHistory({ kind: "updateNode", nodeId: previous.id, patch: { content: previous.content } });
    }
    await onRefreshCanvas(threadId);
    await onRefreshProjectSurfaces();
    return result;
  };

  const handleRejectCanvasWriteRequest = async (requestId: string) => {
    const threadId = await ensureThreadId();
    await rejectCanvasWriteRequest(threadId, requestId);
    await onRefreshCanvas(threadId);
    await onRefreshProjectSurfaces();
  };

  const handleAcceptCanvasWorkflowSuggestion = async (suggestionId: string) => {
    const threadId = await ensureThreadId();
    await acceptCanvasWorkflowSuggestion(threadId, suggestionId);
    await onRefreshCanvas(threadId);
    await onRefreshProjectSurfaces();
  };

  const handleIgnoreCanvasWorkflowSuggestion = async (suggestionId: string) => {
    const threadId = await ensureThreadId();
    const suggestion = await ignoreCanvasWorkflowSuggestion(threadId, suggestionId);
    setCanvasWorkflowSuggestions((current) => current.map((item) => item.id === suggestion.id ? suggestion : item));
    await onRefreshProjectSurfaces();
  };

  const handleConvertCanvasWorkflowSuggestionToNode = async (suggestionId: string, kind: CanvasNodeKind = "note") => {
    const threadId = await ensureThreadId();
    await convertCanvasWorkflowSuggestionToNode(threadId, suggestionId, kind);
    await onRefreshCanvas(threadId);
    await onRefreshProjectSurfaces();
  };

  return {
    handleAcceptCanvasWorkflowSuggestion,
    handleApproveCanvasWriteRequest,
    handleConvertCanvasNode,
    handleConvertCanvasWorkflowSuggestionToNode,
    handleCreateCanvasEdge,
    handleCreateCanvasNode,
    handleCreateCanvasObject,
    handleCreateCanvasWriteRequest,
    handleRequestCanvasRangeRewrite,
    handleDeleteCanvasEdge,
    handleDeleteCanvasNode,
    handleDeleteCanvasObject,
    handleIgnoreCanvasWorkflowSuggestion,
    handlePasteCanvas,
    handleRejectCanvasWriteRequest,
    handleUpdateCanvasNodeWorkflow,
    handleUpdateCanvasWorkflow,
    handleUpdateCanvasNode,
    handleUpdateCanvasNodePositions,
    handleUpdateCanvasObject,
    handleConvertCanvasText,
    handleUploadCanvasAsset,
    undoCanvas
  };
}
