import type { SQLiteStorageRepository } from "../storage.js";
import type { CanvasWorkflowMode } from "../../shared/canvasWorkflow.js";
import { stableDeliveryId } from "./canvasDelivery.js";
import type { CanvasDeliveryContent, DiagramDeliveryContent, DiagramDeliveryShape } from "./generation/canvasDeliveryContent.js";
import { formatSourceLinks } from "./generation/sourceLinks.js";
import { isDiagramCanvasDeliveryIntent, isDirectCanvasDeliveryIntent } from "./generation/canvasDeliveryIntent.js";

export { isDirectCanvasDeliveryIntent } from "./generation/canvasDeliveryIntent.js";

type CanvasDeliveryPhase = "outline" | "body" | "sources";
type CanvasDeliveryModuleId = "document_batch" | "diagram_delivery";

const DELIVERY_NODE_SIZE: Record<CanvasDeliveryPhase, { width: number; height: number }> = {
  outline: { width: 520, height: 260 },
  body: { width: 640, height: 520 },
  sources: { width: 520, height: 320 }
};

const DIAGRAM_NODE_SIZE: Record<DiagramDeliveryShape, { width: number; height: number }> = {
  rounded: { width: 230, height: 110 },
  rect: { width: 230, height: 110 },
  diamond: { width: 180, height: 150 },
  parallelogram: { width: 230, height: 110 },
  circle: { width: 160, height: 160 },
  database: { width: 230, height: 120 },
  document: { width: 250, height: 140 }
};

const DELIVERY_LAYOUT = {
  startX: 560,
  startY: 120,
  columnGap: 720,
  bodyStaggerY: 280
};

const DIAGRAM_LAYOUT = {
  startX: 560,
  startY: 180,
  levelGap: 320,
  rowGap: 190
};

