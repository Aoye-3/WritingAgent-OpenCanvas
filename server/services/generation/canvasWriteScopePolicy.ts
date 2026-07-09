export const SHORT_PROGRESS_CANVAS_WRITE_SCOPE = "short_progress_nodes" as const;
export const SHORT_PROGRESS_CANVAS_WRITE_MAX_CHARS = 2400;

export const SHORT_PROGRESS_CANVAS_WRITE_POLICY = {
  scope: SHORT_PROGRESS_CANVAS_WRITE_SCOPE,
  allowedOperations: ["create", "append"],
  allowedNodeKinds: ["document", "note", "reference"],
  allowedTitles: [
    "Summary",
    "Overview",
    "Progress note",
    "Research note",
    "References",
    "摘要",
    "整体概述",
    "进度摘录",
    "研究摘录",
    "参考文献"
  ],
  maxContentChars: SHORT_PROGRESS_CANVAS_WRITE_MAX_CHARS,
  forbiddenTitles: ["Body", "Final body", "Full report", "Full document", "正文", "最终正文", "完整报告", "完整正文"]
} as const;

export type CanvasWriteExposureInput = {
  skillScopeGuard?: boolean;
  progressiveCanvasDeliveryEnabled?: boolean;
  canvasActionRequiresTool?: boolean;
};

export type ShortProgressCanvasWriteValidationInput = {
  scope?: unknown;
  operation?: string;
  nodeKind?: string;
  title?: string;
  content?: string;
};

export function canvasWriteScopeForRun(input: CanvasWriteExposureInput) {
  if (input.skillScopeGuard) return undefined;
  return input.progressiveCanvasDeliveryEnabled ? SHORT_PROGRESS_CANVAS_WRITE_SCOPE : undefined;
}

export function applyCanvasWriteToolExposure(toolRefs: string[], input: CanvasWriteExposureInput) {
  if (input.skillScopeGuard) return ["ask_clarification"];
  const allowed = new Set(toolRefs);
  if (input.canvasActionRequiresTool || input.progressiveCanvasDeliveryEnabled) {
    allowed.add("canvas_write");
  }
  return [...allowed];
}

export function applyCanvasWriteToolState<T extends Record<string, unknown>>(toolState: T, input: CanvasWriteExposureInput): T | (T & { canvas_write: true }) {
  if (input.skillScopeGuard) return { ask_clarification: true } as unknown as T;
  if (!input.canvasActionRequiresTool && !input.progressiveCanvasDeliveryEnabled) return toolState;
  return { ...toolState, canvas_write: true };
}

export function isShortProgressCanvasWriteScope(value: unknown) {
  return value === SHORT_PROGRESS_CANVAS_WRITE_SCOPE;
}

export function validateShortProgressCanvasWrite(input: ShortProgressCanvasWriteValidationInput) {
  if (!isShortProgressCanvasWriteScope(input.scope)) return { ok: true as const };
  const operation = input.operation ?? "";
  if (operation !== "create" && operation !== "append") {
    return {
      ok: false as const,
      reason: "short_progress_operation_not_allowed",
      message: "Canvas write is limited to short create/append nodes during progressive delivery; use write_file and present_files for final documents."
    };
  }
  if (input.nodeKind && !SHORT_PROGRESS_CANVAS_WRITE_POLICY.allowedNodeKinds.includes(input.nodeKind as never)) {
    return {
      ok: false as const,
      reason: "short_progress_node_kind_not_allowed",
      message: "Canvas write can only create document, note, or reference nodes during progressive delivery."
    };
  }
  const content = input.content ?? "";
  if (content.length > SHORT_PROGRESS_CANVAS_WRITE_MAX_CHARS) {
    return {
      ok: false as const,
      reason: "short_progress_content_too_long",
      message: `Canvas write is limited to ${SHORT_PROGRESS_CANVAS_WRITE_MAX_CHARS} characters for progressive short nodes; write the full Markdown to /mnt/user-data/outputs/*.md with write_file, then call present_files.`
    };
  }
  const title = input.title ?? "";
  if (looksLikeLongFormCanvasWrite(title) || looksLikeLongFormCanvasWrite(firstHeading(content))) {
    return {
      ok: false as const,
      reason: "short_progress_long_form_title",
      message: "Canvas write is limited to summaries, overviews, progress/reference notes, and references during progressive delivery; use write_file and present_files for body or full-report content."
    };
  }
  return { ok: true as const };
}

export function shortProgressCanvasWriteStableNodeId(threadId: string | undefined, title: string | undefined) {
  if (!threadId || !title?.trim()) return undefined;
  const key = normalizeStableTitle(title);
  if (!key) return undefined;
  return `node_short_progress_${safeSegment(threadId).slice(0, 48)}_${hashString(key)}`;
}

function firstHeading(content: string) {
  const heading = content.split(/\r?\n/).find((line) => /^#{1,3}\s+\S/.test(line.trim()));
  return heading ? heading.replace(/^#{1,3}\s+/, "").trim() : "";
}

function looksLikeLongFormCanvasWrite(value: string) {
  return /(?:^|\b)(?:body|final body|full report|final report|complete report|full document|complete document)(?:\b|$)|正文|最终正文|完整报告|完整正文/i.test(value);
}

function normalizeStableTitle(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120);
}

function safeSegment(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "_") || "thread";
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
