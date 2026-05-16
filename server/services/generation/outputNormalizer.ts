import type { Locale } from "../../promptBuilder.js";
import type { ToolEventRecord } from "../../toolRuntime.js";

const blockedPromptPatterns = [
  /You are FacetWrite(?:'s)? (?:writing assistant|text agent)/i,
  /#\s*AgentCard/i,
  /#\s*Loaded Skills/i,
  /#\s*Current User Instruction/i,
  /#\s*Output Contract/i,
  /FacetWrite runtime context/i,
  /This context is private implementation detail/i,
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

  if (isBlockedPlaceholder(sanitized, input.locale) && input.text.trim()) {
    events.push({
      eventType: "internal_output_blocked",
      payload: {
        source: input.source,
        reason: "internal_prompt_or_tool_payload",
        redactedPreview: preview(input.text)
      }
    });
  }

  return { text: sanitized, events };
}

export function sanitizeVisibleText(text: string, locale: Locale = "en") {
  const trimmed = text.trim();
  if (!trimmed) return "";

  if (blockedPromptPatterns.some((pattern) => pattern.test(trimmed))) {
    return blockedMessage(locale);
  }

  const withoutJson = stripLeakedToolJson(trimmed).text.trim();
  return withoutJson || blockedMessage(locale);
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

function preview(text: string) {
  return text.replace(/\s+/g, " ").slice(0, 160);
}
