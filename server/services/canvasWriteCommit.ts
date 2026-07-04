import type { CanvasWriteRequestInput, SQLiteStorageRepository } from "../storage.js";
import { findAvailableCanvasNodePosition } from "./canvasNodePlacement.js";

type CanvasWriteCommitStorage = Pick<SQLiteStorageRepository, "createCanvasNode" | "listCanvasNodes" | "updateCanvasNode">;

export function commitLowRiskCanvasWrite(
  storage: CanvasWriteCommitStorage,
  projectId: string,
  input: CanvasWriteRequestInput,
  options: {
    actionId?: string;
    selectedCanvasNodeId?: string;
    shortProgressStableNodeId?: string;
  } = {}
) {
  if (input.operation === "create") {
    const stableId = options.shortProgressStableNodeId || (options.actionId ? `node_${options.actionId.replace(/[^A-Za-z0-9_-]/g, "_")}` : undefined);
    const existingNodes = storage.listCanvasNodes(projectId);
    const existing = stableId ? existingNodes.find((node) => node.id === stableId) : undefined;
    if (existing && options.shortProgressStableNodeId) {
      const updated = storage.updateCanvasNode(projectId, existing.id, {
        kind: input.nodeKind ?? existing.kind,
        title: input.title,
        content: input.content
      });
      if (updated) return updated;
    }
    if (existing) return existing;
    const position = findAvailableCanvasNodePosition({
      existingNodes,
      anchorNodeId: input.targetNodeId ?? options.selectedCanvasNodeId
    });
    return storage.createCanvasNode(projectId, {
      id: stableId,
      kind: input.nodeKind ?? "document",
      title: input.title,
      content: input.content,
      x: position.x,
      y: position.y,
      ...(options.shortProgressStableNodeId ? { metadata: { canvasWriteScope: "short_progress_nodes" }, includeInProjectContext: true } : {})
    });
  }
  if (input.operation === "append" && input.targetNodeId) {
    const existing = storage.listCanvasNodes(projectId).find((node) => node.id === input.targetNodeId);
    if (!existing) throw new Error("Target node was not found");
    const updated = storage.updateCanvasNode(projectId, existing.id, {
      content: existing.content ? `${existing.content}\n\n${input.content}` : input.content
    });
    if (updated) return updated;
  }
  throw new Error("Only create and append Canvas operations can be committed without approval");
}
