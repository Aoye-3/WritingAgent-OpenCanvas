import type { StreamStatus } from "../../agentRunLoop.js";
import type { AgentCard, AgentSettings, ConversationModelRuntimeSettings } from "../../agentCards.js";
import type { GenerateRequest } from "../../contracts/generation.js";
import type { ChatMessage } from "../../providerRuntime.js";
import type { ToolEventRecord } from "../../toolRuntime.js";
import type { ToolState } from "../../toolRegistry.js";
import { authenticatedAgentBackendFetch } from "./auth.js";
import { getAgentBackendRuntimeConfig, type AgentBackendRuntimeConfig } from "./config.js";
import { parseSseChunk } from "./sse.js";
import { buildAgentBackendRuntimeMetadata } from "./taskAgentMapping.js";
import { resolvePlanRequestPolicy } from "../../services/generation/planRequestPolicy.js";
import { resolveCanvasAction } from "../../services/generation/canvasActionPolicy.js";
import type { CanvasAction } from "../../services/generation/canvasActionPolicy.js";
import { isDirectCanvasDeliveryIntent } from "../../services/generation/canvasDeliveryIntent.js";
import {
  SHORT_PROGRESS_CANVAS_WRITE_POLICY,
  applyCanvasWriteToolExposure,
  applyCanvasWriteToolState,
  canvasWriteScopeForRun
} from "../../services/generation/canvasWriteScopePolicy.js";

export type AgentBackendRunInput = {
  threadId: string;
  projectId: string;
  configuredModelApiId: string;
  modelSettings?: ConversationModelRuntimeSettings;
  agentCard: AgentCard;
  settings?: AgentSettings;
  messages: ChatMessage[];
  prompt: string;
  allowedToolRefs?: string[];
  toolState?: ToolState;
  selectedCanvasNodeId?: string;
  planPhase?: GenerateRequest["planPhase"];
  planId?: string;
  stepId?: string;
  planGeneration?: GenerateRequest["planGeneration"];
  contextValues?: Record<string, unknown>;
  chatInstruction?: string;
  facetwriteMemoryContent?: string;
  fetchImpl?: typeof fetch;
  config?: AgentBackendRuntimeConfig;
  onToolEvent?: (event: ToolEventRecord) => void;
  onToken?: (token: string) => void;
  onReasoningToken?: (token: string) => void;
  onStatus?: (status: StreamStatus) => void;
  onRuntimeSignal?: (signal: AgentBackendRuntimeSignal) => void;
};

export type AgentBackendRunResult = {
  text: string;
  finishReason: string;
  usage?: unknown;
  events: ToolEventRecord[];
};

export type AgentBackendRuntimeSignal = {
  type: "heartbeat" | "llm_retry" | "llm_call_start" | "llm_call_end" | "llm_call_error" | "synthesis_gate" | "waiting_for_user";
  label: string;
  payload?: Record<string, unknown>;
};

const streamLabels = {
  thinking: "Thinking...",
  searching: "Searching...",
  writing: "Writing...",
  finalizing: "Finalizing..."
} as const;

type AgentBackendRunContext = {
  model_name: string;
  thinking_enabled?: boolean;
  reasoning_effort?: string;
  facetwrite_memory_enabled: boolean;
  facetwrite_memory_scope_id: string;
  facetwrite_project_id: string;
  facetwrite_mcp_refs: string[];
  facetwrite_plan_phase: "chat" | "planning" | "execution";
  facetwrite_plan_stage: "chat" | "intake" | "revise" | "preflight" | "execution";
  facetwrite_plan_phase_attempt_id?: string;
  facetwrite_plan_id?: string;
  facetwrite_plan_step_id?: string;
  facetwrite_memory_content?: string;
  facetwrite_research_tool_limit?: number;
  facetwrite_progressive_canvas_delivery_enabled?: boolean;
  facetwrite_runtime_budget_profile?: "low" | "medium" | "high";
  facetwrite_recursion_limit?: number;
  facetwrite_model_call_limit?: number;
  facetwrite_evidence_tool_limit?: number;
  facetwrite_body_draft_write_limit?: number;
  facetwrite_body_draft_writes_used?: number;
  facetwrite_synthesis_reserve_steps?: number;
  facetwrite_force_synthesis_after_evidence?: boolean;
  facetwrite_evidence_tools?: string[];
  facetwrite_markdown_file_delivery_policy?: string;
  facetwrite_markdown_file_delivery_required?: boolean;
  facetwrite_canvas_write_scope?: "short_progress_nodes";
  facetwrite_canvas_write_policy?: typeof SHORT_PROGRESS_CANVAS_WRITE_POLICY;
  facetwrite_task_completion_policy?: string;
  facetwrite_clarification_policy?: string | Record<string, unknown>;
  facetwrite_clarification_phase?: "clarification_guard";
};

export async function runAgentBackendAgent(input: AgentBackendRunInput): Promise<AgentBackendRunResult> {
  const config = input.config ?? getAgentBackendRuntimeConfig();
  if (!config.enabled) {
    throw new Error("AgentBackend runtime is disabled");
  }

  const response = await authenticatedAgentBackendFetch({
    config,
    path: "/api/runs/stream",
    fetchImpl: input.fetchImpl,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildRunRequest(input, config))
    }
  });

  if (!response.ok) {
    throw new Error(await formatRuntimeHttpError(response));
  }
  if (!response.body) {
    throw new Error("AgentBackend runtime returned an empty stream");
  }

  input.onStatus?.({ phase: "thinking", label: streamLabels.thinking });
  return readAgentBackendStream(response.body, {
    onToolEvent: input.onToolEvent,
    onToken: input.onToken,
    onReasoningToken: input.onReasoningToken,
    onStatus: input.onStatus,
    onRuntimeSignal: input.onRuntimeSignal
  });
}

async function formatRuntimeHttpError(response: Response) {
  const prefix = `AgentBackend runtime returned HTTP ${response.status}`;
  const detail = (await response.text()).trim().replace(/\s+/g, " ").slice(0, 240);
  if (!detail) return prefix;
  if (/api[_-]?key|authorization|token|password|secret|cookie/i.test(detail)) {
    return `${prefix}: credential-related error`;
  }
  return `${prefix}: ${detail}`;
}

