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
  | "run_incomplete"
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
  const payloadType = string(payload.type) || string(payload.eventType);
  if (event.eventType === "agent_backend_agent_clarification_invalid" || payloadType === "agent_clarification_invalid") {
    const reason = string(payload.reason);
    const summary = string(payload.summary) || (builder.locale === "zh" ? "Agent 返回的澄清选项不完整。" : "The Agent returned an incomplete clarification payload.");
    return builder.event("tool_completed", "failed", builder.locale === "zh" ? "澄清协议无效" : "Invalid clarification", reason ? `${summary}: ${reason}` : summary, payload);
  }
  if (/agent_clarification_requested$/.test(event.eventType) || payloadType === "agent_clarification_requested") {
    const question = string(payload.question);
    const options = clarificationOptions(payload.options);
    if (!question || options.length < 2) {
      return builder.event("tool_completed", "failed", builder.locale === "zh" ? "澄清协议无效" : "Invalid clarification", builder.locale === "zh" ? "Agent 返回的澄清问题或选项不完整。" : "The Agent returned a clarification without a valid question and options.", {
        ...payload,
        eventType: "agent_backend_agent_clarification_invalid",
        options
      });
    }
    return builder.event("decision", "waiting", builder.locale === "zh" ? "需要补充信息" : "Clarification needed", question || (builder.locale === "zh" ? "需要用户选择后继续。" : "Waiting for the user to choose an option."), {
      ...payload,
      eventType: "agent_backend_agent_clarification_requested",
      options
    });
  }
  if (/^canvas_delivery_/.test(event.eventType)) {
    if (event.eventType === "canvas_delivery_body_checkpoint_committed") {
      const displayTitle = string(payload.displayTitle) || string(payload.title) || (builder.locale === "zh" ? "正文草稿" : "Body draft");
      return builder.event("canvas_node_committed", "completed", displayTitle, builder.locale === "zh" ? "正文草稿节点已更新。" : "Body draft node updated.", payload);
    }
    if (event.eventType === "canvas_delivery_clarification_committed") {
      return builder.event("canvas_node_committed", "waiting", string(payload.displayTitle) || (builder.locale === "zh" ? "交互确认" : "Clarification"), string(payload.question) || (builder.locale === "zh" ? "需要用户选择后继续。" : "Waiting for the user to choose an option."), payload);
    }
    if (event.eventType === "canvas_delivery_synthesis_started") {
      return builder.event("decision", "running", builder.locale === "zh" ? "最终综合" : "Final synthesis", builder.locale === "zh" ? "预算已满足，正在基于已有材料生成最终正文。" : "Budget reached; synthesizing the final body from gathered material.", payload);
    }
    const title = string(payload.title) || (builder.locale === "zh" ? "Canvas 交付" : "Canvas delivery");
    const summary = string(payload.summary) || (builder.locale === "zh" ? "Canvas 渐进交付已更新。" : "Progressive Canvas delivery updated.");
    const displayTitle = string(payload.displayTitle) || title;
    const committed = string(payload.status) === "committed" || /_committed$/.test(event.eventType);
    return committed
      ? builder.event("canvas_node_committed", "completed", displayTitle, summary, payload)
      : builder.event("tool_started", "running", displayTitle, summary, { ...payload, toolName });
  }
  if (false && (/(?:^|_)tool_failed$/.test(event.eventType) || /(?:^|_)canvas_mutation_failed$/.test(event.eventType))) {
    return builder.event("tool_completed", "failed", label, builder.locale === "zh" ? `${label}失败` : `${label} failed`, { ...payload, toolName });
  }
  if (/(?:^|_)tool_failed$/.test(event.eventType) || /(?:^|_)canvas_mutation_failed$/.test(event.eventType)) {
    if (isRecoverableCanvasWriteGuard(payload)) {
      return builder.event("tool_completed", "completed", label, "Canvas update skipped because no target node was selected.", { ...payload, toolName });
    }
    return builder.event("tool_completed", "failed", label, failureSummary(label, payload, builder.locale), { ...payload, toolName });
  }
  if (/(?:^|_)tool_completed$/.test(event.eventType)) {
    return builder.event("tool_completed", "completed", label, builder.locale === "zh" ? `${label}已完成` : `${label} completed`, { ...payload, toolName });
  }
  if (/(?:^|_)canvas_mutation_committed$/.test(event.eventType)) {
    return builder.event("canvas_node_committed", "completed", builder.locale === "zh" ? "Canvas 节点" : "Canvas node", builder.locale === "zh" ? "Canvas 节点已创建或更新" : "Canvas node was created or updated", payload);
  }
  if (/(?:^|_)runtime_failed$/.test(event.eventType) || /(?:^|_)plan_protocol_failed$/.test(event.eventType)) {
    const message = string(payload.message) || string(payload.reason) || (builder.locale === "zh" ? "Agent Runtime 运行失败" : "Agent Runtime failed");
    return builder.event("run_failed", "failed", builder.locale === "zh" ? "运行失败" : "Run failed", message, payload);
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

function failureSummary(label: string, payload: Record<string, unknown>, locale: GenerateRequest["locale"]) {
  const base = locale === "zh" ? `${label}失败` : `${label} failed`;
  const detail = string(payload.reason) || string(payload.error) || string(payload.message) || string(payload.summary);
  if (!detail) return base;
  return `${base}: ${detail.replace(/\s+/g, " ").slice(0, 180)}`;
}

function isRecoverableCanvasWriteGuard(payload: Record<string, unknown>) {
  return string(payload.reason) === "missing_target_node";
}

function clarificationOptions(value: unknown) {
  if (!Array.isArray(value)) return [];
  const options = value.flatMap((item, index) => {
    if (typeof item === "string") {
      const label = string(item);
      return label ? [{ id: `option_${index + 1}`, label, detail: "", recommended: false }] : [];
    }
    const option = record(item);
    const label = string(option.label) || string(option.title);
    if (!label) return [];
    return [{
      id: string(option.id) || `option_${index + 1}`,
      label,
      detail: string(option.detail) || string(option.description),
      recommended: option.recommended === true
    }];
  }).slice(0, 3);
  const recommendedCount = options.filter((option) => option.recommended).length;
  if (recommendedCount > 1) return [];
  return recommendedCount === 0
    ? options.map((option, index) => ({ ...option, recommended: index === 0 }))
    : options;
}

function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function string(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function number(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : Number.parseInt(String(value ?? "0"), 10) || 0; }
