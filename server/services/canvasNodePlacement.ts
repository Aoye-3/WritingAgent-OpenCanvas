import type { CanvasNode } from "../storageTypes.js";

type CanvasNodeLike = Pick<CanvasNode, "id" | "x" | "y" | "width" | "height">;
type CanvasSize = { width: number; height: number };
type CanvasRect = { x: number; y: number; width: number; height: number };

const defaultPosition = { x: 120, y: 120 };
const defaultSize: CanvasSize = { width: 320, height: 220 };
const nodeGap = 32;
const searchRings = 12;

export function findAvailableCanvasNodePosition({
  existingNodes,
  anchorNodeId,
  size = defaultSize
}: {
  existingNodes: CanvasNodeLike[];
  anchorNodeId?: string;
  size?: Partial<CanvasSize>;
}) {
  const resolvedSize = {
    width: readPositiveSize(size.width, defaultSize.width),
    height: readPositiveSize(size.height, defaultSize.height)
  };
  if (existingNodes.length === 0) return defaultPosition;

  const anchor = anchorNodeId ? existingNodes.find((node) => node.id === anchorNodeId) : undefined;
  const origin = anchor
    ? {
      x: anchor.x + anchor.width + nodeGap,
      y: anchor.y + anchor.height / 2 - resolvedSize.height / 2
    }
    : centerOrigin(existingNodes, resolvedSize);
  const step = {
    x: resolvedSize.width + nodeGap,
    y: resolvedSize.height + nodeGap
  };

  for (let ring = 0; ring <= searchRings; ring += 1) {
    for (const offset of placementOffsets(ring)) {
      const candidate = {
        x: Math.round(origin.x + offset.x * step.x),
        y: Math.round(origin.y + offset.y * step.y),
        width: resolvedSize.width,
        height: resolvedSize.height
      };
      if (!existingNodes.some((node) => canvasRectsOverlap(candidate, node))) {
        return { x: candidate.x, y: candidate.y };
      }
    }
  }

  return {
    x: Math.round(origin.x + (searchRings + 1) * step.x),
    y: Math.round(origin.y)
  };
}

export function canvasRectsOverlap(first: CanvasRect, second: CanvasRect) {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

function centerOrigin(nodes: CanvasNodeLike[], size: CanvasSize) {
  const center = nodes.reduce((sum, node) => ({
    x: sum.x + node.x + node.width / 2,
    y: sum.y + node.y + node.height / 2
  }), { x: 0, y: 0 });
  return {
    x: center.x / nodes.length - size.width / 2,
    y: center.y / nodes.length - size.height / 2
  };
}

function placementOffsets(ring: number) {
  if (ring === 0) return [{ x: 0, y: 0 }];
  const offsets: Array<{ x: number; y: number }> = [];
  for (let y = -ring; y <= ring; y += 1) {
    for (let x = -ring; x <= ring; x += 1) {
      if (Math.max(Math.abs(x), Math.abs(y)) === ring) offsets.push({ x, y });
    }
  }
  return offsets.sort((first, second) => {
    const firstDistance = first.x * first.x + first.y * first.y;
    const secondDistance = second.x * second.x + second.y * second.y;
    return firstDistance - secondDistance
      || offsetPreference(first) - offsetPreference(second)
      || first.y - second.y
      || first.x - second.x;
  });
}

function offsetPreference(offset: { x: number; y: number }) {
  if (offset.x > 0 && offset.y === 0) return 0;
  if (offset.x === 0 && offset.y > 0) return 1;
  if (offset.x < 0 && offset.y === 0) return 2;
  if (offset.x === 0 && offset.y < 0) return 3;
  return 4;
}

function readPositiveSize(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
