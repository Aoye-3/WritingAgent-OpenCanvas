import type { CanvasNodeKind } from "./canvasHistory.js";
import type { CanvasObject, CanvasObjectDraft, CanvasPoint, CanvasTextObject } from "./canvasObjects.js";

export const CANVAS_CLIPBOARD_MIME = "application/x-facetwrite-canvas+json";

export type ClipboardNodeDraft = {
  kind: CanvasNodeKind;
  title?: string;
  content?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  metadata?: unknown;
};
type ClipboardNode = { sourceId: string; draft: ClipboardNodeDraft };
type ClipboardText = { sourceId: string; draft: Pick<CanvasTextObject, "kind" | "geometry" | "data"> };
type ClipboardEdge = { sourceId: string; targetId: string; label: string };

export type CanvasClipboardPayload = {
  version: 1;
  nodes: ClipboardNode[];
  objects: ClipboardText[];
  edges: ClipboardEdge[];
};

export function createCanvasClipboardPayload(input: {
  nodes: Array<ClipboardNodeDraft & { id: string }>;
  objects: CanvasObject[];
  edges: Array<{ sourceNodeId: string; targetNodeId: string; label: string }>;
}): CanvasClipboardPayload {
  const nodeIds = new Set(input.nodes.map((node) => node.id));
  return {
    version: 1,
    nodes: input.nodes.map((node) => ({
      sourceId: node.id,
      draft: {
        kind: node.kind,
        title: node.title,
        content: node.content,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        metadata: node.metadata,
      },
    })),
    objects: input.objects.filter((object): object is CanvasTextObject => object.kind === "text").map((object) => ({
      sourceId: object.id,
      draft: { kind: object.kind, geometry: object.geometry, data: object.data },
    })),
    edges: input.edges.filter((edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId)).map((edge) => ({
      sourceId: edge.sourceNodeId,
      targetId: edge.targetNodeId,
      label: edge.label,
    })),
  };
}

export function placeCanvasClipboardPayload(payload: CanvasClipboardPayload, center: CanvasPoint) {
  const boxes = [
    ...payload.nodes.map(({ draft }) => ({ x: draft.x ?? 0, y: draft.y ?? 0, width: draft.width ?? 300, height: draft.height ?? 190 })),
    ...payload.objects.map(({ draft }) => draft.geometry),
  ];
  const left = boxes.length ? Math.min(...boxes.map((box) => box.x)) : center.x;
  const top = boxes.length ? Math.min(...boxes.map((box) => box.y)) : center.y;
  const right = boxes.length ? Math.max(...boxes.map((box) => box.x + box.width)) : center.x;
  const bottom = boxes.length ? Math.max(...boxes.map((box) => box.y + box.height)) : center.y;
  const offset = { x: center.x - (left + right) / 2, y: center.y - (top + bottom) / 2 };
  return {
    nodes: payload.nodes.map(({ sourceId, draft }) => ({ sourceId, draft: { ...draft, x: (draft.x ?? 0) + offset.x, y: (draft.y ?? 0) + offset.y } })),
    objects: payload.objects.map(({ sourceId, draft }) => ({ sourceId, draft: { ...draft, geometry: { ...draft.geometry, x: draft.geometry.x + offset.x, y: draft.geometry.y + offset.y } } as CanvasObjectDraft })),
    edges: payload.edges,
  };
}
