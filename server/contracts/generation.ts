import type { Locale } from "../promptBuilder.js";
import type { ToolEventRecord } from "../toolRuntime.js";
import type { Provider, ProviderId } from "../types.js";
import type { ToolState } from "../toolRegistry.js";
import type { CanvasAction } from "../services/generation/canvasActionPolicy.js";
import type { OrchestrationPolicy } from "../services/generation/orchestrationPolicy.js";

export type GenerateRequest = {
  mode: "faceted" | "freeText" | "structured" | "chat";
  taskId?: string;
  agentCardId?: string;
  projectId?: string;
  threadId?: string;
  locale: Locale;
  formValues?: Record<string, string | string[]>;
  structuredValues?: Record<string, string | string[]>;
  contextValues?: Record<string, unknown>;
  freeTextPrompt?: string;
  chatInstruction?: string;
  toolState?: ToolState;
  systemPrompt?: string;
  providerId?: ProviderId;
  modelOverrides?: {
    thinkingMode?: "enabled" | "disabled";
    reasoningEffort?: "high" | "max" | "low" | "medium" | "xhigh";
  };
  selectedCanvasNodeId?: string;
  planPhase?: "intake" | "revise" | "execution";
  planId?: string;
  stepId?: string;
  planGeneration?: {
    phase: "intake" | "revise" | "execution";
    planId: string;
    stepId?: string;
    phaseAttemptId: string;
    executionVersion?: number;
  };
  canvasAction?: CanvasAction;
  orchestrationPolicy?: OrchestrationPolicy;
};

export type GenerateResponse = {
  text: string;
  prompt: string;
  provider: Provider;
  usedMock: boolean;
  threadId: string;
  runId?: string;
  errorMessage?: string;
  events?: ToolEventRecord[];
  finishReason?: string;
  usage?: unknown;
};

export function parseGenerateRequest(value: unknown): GenerateRequest {
  if (!value || typeof value !== "object") {
    throw new Error("Request body must be an object");
  }

  const body = value as Record<string, unknown>;
  const mode = body.mode;
  const locale = body.locale;
  if (mode !== "faceted" && mode !== "freeText" && mode !== "structured" && mode !== "chat") {
    throw new Error("mode must be faceted, freeText, structured, or chat");
  }
  if (locale !== "en" && locale !== "zh") {
    throw new Error("locale must be en or zh");
  }

  return {
    mode,
    locale,
    taskId: readString(body.taskId),
    agentCardId: readString(body.agentCardId),
    projectId: readString(body.projectId),
    threadId: readString(body.threadId),
    formValues: readStringRecord(body.formValues),
    structuredValues: readStringRecord(body.structuredValues),
    contextValues: readUnknownRecord(body.contextValues),
    freeTextPrompt: readString(body.freeTextPrompt),
    chatInstruction: readString(body.chatInstruction),
    toolState: readBooleanRecord(body.toolState),
    systemPrompt: readString(body.systemPrompt),
    providerId: readProviderId(body.providerId),
    modelOverrides: readModelOverrides(body.modelOverrides),
    selectedCanvasNodeId: readString(body.selectedCanvasNodeId)
    ,planPhase: body.planPhase === "intake" || body.planPhase === "revise" || body.planPhase === "execution" ? body.planPhase : undefined
    ,planId: readString(body.planId)
    ,stepId: readString(body.stepId)
    ,planGeneration: readPlanGeneration(body.planGeneration)
    ,canvasAction: readCanvasAction(body.canvasAction)
    ,orchestrationPolicy: readOrchestrationPolicy(body.orchestrationPolicy)
  };
}

function readOrchestrationPolicy(value: unknown): OrchestrationPolicy | undefined {
  const record = readUnknownRecord(value);
  if (!record) return undefined;
  if (record.mode !== "direct" && record.mode !== "guided" && record.mode !== "managed_plan") return undefined;
  if (record.trigger !== "ordinary" && record.trigger !== "explicit_plan") return undefined;
  if (record.clarificationPolicy !== "when_needed" && record.clarificationPolicy !== "required_once") return undefined;
  if (record.deliveryPolicy !== "conversation_only" && record.deliveryPolicy !== "canvas_required") return undefined;
  return record as OrchestrationPolicy;
}

function readPlanGeneration(value: unknown): GenerateRequest["planGeneration"] {
  const record = readUnknownRecord(value);
  const phase = record?.phase;
  const planId = readString(record?.planId);
  const phaseAttemptId = readString(record?.phaseAttemptId);
  if ((phase !== "intake" && phase !== "revise" && phase !== "execution") || !planId || !phaseAttemptId) return undefined;
  return {
    phase,
    planId,
    phaseAttemptId,
    stepId: readString(record?.stepId),
    executionVersion: typeof record?.executionVersion === "number" ? record.executionVersion : undefined
  };
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function readProviderId(value: unknown): ProviderId | undefined {
  return value === "deepseek" || value === "openai" || value === "openai-compatible" ? value : undefined;
}

function readUnknownRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readStringRecord(value: unknown) {
  const record = readUnknownRecord(value);
  if (!record) return undefined;

  return Object.fromEntries(
    Object.entries(record)
      .filter(([, entry]) => typeof entry === "string" || (Array.isArray(entry) && entry.every((item) => typeof item === "string")))
  ) as Record<string, string | string[]>;
}

function readBooleanRecord(value: unknown) {
  const record = readUnknownRecord(value);
  if (!record) return undefined;

  return Object.fromEntries(
    Object.entries(record).filter(([, entry]) => typeof entry === "boolean")
  ) as ToolState;
}

function readModelOverrides(value: unknown): GenerateRequest["modelOverrides"] {
  const record = readUnknownRecord(value);
  if (!record) return undefined;
  const thinkingMode = record.thinkingMode === "enabled" || record.thinkingMode === "disabled" ? record.thinkingMode : undefined;
  const effort = record.reasoningEffort;
  const reasoningEffort = effort === "high" || effort === "max" || effort === "low" || effort === "medium" || effort === "xhigh" ? effort : undefined;
  if (!thinkingMode && !reasoningEffort) return undefined;
  return { thinkingMode, reasoningEffort };
}

function readCanvasAction(value: unknown): CanvasAction | undefined {
  const record = readUnknownRecord(value);
  if (!record) return undefined;
  const operation = record.operation;
  const risk = record.risk;
  if (operation !== "create" && operation !== "append" && operation !== "replace" && operation !== "replace_range" && operation !== "delete") return undefined;
  if (risk !== "low" && risk !== "high") return undefined;
  const id = readString(record.id);
  if (!id) return undefined;
  return {
    id,
    operation,
    risk,
    requiresTool: record.requiresTool === true,
    targetNodeId: readString(record.targetNodeId)
  };
}
