import type { AgentProgressEvent, GenerateRequest, GenerateResponse, RuntimeRunEvent, RunTimelineEvent, StreamStatus } from "./types";
import { apiGet, apiPost } from "../../shared/apiClient";

export async function generateText(payload: GenerateRequest): Promise<GenerateResponse> {
  return apiPost<GenerateResponse>("/api/generate", payload);
}

export async function requestRunIntervention(payload: {
  threadId: string;
  runId: string;
  text: string;
  inputId: string;
}): Promise<{ id: string; status: string }> {
  return apiPost<{ id: string; status: string }>(`/api/generate/runs/${encodeURIComponent(payload.runId)}/interventions`, {
    threadId: payload.threadId,
    text: payload.text,
    inputId: payload.inputId
  });
}

export async function fetchRuntimeRunEvents(payload: {
  threadId: string;
  runId: string;
  limit?: number;
}): Promise<RuntimeRunEvent[]> {
  const limit = payload.limit && Number.isInteger(payload.limit) ? `&limit=${encodeURIComponent(String(payload.limit))}` : "";
  const response = await apiGet<{ events: RuntimeRunEvent[] }>(
    `/api/generate/runs/${encodeURIComponent(payload.runId)}/events?threadId=${encodeURIComponent(payload.threadId)}${limit}`
  );
  return response.events;
}

