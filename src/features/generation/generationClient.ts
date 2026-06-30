import type { GenerateRequest, GenerateResponse, RunTimelineEvent, StreamStatus } from "./types";
import { apiPost } from "../../shared/apiClient";

export async function generateText(payload: GenerateRequest): Promise<GenerateResponse> {
  return apiPost<GenerateResponse>("/api/generate", payload);
}

export async function generateTextStream(
  payload: GenerateRequest,
  handlers: {
    onToken?: (token: string) => void;
    onReasoningToken?: (token: string) => void;
    onStatus?: (status: StreamStatus) => void;
    onToolEvent?: (event: unknown) => void;
    onTimelineEvent?: (event: RunTimelineEvent) => void;
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
  const event = raw.split("\n").find((line) => line.startsWith("event: "))?.slice(7).trim();
  const dataLine = raw.split("\n").find((line) => line.startsWith("data: "));
  if (!event || !dataLine) return null;
  return { event, data: JSON.parse(dataLine.slice(6)) as unknown };
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
