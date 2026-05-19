import type { GenerateRequest } from "../../contracts/generation.js";

export type ProgressiveTextGate = {
  push: (token: string) => void;
  flush: () => void;
};

const minimumSafeLength = 80;
const minChunkLength = 24;
const preferredChunkLength = 48;
const maxChunkLength = 80;
const unsafeStreamPattern = /#\s*AgentCard|#\s*Loaded Skills|#\s*Current User Instruction|#\s*Output Contract|FacetWrite runtime context|reasoning_content|"results"\s*:|"tool_call_id"\s*:/i;

export function createProgressiveTextGate(
  locale: GenerateRequest["locale"],
  onToken?: (token: string) => void
): ProgressiveTextGate {
  let buffer = "";
  let released = false;
  let blocked = false;

  const emitChunk = (chunk: string) => {
    if (!chunk) return;
    released = true;
    onToken?.(chunk);
  };

  const emitText = (text: string) => {
    for (const chunk of splitIntoUiChunks(text)) {
      emitChunk(chunk);
    }
  };

  const releaseAvailable = (force: boolean) => {
    while (buffer) {
      const boundary = findReleaseBoundary(buffer, released || force);
      if (boundary <= 0) break;
      emitText(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary);
    }
    if (force && buffer) {
      emitText(buffer);
      buffer = "";
    }
  };

  const push = (token: string) => {
    if (!token || blocked) return;
    buffer += token;
    if (looksUnsafeForStream(buffer)) {
      blocked = true;
      buffer = "";
      return;
    }
    if (!released && buffer.length < minimumSafeLength) return;
    releaseAvailable(false);
  };

  const flush = () => {
    if (blocked) {
      onToken?.(locale === "zh"
        ? "\u672c\u6b21\u8fd0\u884c\u8fd4\u56de\u4e86\u5185\u90e8\u8fd0\u884c\u4fe1\u606f\uff0c\u5df2\u62e6\u622a\uff1b\u8bf7\u91cd\u65b0\u751f\u6210\u3002"
        : "This run returned internal runtime information and was blocked. Please regenerate.");
      return;
    }
    releaseAvailable(true);
  };

  return { push, flush };
}

export function splitProgressiveTextForTest(text: string, locale: GenerateRequest["locale"] = "zh") {
  const chunks: string[] = [];
  const gate = createProgressiveTextGate(locale, (chunk) => chunks.push(chunk));
  gate.push(text);
  gate.flush();
  return chunks;
}

export function looksUnsafeForStream(text: string) {
  return unsafeStreamPattern.test(text);
}

export function splitIntoUiChunks(text: string) {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining) {
    if (remaining.length <= maxChunkLength) {
      chunks.push(remaining);
      break;
    }
    const boundary = findUiChunkBoundary(remaining);
    chunks.push(remaining.slice(0, boundary));
    remaining = remaining.slice(boundary);
  }
  return chunks;
}

function findReleaseBoundary(text: string, canReleaseShortChunk: boolean) {
  if (!canReleaseShortChunk && text.length < minimumSafeLength) return -1;
  const minimumIndex = canReleaseShortChunk ? minChunkLength : minimumSafeLength;
  const boundary = firstSemanticBoundaryAtOrAfter(text, minimumIndex);
  if (boundary > 0 && boundary <= maxChunkLength) return boundary;
  if (text.length >= maxChunkLength) return fallbackBoundary(text);
  return -1;
}

function firstSemanticBoundaryAtOrAfter(text: string, minimumIndex: number) {
  const searchText = text.slice(0, maxChunkLength);
  const patterns = [
    /\n\s*\n/g,
    /\n(?=\s*(?:[-*+]\s+|\d+[.)]\s+|[一二三四五六七八九十]+[、.]\s*))/g,
    /[。！？；]\s*/g,
    /[.!?;]\s+/g
  ];

  let best = Number.POSITIVE_INFINITY;
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(searchText)) !== null) {
      const end = match.index + match[0].length;
      if (end >= minimumIndex) {
        best = Math.min(best, end);
        break;
      }
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  }

  return Number.isFinite(best) ? best : -1;
}

function fallbackBoundary(text: string) {
  const window = text.slice(0, maxChunkLength);
  const softBreak = Math.max(
    window.lastIndexOf("\n"),
    window.lastIndexOf(" "),
    window.lastIndexOf(","),
    window.lastIndexOf(";"),
    window.lastIndexOf(":"),
    window.lastIndexOf("，"),
    window.lastIndexOf("；"),
    window.lastIndexOf("："),
    window.lastIndexOf("。")
  );
  return softBreak >= minChunkLength ? softBreak + 1 : Math.min(maxChunkLength, text.length);
}

function findUiChunkBoundary(text: string) {
  const preferred = text.slice(0, preferredChunkLength);
  const softBreak = Math.max(
    preferred.lastIndexOf("\n"),
    preferred.lastIndexOf(" "),
    preferred.lastIndexOf(","),
    preferred.lastIndexOf(";"),
    preferred.lastIndexOf(":"),
    preferred.lastIndexOf("，"),
    preferred.lastIndexOf("；"),
    preferred.lastIndexOf("："),
    preferred.lastIndexOf("。")
  );
  if (softBreak >= minChunkLength) return softBreak + 1;
  return Math.min(preferredChunkLength, text.length);
}
