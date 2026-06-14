import type { SQLiteStorageRepository } from "../storage.js";
import { splitCanvasText, stableDeliveryId } from "./canvasDelivery.js";
import type { CanvasDeliveryContent } from "./generation/canvasDeliveryContent.js";
import { formatSourceLinks } from "./generation/sourceLinks.js";
import { isDirectCanvasDeliveryIntent } from "./generation/canvasDeliveryIntent.js";

export { isDirectCanvasDeliveryIntent } from "./generation/canvasDeliveryIntent.js";

type CanvasDeliveryPhase = "outline" | "body" | "sources";

const DELIVERY_NODE_SIZE: Record<CanvasDeliveryPhase, { width: number; height: number }> = {
  outline: { width: 520, height: 260 },
  body: { width: 640, height: 520 },
  sources: { width: 520, height: 320 }
};

const DELIVERY_LAYOUT = {
  startX: 560,
  startY: 120,
  columnGap: 720,
  bodyStaggerY: 280
};

export type CanvasDeliveryPlan = {
  required: boolean;
  nodes: Array<{
    id: string;
    kind: "document" | "reference";
    title: string;
    content: string;
    x: number;
    y: number;
    width: number;
    height: number;
    metadata?: Record<string, unknown>;
  }>;
  edges: Array<{ id: string; sourceNodeId: string; targetNodeId: string; label: string }>;
};

export function planCanvasDelivery(input: {
  deliveryId: string;
  projectId: string;
  instruction?: string;
  locale: "en" | "zh";
  content: CanvasDeliveryContent;
}): CanvasDeliveryPlan {
  if (!isDirectCanvasDeliveryIntent(input.instruction ?? "")) return { required: false, nodes: [], edges: [] };
  const nodes = [
    ...outlineNodes(input),
    ...bodyNodes(input),
    ...sourceNodes(input)
  ];
  const edges = nodes.slice(1).map((node, index) => ({
    id: stableDeliveryId("edge", input.deliveryId, index + 1),
    sourceNodeId: nodes[index]!.id,
    targetNodeId: node.id,
    label: "next"
  }));
  return { required: nodes.length > 0, nodes, edges };
}

export function commitCanvasDelivery(storage: SQLiteStorageRepository, projectId: string, plan: CanvasDeliveryPlan) {
  if (!plan.required) return [];
  const existingNodes = new Set(storage.listCanvasNodes(projectId).map((node) => node.id));
  const existingEdges = new Set(storage.listCanvasEdges(projectId).map((edge) => edge.id));
  const committed: Array<{ nodeId: string; title: string }> = [];
  for (const node of plan.nodes) {
    if (existingNodes.has(node.id)) {
      storage.updateCanvasNode(projectId, node.id, {
        title: node.title,
        content: node.content,
        kind: node.kind,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        metadata: { canvasDelivery: true, ...(node.metadata ?? {}) },
        includeInProjectContext: true
      });
    } else {
      storage.createCanvasNode(projectId, {
        ...node,
        metadata: { canvasDelivery: true, ...(node.metadata ?? {}) },
        includeInProjectContext: true
      });
      existingNodes.add(node.id);
    }
    committed.push({ nodeId: node.id, title: node.title });
  }
  for (const edge of plan.edges) {
    if (!existingEdges.has(edge.id)) {
      storage.createCanvasEdge(projectId, edge);
      existingEdges.add(edge.id);
    }
  }
  return committed;
}

function outlineNodes(input: Parameters<typeof planCanvasDelivery>[0]) {
  const content = input.content.outlineMarkdown.trim();
  if (!content) return [];
  return [node(input, {
    index: 1,
    phase: "outline",
    kind: "document",
    title: titleFromMarkdown(content, input.locale === "zh" ? "摘要分区" : "Summary"),
    content,
    x: DELIVERY_LAYOUT.startX,
    y: DELIVERY_LAYOUT.startY,
    pageIndex: 0,
    pageCount: 1
  })];
}

function bodyNodes(input: Parameters<typeof planCanvasDelivery>[0]) {
  const pages = splitCanvasText(input.content.bodyMarkdown.trim(), 1200);
  return pages.map((content, pageIndex) => node(input, {
    index: 2 + pageIndex,
    phase: "body",
    kind: "document",
    title: pages.length > 1
      ? `${input.locale === "zh" ? "正文" : "Body"} ${pageIndex + 1}/${pages.length}`
      : input.locale === "zh" ? "正文" : "Body",
    content,
    x: DELIVERY_LAYOUT.startX + DELIVERY_LAYOUT.columnGap + pageIndex * DELIVERY_LAYOUT.columnGap,
    y: DELIVERY_LAYOUT.startY + pageIndex * DELIVERY_LAYOUT.bodyStaggerY,
    pageIndex,
    pageCount: pages.length
  }));
}

function sourceNodes(input: Parameters<typeof planCanvasDelivery>[0]) {
  if (!input.content.sources.length) return [];
  const content = `# ${input.locale === "zh" ? "来源" : "Sources"}\n${formatSourceLinks(input.content.sources)}`;
  const bodyPageCount = splitCanvasText(input.content.bodyMarkdown.trim(), 1200).length;
  const index = 2 + bodyPageCount;
  return [node(input, {
    index,
    phase: "sources",
    kind: "reference",
    title: input.locale === "zh" ? "来源" : "Sources",
    content,
    x: DELIVERY_LAYOUT.startX + DELIVERY_LAYOUT.columnGap * (bodyPageCount + 1),
    y: DELIVERY_LAYOUT.startY,
    pageIndex: 0,
    pageCount: 1
  })];
}

function node(input: Parameters<typeof planCanvasDelivery>[0], value: {
  index: number;
  phase: CanvasDeliveryPhase;
  kind: "document" | "reference";
  title: string;
  content: string;
  x: number;
  y: number;
  pageIndex: number;
  pageCount: number;
}) {
  return {
    id: stableDeliveryId("node", input.deliveryId, value.index),
    kind: value.kind,
    title: value.title,
    content: value.content,
    x: value.x,
    y: value.y,
    width: DELIVERY_NODE_SIZE[value.phase].width,
    height: DELIVERY_NODE_SIZE[value.phase].height,
    metadata: {
      deliveryId: input.deliveryId,
      phase: value.phase,
      pageIndex: value.pageIndex,
      pageCount: value.pageCount
    }
  };
}

function titleFromMarkdown(content: string, fallback: string) {
  return content.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim() || fallback;
}
