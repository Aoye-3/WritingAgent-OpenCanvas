import type { GenerateRequest } from "../../contracts/generation.js";
import type { ToolEventRecord } from "../../toolRuntime.js";
import { formatSourceLinks, extractSourceLinks, type SourceLink } from "./sourceLinks.js";

export type CanvasDeliveryContract = {
  id: "facetwrite_canvas_delivery_v1";
  format: "facetwrite_canvas_delivery";
  locale: GenerateRequest["locale"];
};

export type CanvasDeliveryContent = {
  assistantText: string;
  outlineMarkdown: string;
  bodyMarkdown: string;
  sources: SourceLink[];
  usedStructuredBlock: boolean;
};

export function createCanvasDeliveryContract(locale: GenerateRequest["locale"]): CanvasDeliveryContract {
  return {
    id: "facetwrite_canvas_delivery_v1",
    format: "facetwrite_canvas_delivery",
    locale
  };
}

export function resolveCanvasDeliveryContent(input: {
  instruction: string;
  locale: GenerateRequest["locale"];
  text: string;
  events?: ToolEventRecord[];
}): CanvasDeliveryContent {
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

function unwrapDeliveryRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const nested = record.facetwrite_canvas_delivery;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested as Record<string, unknown>;
  return record;
}

function stripDeliveryBlocks(text: string) {
  return text.replace(/```facetwrite_canvas_delivery\s*[\s\S]*?```/gi, "").replace(/\n{3,}/g, "\n\n").trim();
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
