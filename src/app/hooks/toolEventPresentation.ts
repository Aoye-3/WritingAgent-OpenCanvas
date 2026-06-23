import type { Locale } from "../../features/i18n/types";
import type { CanvasNode, CanvasNodeKind } from "../../features/agents/types";

export type LiveToolEvent = {
  eventType: string;
  payload?: Record<string, unknown>;
};

export type LiveToolEventState = {
  callsByTool: Record<string, number>;
};

export type LiveToolEventReduction = {
  state: LiveToolEventState;
  statusLabel?: string;
  chatActivityText?: string;
};

export function createLiveToolEventState(): LiveToolEventState {
  return { callsByTool: {} };
}

export function reduceLiveToolEvent(
  state: LiveToolEventState,
  event: LiveToolEvent,
  locale: Locale
): LiveToolEventReduction {
  const payload = event.payload ?? {};
  const toolName = readToolName(payload);
  if (toolName && /(?:^|_)tool_(?:started|completed|failed)$/.test(event.eventType)) {
    const nextCount = /(?:^|_)tool_started$/.test(event.eventType)
      ? (state.callsByTool[toolName] ?? 0) + 1
      : Math.max(state.callsByTool[toolName] ?? 0, 1);
    const nextState = {
      callsByTool: {
        ...state.callsByTool,
        [toolName]: nextCount
      }
    };
    return {
      state: nextState,
      statusLabel: buildToolStatusLabel(toolName, event.eventType, nextCount, locale)
    };
  }

  const activityText = lifecycleActivityText(event.eventType, locale);
  return {
    state,
    statusLabel: activityText,
    chatActivityText: activityText
  };
}

export function shouldRefreshThreadStateForToolEvent(event: LiveToolEvent) {
  return /(?:^|_)(?:canvas_mutation_committed|canvas_write_pending_approval|canvas_mutation_failed|artifact_committed|artifact_staged)$/.test(event.eventType)
    || (/^canvas_delivery_/.test(event.eventType) && event.eventType !== "canvas_delivery_synthesis_started")
    || /(?:^|_)plan_waiting_for_user$/.test(event.eventType)
    || /(?:^|_)agent_clarification_requested$/.test(event.eventType);
}

export function readLiveCanvasNodeSnapshot(event: LiveToolEvent): CanvasNode | undefined {
  if (!/^canvas_delivery_.*_committed$/.test(event.eventType)) return undefined;
  const node = readRecord(event.payload?.node);
  const id = readNonEmptyString(node.id);
  const projectId = readNonEmptyString(node.projectId);
  const kind = readCanvasNodeKind(node.kind);
  const title = readNonEmptyString(node.title);
  const content = typeof node.content === "string" ? node.content : undefined;
  const x = readFiniteNumber(node.x);
  const y = readFiniteNumber(node.y);
  const width = readFiniteNumber(node.width);
  const height = readFiniteNumber(node.height);
  const includeInProjectContext = typeof node.includeInProjectContext === "boolean" ? node.includeInProjectContext : undefined;
  const createdAt = readNonEmptyString(node.createdAt);
  const updatedAt = readNonEmptyString(node.updatedAt);
  if (!id || !projectId || !kind || !title || content === undefined || x === undefined || y === undefined || width === undefined || height === undefined || includeInProjectContext === undefined || !createdAt || !updatedAt) {
    return undefined;
  }
  return {
    id,
    projectId,
    kind,
    title,
    content,
    x,
    y,
    width,
    height,
    metadata: node.metadata,
    includeInProjectContext,
    createdAt,
    updatedAt
  };
}

function readToolName(payload: Record<string, unknown>) {
  return typeof payload.toolName === "string"
    ? payload.toolName
    : typeof payload.tool === "string" ? payload.tool : "";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readCanvasNodeKind(value: unknown): CanvasNodeKind | undefined {
  return value === "document"
    || value === "note"
    || value === "reference"
    || value === "role"
    || value === "plan"
    || value === "file_document"
    || value === "clarification"
    ? value
    : undefined;
}

function buildToolStatusLabel(toolName: string, eventType: string, count: number, locale: Locale) {
  const label = toolLabel(toolName, locale);
  const suffix = count > 1 ? locale === "zh" ? ` (${count} 次)` : ` (${count} calls)` : "";
  if (/(?:^|_)tool_failed$/.test(eventType)) return locale === "zh" ? `${label}失败${suffix}` : `${label} failed${suffix}`;
  if (/(?:^|_)tool_completed$/.test(eventType)) return locale === "zh" ? `${label}已完成${suffix}` : `${label} completed${suffix}`;
  return locale === "zh" ? `${label}运行中${suffix}` : `${label} running${suffix}`;
}

function toolLabel(toolName: string, locale: Locale) {
  if (toolName === "web_search") return locale === "zh" ? "联网搜索" : "Web search";
  if (toolName === "knowledge_base") return locale === "zh" ? "知识库" : "Knowledge base";
  if (toolName === "canvas_write") return locale === "zh" ? "Canvas 写入" : "Canvas write";
  if (toolName === "artifact_stage") return locale === "zh" ? "产物暂存" : "Artifact staging";
  return humanizeToolName(toolName);
}

function humanizeToolName(toolName: string) {
  return toolName
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function lifecycleActivityText(eventType: string, locale: Locale) {
  if (/agent_clarification_requested$/.test(eventType)) {
    return locale === "zh" ? "需要补充信息" : "Waiting for user choice";
  }
  if (/(?:^|_)artifact_committed$/.test(eventType) || /(?:^|_)artifact_staged$/.test(eventType)) {
    return locale === "zh" ? "Canvas 产物已更新" : "Canvas artifact updated";
  }
  if (/(?:^|_)canvas_mutation_committed$/.test(eventType)) {
    return locale === "zh" ? "Canvas 节点已创建或更新" : "Canvas node created or updated";
  }
  if (/^canvas_delivery_/.test(eventType)) {
    if (eventType === "canvas_delivery_clarification_committed") return locale === "zh" ? "需要补充信息" : "Waiting for user choice";
    if (eventType === "canvas_delivery_body_checkpoint_committed") return locale === "zh" ? "正文草稿已更新" : "Body draft updated";
    if (eventType === "canvas_delivery_synthesis_started") return locale === "zh" ? "正在最终综合" : "Final synthesis running";
    if (eventType === "canvas_delivery_body_final_committed") return locale === "zh" ? "最终正文已写入 Canvas" : "Final body written to Canvas";
    return locale === "zh" ? "Canvas 渐进交付已更新" : "Progressive Canvas delivery updated";
  }
  if (/(?:^|_)canvas_write_pending_approval$/.test(eventType)) {
    return locale === "zh" ? "Canvas 覆盖操作等待批准" : "Canvas replacement is waiting for approval";
  }
  if (/(?:^|_)canvas_mutation_failed$/.test(eventType)) {
    return locale === "zh" ? "Canvas 写入失败" : "Canvas write failed";
  }
  return undefined;
}
