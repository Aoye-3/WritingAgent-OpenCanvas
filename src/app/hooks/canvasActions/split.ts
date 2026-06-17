import type { CanvasNode, CanvasNodeKind } from "../../../features/agents/types";
import type { CanvasNodeDraft } from "../../../features/canvas/canvasClient";

export type CanvasSplittableNodeKind = Extract<CanvasNodeKind, "document" | "note" | "reference">;

export type CanvasTextSelectionDraft = {
  nodeId: string;
  rangeStart: number;
  rangeEnd: number;
  text: string;
};

const splitNodeSize: Record<CanvasSplittableNodeKind, { width: number; height: number }> = {
  document: { width: 640, height: 260 },
  note: { width: 380, height: 190 },
  reference: { width: 420, height: 190 },
};

export function isSplittableCanvasNodeKind(kind: CanvasNodeKind): kind is CanvasSplittableNodeKind {
  return kind === "document" || kind === "note" || kind === "reference";
}

export function createSplitCanvasNodeDraft(source: CanvasNode, selection: CanvasTextSelectionDraft): CanvasNodeDraft {
  if (!isSplittableCanvasNodeKind(source.kind)) throw new Error("Only text content nodes can be split");
  const content = selection.text.trim();
  if (!content) throw new Error("A text selection is required");
  const size = splitNodeSize[source.kind];
  return {
    kind: source.kind,
    title: source.title,
    content,
    x: Math.round(source.x + source.width + 48),
    y: Math.round(source.y + 24),
    width: size.width,
    height: size.height,
    metadata: {
      splitFrom: {
        nodeId: source.id,
        rangeStart: selection.rangeStart,
        rangeEnd: selection.rangeEnd,
        sourceUpdatedAt: source.updatedAt,
      },
    },
  };
}
