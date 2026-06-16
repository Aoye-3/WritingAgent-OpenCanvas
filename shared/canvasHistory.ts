import type { CanvasObject, CanvasObjectPatch } from "./canvasObjects.js";

export type CanvasHistoryNode = {
  id: string;
  kind: "document" | "note" | "reference" | "role";
  title: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  metadata: unknown;
};
export type CanvasNodeKind = CanvasHistoryNode["kind"];

export type CanvasHistoryEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  label: string;
};

export type CanvasHistoryObject = Pick<CanvasObject, "id" | "kind" | "geometry" | "data">;

export type CanvasHistoryNodePatch = Partial<{
  kind: CanvasHistoryNode["kind"];
  title: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  metadata: unknown;
}>;
export type CanvasHistoryNodePositionPatch = { nodeId: string; x: number; y: number };

export type CanvasHistoryEntry =
  | { kind: "deleteNode"; nodeId: string }
  | { kind: "restoreNode"; node: CanvasHistoryNode; edges: CanvasHistoryEdge[] }
  | { kind: "updateNode"; nodeId: string; patch: CanvasHistoryNodePatch }
  | { kind: "updateNodes"; patches: CanvasHistoryNodePositionPatch[] }
  | { kind: "deleteEdge"; edgeId: string }
  | { kind: "restoreEdge"; edge: CanvasHistoryEdge }
  | { kind: "deleteObject"; objectId: string }
  | { kind: "restoreObject"; object: Exclude<CanvasObject, { kind: "asset" }> }
  | { kind: "updateObject"; objectId: string; patch: CanvasObjectPatch }
  | { kind: "deleteGroup"; nodeIds: string[]; objectIds: string[]; edgeIds: string[] }
  | { kind: "restoreTextConversion"; nodeId: string; object: Extract<CanvasObject, { kind: "text" }> };

export function limitCanvasHistoryDepth(entries: CanvasHistoryEntry[], undoDepth: number) {
  return entries.slice(0, Math.max(1, undoDepth));
}

export function pushCanvasHistoryEntry(
  current: CanvasHistoryEntry[],
  entry: CanvasHistoryEntry,
  undoDepth: number
) {
  return limitCanvasHistoryDepth([entry, ...current], undoDepth);
}

export function createInverseCanvasNodePatch(
  node: CanvasHistoryNode,
  patch: CanvasHistoryNodePatch
): CanvasHistoryNodePatch {
  const inverse: CanvasHistoryNodePatch = {};
  if (patch.kind !== undefined) inverse.kind = node.kind;
  if (patch.title !== undefined) inverse.title = node.title;
  if (patch.content !== undefined) inverse.content = node.content;
  if (patch.x !== undefined) inverse.x = node.x;
  if (patch.y !== undefined) inverse.y = node.y;
  if (patch.width !== undefined) inverse.width = node.width;
  if (patch.height !== undefined) inverse.height = node.height;
  if (patch.metadata !== undefined) inverse.metadata = node.metadata;
  return inverse;
}

export function createInverseCanvasObjectPatch(
  object: CanvasHistoryObject,
  patch: CanvasObjectPatch
): CanvasObjectPatch {
  const inverse: CanvasObjectPatch = {};
  if (patch.kind !== undefined) inverse.kind = object.kind;
  if (patch.geometry !== undefined) inverse.geometry = object.geometry;
  if (patch.data !== undefined && object.kind !== "asset") {
    inverse.data = object.data as NonNullable<CanvasObjectPatch["data"]>;
  }
  return inverse;
}