export function buildRunRequest(input: AgentBackendRunInput, config: AgentBackendRuntimeConfig) {
  const baseRuntimeContext = buildAgentBackendRunContext(input);
  const skillScopeGuardPolicy = skillScopeGuardPolicyFromContext(input.contextValues);
  const skillScopeGuard = Boolean(skillScopeGuardPolicy);
  const runtimeContext = skillScopeGuardPolicy
    ? withClarificationGuardContext(baseRuntimeContext, skillScopeGuardPolicy)
    : baseRuntimeContext;
  const providedCanvasAction = input.contextValues?.canvasAction as CanvasAction | undefined;
  const canvasAction = skillScopeGuard
    ? undefined
    : providedCanvasAction ?? resolveCanvasAction({
      threadId: input.threadId,
      instruction: input.chatInstruction,
      selectedCanvasNodeId: input.selectedCanvasNodeId
    });
  const effectiveRuntimeContext = canvasAction?.requiresTool
    ? { ...runtimeContext, facetwrite_canvas_write_scope: undefined, facetwrite_canvas_write_policy: undefined }
    : runtimeContext;
  const baseAllowedToolRefs = skillScopeGuard
    ? ["ask_clarification"]
    : canvasAction?.requiresTool
    ? [...new Set([...(input.allowedToolRefs ?? input.agentCard.toolRefs), "canvas_write"])]
    : input.allowedToolRefs ?? input.agentCard.toolRefs;
  const chatAllowedToolRefs = applyCanvasWriteToolExposure(baseAllowedToolRefs, {
    skillScopeGuard,
    progressiveCanvasDeliveryEnabled: effectiveRuntimeContext.facetwrite_progressive_canvas_delivery_enabled === true,
    canvasActionRequiresTool: canvasAction?.requiresTool === true
  });
  const allowedToolRefs = !skillScopeGuard && effectiveRuntimeContext.facetwrite_markdown_file_delivery_required
    ? [...new Set([...chatAllowedToolRefs, "write_file", "present_files"])]
    : chatAllowedToolRefs;
  const baseToolState = skillScopeGuard
    ? { ask_clarification: true }
    : canvasAction?.requiresTool
    ? { ...(input.toolState ?? {}), canvas_write: true }
    : input.toolState ?? {};
  const toolState = applyCanvasWriteToolState(baseToolState, {
    skillScopeGuard,
    progressiveCanvasDeliveryEnabled: effectiveRuntimeContext.facetwrite_progressive_canvas_delivery_enabled === true,
    canvasActionRequiresTool: canvasAction?.requiresTool === true
  });
  const scopedContextValues = {
    ...(input.contextValues ?? {}),
    ...(effectiveRuntimeContext.facetwrite_canvas_write_scope ? { facetwrite_canvas_write_scope: effectiveRuntimeContext.facetwrite_canvas_write_scope } : {})
  };
  return {
    assistant_id: config.assistantId,
    input: {
      messages: input.messages.map((message) => ({
        role: message.role,
        content: message.content ?? ""
      }))
    },
    metadata: buildAgentBackendRuntimeMetadata(input.agentCard, input.settings),
    config: {
      ...(effectiveRuntimeContext.facetwrite_recursion_limit ? { recursion_limit: effectiveRuntimeContext.facetwrite_recursion_limit } : {}),
      configurable: {
        thread_id: input.threadId,
        ...effectiveRuntimeContext
      }
    },
    context: {
      facetwrite_prompt: input.prompt,
      facetwrite_allowed_tool_refs: allowedToolRefs,
      facetwrite_tool_state: toolState,
      facetwrite_selected_canvas_node_id: input.selectedCanvasNodeId,
      facetwrite_context_values: scopedContextValues,
      facetwrite_chat_instruction: input.chatInstruction ?? input.prompt,
      facetwrite_canvas_action: canvasAction,
      facetwrite_canvas_delivery_contract: input.contextValues?.canvasDeliveryContract,
      ...effectiveRuntimeContext
    },
    stream_mode: ["messages-tuple", "custom", "values"],
    stream_subgraphs: true,
    multitask_strategy: "interrupt",
    if_not_exists: "create",
    on_disconnect: "cancel",
    on_completion: "keep"
  };
}

function skillScopeGuardPolicyFromContext(contextValues: AgentBackendRunInput["contextValues"]) {
  const policy = contextValues?.facetwrite_clarification_policy;
  return isRecord(policy) && policy.mode === "skill_scope_guard" ? policy : undefined;
}

function withoutProgressiveDeliveryContext(context: AgentBackendRunContext): AgentBackendRunContext {
  return {
    ...context,
    facetwrite_research_tool_limit: undefined,
    facetwrite_progressive_canvas_delivery_enabled: undefined,
    facetwrite_runtime_budget_profile: undefined,
    facetwrite_recursion_limit: undefined,
    facetwrite_model_call_limit: undefined,
    facetwrite_evidence_tool_limit: undefined,
    facetwrite_body_draft_write_limit: undefined,
    facetwrite_body_draft_writes_used: undefined,
    facetwrite_synthesis_reserve_steps: undefined,
    facetwrite_force_synthesis_after_evidence: undefined,
    facetwrite_evidence_tools: undefined,
    facetwrite_markdown_file_delivery_policy: undefined,
    facetwrite_markdown_file_delivery_required: undefined,
    facetwrite_canvas_write_scope: undefined,
    facetwrite_canvas_write_policy: undefined
  };
}

function withClarificationGuardContext(context: AgentBackendRunContext, policy: Record<string, unknown>): AgentBackendRunContext {
  return {
    ...withoutProgressiveDeliveryContext(context),
    thinking_enabled: false,
    reasoning_effort: undefined,
    facetwrite_clarification_policy: policy,
    facetwrite_clarification_phase: "clarification_guard"
  };
}

