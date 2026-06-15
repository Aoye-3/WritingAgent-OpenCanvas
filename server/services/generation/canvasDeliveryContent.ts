import type { GenerateRequest } from "../../contracts/generation.js";
import type { CanvasWorkflowMode } from "../../../shared/canvasWorkflow.js";
import type { ToolEventRecord } from "../../toolRuntime.js";
import { formatSourceLinks, extractSourceLinks, type SourceLink } from "./sourceLinks.js";

export type CanvasDeliveryContract = {
  id: "facetwrite_canvas_delivery_v1";
  format: "facetwrite_canvas_delivery";
  diagramFormat: "facetwrite_diagram_delivery";
  preferredMode: CanvasWorkflowMode;
  locale: GenerateRequest["locale"];
};

export type DiagramDeliveryKind = "mindmap" | "userflow" | "flowchart" | "freeform";
export type DiagramDeliveryLayout = "radial" | "tree" | "left-right" | "freeform";
export type DiagramDeliveryShape = "rounded" | "rect" | "diamond" | "parallelogram" | "circle" | "database" | "document";
export type DiagramDeliveryTone = "primary" | "success" | "warning" | "danger" | "neutral";

export type DiagramDeliveryContent = {
  assistantText: string;
  kind: DiagramDeliveryKind;
  title: string;
  layout: DiagramDeliveryLayout;
  nodes: Array<{
    id: string;
    label: string;
    body?: string;
    shape: DiagramDeliveryShape;
    tone: DiagramDeliveryTone;
    parentId?: string;
    position?: { x: number; y: number };
  }>;
  edges: Array<{
    from: string;
    to: string;
    label?: string;
    kind: "next" | "yes" | "no" | "depends" | "contains";
  }>;
  sources: SourceLink[];
};

export type CanvasDeliveryContent = {
  assistantText: string;
  outlineMarkdown: string;
  bodyMarkdown: string;
  sources: SourceLink[];
  usedStructuredBlock: boolean;
  diagram?: DiagramDeliveryContent;
  invalidDiagramBlock?: boolean;
};

export function createCanvasDeliveryContract(locale: GenerateRequest["locale"], preferredMode: CanvasWorkflowMode = "batch_delivery"): CanvasDeliveryContract {
  return {
    id: "facetwrite_canvas_delivery_v1",
    format: "facetwrite_canvas_delivery",
    diagramFormat: "facetwrite_diagram_delivery",
    preferredMode,
    locale
  };
}

export function resolveCanvasDeliveryContent(input: {
  instruction: string;
  locale: GenerateRequest["locale"];
  text: string;
  events?: ToolEventRecord[];
}): CanvasDeliveryContent {
  const parsedDiagram = parseStructuredDiagramBlock(input.text);
  if (parsedDiagram.invalid) {
    return {
      assistantText: stripDeliveryBlocks(input.text),
      outlineMarkdown: "",
      bodyMarkdown: "",
      sources: [],
      usedStructuredBlock: false,
      invalidDiagramBlock: true
    };
  }
  if (parsedDiagram.content) {
    const eventSources = extractSourceLinks({ events: input.events, limit: 10 });
    const sources = mergeSources(eventSources, parsedDiagram.content.sources);
    return {
      assistantText: assistantTextWithSources(parsedDiagram.content.assistantText || stripDeliveryBlocks(input.text), sources, input.locale),
      outlineMarkdown: "",
      bodyMarkdown: "",
      sources,
      usedStructuredBlock: true,
      diagram: { ...parsedDiagram.content, sources }
    };
  }

  const parsed = parseStructuredDeliveryBlock(input.text);
  const eventSources = extractSourceLinks({ events: input.events, limit: 10 });
  if (parsed) {
    const sources = mergeSources(eventSources, parsed.sources);
    return {
      assistantText: assistantTextWithSources(parsed.assistantText || stripDeliveryBlocks(input.text), sources, input.locale),
      outlineMarkdown: parsed.outlineMarkdown || outlineFromBody(parsed.bodyMarkdown, input.locale),
      bodyMarkdown: parsed.bodyMarkdown || stripDeliveryBlocks(input.text),
      sources,
      usedStructuredBlock: true
    };
  }

  const withoutSources = stripSourcesSection(input.text);
  const bodyMarkdown = stripCompletionChatter(withoutSources.text).trim() || input.text.trim();
  const sources = mergeSources(eventSources, extractSourceLinks({ text: withoutSources.sourcesText, limit: 10 }));
  return {
    assistantText: assistantTextWithSources(input.text.trim(), sources, input.locale),
    outlineMarkdown: outlineFromBody(bodyMarkdown, input.locale),
    bodyMarkdown,
    sources,
    usedStructuredBlock: false
  };
}

