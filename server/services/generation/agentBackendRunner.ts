import type { AgentRuntimeConfig } from "../agentDefinitionService.js";
import type { ConversationModelRuntimeSettings } from "../../agentCards.js";
import type { GenerateRequest } from "../../contracts/generation.js";
import { getAgentBackendRuntimeConfig, type AgentBackendRuntimeConfig } from "../../runtime/agentBackendAdapter/config.js";
import { resumeAgentBackendRun, runAgentBackendAgent } from "../../runtime/agentBackendAdapter/client.js";
import type { AgentBackendRuntimeSignal } from "../../runtime/agentBackendAdapter/client.js";
import type { ChatMessage } from "../../providerRuntime.js";
import type { ToolEventRecord } from "../../toolRuntime.js";
import type { StreamStatus } from "../../agentRunLoop.js";
import { applyCanvasWriteToolExposure } from "./canvasWriteScopePolicy.js";
import {
  agentIntakeToolRefsForPayload,
  isAgentIntakePhase,
  isProgressiveCanvasDelivery,
  withAgentIntakeExecutionPhase,
  withSanitizedAgentIntakeCanvas
} from "./agentIntakePolicy.js";

export type AgentBackendRunnerInput = {
  payload: GenerateRequest;
  threadId: string;
  projectId: string;
  configuredModelApiId: string;
  modelSettings: ConversationModelRuntimeSettings;
  runtimeConfig: AgentRuntimeConfig;
  messages: ChatMessage[];
  prompt: string;
  facetwriteMemoryContent?: string;
  onToolEvent?: (event: ToolEventRecord) => void;
  onToken?: (token: string) => void;
  onReasoningToken?: (token: string) => void;
  onStatus?: (status: StreamStatus) => void;
  onRuntimeSignal?: (signal: AgentBackendRuntimeSignal) => void;
};

export type AgentBackendRunnerDeps = {
  getRuntimeConfig?: () => AgentBackendRuntimeConfig;
  runAgent?: typeof runAgentBackendAgent;
  resumeRun?: typeof resumeAgentBackendRun;
};

export async function runAgentBackendGeneration(input: AgentBackendRunnerInput, deps: AgentBackendRunnerDeps = {}) {
  const config = (deps.getRuntimeConfig ?? getAgentBackendRuntimeConfig)();
  if (!config.enabled) return undefined;
  input = { ...input, payload: withSanitizedAgentIntakeCanvas(input.payload) };

  const agentClarification = readRecord(input.payload.contextValues?.agentClarification);
  const runtimeResume = readRuntimeResumeMetadata(readRecord(agentClarification.resumeContext)?.runtimeResume);
  if (agentClarification.requiresRuntimeResume === true && !runtimeResume) {
    throw new Error("Agent clarification answer is missing runtime resume metadata; refresh the thread and answer the latest clarification.");
  }

  const baseRunInput = buildBaseRunInput(input, config);

  const run = runtimeResume
    ? await (deps.resumeRun ?? resumeAgentBackendRun)({
      ...baseRunInput,
      threadId: runtimeResume.runtimeThreadId || input.threadId,
      resume: buildClarificationResumePayload(agentClarification),
      resumeOfRunId: runtimeResume.runtimeRunId,
      interruptId: runtimeResume.interruptId,
      checkpointId: runtimeResume.checkpointId
    })
    : await (deps.runAgent ?? runAgentBackendAgent)(baseRunInput);

  if (isAgentIntakePhase(input.payload) && hasAgentIntakeCompleteEvent(run.events)) {
    const executionPayload = withAgentIntakeExecutionPhase(input.payload);
    const executionInput = buildBaseRunInput({ ...input, payload: executionPayload }, config);
    const executionRun = await (deps.runAgent ?? runAgentBackendAgent)(executionInput);
    return {
      ...executionRun,
      events: [...run.events, ...executionRun.events]
    };
  }

  if (!run.text && !run.events.some((event) => /(?:^|_)(?:plan|artifact|canvas|agent_intake)_/.test(event.eventType))) {
    if (!hasAgentClarificationEvent(run.events)) {
      throw new Error("AgentBackend completed with no visible assistant text or structured lifecycle events");
    }
  }

  return run;
}

