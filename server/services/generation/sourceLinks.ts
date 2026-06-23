import type { ToolEventRecord } from "../../toolRuntime.js";

export type SourceLink = {
  title: string;
  url: string;
};

export function extractSourceLinks(input: {
  text?: string;
  events?: ToolEventRecord[];
  limit?: number;
}): SourceLink[] {
  const limit = input.limit ?? 10;
  const sources: Array<SourceLink & { priority: number }> = [];
  const seen = new Set<string>();
  const add = (title: string, url: string, priority = 0) => {
    const cleanUrl = url.trim();
    if (!/^https?:\/\//i.test(cleanUrl) || seen.has(cleanUrl)) return;
    seen.add(cleanUrl);
    sources.push({ title: cleanTitle(title, cleanUrl), url: cleanUrl, priority: priority + scholarlyUrlPriority(cleanUrl) });
  };

  const events = [...(input.events ?? [])].sort((left, right) => sourceEventPriority(right) - sourceEventPriority(left));
  for (const event of events) {
    const priority = sourceEventPriority(event) * 10;
    const rawSources = Array.isArray(event.payload.sources) ? event.payload.sources : [];
    for (const rawSource of rawSources) {
      if (!rawSource || typeof rawSource !== "object" || Array.isArray(rawSource)) continue;
      const source = rawSource as Record<string, unknown>;
      add(readString(source.title), readString(source.url), priority);
    }
  }

  for (const source of extractMarkdownSources(input.text ?? "")) {
    add(source.title, source.url);
  }

  return sources
    .sort((left, right) => right.priority - left.priority)
    .slice(0, limit)
    .map(({ priority: _priority, ...source }) => source);
}

function sourceEventPriority(event: ToolEventRecord) {
  const tool = readString(event.payload.tool) || readString(event.payload.toolName);
  const eventType = readString(event.payload.eventType) || event.eventType;
  if (tool === "canvas_write" || /canvas_mutation_committed$/.test(eventType)) return 2;
  return 1;
}

function scholarlyUrlPriority(url: string) {
  if (/\/(?:abs|pdf)\/\d{4}\.\d{4,5}|arxiv\.org/i.test(url)) return 6;
  if (/doi\.org\/10\.|\/doi\/10\./i.test(url)) return 5;
  if (/(?:aclanthology|ieeexplore|dl\.acm|springer|sciencedirect|semanticscholar|openreview|proceedings\.mlr)\./i.test(url)) return 4;
  return 0;
}

export function formatSourceLinks(sources: SourceLink[]) {
  return sources.map((source) => `- [${escapeMarkdownLinkText(source.title)}](${source.url})`).join("\n");
}

function extractMarkdownSources(text: string): SourceLink[] {
  const sources: SourceLink[] = [];
  const markdownLinkPattern = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = markdownLinkPattern.exec(text)) !== null) {
    sources.push({ title: match[1].trim(), url: match[2].trim() });
  }

  const bareUrlPattern = /https?:\/\/[^\s)\]]+/gi;
  while ((match = bareUrlPattern.exec(text)) !== null) {
    const url = match[0].replace(/[.,;:!?，。；：！？]+$/, "");
    sources.push({ title: url, url });
  }
  return sources;
}

function cleanTitle(title: string, url: string) {
  return (title || domainFromUrl(url) || url).replace(/\s+/g, " ").slice(0, 120);
}

function domainFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function escapeMarkdownLinkText(text: string) {
  return text.replace(/[[\]\\]/g, "\\$&");
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