function buildAgentBackendRunContext(input: Pick<AgentBackendRunInput, "threadId" | "projectId" | "configuredModelApiId" | "modelSettings" | "settings" | "facetwriteMemoryContent" | "chatInstruction" | "contextValues" | "toolState" | "planPhase" | "planId" | "stepId" | "planGeneration">): AgentBackendRunContext {
  const memoryEnabled = false;
  const memoryContent = memoryEnabled ? input.facetwriteMemoryContent?.trim() : "";
  const planPolicy = resolvePlanRequestPolicy({
    chatInstruction: input.chatInstruction,
    contextValues: input.contextValues,
    toolState: input.toolState,
    planPhase: input.planPhase,
    planId: input.planId,
    stepId: input.stepId
  });
  const planGeneration = input.planGeneration ?? (input.contextValues?.planGeneration && isRecord(input.contextValues.planGeneration)
    ? input.contextValues.planGeneration
    : undefined);
  const researchToolLimit = isDirectCanvasDeliveryIntent(input.chatInstruction ?? "") ? 8 : undefined;
  const progressiveDelivery = isRecord(input.contextValues?.progressiveCanvasDelivery)
    ? input.contextValues.progressiveCanvasDelivery
    : undefined;
  const progressiveCanvasDeliveryEnabled = progressiveDelivery?.enabled === true ? true : undefined;
  const evidenceToolLimit = typeof progressiveDelivery?.evidenceToolLimit === "number" && progressiveDelivery.evidenceToolLimit > 0
    ? Math.floor(progressiveDelivery.evidenceToolLimit)
    : undefined;
  const bodyDraftWriteLimit = typeof progressiveDelivery?.bodyDraftWriteLimit === "number" && progressiveDelivery.bodyDraftWriteLimit > 0
    ? Math.floor(progressiveDelivery.bodyDraftWriteLimit)
    : undefined;
  const recursionLimit = typeof progressiveDelivery?.recursionLimit === "number" && progressiveDelivery.recursionLimit > 0
    ? Math.floor(progressiveDelivery.recursionLimit)
    : undefined;
  const modelCallLimit = typeof progressiveDelivery?.modelCallLimit === "number" && progressiveDelivery.modelCallLimit > 0
    ? Math.floor(progressiveDelivery.modelCallLimit)
    : undefined;
  const synthesisReserveSteps = typeof progressiveDelivery?.synthesisReserveSteps === "number" && progressiveDelivery.synthesisReserveSteps > 0
    ? Math.floor(progressiveDelivery.synthesisReserveSteps)
    : undefined;
  const budgetProfile = progressiveDelivery?.runtimeBudgetProfile === "low" || progressiveDelivery?.runtimeBudgetProfile === "high"
    ? progressiveDelivery.runtimeBudgetProfile
    : progressiveDelivery?.runtimeBudgetProfile === "medium" ? "medium" : undefined;
  const forceSynthesisAfterEvidence = progressiveDelivery?.forceSynthesisAfterEvidence === true ? true : undefined;
  const canvasWriteScope = canvasWriteScopeForRun({
    progressiveCanvasDeliveryEnabled: progressiveCanvasDeliveryEnabled === true
  });
  const markdownFileDeliveryRequired = progressiveCanvasDeliveryEnabled && !isDirectCanvasDeliveryIntent(input.chatInstruction ?? "")
    ? true
    : undefined;
  const markdownFileDeliveryPolicy = progressiveCanvasDeliveryEnabled
    ? "For medium or long text deliverables, especially if you perform two or more web_search calls or use a complex writing/research skill, first draft the complete user deliverable, then write that full Markdown report to /mnt/user-data/outputs/*.md with write_file and call present_files. The file content must contain the actual report, summary tables, findings, and references when applicable. Never write a delivery note, skill-loading note, clarification question, or file-save status as the Markdown file content. Use canvas_write only for short progressive nodes such as summaries, overviews, progress/reference notes, and references; never use canvas_write for the body, final body, full report, or full document. Keep the final chat response concise only after the full file is saved and presented; the Canvas body should contain a readable summary, while the full document lives in the Markdown file."
    : undefined;
  const taskCompletionPolicy = planPolicy.phase === "chat"
    ? "Complete the user's task directly when reasonable defaults are enough. If a selected skill genuinely needs missing information before continuing, ask exactly one structured multiple-choice clarification with 2-3 mutually exclusive options and one recommended option. Do not ask open-ended questions, and do not write clarification text into final deliverables or Markdown files."
    : undefined;
  const clarificationPolicy = "When clarification is blocking, emit only the structured clarification protocol. Prefer the ask_clarification tool. The payload must be { type:'agent_clarification_requested', question:string, options:[2-3 items] }, and every option must include id, label, and detail or description; at most one option may be recommended. If tool calling is unavailable, output exactly one JSON object with the same fields and no surrounding prose or Markdown. Never answer with ordinary clarification prose, Markdown option lists, or a sentence ending in a colon.";
  const evidenceTools = Array.isArray(progressiveDelivery?.evidenceTools)
    ? progressiveDelivery.evidenceTools.filter((tool): tool is string => typeof tool === "string" && tool.trim().length > 0)
    : undefined;
  const planId = planGeneration ? String(planGeneration.planId ?? "").trim() : String(input.planId ?? "").trim();
  const planStepId = planGeneration ? String(planGeneration.stepId ?? "").trim() : String(input.stepId ?? "").trim();
  const phaseAttemptId = planGeneration ? String(planGeneration.phaseAttemptId ?? "").trim() : "";
  const modelSettings = input.modelSettings;
  if (!modelSettings) {
    return {
      model_name: input.configuredModelApiId,
      facetwrite_memory_enabled: false,
      facetwrite_memory_scope_id: input.threadId,
      facetwrite_project_id: input.projectId,
      facetwrite_mcp_refs: input.settings?.mcpRefs ?? [],
      facetwrite_plan_phase: planPolicy.phase,
      facetwrite_plan_stage: planPolicy.stage,
      facetwrite_plan_phase_attempt_id: phaseAttemptId || undefined,
      facetwrite_plan_id: planId || undefined,
      facetwrite_plan_step_id: planStepId || undefined,
      facetwrite_research_tool_limit: researchToolLimit,
      facetwrite_progressive_canvas_delivery_enabled: progressiveCanvasDeliveryEnabled,
      facetwrite_runtime_budget_profile: budgetProfile,
      facetwrite_recursion_limit: recursionLimit,
      facetwrite_model_call_limit: modelCallLimit,
      facetwrite_evidence_tool_limit: evidenceToolLimit,
      facetwrite_body_draft_write_limit: bodyDraftWriteLimit,
      facetwrite_synthesis_reserve_steps: synthesisReserveSteps,
      facetwrite_force_synthesis_after_evidence: forceSynthesisAfterEvidence,
      facetwrite_evidence_tools: evidenceTools,
      facetwrite_markdown_file_delivery_policy: markdownFileDeliveryPolicy,
      facetwrite_markdown_file_delivery_required: markdownFileDeliveryRequired,
      facetwrite_canvas_write_scope: canvasWriteScope,
      facetwrite_canvas_write_policy: canvasWriteScope ? SHORT_PROGRESS_CANVAS_WRITE_POLICY : undefined,
      facetwrite_task_completion_policy: taskCompletionPolicy,
      facetwrite_clarification_policy: clarificationPolicy
    };
  }
  const thinkingMode = modelSettings.thinkingMode ?? (modelSettings.providerId === "deepseek" && modelSettings.model === "deepseek-reasoner" ? "enabled" : "disabled");
  return {
    model_name: input.configuredModelApiId,
    thinking_enabled: thinkingMode === "enabled",
    reasoning_effort: normalizeAgentBackendReasoningEffort(modelSettings.reasoningEffort),
    facetwrite_memory_enabled: memoryEnabled,
    facetwrite_memory_scope_id: input.threadId,
    facetwrite_project_id: input.projectId,
    facetwrite_mcp_refs: input.settings?.mcpRefs ?? [],
    facetwrite_plan_phase: planPolicy.phase,
    facetwrite_plan_stage: planPolicy.stage,
    facetwrite_plan_phase_attempt_id: phaseAttemptId || undefined,
    facetwrite_plan_id: planId || undefined,
    facetwrite_plan_step_id: planStepId || undefined,
    facetwrite_research_tool_limit: researchToolLimit,
    facetwrite_progressive_canvas_delivery_enabled: progressiveCanvasDeliveryEnabled,
    facetwrite_runtime_budget_profile: budgetProfile,
    facetwrite_recursion_limit: recursionLimit,
    facetwrite_model_call_limit: modelCallLimit,
    facetwrite_evidence_tool_limit: evidenceToolLimit,
    facetwrite_body_draft_write_limit: bodyDraftWriteLimit,
    facetwrite_synthesis_reserve_steps: synthesisReserveSteps,
    facetwrite_force_synthesis_after_evidence: forceSynthesisAfterEvidence,
    facetwrite_evidence_tools: evidenceTools,
    facetwrite_markdown_file_delivery_policy: markdownFileDeliveryPolicy,
    facetwrite_markdown_file_delivery_required: markdownFileDeliveryRequired,
    facetwrite_canvas_write_scope: canvasWriteScope,
    facetwrite_canvas_write_policy: canvasWriteScope ? SHORT_PROGRESS_CANVAS_WRITE_POLICY : undefined,
    facetwrite_task_completion_policy: taskCompletionPolicy,
    facetwrite_clarification_policy: clarificationPolicy,
    ...(memoryContent ? { facetwrite_memory_content: memoryContent } : {})
  };
}

