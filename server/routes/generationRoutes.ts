import type { Express, Response } from "express";
import { parseGenerateRequest, type GenerateRequest } from "../contracts/generation.js";
import type { GenerationService } from "../services/generationService.js";
import type { CanvasDomainService } from "../domains/canvas/index.js";
import type { SQLiteStorageRepository } from "../storage.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";
import { GenerationError } from "../domains/generation/index.js";
import { listAgentBackendRunEvents, requestAgentBackendRunIntervention } from "../runtime/agentBackendAdapter/client.js";
import { sanitizeToolEventPayload } from "../services/generation/toolEventSanitizer.js";

type GenerationRouteDeps = {
  generationService: GenerationService;
  canvasService: CanvasDomainService;
  storage: Pick<SQLiteStorageRepository, "findRuntimeRunMetadata">;
  planExecutor?: { wake: (threadId: string, planId: string) => void };
};

export function registerGenerationRoutes(app: Express, { generationService, canvasService, storage, planExecutor }: GenerationRouteDeps) {
  app.post("/api/generate", async (request, response) => {
    try {
      const payload = parseGenerateRequest(request.body);
      const result = await generationService.generateAndRecord(payload);
      wakePlanExecutionIfReady(planExecutor, payload, result);
      sendOk(response, result);
    } catch (error) {
      const status = error instanceof GenerationError ? generationErrorStatus(error.code) : error instanceof Error && error.message.startsWith("Request body") || error instanceof Error && error.message.startsWith("mode ") || error instanceof Error && error.message.startsWith("locale ")
        ? 400
        : 500;
      sendError(response, status, error instanceof GenerationError ? error.code : status === 400 ? "bad_request" : "internal_error", errorMessage(error, "Generation failed"));
    }
  });

  app.post("/api/generate/stream", async (request, response) => {
    const trace = createServerStreamTrace();
    const sendSse = (event: string, payload: unknown) => writeSse(response, event, payload, trace);
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });
    request.on("close", () => {
      trace("request_close", {
        aborted: request.aborted,
        readableEnded: request.readableEnded,
        responseWritableEnded: response.writableEnded
      });
    });
    response.on("close", () => {
      trace("response_close", {
        writableEnded: response.writableEnded,
        writableFinished: response.writableFinished,
        writableLength: response.writableLength
      });
    });
    response.on("error", (error) => {
      trace("response_error", { message: error.message });
    });

    try {
      const payload = parseGenerateRequest(request.body);
      trace("start", { mode: payload.mode, threadId: payload.threadId, planId: payload.planId, stepId: payload.stepId });
      const result = await generationService.generateAndRecordStream(payload, {
        onStatus: (status) => {
          trace("status", { label: status.label, statusPhase: status.phase });
          sendSse("status", status);
        },
        onToken: (token) => {
          trace("token", { length: token.length });
          sendSse("token", { text: token });
        },
        onReasoningToken: (token) => {
          trace("reasoning_token", { length: token.length });
          sendSse("reasoning_token", { text: token });
        },
        onTimelineEvent: (event) => {
          trace("timeline_event", { eventType: event.eventType, status: event.status, sequence: event.sequence });
          sendSse("timeline_event", event);
        },
        onProgressEvent: (event) => {
          trace("progress_event", { status: event.status, phase: event.phase });
          sendSse("progress_event", event);
        },
        onToolEvent: (event) => {
          const safePayload = sanitizeToolEventPayload(event.payload);
          const safeEvent = { ...event, payload: safePayload };
          trace("tool_event", {
            eventType: event.eventType,
            structuredEvent: typeof event.payload?.eventType === "string" ? event.payload.eventType : "",
            tool: typeof event.payload?.tool === "string" ? event.payload.tool : typeof event.payload?.toolName === "string" ? event.payload.toolName : "",
            deliveryId: typeof event.payload?.deliveryId === "string" ? event.payload.deliveryId : ""
          });
          sendSse("tool_event", safeEvent);
          const structuredEvent = typeof event.payload?.eventType === "string" ? event.payload.eventType : "";
          if (/^(?:plan_|artifact_)/.test(structuredEvent)) sendSse(structuredEvent, safePayload);
          if (/^(?:plan_|artifact_|canvas_)/.test(structuredEvent) || /(?:tool_started|tool_completed)$/.test(event.eventType)) {
            sendSse("activity", safePayload);
          }
        }
      });
      trace("final", { threadId: result.threadId, runId: result.runId, provider: result.provider, finishReason: result.finishReason });
      sendSse("final", result);
      wakePlanExecutionIfReady(planExecutor, payload, result);
    } catch (error) {
      trace("error", { message: errorMessage(error, "Generation failed") });
      sendSse("error", {
        code: error instanceof GenerationError ? error.code : error instanceof Error && (error.message.startsWith("Request body") || error.message.startsWith("mode ") || error.message.startsWith("locale ")) ? "bad_request" : "internal_error",
        message: errorMessage(error, "Generation failed")
      });
    } finally {
      trace("end");
      response.end();
    }
  });

  app.post("/api/generate/runs/:runId/interventions", async (request, response) => {
    try {
      const body = request.body as Record<string, unknown>;
      const threadId = typeof body.threadId === "string" ? body.threadId.trim() : "";
      const text = typeof body.text === "string" ? body.text.trim() : "";
      const inputId = typeof body.inputId === "string" ? body.inputId : undefined;
      if (!threadId || !text) {
        sendError(response, 400, "bad_request", "threadId and text are required");
        return;
      }
      sendOk(response, await requestAgentBackendRunIntervention({
        threadId,
        runId: request.params.runId,
        text,
        inputId
      }));
    } catch (error) {
      sendError(response, 503, "runtime_unavailable", errorMessage(error, "Unable to request run intervention"));
    }
  });

  app.get("/api/generate/runs/:runId/events", async (request, response) => {
    try {
      const threadId = typeof request.query.threadId === "string" ? request.query.threadId.trim() : "";
      const limit = typeof request.query.limit === "string" ? Number.parseInt(request.query.limit, 10) : undefined;
      if (!threadId) {
        sendError(response, 400, "bad_request", "threadId is required");
        return;
      }
      const runtimeRun = storage.findRuntimeRunMetadata(threadId, request.params.runId);
      const events = await listAgentBackendRunEvents({
        threadId: runtimeRun?.runtimeThreadId || threadId,
        runId: runtimeRun?.runtimeRunId || request.params.runId,
        limit
      });
      sendOk(response, { events: sanitizeRuntimeRunEvents(events) });
    } catch (error) {
      sendError(response, 503, "runtime_unavailable", errorMessage(error, "Unable to load runtime run events"));
    }
  });

  app.post("/api/threads/:threadId/canvas/range-rewrites", async (request, response) => {
    try {
      const body = request.body as Record<string, unknown>;
      const canvas = canvasService.getCanvas(request.params.threadId);
      const node = canvas?.nodes.find((item) => item.id === body.nodeId);
      const rangeStart = body.rangeStart;
      const rangeEnd = body.rangeEnd;
      const originalText = body.originalText;
      const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
      const locale = body.locale === "zh" ? "zh" : "en";
      if (!node || node.kind !== "document") throw new Error("Range rewrite requires a document node");
      if (!Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd) || typeof originalText !== "string" || !instruction) {
        throw new Error("Range rewrite selection and instruction are required");
      }
      const start = rangeStart as number;
      const end = rangeEnd as number;
      if (start < 0 || end <= start || end > node.content.length || node.content.slice(start, end) !== originalText || originalText.includes("\n")) {
        throw new Error("Range rewrite selection is stale or crosses paragraphs");
      }
      const paragraphStart = Math.max(node.content.lastIndexOf("\n", start - 1) + 1, 0);
      const nextBreak = node.content.indexOf("\n", end);
      const paragraph = node.content.slice(paragraphStart, nextBreak < 0 ? node.content.length : nextBreak);
      const result = await generationService.generateAndRecord({
        mode: "freeText",
        locale,
        threadId: request.params.threadId,
        agentCardId: typeof body.agentCardId === "string" ? body.agentCardId : undefined,
        modelOverrides: readModelOverrides(body.modelOverrides),
        systemPrompt: "Rewrite only the selected text. Return replacement text only, with no explanation, labels, quotes, or markdown fences. Preserve the surrounding language and tone.",
        freeTextPrompt: instruction,
        contextValues: { selectedText: originalText, containingParagraph: paragraph }
      });
      const replacement = result.text.trim();
      if (!replacement) throw new Error("Range rewrite returned empty text");
      const writeRequest = canvasService.createWriteRequest(request.params.threadId, {
        operation: "replace_range",
        targetNodeId: node.id,
        nodeKind: "document",
        title: node.title,
        content: replacement,
        rationale: instruction,
        rangeStart: start,
        rangeEnd: end,
        originalText,
        baseNodeUpdatedAt: node.updatedAt
      });
      sendOk(response, { request: writeRequest });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create range rewrite"));
    }
  });
}

