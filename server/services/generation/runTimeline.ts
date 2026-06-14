import type { GenerateRequest } from "../../contracts/generation.js";
import type { ToolEventRecord } from "../../toolRuntime.js";

export type RunTimelineStatus = "running" | "completed" | "failed" | "waiting";
export type RunTimelineEventType =
  | "phase_started"
  | "decision"
  | "tool_started"
  | "tool_completed"
  | "canvas_node_committed"
  | "artifact_committed"
  | "run_completed"
  | "run_failed";

export type RunTimelineEvent = {
  id: string;
  threadId: string;
  runId: string;
  sequence: number;
  eventType: RunTimelineEventType;
  status: RunTimelineStatus;
  title: string;
  summary: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};

type RunTimelineBuilder = {
  locale: GenerateRequest["locale"];
  event: (
    eventType: RunTimelineEventType,
    status: RunTimelineStatus,
    title: string,
    summary: string,
    payload?: Record<string, unknown>
  ) => RunTimelineEvent;
};

export function createRunTimelineBuilder(input: {
  threadId: string;
  runId?: string;
  locale: GenerateRequest["locale"];
}): RunTimelineBuilder {
  let sequence = 0;
  return {
    locale: input.locale,
    event(eventType, status, title, summary, payload) {
      sequence += 1;
      return {
        id: `timeline_${crypto.randomUUID()}`,
        threadId: input.threadId,
        runId: input.runId ?? "pending",
        sequence,
        eventType,
        status,
        title,
        summary,
        ...(payload ? { payload: sanitizeTimelinePayload(payload) } : {}),
        createdAt: new Date().toISOString()
      };
    }
  };
}

export function toolEventToTimelineEvent(builder: RunTimelineBuilder, event: ToolEventRecord): RunTimelineEvent {
  const payload = record(event.payload);
  const toolName = string(payload.toolName) || string(payload.tool) || "tool";
  const label = toolLabel(toolName, builder.locale);
  if (/(?:^|_)tool_failed$/.test(event.eventType) || /(?:^|_)canvas_mutation_failed$/.test(event.eventType)) {
    return builder.event("tool_completed", "failed", label, builder.locale === "zh" ? `${label}失败` : `${label} failed`, { ...payload, toolName });
  }
  if (/(?:^|_)tool_completed$/.test(event.eventType)) {
    return builder.event("tool_completed", "completed", label, builder.locale === "zh" ? `${label}已完成` : `${label} completed`, { ...payload, toolName });
  }
  if (/(?:^|_)canvas_mutation_committed$/.test(event.eventType)) {
    return builder.event("canvas_node_committed", "completed", builder.locale === "zh" ? "Canvas 节点" : "Canvas node", builder.locale === "zh" ? "Canvas 节点已创建或更新" : "Canvas node was created or updated", payload);
  }
  if (/(?:^|_)artifact_committed$/.test(event.eventType) || /(?:^|_)artifact_staged$/.test(event.eventType)) {
    return builder.event("artifact_committed", "completed", builder.locale === "zh" ? "Canvas 产物" : "Canvas artifact", builder.locale === "zh" ? "Canvas 产物已更新" : "Canvas artifact was updated", payload);
  }
  return builder.event("tool_started", "running", label, builder.locale === "zh" ? `${label}运行中` : `${label} running`, { ...payload, toolName });
}

export function timelineEventToToolEvent(event: RunTimelineEvent): ToolEventRecord {
  return {
    eventType: `run_timeline_${event.eventType}`,
    payload: event
  };
}

export function timelineEventFromToolEvent(event: { eventType: string; payload: unknown }): RunTimelineEvent | undefined {
  if (!event.eventType.startsWith("run_timeline_")) return undefined;
  const payload = record(event.payload);
  const eventType = string(payload.eventType) as RunTimelineEventType;
  const status = string(payload.status) as RunTimelineStatus;
  if (!eventType || !status) return undefined;
  return {
    id: string(payload.id) || `timeline_${crypto.randomUUID()}`,
    threadId: string(payload.threadId),
    runId: string(payload.runId) || "pending",
    sequence: number(payload.sequence),
    eventType,
    status,
    title: string(payload.title),
    summary: string(payload.summary),
    payload: record(payload.payload),
    createdAt: string(payload.createdAt) || new Date().toISOString()
  };
}

export function safeDecisionTimelineEvent(builder: RunTimelineBuilder, summary: string, payload?: Record<string, unknown>) {
  return builder.event("decision", "running", builder.locale === "zh" ? "公开决策" : "Public decision", summary, payload);
}

function sanitizeTimelinePayload(payload: Record<string, unknown>) {
  const blocked = new Set(["reasoning", "reasoning_content", "thinking", "thought", "chain_of_thought", "messages", "prompt"]);
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !blocked.has(key)));
}

function toolLabel(toolName: string, locale: GenerateRequest["locale"]) {
  if (toolName === "web_search") return locale === "zh" ? "联网搜索" : "Web search";
  if (toolName === "knowledge_base") return locale === "zh" ? "知识库" : "Knowledge base";
  if (toolName === "canvas_write") return locale === "zh" ? "Canvas 写入" : "Canvas write";
  if (toolName === "artifact_stage") return locale === "zh" ? "产物暂存" : "Artifact staging";
  return toolName.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function string(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function number(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : Number.parseInt(String(value ?? "0"), 10) || 0; }