function normalizeAgentBackendReasoningEffort(effort: ConversationModelRuntimeSettings["reasoningEffort"]) {
  if (effort === "max" || effort === "xhigh") return "max";
  if (effort === "low" || effort === "medium" || effort === "high") return effort;
  return undefined;
}

async function readAgentBackendStream(
  body: ReadableStream<Uint8Array>,
  callbacks: {
    onToolEvent?: (event: ToolEventRecord) => void;
    onToken?: (token: string) => void;
    onReasoningToken?: (token: string) => void;
    onStatus?: (status: StreamStatus) => void;
    onRuntimeSignal?: (signal: AgentBackendRuntimeSignal) => void;
  } = {}
): Promise<AgentBackendRunResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events: ToolEventRecord[] = [];
  const textByMessageId = new Map<string, string[]>();
  const unkeyedText: string[] = [];
  const toolCallArgsById = new Map<string, Record<string, unknown>>();
  const emittedToolEventKeys = new Set<string>();
  let lastMessageId: string | undefined;
  let finalValuesText: string | undefined;
  let usage: unknown;
  let buffer = "";
  let sawWaitingForUser = false;
  let sawRuntimeEnd = false;

  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      const splitAt = buffer.lastIndexOf("\n\n");
      if (splitAt >= 0) {
        const complete = buffer.slice(0, splitAt + 2);
        buffer = buffer.slice(splitAt + 2);
        handleEvents(parseSseChunk(complete));
        if (sawRuntimeEnd) break;
      }
    }
    if (done || sawRuntimeEnd) break;
  }
  if (sawRuntimeEnd) {
    try {
      await reader.cancel();
    } catch {
      // The runtime has already sent its business-level end event.
    }
  }

  if (!sawRuntimeEnd && buffer.trim()) {
    handleEvents(parseSseChunk(buffer));
  }

  return {
    text: (finalValuesText || (lastMessageId ? textByMessageId.get(lastMessageId)?.join("") : unkeyedText.join("")) || "").trim(),
    finishReason: sawWaitingForUser ? "clarification_required" : "agent_backend_completed",
    usage,
    events
  };

  function handleEvents(parsedEvents: ReturnType<typeof parseSseChunk>) {
    for (const parsed of parsedEvents) {
      const runtimeError = extractRuntimeError(parsed.event, parsed.data);
      if (runtimeError) throw new Error(runtimeError);
      if (parsed.event === "end") {
        sawRuntimeEnd = true;
        continue;
      }
      const runtimeSignal = runtimeSignalFromSseEvent(parsed.event, parsed.data);
      if (runtimeSignal) {
        if (runtimeSignal.type === "waiting_for_user") {
          sawWaitingForUser = true;
          callbacks.onStatus?.({ phase: "finalizing", label: runtimeSignal.label });
          callbacks.onRuntimeSignal?.(runtimeSignal);
        } else if (runtimeSignal.type === "heartbeat") {
          if (!sawWaitingForUser) {
            callbacks.onStatus?.({ phase: "thinking", label: runtimeSignal.label });
            callbacks.onRuntimeSignal?.(runtimeSignal);
          }
          continue;
        } else {
          callbacks.onStatus?.({ phase: "thinking", label: runtimeSignal.label });
          callbacks.onRuntimeSignal?.(runtimeSignal);
        }
      }
      const messageId = extractMessageId(parsed.event, parsed.data);
      const reasoningText = extractReasoningText(parsed.event, parsed.data);
      if (reasoningText) {
        callbacks.onReasoningToken?.(reasoningText);
      }
      let toolEvents = mapToolEvents(parsed.event, parsed.data, toolCallArgsById);
      const text = extractText(parsed.event, parsed.data);
      if (text && !shouldSuppressAssistantText(toolEvents)) {
        if (messageId) {
          const parts = textByMessageId.get(messageId) ?? [];
          parts.push(text);
          textByMessageId.set(messageId, parts);
          lastMessageId = messageId;
        } else {
          unkeyedText.push(text);
        }
        callbacks.onStatus?.({ phase: "writing", label: streamLabels.writing });
        callbacks.onToken?.(text);
      }
      if (parsed.event === "values") {
        const nextFinalText = extractFinalValuesText(parsed.data);
        if (nextFinalText) {
          const structuredClarification = structuredAssistantClarificationEvent(nextFinalText);
          if (structuredClarification) {
            if (!events.some((event) => /agent_clarification_(?:requested|invalid)$/.test(event.eventType))) {
              toolEvents = [...toolEvents, structuredClarification];
            }
          } else {
            finalValuesText = nextFinalText;
          }
        }
      }

      for (const event of toolEvents) {
        const key = toolEventDedupeKey(event);
        if (key && emittedToolEventKeys.has(key)) continue;
        if (key) emittedToolEventKeys.add(key);
        events.push(event);
        if (isAgentClarificationToolEvent(event)) sawWaitingForUser = true;
        callbacks.onStatus?.(statusFromToolEvent(event));
        callbacks.onToolEvent?.(event);
      }

      const nextUsage = extractUsage(parsed.data);
      if (nextUsage) usage = nextUsage;
      if (sawRuntimeEnd) break;
    }
  }
}

