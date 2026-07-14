import type { GenerateRequest, GenerateResponse, RunCompletionVerdict } from "../../contracts/generation.js";
import type { SQLiteStorageRepository } from "../../storage.js";
import type { Provider } from "../../types.js";
import type { ToolEventRecord } from "../../toolRuntime.js";
import type { ToolState } from "../../toolRegistry.js";
import { userMessageForRun } from "./promptRunBuilder.js";
import { extractTopLevelListItems } from "../canvasDelivery.js";
import { completionEvaluatedEvent, evaluateRunCompletion } from "./completionEvaluator.js";

export type RecordRunInput = {
  storage: SQLiteStorageRepository;
  payload: GenerateRequest;
  threadId: string;
  agentCardId: string;
  agentTitle: string;
  configuredModelApiId?: string;
  modelId?: string;
  mode: "structured" | "chat";
  prompt: string;
  text: string;
  provider: Provider;
  usedMock: boolean;
  toolState: ToolState;
  events?: ToolEventRecord[];
  finishReason?: string;
  runtimeRunId?: string;
  runtimeThreadId?: string;
  usage?: unknown;
  errorMessage?: string;
  completion?: RunCompletionVerdict;
};

export function recordGenerationRun(input: RecordRunInput): GenerateResponse {
  const completion = input.completion ?? evaluateRunCompletion({
    payload: input.payload,
    text: input.text,
    events: input.events,
    finishReason: input.finishReason,
    errorMessage: input.errorMessage
  });
  const events = appendCompletionEvent(input.events, completionEvaluatedEvent(completion));
  const saved = input.storage.recordRun({
    threadId: input.threadId,
    clientRequestId: input.payload.clientRequestId,
    agentCardId: input.agentCardId,
    configuredModelApiId: input.configuredModelApiId,
    modelId: input.modelId,
    mode: input.mode,
    prompt: input.prompt,
    output: input.text,
    provider: input.provider,
    usedMock: input.usedMock,
    errorMessage: input.errorMessage,
    userMessage: userMessageForRun(input.payload, input.agentTitle),
    toolState: input.toolState,
    events,
    finishReason: input.finishReason,
    runtimeRunId: input.runtimeRunId,
    runtimeThreadId: input.runtimeThreadId,
    resumedClarificationId: resumedClarificationId(input.payload),
    usage: input.usage,
    completion
  });
  const policy = input.payload.orchestrationPolicy;
  if (!input.usedMock && policy?.trigger === "ordinary" && policy.mode !== "managed_plan" && !input.payload.canvasAction) {
    const items = extractTopLevelListItems(input.text);
    if (items.length >= 3 && saved.runId) input.storage.createCanvasWriteSuggestion(input.threadId, saved.runId, items);
  }

  return {
    text: input.text,
    prompt: input.prompt,
    provider: input.provider,
    usedMock: input.usedMock,
    threadId: input.threadId,
    runId: saved.runId,
    runtimeRunId: input.runtimeRunId,
    runtimeThreadId: input.runtimeThreadId,
    errorMessage: input.errorMessage,
    events,
    finishReason: input.finishReason,
    completion,
    usage: input.usage
  };
}

function resumedClarificationId(payload: GenerateRequest) {
  const clarification = payload.contextValues?.agentClarification;
  if (!clarification || typeof clarification !== "object" || Array.isArray(clarification)) return undefined;
  const record = clarification as Record<string, unknown>;
  return record.resumeClaimed === true && typeof record.clarificationId === "string"
    ? record.clarificationId
    : undefined;
}

function appendCompletionEvent(events: ToolEventRecord[] | undefined, completionEvent: ToolEventRecord) {
  const existing = events?.filter((event) => event.eventType !== "completion_evaluated") ?? [];
  return [...existing, completionEvent];
}