function wakePlanExecutionIfReady(
  planExecutor: GenerationRouteDeps["planExecutor"],
  payload: GenerateRequest,
  result: { finishReason?: string }
) {
  if (result.finishReason === "clarification_required") return;
  if (payload.planPhase !== "execution" || !payload.threadId || !payload.planId) return;
  planExecutor?.wake(payload.threadId, payload.planId);
}

function generationErrorStatus(code: GenerationError["code"]) {
  if (code === "model_required" || code === "model_not_ready") return 409;
  if (code === "runtime_auth_failed") return 401;
  return 503;
}

function readModelOverrides(value: unknown): GenerateRequest["modelOverrides"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const thinkingMode = input.thinkingMode === "enabled" || input.thinkingMode === "disabled" ? input.thinkingMode : undefined;
  const effort = input.reasoningEffort;
  const reasoningEffort = effort === "high" || effort === "max" || effort === "low" || effort === "medium" || effort === "xhigh" ? effort : undefined;
  return thinkingMode || reasoningEffort ? { thinkingMode, reasoningEffort } : undefined;
}

function writeSse(
  response: Response,
  event: string,
  payload: unknown,
  trace?: ReturnType<typeof createServerStreamTrace>
) {
  const eventWriteAccepted = response.write(`event: ${event}\n`);
  const dataWriteAccepted = response.write(`data: ${JSON.stringify(payload)}\n\n`);
  if (!eventWriteAccepted || !dataWriteAccepted) {
    trace?.("sse_backpressure", {
      event,
      eventWriteAccepted,
      dataWriteAccepted,
      writableEnded: response.writableEnded,
      writableLength: response.writableLength
    });
  }
}