function runtimeSignalFromSseEvent(event: string, data: unknown): AgentBackendRuntimeSignal | undefined {
  if (event === "comment") {
    const comment = typeof data === "string" ? data.trim().toLowerCase() : "";
    if (comment === "heartbeat") {
      return {
        type: "heartbeat",
        label: "Agent Runtime is still working...",
        payload: { comment }
      };
    }
    return undefined;
  }
  if (event === "interrupt" || event === "waiting_for_user") {
    return {
      type: "waiting_for_user",
      label: "Waiting for your clarification choice.",
      payload: sanitizeRuntimeSignalPayload(isRecord(data) ? data : { event })
    };
  }
  if (event === "values") return waitingForUserSignalFromValues(data);
  if (event !== "custom" || !isRecord(data)) return undefined;
  const type = readSourceString(data.type) || readSourceString(data.event);
  if (isWaitingForUserType(type)) {
    return {
      type: "waiting_for_user",
      label: "Waiting for your clarification choice.",
      payload: sanitizeRuntimeSignalPayload(data)
    };
  }
  if (type === "llm_retry" || type === "llm_call_retry") {
    return {
      type: "llm_retry",
      label: llmRetryStatusLabel(data),
      payload: sanitizeRuntimeSignalPayload(data)
    };
  }
  if (type === "llm_call_start" || type === "llm_call_end" || type === "llm_call_error" || type === "synthesis_gate") {
    return {
      type,
      label: runtimeCustomStatusLabel(type, data),
      payload: sanitizeRuntimeSignalPayload(data)
    };
  }
  return undefined;
}

function waitingForUserSignalFromValues(data: unknown): AgentBackendRuntimeSignal | undefined {
  if (!isRecord(data)) return undefined;
  const interrupt = data.__interrupt__ ?? data.interrupt ?? data.interrupts;
  if (interrupt !== undefined) {
    return {
      type: "waiting_for_user",
      label: "Waiting for your clarification choice.",
      payload: sanitizeRuntimeSignalPayload({ type: "runtime_interrupt", interrupt })
    };
  }
  const next = Array.isArray(data.next) ? data.next.join(",") : readSourceString(data.next);
  const status = readSourceString(data.status) || readSourceString(data.state);
  if (isWaitingForUserType(status) || /interrupt|wait/i.test(next)) {
    return {
      type: "waiting_for_user",
      label: "Waiting for your clarification choice.",
      payload: sanitizeRuntimeSignalPayload({ type: "runtime_waiting", status, next })
    };
  }
  return undefined;
}

function isWaitingForUserType(type: string) {
  return /^(?:interrupt|waiting_for_user|wait_for_user|waiting-for-user|user_input_required|clarification_required)$/.test(type);
}

function llmRetryStatusLabel(data: Record<string, unknown>) {
  const delaySeconds = readPositiveNumber(data.delay_seconds ?? data.delaySeconds ?? data.retry_after ?? data.retryAfter)
    ?? secondsFromMs(data.wait_ms ?? data.waitMs);
  const attempt = readPositiveInteger(data.attempt);
  const maxAttempts = readPositiveInteger(data.max_attempts ?? data.maxAttempts);
  const reason = readSourceString(data.reason);
  const prefix = reason === "stream_chunk_timeout"
    ? attempt && maxAttempts
      ? `Model stream produced no content; retry ${attempt}/${maxAttempts}.`
      : "Model stream produced no content; retry scheduled."
    : attempt && maxAttempts ? `Model request retry ${attempt}/${maxAttempts}.` : "Model request retry scheduled.";
  const suffix = delaySeconds ? ` Waiting ${delaySeconds}s before retry.` : " Waiting before retry.";
  return `${prefix}${suffix}`;
}

function secondsFromMs(value: unknown) {
  const ms = readPositiveNumber(value);
  return ms ? Math.max(1, Math.round(ms / 1000)) : undefined;
}

function sanitizeRuntimeSignalPayload(data: Record<string, unknown>) {
  const allowed = ["type", "event", "phase", "attempt", "max_attempts", "maxAttempts", "elapsed_ms", "elapsedMs", "delay_seconds", "delaySeconds", "retry_after", "retryAfter", "wait_ms", "waitMs", "reason", "error_type", "errorType", "status_code", "statusCode", "status", "state", "next", "interrupt", "model", "provider_class", "providerClass", "base_url_host", "baseUrlHost", "timeout_s", "timeoutS", "stream_chunk_timeout_s", "streamChunkTimeoutS", "max_retries", "maxRetries", "completed_evidence_tools", "completedEvidenceTools", "evidence_limit", "evidenceLimit", "model_limit", "modelLimit", "model_calls", "modelCalls", "recursion_limit", "recursionLimit", "estimated_steps_used", "estimatedStepsUsed", "file_delivery_required", "fileDeliveryRequired", "second_handler", "secondHandler", "entered_second_handler", "enteredSecondHandler"];
  return Object.fromEntries(allowed.filter((key) => key in data).map((key) => [key, data[key]]));
}

function runtimeCustomStatusLabel(type: "llm_call_start" | "llm_call_end" | "llm_call_error" | "synthesis_gate", data: Record<string, unknown>) {
  if (type === "llm_call_start") return "Waiting for model response...";
  if (type === "llm_call_end") return "Model response received.";
  if (type === "llm_call_error") {
    const reason = readSourceString(data.reason);
    if (reason === "stream_chunk_timeout") return "Model stream produced no content before timeout.";
    const errorType = readSourceString(data.error_type ?? data.errorType);
    return errorType ? `Model request failed: ${errorType}.` : "Model request failed.";
  }
  const secondHandler = data.second_handler === true || data.secondHandler === true;
  return secondHandler ? "Forcing final synthesis..." : "Runtime budget synthesis started.";
}

function isAgentClarificationToolEvent(event: ToolEventRecord) {
  const type = readSourceString(event.payload?.type) || readSourceString(event.payload?.eventType);
  return /agent_clarification_requested$/.test(event.eventType) || type === "agent_clarification_requested";
}

function shouldSuppressAssistantText(events: ToolEventRecord[]) {
  return events.some((event) => {
    const source = readSourceString(event.payload?.source);
    return source === "assistant_structured_object"
      && (event.eventType === "agent_backend_agent_clarification_requested" || event.eventType === "agent_backend_agent_clarification_invalid");
  });
}

function extractRuntimeError(event: string, data: unknown): string | undefined {
  if (event !== "error") return undefined;
  if (typeof data === "string") {
    const message = data.trim() || "AgentBackend runtime stream failed";
    if (isBudgetExhaustionMessage(message)) throw budgetExhaustedError({ message });
    return message;
  }
  if (!isRecord(data)) return "AgentBackend runtime stream failed";
  const message = readSourceString(data.message) || readSourceString(data.error) || readSourceString(data.detail);
  if (isBudgetExhaustionPayload(data, message)) {
    throw budgetExhaustedError({
      message: message || "AgentBackend runtime step budget exhausted",
      recursionLimit: readPositiveInteger(data.recursion_limit ?? data.recursionLimit),
      estimatedStepsUsed: readPositiveInteger(data.estimated_steps_used ?? data.estimatedStepsUsed)
    });
  }
  return message || "AgentBackend runtime stream failed";
}

