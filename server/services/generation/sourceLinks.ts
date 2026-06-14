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
  const sources: SourceLink[] = [];
  const seen = new Set<string>();
  const add = (title: string, url: string) => {
    const cleanUrl = url.trim();
    if (!/^https?:\/\//i.test(cleanUrl) || seen.has(cleanUrl) || sources.length >= limit) return;
    seen.add(cleanUrl);
    sources.push({ title: cleanTitle(title, cleanUrl), url: cleanUrl });
  };

  for (const event of input.events ?? []) {
    const rawSources = Array.isArray(event.payload.sources) ? event.payload.sources : [];
    for (const rawSource of rawSources) {
      if (!rawSource || typeof rawSource !== "object" || Array.isArray(rawSource)) continue;
      const source = rawSource as Record<string, unknown>;
      add(readString(source.title), readString(source.url));
    }
  }

  for (const source of extractMarkdownSources(input.text ?? "")) {
    add(source.title, source.url);
  }

  return sources;
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
