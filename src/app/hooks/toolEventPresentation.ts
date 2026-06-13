import type { Locale } from "../../features/i18n/types";

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
  return /(?:^|_)(?:canvas_mutation_committed|canvas_write_pending_approval|canvas_mutation_failed|artifact_committed|artifact_staged)$/.test(event.eventType);
}

function readToolName(payload: Record<string, unknown>) {
  return typeof payload.toolName === "string"
    ? payload.toolName
    : typeof payload.tool === "string" ? payload.tool : "";
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
  if (toolName === "canvas_write") return locale === "zh" ? "Canvas 写入" : "Canvas write";
  return humanizeToolName(toolName);
}

function humanizeToolName(toolName: string) {
  return toolName
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function lifecycleActivityText(eventType: string, locale: Locale) {
  if (/(?:^|_)artifact_committed$/.test(eventType) || /(?:^|_)artifact_staged$/.test(eventType)) {
    return locale === "zh" ? "Canvas 产物已更新" : "Canvas artifact updated";
  }
  if (/(?:^|_)canvas_mutation_committed$/.test(eventType)) {
    return locale === "zh" ? "Canvas 节点已创建或更新" : "Canvas node created or updated";
  }
  if (/(?:^|_)canvas_write_pending_approval$/.test(eventType)) {
    return locale === "zh" ? "Canvas 覆盖操作等待批准" : "Canvas replacement is waiting for approval";
  }
  if (/(?:^|_)canvas_mutation_failed$/.test(eventType)) {
    return locale === "zh" ? "Canvas 写入失败" : "Canvas write failed";
  }
  return undefined;
}