export type CanvasDeliveryPlan = {
  required: boolean;
  moduleId?: CanvasDeliveryModuleId;
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

type CanvasDeliveryInput = {
  deliveryId: string;
  projectId: string;
  instruction?: string;
  locale: "en" | "zh";
  content: CanvasDeliveryContent;
  workflowMode?: CanvasWorkflowMode;
};

type CanvasDeliveryModule = {
  id: CanvasDeliveryModuleId;
  canPlan: (input: CanvasDeliveryInput) => boolean;
  plan: (input: CanvasDeliveryInput) => Omit<CanvasDeliveryPlan, "required" | "moduleId">;
};

const deliveryModules: CanvasDeliveryModule[] = [
  diagramDeliveryModule(),
  documentBatchDeliveryModule()
];

export function planCanvasDelivery(input: CanvasDeliveryInput): CanvasDeliveryPlan {
  if (!isDirectCanvasDeliveryIntent(input.instruction ?? "")) return emptyPlan();
  if (input.content.invalidDiagramBlock) return emptyPlan();
  const module = deliveryModules.find((candidate) => candidate.canPlan(input));
  if (!module) return emptyPlan();
  const planned = module.plan(input);
  return { required: planned.nodes.length > 0, moduleId: module.id, ...planned };
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

function documentBatchDeliveryModule(): CanvasDeliveryModule {
  return {
    id: "document_batch",
    canPlan: (input) => !input.content.diagram && (input.workflowMode ?? "batch_delivery") === "batch_delivery",
    plan: (input) => {
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
      return { nodes, edges };
    }
  };
}

function diagramDeliveryModule(): CanvasDeliveryModule {
  return {
    id: "diagram_delivery",
    canPlan: (input) => Boolean(input.content.diagram) || isDiagramCanvasDeliveryIntent(input.instruction ?? "") || (input.workflowMode ?? "batch_delivery") !== "batch_delivery",
    plan: (input) => input.content.diagram ? planDiagramDelivery(input, input.content.diagram) : { nodes: [], edges: [] }
  };
}

function outlineNodes(input: CanvasDeliveryInput) {
  const content = input.content.outlineMarkdown.trim();
  if (!content) return [];
  return [node(input, {
    index: 1,
    phase: "outline",
    kind: "document",
    title: titleFromMarkdown(content, input.locale === "zh" ? "整体概述" : "Overview"),
    content,
    x: DELIVERY_LAYOUT.startX,
    y: DELIVERY_LAYOUT.startY,
    pageIndex: 0,
    pageCount: 1
  })];
}

function bodyNodes(input: CanvasDeliveryInput) {
  const sections = directDeliverySections(input.content.bodyMarkdown.trim(), input.locale === "zh" ? "正文" : "Body");
  return sections.map((section, sectionIndex) => node(input, {
    index: 2 + sectionIndex,
    phase: "body",
    kind: "document",
    title: section.title,
    content: section.content,
    x: DELIVERY_LAYOUT.startX + DELIVERY_LAYOUT.columnGap + sectionIndex * DELIVERY_LAYOUT.columnGap,
    y: DELIVERY_LAYOUT.startY + sectionIndex * DELIVERY_LAYOUT.bodyStaggerY,
    pageIndex: sectionIndex,
    pageCount: sections.length
  }));
}

function sourceNodes(input: CanvasDeliveryInput) {
  if (!input.content.sources.length) return [];
  const content = `# ${input.locale === "zh" ? "来源" : "Sources"}\n${formatSourceLinks(input.content.sources)}`;
  const bodySectionCount = directDeliverySections(input.content.bodyMarkdown.trim(), input.locale === "zh" ? "正文" : "Body").length;
  const index = 2 + bodySectionCount;
  return [node(input, {
    index,
    phase: "sources",
    kind: "reference",
    title: input.locale === "zh" ? "来源" : "Sources",
    content,
    x: DELIVERY_LAYOUT.startX + DELIVERY_LAYOUT.columnGap * (bodySectionCount + 1),
    y: DELIVERY_LAYOUT.startY,
    pageIndex: 0,
    pageCount: 1
  })];
}

function directDeliverySections(content: string, fallbackTitle: string) {
  if (!content) return [];
  const blocks = content.split(/(?=^#\s+)/m).map((block) => block.trim()).filter(Boolean);
  return blocks.map((block, index) => ({
    title: titleFromMarkdown(block, blocks.length === 1 ? fallbackTitle : `${fallbackTitle} ${index + 1}`),
    content: block
  }));
}

function node(input: CanvasDeliveryInput, value: {
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

function planDiagramDelivery(input: CanvasDeliveryInput, diagram: DiagramDeliveryContent) {
  const positions = layoutDiagram(diagram);
  const nodeIdByDiagramId = new Map<string, string>();
  const nodes = diagram.nodes.map((diagramNode, index) => {
    const id = stableDeliveryId("node", input.deliveryId, index + 1);
    nodeIdByDiagramId.set(diagramNode.id, id);
    const size = DIAGRAM_NODE_SIZE[diagramNode.shape];
    const position = positions.get(diagramNode.id) ?? { x: DIAGRAM_LAYOUT.startX, y: DIAGRAM_LAYOUT.startY };
    return {
      id,
      kind: "document" as const,
      title: diagramNode.label,
      content: diagramNode.body ?? "",
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      metadata: {
        deliveryId: input.deliveryId,
        phase: "diagram",
        diagram: {
          deliveryId: input.deliveryId,
          module: "diagram_delivery",
          diagramKind: diagram.kind,
          layout: diagram.layout,
          shape: diagramNode.shape,
          tone: diagramNode.tone,
          sourceId: diagramNode.id,
          parentId: diagramNode.parentId
        }
      }
    };
  });

  const semanticEdges = normalizedDiagramEdges(diagram);
  const edges = semanticEdges.flatMap((edge, index) => {
    const sourceNodeId = nodeIdByDiagramId.get(edge.from);
    const targetNodeId = nodeIdByDiagramId.get(edge.to);
    if (!sourceNodeId || !targetNodeId) return [];
    return [{
      id: stableDeliveryId("edge", input.deliveryId, index + 1),
      sourceNodeId,
      targetNodeId,
      label: edge.label || edge.kind
    }];
  });

  return { nodes, edges };
}

function normalizedDiagramEdges(diagram: DiagramDeliveryContent) {
  const seen = new Set<string>();
  const edges: DiagramDeliveryContent["edges"] = [];
  const add = (edge: DiagramDeliveryContent["edges"][number]) => {
    const key = `${edge.from}->${edge.to}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(edge);
  };
  for (const node of diagram.nodes) {
    if (node.parentId) add({ from: node.parentId, to: node.id, kind: "contains" });
  }
  for (const edge of diagram.edges) add(edge);
  return edges;
}

function layoutDiagram(diagram: DiagramDeliveryContent) {
  const explicit = diagram.layout === "freeform";
  const levels = diagram.layout === "radial"
    ? radialLevels(diagram)
    : directedLevels(diagram);
  const positions = new Map<string, { x: number; y: number }>();
  const maxRows = Math.max(...levels.map((level) => level.length), 1);
  levels.forEach((level, levelIndex) => {
    const levelOffset = ((maxRows - level.length) * DIAGRAM_LAYOUT.rowGap) / 2;
    level.forEach((nodeId, rowIndex) => {
      const node = diagram.nodes.find((item) => item.id === nodeId);
      if (explicit && node?.position) {
        positions.set(nodeId, { x: Math.round(node.position.x), y: Math.round(node.position.y) });
        return;
      }
      positions.set(nodeId, {
        x: DIAGRAM_LAYOUT.startX + levelIndex * DIAGRAM_LAYOUT.levelGap,
        y: DIAGRAM_LAYOUT.startY + levelOffset + rowIndex * DIAGRAM_LAYOUT.rowGap
      });
    });
  });
  return positions;
}

function radialLevels(diagram: DiagramDeliveryContent) {
  const levels = directedLevels(diagram);
  if (levels.length <= 2) return levels;
  return levels;
}

function directedLevels(diagram: DiagramDeliveryContent) {
  const childIds = new Set<string>();
  for (const edge of normalizedDiagramEdges(diagram)) childIds.add(edge.to);
  const roots = diagram.nodes.filter((node) => !node.parentId && !childIds.has(node.id)).map((node) => node.id);
  const queue = (roots.length ? roots : [diagram.nodes[0]!.id]).map((id) => ({ id, level: 0 }));
  const byParent = new Map<string, string[]>();
  for (const edge of normalizedDiagramEdges(diagram)) {
    byParent.set(edge.from, [...(byParent.get(edge.from) ?? []), edge.to]);
  }
  const seen = new Set<string>();
  const levels: string[][] = [];
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current.id)) continue;
    seen.add(current.id);
    levels[current.level] = [...(levels[current.level] ?? []), current.id];
    for (const child of byParent.get(current.id) ?? []) queue.push({ id: child, level: current.level + 1 });
  }
  for (const node of diagram.nodes) {
    if (!seen.has(node.id)) levels[0] = [...(levels[0] ?? []), node.id];
  }
  return levels.filter(Boolean);
}

function emptyPlan(): CanvasDeliveryPlan {
  return { required: false, nodes: [], edges: [] };
}

function titleFromMarkdown(content: string, fallback: string) {
  return content.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim() || fallback;
}