export async function generateTextStream(
  payload: GenerateRequest,
  handlers: {
    onToken?: (token: string) => void;
    onReasoningToken?: (token: string) => void;
    onStatus?: (status: StreamStatus) => void;
    onToolEvent?: (event: unknown) => void;
    onTimelineEvent?: (event: RunTimelineEvent) => void;
    onProgressEvent?: (event: AgentProgressEvent) => void;
  } = {},
  options: { signal?: AbortSignal } = {}
): Promise<GenerateResponse> {
  const trace = createStreamTrace(payload);
  const response = await fetch("/api/generate/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: options.signal
  });
  trace("response", { status: response.status, ok: response.ok });

  if (!response.ok || !response.body) {
    trace("response_error", { status: response.status });
    throw new Error(`Streaming generation request failed with ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: GenerateResponse | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      trace("reader_done");
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const rawEvent of events) {
      const parsed = parseSseEvent(rawEvent);
      if (!parsed) continue;
      trace("event", {
        event: parsed.event,
        type: eventTypeFromData(parsed.data)
      });
      if (parsed.event === "token") {
        handlers.onToken?.(String((parsed.data as { text?: unknown }).text ?? ""));
      } else if (parsed.event === "reasoning_token") {
        handlers.onReasoningToken?.(String((parsed.data as { text?: unknown }).text ?? ""));
      } else if (parsed.event === "status") {
        handlers.onStatus?.(parsed.data as StreamStatus);
      } else if (parsed.event === "tool_event") {
        handlers.onToolEvent?.(parsed.data);
      } else if (parsed.event === "timeline_event") {
        handlers.onTimelineEvent?.(parsed.data as RunTimelineEvent);
      } else if (parsed.event === "progress_event") {
        const progress = normalizeAgentProgressEvent(parsed.data);
        if (progress) handlers.onProgressEvent?.(progress);
      } else if (parsed.event === "final") {
        finalResult = parsed.data as GenerateResponse;
        trace("final", { threadId: finalResult.threadId, runId: finalResult.runId });
      } else if (parsed.event === "error") {
        const message = String((parsed.data as { message?: unknown }).message ?? "Streaming generation failed");
        trace("error", { message });
        throw new Error(message);
      }
    }
  }

  if (!finalResult) {
    trace("missing_final");
    throw new Error("Streaming generation ended without a final response");
  }

  trace("complete", { threadId: finalResult.threadId, runId: finalResult.runId });
  return finalResult;
}

function parseSseEvent(raw: string) {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
  const dataLines = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart());
  if (!event || !dataLines.length) return null;
  return { event, data: JSON.parse(dataLines.join("\n")) as unknown };
}

function normalizeAgentProgressEvent(data: unknown): AgentProgressEvent | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const source = data as Record<string, unknown>;
  const id = safeProgressString(source.id, 160);
  const summary = safeProgressText(source.summary, 360);
  const createdAt = safeProgressString(source.createdAt, 80) || new Date().toISOString();
  if (!id || !summary) return null;
  const visibility = readProgressVisibility(source.visibility);
  const status = readProgressStatus(source.status);
  const loopIndex = typeof source.loopIndex === "number" && Number.isInteger(source.loopIndex) ? source.loopIndex : undefined;
  return {
    id,
    ...(safeProgressString(source.threadId, 160) ? { threadId: safeProgressString(source.threadId, 160) } : {}),
    ...(safeProgressString(source.runId, 160) ? { runId: safeProgressString(source.runId, 160) } : {}),
    ...(safeProgressString(source.stageId, 180) ? { stageId: safeProgressString(source.stageId, 180) } : {}),
    ...(safeProgressString(source.loopId, 180) ? { loopId: safeProgressString(source.loopId, 180) } : {}),
    ...(loopIndex !== undefined ? { loopIndex } : {}),
    ...(readStepKind(source.stepKind) ? { stepKind: readStepKind(source.stepKind) } : {}),
    ...(safeProgressString(source.actionId, 180) ? { actionId: safeProgressString(source.actionId, 180) } : {}),
    ...(safeProgressString(source.observationId, 180) ? { observationId: safeProgressString(source.observationId, 180) } : {}),
    ...(readCompletionStatus(source.completionStatus) ? { completionStatus: readCompletionStatus(source.completionStatus) } : {}),
    ...(readStringList(source.completionReasons).length ? { completionReasons: readStringList(source.completionReasons) } : {}),
    ...(readStringList(source.missingRequirements).length ? { missingRequirements: readStringList(source.missingRequirements) } : {}),
    ...(safeProgressString(source.phase, 80) ? { phase: safeProgressString(source.phase, 80) } : {}),
    ...(status ? { status } : {}),
    ...(safeProgressText(source.title, 160) ? { title: safeProgressText(source.title, 160) } : {}),
    summary,
    ...(safeProgressText(source.next, 360) ? { next: safeProgressText(source.next, 360) } : {}),
    ...(readProgressEvidence(source.evidence).length ? { evidence: readProgressEvidence(source.evidence) } : {}),
    ...(safeProgressText(source.interventionHint, 240) ? { interventionHint: safeProgressText(source.interventionHint, 240) } : {}),
    ...(visibility ? { visibility } : {}),
    ...(safeProgressString(source.source, 120) ? { source: safeProgressString(source.source, 120) } : {}),
    createdAt
  };
}

function safeProgressText(value: unknown, max: number) {
  const text = safeProgressString(value, max);
  if (/prompt|reasoning|chain[_\s-]?of[_\s-]?thought|messages?|tool[_\s-]?calls?|arguments?|contextValues|api.?key|token|secret|password|authorization/i.test(text)) {
    return "";
  }
  return text;
}

function safeProgressString(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || /^(?:undefined|null|none|nan)$/i.test(text)) return "";
  return text.slice(0, max);
}

function readProgressVisibility(value: unknown): AgentProgressEvent["visibility"] | undefined {
  return value === "stage" || value === "raw" || value === "public" ? value : undefined;
}

function readProgressStatus(value: unknown): AgentProgressEvent["status"] | undefined {
  return value === "running" || value === "completed" || value === "failed" || value === "waiting" ? value : undefined;
}

function readStepKind(value: unknown): AgentProgressEvent["stepKind"] | undefined {
  return value === "intake" || value === "context" || value === "decide" || value === "act" || value === "observe" || value === "evaluate" || value === "checkpoint" || value === "complete" || value === "fail"
    ? value
    : undefined;
}

function readCompletionStatus(value: unknown): AgentProgressEvent["completionStatus"] | undefined {
  return value === "continue" || value === "waiting" || value === "finalizing" || value === "completed" || value === "partial" || value === "failed"
    ? value
    : undefined;
}

function readStringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => safeProgressText(item, 160)).filter(Boolean).slice(0, 20)
    : [];
}

function readProgressEvidence(value: unknown): NonNullable<AgentProgressEvent["evidence"]> {
  if (!Array.isArray(value)) return [];
  const evidence: NonNullable<AgentProgressEvent["evidence"]> = [];
  for (const item of value) {
    if (typeof item === "string") {
      const label = safeProgressText(item, 120);
      if (label) evidence.push({ kind: "runtime", label });
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      const source = item as Record<string, unknown>;
      const kind = readProgressEvidenceKind(source.kind);
      const label = safeProgressText(source.label, 120);
      const ref = safeProgressString(source.ref, 160);
      if (kind && label) evidence.push({ kind, label, ...(ref ? { ref } : {}) });
    }
    if (evidence.length >= 5) break;
  }
  return evidence;
}

function readProgressEvidenceKind(value: unknown): NonNullable<AgentProgressEvent["evidence"]>[number]["kind"] | undefined {
  return value === "tool" || value === "subagent" || value === "codegraph" || value === "search" || value === "file" || value === "runtime"
    ? value
    : undefined;
}

function createStreamTrace(payload: GenerateRequest) {
  const traceId = `client_stream_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = performance.now();
  let lastAt = startedAt;
  return (phase: string, details: Record<string, unknown> = {}) => {
    const now = performance.now();
    const event = typeof details.event === "string" ? details.event : "";
    const type = typeof details.type === "string" ? details.type : "";
    const shouldLog = phase !== "event"
      || event === "final"
      || event === "error"
      || event === "status"
      || event === "tool_event"
      || event === "progress_event"
      || event === "activity"
      || /^canvas_delivery_/.test(type)
      || /^agent_backend_/.test(type)
      || /llm_|heartbeat|waiting/i.test(type);
    if (!shouldLog) return;
    console.info("[FacetWrite stream trace]", {
      traceId,
      phase,
      mode: payload.mode,
      threadId: payload.threadId,
      planId: payload.planId,
      stepId: payload.stepId,
      elapsedMs: Math.round(now - startedAt),
      sinceLastMs: Math.round(now - lastAt),
      ...details
    });
    lastAt = now;
  };
}

function eventTypeFromData(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const record = data as Record<string, unknown>;
  const payload = record.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const nested = payload as Record<string, unknown>;
    if (typeof nested.eventType === "string") return nested.eventType;
    if (typeof nested.type === "string") return nested.type;
  }
  return typeof record.eventType === "string"
    ? record.eventType
    : typeof record.type === "string" ? record.type : "";
}
