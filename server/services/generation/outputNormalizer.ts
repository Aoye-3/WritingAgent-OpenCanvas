import type { Locale } from "../../promptBuilder.js";
import type { ToolEventRecord } from "../../toolRuntime.js";
import { extractSourceLinks, formatSourceLinks } from "./sourceLinks.js";
import { containsInternalRuntimeProtocol, internalRuntimeProtocolPreview } from "../../../shared/internalRuntimeProtocol.js";

const blockedPromptPatterns = [
  /You are FacetWrite(?:'s)? (?:writing assistant|text agent)/i,
  /#\s*AgentCard/i,
  /#\s*Loaded Skills/i,
  /#\s*Current User Instruction/i,
  /#\s*Output Contract/i,
  /FacetWrite runtime context/i,
  /This context is private implementation detail/i,
  /LLM request failed:/i,
  /Content Exists Risk/i,
  /The configured LLM provider (?:is|rejected the request)/i,
  /LLM request failed:.*reasoning_content/i,
  /reasoning_content.*(?:must be passed back|thinking mode)/i
];

type NormalizeInput = {
  text: string;
  locale: Locale;
  source: string;
  events?: ToolEventRecord[];
};

export function normalizeAgentRunOutput(input: NormalizeInput): { text: string; events: ToolEventRecord[] } {
  const sourceEvents = [...(input.events ?? [])];
  const withoutJson = stripLeakedToolJson(input.text);
  const sanitized = sanitizeVisibleText(withoutJson.text, input.locale);
  const events = [...sourceEvents, ...withoutJson.events];
  let visibleText = correctCanvasOutcomeClaim(sanitized, events, input.locale);

  if (isBlockedPlaceholder(visibleText, input.locale) && input.text.trim()) {
    events.push({
      eventType: "internal_output_blocked",
      payload: {
        source: input.source,
        reason: "internal_prompt_or_tool_payload",
        redactedPreview: preview(input.text)
      }
    });
  }

  if (!isBlockedPlaceholder(visibleText, input.locale)) {
    visibleText = enforceWebSearchSources(visibleText, events, input.locale);
  }

  return { text: visibleText, events };
}

export function sanitizeVisibleText(text: string, locale: Locale = "en") {
  const trimmed = text.trim();
  if (!trimmed) return "";

  if (blockedPromptPatterns.some((pattern) => pattern.test(trimmed)) || containsInternalRuntimeProtocol(trimmed)) {
    return blockedMessage(locale);
  }

  const withoutJson = stripLeakedToolJson(trimmed).text.trim();
  return withoutJson || blockedMessage(locale);
}

export function shouldExcludeFromModelContext(text: string) {
  const trimmed = text.trim();
  return blockedPromptPatterns.some((pattern) => pattern.test(trimmed))
    || trimmed === blockedMessage("en")
    || trimmed === blockedMessage("zh");
}

function stripLeakedToolJson(text: string): { text: string; events: ToolEventRecord[] } {
  const events: ToolEventRecord[] = [];
  let next = text;

  for (const match of findJsonObjects(text)) {
    if (!looksLikeToolPayload(match.value)) continue;
    events.push({
      eventType: "internal_output_blocked",
      payload: {
        reason: "tool_payload_in_assistant_text",
        redactedPreview: preview(match.value)
      }
    });
    next = next.replace(match.value, "");
  }

  return { text: next.replace(/\n{3,}/g, "\n\n").trim(), events };
}

function findJsonObjects(text: string) {
  const matches: Array<{ value: string }> = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let cursor = index; cursor < text.length; cursor += 1) {
      const char = text[cursor];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }
      if (char === "\"") inString = true;
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth === 0) {
        matches.push({ value: text.slice(index, cursor + 1) });
        index = cursor;
        break;
      }
    }
  }
  return matches;
}

function looksLikeToolPayload(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const record = parsed as Record<string, unknown>;
    return "query" in record || "results" in record || "tool" in record || "tool_call_id" in record || "arguments" in record;
  } catch {
    return false;
  }
}

function isBlockedPlaceholder(value: string, locale: Locale) {
  return value === blockedMessage(locale);
}

function blockedMessage(locale: Locale) {
  return locale === "zh"
    ? "本次运行返回了内部运行信息，已拦截；请重新生成。"
    : "This run returned internal runtime information and was blocked. Please regenerate.";
}

function correctCanvasOutcomeClaim(text: string, events: ToolEventRecord[], locale: Locale) {
  const committed = events.find((event) => /(?:^|_)canvas_mutation_committed$/.test(event.eventType));
  const pending = events.find((event) => /(?:^|_)canvas_write_pending_approval$/.test(event.eventType));
  const failed = events.find((event) => /(?:^|_)canvas_mutation_failed$/.test(event.eventType));
  if (!text && committed) return locale === "zh" ? "Canvas 节点已创建或更新。" : "The Canvas node was created or updated.";
  if (!text && failed) return locale === "zh" ? "画布操作未完成，请查看错误信息后重试。" : "The Canvas operation did not complete. Review the error and try again.";
  if (!text && pending) return locale === "zh" ? "画布操作正在等待你的批准，尚未写入。" : "The Canvas operation is waiting for your approval and has not been applied yet.";
  const claimsCommitted = /已(?:经)?(?:创建|新增|写入|追加)|创建成功|写入成功|节点已|(?:created|added|written|appended|saved).*(?:canvas|node)|(?:canvas|node).*(?:created|added|written|appended|saved)/i.test(text);
  if (!claimsCommitted) return text;
  if (failed) return locale === "zh" ? "画布操作未完成，请查看错误信息后重试。" : "The Canvas operation did not complete. Review the error and try again.";
  if (pending) return locale === "zh" ? "画布操作正在等待你的批准，尚未写入。" : "The Canvas operation is waiting for your approval and has not been applied yet.";
  return text;
}

function enforceWebSearchSources(text: string, events: ToolEventRecord[], locale: Locale) {
  if (!webSearchWasUsed(events) || hasVisibleUrl(text)) return text;

  const sources = extractSourceLinks({ events });
  if (!sources.length) {
    events.push({
      eventType: "web_search_sources_missing",
      payload: {
        reason: "no_source_urls"
      }
    });
    return locale === "zh"
      ? "本次联网搜索回复已被拦截，因为没有可用的来源链接。请重试搜索。"
      : "This web search answer was blocked because source links were not available. Please retry the search.";
  }

  events.push({
    eventType: "web_search_sources_appended",
    payload: {
      sourceCount: sources.length
    }
  });
  const heading = locale === "zh" ? "来源" : "Sources";
  return `${text.trim()}\n\n## ${heading}\n${formatSourceLinks(sources)}`;
}

function webSearchWasUsed(events: ToolEventRecord[]) {
  return events.some((event) => {
    if (/_tool_failed$/.test(event.eventType)) return false;
    const tool = readString(event.payload.toolName) || readString(event.payload.tool);
    return tool === "web_search";
  });
}

function hasVisibleUrl(text: string) {
  return /https?:\/\/\S+/i.test(text);
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function preview(text: string) {
  return internalRuntimeProtocolPreview(text);
}