function buildBaseRunInput(input: AgentBackendRunnerInput, config: AgentBackendRuntimeConfig) {
  return {
    config,
    threadId: input.threadId,
    projectId: input.projectId,
    configuredModelApiId: input.configuredModelApiId,
    modelSettings: input.modelSettings,
    agentCard: input.runtimeConfig.agentCard,
    settings: input.runtimeConfig.settings,
    messages: input.messages,
    prompt: input.prompt,
    facetwriteMemoryContent: input.facetwriteMemoryContent,
    allowedToolRefs: allowedToolsForRequest(input),
    toolState: input.payload.toolState,
    selectedCanvasNodeId: input.payload.selectedCanvasNodeId,
    planPhase: input.payload.planPhase,
    planId: input.payload.planId,
    stepId: input.payload.stepId,
    planGeneration: input.payload.planGeneration,
    contextValues: { ...input.payload.contextValues, ...(input.payload.canvasAction ? { canvasAction: input.payload.canvasAction } : {}), ...(input.payload.planGeneration ? { planGeneration: input.payload.planGeneration } : {}) },
    chatInstruction: input.payload.chatInstruction ?? input.payload.freeTextPrompt,
    onToolEvent: input.onToolEvent,
    onToken: input.onToken,
    onReasoningToken: input.onReasoningToken,
    onStatus: input.onStatus,
    onRuntimeSignal: input.onRuntimeSignal
  };
}

function allowedToolsForRequest(input: AgentBackendRunnerInput) {
  if (isAgentIntakePhase(input.payload)) return agentIntakeToolRefsForPayload(input.payload);
  const allowed = new Set<string>(input.runtimeConfig.enabledTools);
  for (const tool of ["plan_clarification_submit", "plan_revision_submit", "artifact_stage"] as const) {
    if (input.payload.toolState?.[tool]) allowed.add(tool);
  }
  const exposed = applyCanvasWriteToolExposure([...allowed], {
    progressiveCanvasDeliveryEnabled: isProgressiveMarkdownFileDelivery(input.payload),
    canvasActionRequiresTool: input.payload.canvasAction?.requiresTool === true
  });
  allowed.clear();
  for (const tool of exposed) allowed.add(tool);
  if (isProgressiveMarkdownFileDelivery(input.payload)) {
    allowed.add("write_file");
    allowed.add("present_files");
  }
  if (shouldAllowAgentClarification(input.payload)) {
    allowed.add("ask_clarification");
  }
  return [...allowed];
}

function isProgressiveMarkdownFileDelivery(payload: GenerateRequest) {
  return isProgressiveCanvasDelivery(payload);
}

function shouldAllowAgentClarification(payload: GenerateRequest) {
  if ((payload.transientSkillRefs ?? []).length > 0) return true;
  if (isProgressiveMarkdownFileDelivery(payload)) return true;
  return Boolean(payload.contextValues?.facetwrite_clarification_policy);
}

function hasAgentClarificationEvent(events: ToolEventRecord[]) {
  return events.some((event) => /agent_clarification_(?:requested|invalid)$/.test(event.eventType));
}

function hasAgentIntakeCompleteEvent(events: ToolEventRecord[]) {
  return events.some((event) => event.eventType === "agent_backend_agent_intake_complete");
}

function buildClarificationResumePayload(agentClarification: Record<string, unknown>) {
  return {
    type: "agent_clarification_answer",
    clarificationId: readString(agentClarification.clarificationId),
    question: readString(agentClarification.question),
    selectedOptionId: readString(agentClarification.selectedOptionId),
    answer: readString(agentClarification.answer),
    option: readRecord(agentClarification.option)
  };
}

function readRuntimeResumeMetadata(value: unknown) {
  const record = readRecord(value);
  const runtimeThreadId = readString(record.runtimeThreadId);
  const runtimeRunId = readString(record.runtimeRunId);
  const interruptId = readString(record.interruptId);
  const checkpointId = readString(record.checkpointId);
  if (!runtimeThreadId || !runtimeRunId || !interruptId) return undefined;
  return {
    runtimeThreadId,
    runtimeRunId,
    interruptId,
    ...(checkpointId ? { checkpointId } : {})
  };
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}