function budgetExhaustedError(input: { message: string; recursionLimit?: number; estimatedStepsUsed?: number }) {
  return Object.assign(new Error(input.message), {
    facetwriteBudgetStatus: {
      status: "budget_exhausted",
      canResume: true,
      ...(input.recursionLimit ? { recursionLimit: input.recursionLimit } : {}),
      ...(input.estimatedStepsUsed ? { estimatedStepsUsed: input.estimatedStepsUsed } : {})
    }
  });
}

function isBudgetExhaustionPayload(data: Record<string, unknown>, message: string | undefined) {
  const status = readSourceString(data.status) || readSourceString(data.type) || readSourceString(data.code);
  const name = readSourceString(data.name);
  return status === "budget_exhausted" || name === "GraphRecursionError" || isBudgetExhaustionMessage(message ?? "");
}

function isBudgetExhaustionMessage(message: string) {
  return /Recursion limit of \d+ reached|GRAPH_RECURSION_LIMIT|GraphRecursionError/i.test(message);
}

function extractMessageId(event: string, data: unknown) {
  if (event !== "messages" && event !== "messages-tuple") return undefined;
  const message = Array.isArray(data) ? data[0] : data;
  return isRecord(message) && typeof message.id === "string" ? message.id : undefined;
}

function statusFromToolEvent(event: ToolEventRecord): StreamStatus {
  if (isAgentClarificationToolEvent(event)) {
    return { phase: "finalizing", label: "Waiting for your clarification choice." };
  }
  if (/search|tool|started/i.test(String(event.payload?.type ?? event.eventType))) {
    return { phase: "searching", label: streamLabels.searching };
  }
  return { phase: "finalizing", label: streamLabels.finalizing };
}

function extractText(event: string, data: unknown): string | undefined {
  if (event === "messages" || event === "messages-tuple") {
    return textFromMessageTuple(data);
  }
  if (event === "token" || event === "message") {
    return textFromUnknown(data);
  }
  return undefined;
}

function extractReasoningText(event: string, data: unknown): string | undefined {
  if (event !== "messages" && event !== "messages-tuple") return undefined;
  const message = Array.isArray(data) ? data[0] : data;
  return reasoningTextFromMessageLike(message);
}

function extractFinalValuesText(data: unknown): string | undefined {
  if (!isRecord(data) || !Array.isArray(data.messages)) return undefined;
  for (let index = data.messages.length - 1; index >= 0; index -= 1) {
    const message = data.messages[index];
    if (!isRecord(message)) continue;
    const role = typeof message.role === "string" ? message.role.toLowerCase() : "";
    const type = typeof message.type === "string" ? message.type.toLowerCase() : "";
    if (role === "assistant" || type === "ai" || type === "assistant") {
      return textFromUnknown(message);
    }
  }
  return undefined;
}

function toolEventDedupeKey(event: ToolEventRecord) {
  const toolName = typeof event.payload?.toolName === "string" ? event.payload.toolName : "";
  const toolCallId = typeof event.payload?.toolCallId === "string" ? event.payload.toolCallId : "";
  if (!toolName || !toolCallId) return undefined;
  return `${event.eventType}:${toolName}:${toolCallId}`;
}

function textFromMessageTuple(data: unknown): string | undefined {
  if (Array.isArray(data)) {
    return textFromMessageLike(data[0]);
  }
  return textFromMessageLike(data);
}

function textFromMessageLike(value: unknown): string | undefined {
  if (!isRecord(value)) return typeof value === "string" ? value : undefined;
  const role = typeof value.role === "string" ? value.role.toLowerCase() : "";
  const type = typeof value.type === "string" ? value.type.toLowerCase() : "";
  const id = typeof value.id === "string" ? value.id.toLowerCase() : "";
  const allowed = role === "assistant" || type === "ai" || type === "assistant" || id.startsWith("run-");
  if (role || type || id) {
    return allowed ? textFromUnknown(value) : undefined;
  }
  return textFromUnknown(value);
}

function textFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;
  if (typeof value.content === "string") return value.content;
  if (Array.isArray(value.content)) {
    return value.content.map((part) => isRecord(part) && typeof part.text === "string" ? part.text : "").join("");
  }
  if (typeof value.text === "string") return value.text;
  if (typeof value.delta === "string") return value.delta;
  return undefined;
}

function reasoningTextFromMessageLike(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.reasoning_content === "string") return value.reasoning_content;
  const additional = value.additional_kwargs;
  if (isRecord(additional) && typeof additional.reasoning_content === "string") return additional.reasoning_content;
  return undefined;
}

function mapToolEvents(event: string, data: unknown, toolCallArgsById: Map<string, Record<string, unknown>>): ToolEventRecord[] {
  if (event === "custom" && isRecord(data)) {
    const type = typeof data.type === "string" ? data.type : typeof data.event === "string" ? data.event : undefined;
    if (type === "agent_clarification_requested") {
      return [agentClarificationEventFromSource(data, { source: "runtime_custom_event" })];
    }
    return type && /^(?:task_|plan_|artifact_|canvas_|agent_clarification_)/.test(type) ? [{ eventType: `agent_backend_${type}`, payload: data }] : [];
  }
  if (event === "values" && isRecord(data) && Array.isArray(data.messages)) {
    return data.messages.flatMap((message) => mapMessageToolEvents(message, toolCallArgsById));
  }
  if (event !== "messages" && event !== "messages-tuple") return [];
  const message = Array.isArray(data) ? data[0] : data;
  return mapMessageToolEvents(message, toolCallArgsById);
}