function sanitizeRuntimeRunEvents(events: unknown[]) {
  return events
    .flatMap((event) => sanitizeRuntimeRunEvent(event))
    .slice(0, 500);
}

function sanitizeRuntimeRunEvent(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const source = value as Record<string, unknown>;
  const eventType = readString(source.event_type ?? source.eventType);
  if (!eventType || isHiddenRuntimeEventType(eventType)) return [];
  const category = readString(source.category);
  const content = sanitizeRuntimeRunValue(source.content, 0);
  const metadata = sanitizeRuntimeRunValue(source.metadata, 0);
  return [{
    threadId: readString(source.thread_id ?? source.threadId),
    runId: readString(source.run_id ?? source.runId),
    eventType,
    category,
    content,
    metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {},
    sequence: readInteger(source.seq ?? source.sequence),
    createdAt: readString(source.created_at ?? source.createdAt)
  }];
}

function isHiddenRuntimeEventType(eventType: string) {
  return /^(?:human_message|ai_message|llm\.human\.input|llm\.ai\.response)$/i.test(eventType);
}

function sanitizeRuntimeRunValue(value: unknown, depth: number): unknown {
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") return redactSecretLikeText(value).replace(/\s+/g, " ").trim().slice(0, 900);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeRuntimeRunValue(item, depth + 1));
  if (!value || typeof value !== "object") return "";
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 40).map(([key, entry]) => (
    secretKeyPattern.test(key)
      ? [key, "[redacted]"]
      : [key, sanitizeRuntimeRunValue(entry, depth + 1)]
  )));
}

const secretKeyPattern = /(key|token|secret|password|credential|authorization|cookie)/i;

function redactSecretLikeText(value: string) {
  return value
    .replace(/\b[A-Za-z0-9_]*(?:api[_-]?key|authorization|token|password|secret|cookie)\s*[:=]\s*\S+/gi, "[redacted credential]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted credential]");
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readInteger(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : 0;
  return Number.isInteger(number) ? number : 0;
}

function createServerStreamTrace() {
  const traceId = `server_stream_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  let lastAt = startedAt;
  return (phase: string, details: Record<string, unknown> = {}) => {
    const now = Date.now();
    const eventType = typeof details.eventType === "string" ? details.eventType : "";
    const structuredEvent = typeof details.structuredEvent === "string" ? details.structuredEvent : "";
    const shouldLog = phase !== "token"
      || now - lastAt > 5000
      || /^canvas_delivery_/.test(structuredEvent)
      || /^agent_backend_/.test(eventType);
    if (!shouldLog) return;
    console.info("[FacetWrite server stream trace]", {
      traceId,
      phase,
      elapsedMs: now - startedAt,
      sinceLastMs: now - lastAt,
      ...details
    });
    lastAt = now;
  };
}