export function stripCanvasDeliveryBlocks(text: string) {
  return stripDeliveryBlocks(text);
}

function parseStructuredDeliveryBlock(text: string): CanvasDeliveryContent | undefined {
  const fenced = text.match(/```facetwrite_canvas_delivery\s*([\s\S]*?)```/i);
  const jsonText = fenced?.[1]?.trim();
  if (!jsonText) return undefined;
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const record = unwrapDeliveryRecord(parsed);
    if (!record) return undefined;
    const sources = Array.isArray(record.sources)
      ? record.sources.flatMap((source) => {
          if (!source || typeof source !== "object" || Array.isArray(source)) return [];
          const item = source as Record<string, unknown>;
          const url = readString(item.url);
          return /^https?:\/\//i.test(url) ? [{ title: readString(item.title) || url, url }] : [];
        })
      : [];
    return {
      assistantText: readString(record.assistant_reply) || readString(record.assistantText),
      outlineMarkdown: readString(record.outline_markdown) || readString(record.outlineMarkdown),
      bodyMarkdown: readString(record.body_markdown) || readString(record.bodyMarkdown),
      sources,
      usedStructuredBlock: true
    };
  } catch {
    return undefined;
  }
}

function parseStructuredDiagramBlock(text: string): { content?: DiagramDeliveryContent; invalid: boolean } {
  const fenced = text.match(/```facetwrite_diagram_delivery\s*([\s\S]*?)```/i);
  const jsonText = fenced?.[1]?.trim();
  if (!jsonText) return { invalid: false };
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const record = unwrapDiagramRecord(parsed);
    if (!record) return { invalid: true };
    const nodes = readDiagramNodes(record.nodes);
    if (!nodes.length) return { invalid: true };
    const nodeIds = new Set<string>();
    for (const node of nodes) {
      if (nodeIds.has(node.id)) return { invalid: true };
      nodeIds.add(node.id);
    }
    const edges = readDiagramEdges(record.edges, nodeIds);
    const sources = Array.isArray(record.sources)
      ? record.sources.flatMap((source) => {
          if (!source || typeof source !== "object" || Array.isArray(source)) return [];
          const item = source as Record<string, unknown>;
          const url = readString(item.url);
          return /^https?:\/\//i.test(url) ? [{ title: readString(item.title) || url, url }] : [];
        })
      : [];
    return {
      invalid: false,
      content: {
        assistantText: readString(record.assistant_reply) || readString(record.assistantText),
        kind: readDiagramKind(record.kind),
        title: readString(record.title) || "Diagram",
        layout: readDiagramLayout(record.layout),
        nodes,
        edges,
        sources
      }
    };
  } catch {
    return { invalid: true };
  }
}

function unwrapDeliveryRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const nested = record.facetwrite_canvas_delivery;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested as Record<string, unknown>;
  return record;
}

function stripDeliveryBlocks(text: string) {
  return text
    .replace(/```facetwrite_canvas_delivery\s*[\s\S]*?```/gi, "")
    .replace(/```facetwrite_diagram_delivery\s*[\s\S]*?```/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function unwrapDiagramRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const nested = record.facetwrite_diagram_delivery;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested as Record<string, unknown>;
  return record;
}

function readDiagramNodes(value: unknown): DiagramDeliveryContent["nodes"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return [];
    const record = node as Record<string, unknown>;
    const id = readDiagramId(record.id);
    const label = readString(record.label);
    if (!id || !label) return [];
    const parentId = readDiagramId(record.parentId);
    const position = readPosition(record.position);
    return [{
      id,
      label,
      body: readString(record.body) || undefined,
      shape: readDiagramShape(record.shape),
      tone: readDiagramTone(record.tone),
      parentId: parentId || undefined,
      ...(position ? { position } : {})
    }];
  });
}