function mapMessageToolEvents(message: unknown, toolCallArgsById: Map<string, Record<string, unknown>>): ToolEventRecord[] {
  if (!isRecord(message)) return [];

  if (Array.isArray(message.tool_calls)) {
    return message.tool_calls.flatMap((toolCall) => {
      if (!isRecord(toolCall)) return [];
      const toolName = typeof toolCall.name === "string" ? toolCall.name : toolFunctionName(toolCall);
      if (!toolName) return [];
      const toolCallId = typeof toolCall.id === "string" ? toolCall.id : undefined;
      const args = toolCallArgs(toolCall);
      if (toolCallId && !isEmptyRecord(args)) toolCallArgsById.set(toolCallId, args);
      if (toolName === "ask_clarification") {
        if (isEmptyRecord(args)) return [];
        return [agentClarificationEventFromSource(args, { toolName, toolCallId, source: "ask_clarification" })];
      }
      const started: ToolEventRecord = {
        eventType: "agent_backend_tool_started",
        payload: {
          type: "tool_started",
          toolName,
          toolCallId,
          ...safeToolArgs(toolName, args)
        }
      };
      return toolName === "canvas_write"
        ? [started, {
            eventType: "agent_backend_canvas_mutation_started",
            payload: {
              type: "canvas_mutation_started",
              toolName,
              toolCallId
            }
          }]
        : [started];
    });
  }

  if (Array.isArray(message.tool_call_chunks)) {
    return message.tool_call_chunks.flatMap((toolCall) => {
      if (!isRecord(toolCall)) return [];
      const toolName = typeof toolCall.name === "string" ? toolCall.name : toolFunctionName(toolCall);
      if (toolName !== "ask_clarification") return [];
      const toolCallId = typeof toolCall.id === "string" ? toolCall.id : undefined;
      const args = toolCallArgs(toolCall);
      if (toolCallId && !isEmptyRecord(args)) toolCallArgsById.set(toolCallId, args);
      return isEmptyRecord(args)
        ? []
        : [agentClarificationEventFromSource(args, { toolName, toolCallId, source: "ask_clarification" })];
    });
  }

  const structuredClarification = structuredAssistantClarificationEvent(message);
  if (structuredClarification) return [structuredClarification];

  const messageType = typeof message.type === "string" ? message.type.toLowerCase() : "";
  const role = typeof message.role === "string" ? message.role.toLowerCase() : "";
  if (messageType !== "tool" && role !== "tool") return [];
  const structured = structuredToolEvents(message.content);
  const failed = structured.some((event) => /_failed$/.test(event.eventType))
    || (typeof message.content === "string" && message.content.startsWith("Error:"));
  const toolName = typeof message.name === "string" ? message.name : "unknown";
  if (toolName === "ask_clarification") {
    const event = structuredToolMessageClarificationEvent(message);
    return event ? [event] : [];
  }
  const sources = toolName === "web_search" ? extractWebSearchSources(message.content) : [];
  const toolCallId = typeof message.tool_call_id === "string" ? message.tool_call_id : undefined;
  const startedArgs = toolCallId ? toolCallArgsById.get(toolCallId) ?? {} : {};
  const terminal: ToolEventRecord = {
    eventType: failed ? "agent_backend_tool_failed" : "agent_backend_tool_completed",
    payload: {
      type: failed ? "tool_failed" : "tool_completed",
      toolName,
      toolCallId,
      ...safeToolArgs(toolName, startedArgs),
      ...safeToolResult(toolName, message.content),
      ...(sources.length ? { sources } : {}),
      ...(structured[0]?.payload?.reason ? { reason: structured[0].payload.reason } : {}),
      ...(structured[0]?.payload?.summary ? { summary: structured[0].payload.summary } : {})
    }
  };
  return [terminal, ...structured];
}

function toolFunctionName(toolCall: Record<string, unknown>) {
  const fn = toolCall.function;
  return isRecord(fn) && typeof fn.name === "string" ? fn.name : undefined;
}

function toolCallArgs(toolCall: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(toolCall.args)) return toolCall.args;
  if (typeof toolCall.args === "string") return parseJsonRecord(toolCall.args);
  const fn = toolCall.function;
  if (isRecord(fn)) {
    if (isRecord(fn.arguments)) return fn.arguments;
    if (typeof fn.arguments === "string") {
      return parseJsonRecord(fn.arguments);
    }
  }
  return {};
}

function isEmptyRecord(value: Record<string, unknown>) {
  return Object.keys(value).length === 0;
}

function parseJsonRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeToolArgs(toolName: string, args: Record<string, unknown>) {
  if (toolName === "web_search") {
    const query = readSourceString(args.query).slice(0, 240);
    return query ? { query } : {};
  }
  if (toolName === "web_fetch") {
    const url = readSourceString(args.url).slice(0, 500);
    return /^https?:\/\//i.test(url) ? { url } : {};
  }
  if (toolName === "read_file") {
    const path = readSourceString(args.path ?? args.file_path ?? args.filePath).slice(0, 500);
    const startLine = readPositiveInteger(args.start_line ?? args.startLine);
    const endLine = readPositiveInteger(args.end_line ?? args.endLine);
    return {
      ...(path ? { path } : {}),
      ...(startLine ? { startLine } : {}),
      ...(endLine ? { endLine } : {})
    };
  }
  if (toolName === "bash") {
    const command = readSourceString(args.command ?? args.cmd).slice(0, 240);
    return command ? { command } : {};
  }
  if (toolName === "write_file") {
    const path = readSourceString(args.path ?? args.file_path ?? args.filePath ?? args.filepath).slice(0, 500);
    return path ? { path } : {};
  }
  if (toolName === "present_files") {
    const filepaths = readStringArray(args.filepaths ?? args.file_paths ?? args.paths ?? args.files)
      .map((path) => path.slice(0, 500))
      .filter(Boolean)
      .slice(0, 20);
    return filepaths.length ? { filepaths } : {};
  }
  return {};
}

function structuredAssistantClarificationEvent(value: unknown): ToolEventRecord | undefined {
  const text = typeof value === "string" ? value.trim() : textFromMessageLike(value)?.trim() ?? "";
  if (!text || !text.startsWith("{") || !text.endsWith("}")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const source = isRecord(parsed.clarification) ? parsed.clarification : parsed;
  const type = readSourceString(source.type) || readSourceString(parsed.type);
  if (type !== "agent_clarification_requested") return undefined;
  return agentClarificationEventFromSource(source, { source: "assistant_structured_object" });
}

function structuredToolMessageClarificationEvent(message: Record<string, unknown>): ToolEventRecord | undefined {
  const candidates = [
    message.artifact,
    isRecord(message.additional_kwargs) ? message.additional_kwargs.facetwrite_clarification : undefined,
    isRecord(message.response_metadata) ? message.response_metadata.facetwrite_clarification : undefined
  ];
  const source = candidates.find((candidate): candidate is Record<string, unknown> => {
    if (!isRecord(candidate)) return false;
    const payload = isRecord(candidate.clarification) ? candidate.clarification : candidate;
    return readSourceString(payload.type) === "agent_clarification_requested";
  });
  if (!source) return undefined;
  const payload = isRecord(source.clarification) ? source.clarification : source;
  const toolCallId = readSourceString(message.tool_call_id);
  return agentClarificationEventFromSource({
    ...payload,
    ...(toolCallId ? { toolCallId } : {})
  }, {
    toolName: "ask_clarification",
    toolCallId: toolCallId || undefined,
    source: "runtime_tool_message_artifact"
  });
}

function agentClarificationEventFromSource(source: Record<string, unknown>, meta: { toolName?: string; toolCallId?: string; source: string }): ToolEventRecord {
  const result = readAgentClarification(source);
  const toolCallId = meta.toolCallId || readSourceString(source.toolCallId) || readSourceString(source.clarificationId) || undefined;
  const basePayload = {
    type: "agent_clarification_requested",
    ...(meta.toolName ? { toolName: meta.toolName } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(readSourceString(source.clarificationId) ? { clarificationId: readSourceString(source.clarificationId) } : {}),
    status: "pending",
    source: meta.source
  };
  if (!result.valid) {
    return {
      eventType: "agent_backend_agent_clarification_invalid",
      payload: {
        ...basePayload,
        type: "agent_clarification_invalid",
        status: "failed",
        reason: result.reason,
        ...clarificationDiagnostics(source),
        summary: "Agent clarification payload was invalid"
      }
    };
  }
  return {
    eventType: "agent_backend_agent_clarification_requested",
    payload: {
      ...basePayload,
      question: result.question,
      options: result.options,
      ...(isRecord(source.resumeContext) ? { resumeContext: source.resumeContext } : {})
    }
  };
}

function clarificationDiagnostics(args: Record<string, unknown>) {
  const source = isRecord(args.clarification) ? args.clarification : args;
  const rawQuestion = source.question;
  const rawOptions = source.options;
  return {
    hasQuestion: typeof rawQuestion === "string" && rawQuestion.trim().length > 0,
    optionCount: Array.isArray(rawOptions) ? rawOptions.length : 0,
    optionShape: describeClarificationOptionShape(rawOptions)
  };
}

function describeClarificationOptionShape(value: unknown) {
  if (!Array.isArray(value)) return value === undefined ? "missing" : typeof value;
  return value.slice(0, 3).map((item) => {
    if (typeof item === "string") return "string";
    if (!isRecord(item)) return typeof item;
    const fields = ["id", "label", "title", "detail", "description", "recommended"]
      .filter((field) => field in item);
    return fields.length ? `object:${fields.join(",")}` : "object";
  });
}

function readAgentClarification(args: Record<string, unknown>) {
  const source = isRecord(args.clarification) ? args.clarification : args;
  const question = readSourceString(source.question);
  const rawOptions = Array.isArray(source.options) ? source.options : [];
  const tooManyOptions = rawOptions.length > 3;
  const options = rawOptions.flatMap((item, index) => {
    if (typeof item === "string") {
      const label = readSourceString(item);
      if (!label) return [];
      return [{ id: `option_${index + 1}`, label: label.slice(0, 160), detail: "", recommended: false }];
    }
    if (!isRecord(item)) return [];
    const id = readSourceString(item.id) || `option_${index + 1}`;
    const label = readSourceString(item.label) || readSourceString(item.title);
    const detail = readSourceString(item.detail) || readSourceString(item.description);
    if (!label) return [];
    return [{ id, label: label.slice(0, 160), detail: detail.slice(0, 500), recommended: item.recommended === true }];
  }).slice(0, 3);
  const recommendedCount = options.filter((option) => option.recommended).length;
  if (!question) return { valid: false as const, reason: "missing_question" };
  if (!Array.isArray(source.options)) return { valid: false as const, reason: "missing_options" };
  if (tooManyOptions) return { valid: false as const, reason: "too_many_options" };
  if (rawOptions.length !== options.length) return { valid: false as const, reason: "missing_option_label" };
  if (options.length < 2) return { valid: false as const, reason: "insufficient_options" };
  if (recommendedCount > 1) return { valid: false as const, reason: "multiple_recommended_options" };
  const normalizedOptions = recommendedCount === 0
    ? options.map((option, index) => ({ ...option, recommended: index === 0 }))
    : options;
  return { valid: true as const, question: question.slice(0, 500), options: normalizedOptions };
}

function safeToolResult(toolName: string, content: unknown) {
  if (!["web_fetch", "read_file", "bash", "grep", "glob", "ls"].includes(toolName)) return {};
  if (toolName === "bash") return {};
  const text = sanitizeSnippet(readToolContentText(content));
  if (!text) return {};
  return { snippet: text };
}

function extractWebSearchSources(content: unknown) {
  if (typeof content !== "string") return [];
  const markerIndex = content.indexOf("__FACETWRITE_EVENT__");
  const jsonText = (markerIndex >= 0 ? content.slice(0, markerIndex) : content).trim();
  if (!jsonText) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const items = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.results)
      ? parsed.results
      : [];
  const seen = new Set<string>();
  const sources: Array<{ title: string; url: string }> = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const url = readSourceString(item.url) || readSourceString(item.href) || readSourceString(item.link);
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const title = readSourceString(item.title) || url;
    const snippet = readSourceString(item.snippet) || readSourceString(item.body) || readSourceString(item.description);
    sources.push({ title: title.slice(0, 120), url, ...(snippet ? { snippet: snippet.slice(0, 360) } : {}) });
    if (sources.length >= 10) break;
  }
  return sources;
}

function readSourceString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(readSourceString).filter(Boolean) : [];
}

function readPositiveInteger(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : 0;
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function readPositiveNumber(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : 0;
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function readToolContentText(content: unknown) {
  if (typeof content === "string") return content;
  if (!isRecord(content)) return "";
  return readSourceString(content.summary) || readSourceString(content.text) || readSourceString(content.content);
}

function sanitizeSnippet(value: string) {
  const lines = value
    .replace(/__FACETWRITE_EVENT__[\s\S]*/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map(redactSecretLikeText)
    .filter((line) => line && !/^#\s*(?:AgentCard|Loaded Skills|Current User Instruction|Context|Output Contract)\b/i.test(line))
    .filter((line) => !/^\[redacted credential\]$/i.test(line));
  return lines.join(" ").replace(/\s+/g, " ").slice(0, 500);
}

function redactSecretLikeText(value: string) {
  return value
    .replace(/\b[A-Za-z0-9_]*(?:api[_-]?key|authorization|token|password|secret|cookie)\s*[:=]\s*\S+/gi, "[redacted credential]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted credential]");
}

function structuredToolEvents(content: unknown): ToolEventRecord[] {
  if (typeof content !== "string") return [];
  const markerIndex = content.indexOf("__FACETWRITE_EVENT__");
  if (markerIndex < 0) return [];
  try {
    const envelope = JSON.parse(content.slice(markerIndex + "__FACETWRITE_EVENT__".length)) as unknown;
    if (!isRecord(envelope) || !isRecord(envelope.event) || typeof envelope.event.eventType !== "string") return [];
    const eventType = envelope.event.eventType === "tool_failed" && envelope.event.tool === "canvas_write"
      ? "canvas_mutation_failed"
      : envelope.event.eventType;
    if (!/^(?:plan_|artifact_|canvas_)/.test(eventType)) return [];
    const payload = { ...envelope.event, eventType };
    const events: ToolEventRecord[] = [{ eventType: `agent_backend_${eventType}`, payload }];
    if (eventType === "artifact_staged" && Array.isArray(envelope.event.artifacts) && envelope.event.artifacts.some((artifact) => isRecord(artifact) && artifact.status === "committed")) {
      events.push({ eventType: "agent_backend_artifact_committed", payload: { ...payload, eventType: "artifact_committed" } });
    }
    return events;
  } catch {
    return [];
  }
}

function extractUsage(data: unknown): unknown {
  if (!isRecord(data)) return undefined;
  return data.usage ?? data.token_usage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