function readDiagramEdges(value: unknown, nodeIds: Set<string>): DiagramDeliveryContent["edges"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((edge) => {
    if (!edge || typeof edge !== "object" || Array.isArray(edge)) return [];
    const record = edge as Record<string, unknown>;
    const from = readDiagramId(record.from);
    const to = readDiagramId(record.to);
    if (!from || !to || from === to || !nodeIds.has(from) || !nodeIds.has(to)) return [];
    return [{
      from,
      to,
      label: readString(record.label) || undefined,
      kind: readDiagramEdgeKind(record.kind)
    }];
  });
}

function readDiagramKind(value: unknown): DiagramDeliveryKind {
  return value === "mindmap" || value === "userflow" || value === "flowchart" || value === "freeform" ? value : "mindmap";
}

function readDiagramLayout(value: unknown): DiagramDeliveryLayout {
  return value === "radial" || value === "tree" || value === "left-right" || value === "freeform" ? value : "tree";
}

function readDiagramShape(value: unknown): DiagramDeliveryShape {
  return value === "rounded" || value === "rect" || value === "diamond" || value === "parallelogram" || value === "circle" || value === "database" || value === "document" ? value : "rounded";
}

function readDiagramTone(value: unknown): DiagramDeliveryTone {
  return value === "primary" || value === "success" || value === "warning" || value === "danger" || value === "neutral" ? value : "neutral";
}

function readDiagramEdgeKind(value: unknown): DiagramDeliveryContent["edges"][number]["kind"] {
  return value === "yes" || value === "no" || value === "depends" || value === "contains" ? value : "next";
}

function readDiagramId(value: unknown) {
  const text = readString(value).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return text || "";
}

function readPosition(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const x = typeof record.x === "number" ? record.x : Number(record.x);
  const y = typeof record.y === "number" ? record.y : Number(record.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

function stripSourcesSection(text: string) {
  const match = text.match(/(^|\n)#{1,3}\s*(?:来源|Sources)\s*\n/i);
  if (!match || match.index === undefined) return { text, sourcesText: "" };
  const start = match.index + match[1].length;
  return {
    text: text.slice(0, start).trim(),
    sourcesText: text.slice(start).trim()
  };
}

function stripCompletionChatter(text: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^(?:新闻搜索和总结已经完成|搜索和总结已经完成|已经完成|已完成)[！!。.]?$/.test(trimmed)) return false;
      if (/^我已经.*(?:画板|Canvas|canvas|节点|來源|来源)/.test(trimmed)) return false;
      if (/^(?:所有内容|画板内容|Canvas 内容).*(?:包含|包括|更新|写入|生成)/i.test(trimmed)) return false;
      if (/^每个部分都包含/.test(trimmed)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function outlineFromBody(bodyMarkdown: string, locale: GenerateRequest["locale"]) {
  const headings = [...bodyMarkdown.matchAll(/^#{1,3}\s+(.+)$/gm)].map((match) => match[1].trim()).filter(Boolean);
  const listItems = [...bodyMarkdown.matchAll(/^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/gm)]
    .map((match) => match[1].replace(/\*\*/g, "").trim())
    .filter(Boolean);
  const items = (headings.length ? headings : listItems).slice(0, 8);
  const title = locale === "zh" ? "摘要分区" : "Summary";
  if (items.length) return [`# ${title}`, ...items.map((item) => `- ${item}`)].join("\n");
  const summary = bodyMarkdown.replace(/\s+/g, " ").slice(0, 180);
  return [`# ${title}`, summary].filter(Boolean).join("\n\n");
}

function assistantTextWithSources(text: string, sources: SourceLink[], locale: GenerateRequest["locale"]) {
  const cleanText = stripDeliveryBlocks(text).trim();
  if (!sources.length || /https?:\/\//i.test(cleanText)) return cleanText;
  const heading = locale === "zh" ? "来源" : "Sources";
  return `${cleanText}\n\n## ${heading}\n${formatSourceLinks(sources)}`.trim();
}

function mergeSources(...groups: SourceLink[][]) {
  const seen = new Set<string>();
  const merged: SourceLink[] = [];
  for (const group of groups) {
    for (const source of group) {
      if (!/^https?:\/\//i.test(source.url) || seen.has(source.url)) continue;
      seen.add(source.url);
      merged.push(source);
      if (merged.length >= 10) return merged;
    }
  }
  return merged;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
