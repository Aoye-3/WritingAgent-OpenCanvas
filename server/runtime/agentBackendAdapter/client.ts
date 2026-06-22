import type { StreamStatus } from "../../agentRunLoop.js";
import type { AgentCard, AgentSettings, ConversationModelRuntimeSettings } from "../../agentCards.js";
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
  contextValues?: Record<string, unknown>;
  chatInstruction?: string;
  facetwriteMemoryContent?: string;
  fetchImpl?: typeof fetch;
  config?: AgentBackendRuntimeConfig;
  onToolEvent?: (event: ToolEventRecord) => void;
  onToken?: (token: string) => void;
  onReasoningToken?: (token: string) => void;
  onStatus?: (status: StreamStatus) => void;
};

export type AgentBackendRunResult = {
  text: string;
  finishReason: string;
  usage?: unknown;
  events: ToolEventRecord[];
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
  facetwrite_plan_stage: "chat" | "intake" | "revise" | "execution";
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
  facetwrite_force_synthesis_after_body_drafts?: boolean;
  facetwrite_evidence_tools?: string[];
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
    onStatus: input.onStatus
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
  const runtimeContext = buildAgentBackendRunContext(input);
  const canvasAction = input.contextValues?.canvasAction as CanvasAction | undefined ?? resolveCanvasAction({
    threadId: input.threadId,
    instruction: input.chatInstruction,
    selectedCanvasNodeId: input.selectedCanvasNodeId
  });
  const allowedToolRefs = canvasAction?.requiresTool
    ? [...new Set([...(input.allowedToolRefs ?? input.agentCard.toolRefs), "canvas_write"])]
    : input.allowedToolRefs ?? input.agentCard.toolRefs;
  const toolState = canvasAction?.requiresTool
    ? { ...(input.toolState ?? {}), canvas_write: true }
    : input.toolState ?? {};
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
      ...(runtimeContext.facetwrite_recursion_limit ? { recursion_limit: runtimeContext.facetwrite_recursion_limit } : {}),
      configurable: {
        thread_id: input.threadId,
        ...runtimeContext
      }
    },
    context: {
      facetwrite_prompt: input.prompt,
      facetwrite_allowed_tool_refs: allowedToolRefs,
      facetwrite_tool_state: toolState,
      facetwrite_selected_canvas_node_id: input.selectedCanvasNodeId,
      facetwrite_context_values: input.contextValues ?? {},
      facetwrite_chat_instruction: input.chatInstruction ?? input.prompt,
      facetwrite_canvas_action: canvasAction,
      facetwrite_canvas_delivery_contract: input.contextValues?.canvasDeliveryContract,
      ...runtimeContext
    },
    stream_mode: ["messages-tuple", "custom", "values"],
    stream_subgraphs: true,
    multitask_strategy: "interrupt",
    if_not_exists: "create",
    on_disconnect: "cancel",
    on_completion: "keep"
  };
}

function buildAgentBackendRunContext(input: Pick<AgentBackendRunInput, "threadId" | "projectId" | "configuredModelApiId" | "modelSettings" | "settings" | "facetwriteMemoryContent" | "chatInstruction" | "contextValues" | "toolState">): AgentBackendRunContext {
  const memoryEnabled = false;
  const memoryContent = memoryEnabled ? input.facetwriteMemoryContent?.trim() : "";
  const planPolicy = resolvePlanRequestPolicy({
    chatInstruction: input.chatInstruction,
    contextValues: input.contextValues,
    toolState: input.toolState
  });
  const planGeneration = input.contextValues?.planGeneration && isRecord(input.contextValues.planGeneration)
    ? input.contextValues.planGeneration
    : undefined;
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
  const forceSynthesisAfterBodyDrafts = progressiveDelivery?.forceSynthesisAfterBodyDrafts === true ? true : undefined;
  const evidenceTools = Array.isArray(progressiveDelivery?.evidenceTools)
    ? progressiveDelivery.evidenceTools.filter((tool): tool is string => typeof tool === "string" && tool.trim().length > 0)
    : undefined;
  const planId = planGeneration ? String(planGeneration.planId ?? "").trim() : "";
  const planStepId = planGeneration ? String(planGeneration.stepId ?? "").trim() : "";
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
      facetwrite_force_synthesis_after_body_drafts: forceSynthesisAfterBodyDrafts,
      facetwrite_evidence_tools: evidenceTools
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
    facetwrite_force_synthesis_after_body_drafts: forceSynthesisAfterBodyDrafts,
    facetwrite_evidence_tools: evidenceTools,
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
  } = {}
): Promise<AgentBackendRunResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events: ToolEventRecord[] = [];
  const textByMessageId = new Map<string, string[]>();
  const unkeyedText: string[] = [];
  const toolCallArgsById = new Map<string, Record<string, unknown>>();
  let lastMessageId: string | undefined;
  let finalValuesText: string | undefined;
  let usage: unknown;
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      const splitAt = buffer.lastIndexOf("\n\n");
      if (splitAt >= 0) {
        const complete = buffer.slice(0, splitAt + 2);
        buffer = buffer.slice(splitAt + 2);
        handleEvents(parseSseChunk(complete));
      }
    }
    if (done) break;
  }

  if (buffer.trim()) {
    handleEvents(parseSseChunk(buffer));
  }

  return {
    text: (finalValuesText || (lastMessageId ? textByMessageId.get(lastMessageId)?.join("") : unkeyedText.join("")) || "").trim(),
    finishReason: "agent_backend_completed",
    usage,
    events
  };

  function handleEvents(parsedEvents: ReturnType<typeof parseSseChunk>) {
    for (const parsed of parsedEvents) {
      const runtimeError = extractRuntimeError(parsed.event, parsed.data);
      if (runtimeError) throw new Error(runtimeError);
      const messageId = extractMessageId(parsed.event, parsed.data);
      const reasoningText = extractReasoningText(parsed.event, parsed.data);
      if (reasoningText) {
        callbacks.onReasoningToken?.(reasoningText);
      }
      const text = extractText(parsed.event, parsed.data);
      if (text) {
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
        finalValuesText = extractFinalValuesText(parsed.data) ?? finalValuesText;
      }

      const toolEvents = mapToolEvents(parsed.event, parsed.data, toolCallArgsById);
      for (const event of toolEvents) {
        events.push(event);
        callbacks.onStatus?.(statusFromToolEvent(event));
        callbacks.onToolEvent?.(event);
      }

      const nextUsage = extractUsage(parsed.data);
      if (nextUsage) usage = nextUsage;
    }
  }
}

function extractRuntimeError(event: string, data: unknown): string | undefined {
  if (event !== "error") return undefined;
  if (typeof data === "string") return data.trim() || "AgentBackend runtime stream failed";
  if (!isRecord(data)) return "AgentBackend runtime stream failed";
  const message = readSourceString(data.message) || readSourceString(data.error) || readSourceString(data.detail);
  return message || "AgentBackend runtime stream failed";
}

function extractMessageId(event: string, data: unknown) {
  if (event !== "messages" && event !== "messages-tuple") return undefined;
  const message = Array.isArray(data) ? data[0] : data;
  return isRecord(message) && typeof message.id === "string" ? message.id : undefined;
}

function statusFromToolEvent(event: ToolEventRecord): StreamStatus {
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
    return type && /^(?:task_|plan_|artifact_|canvas_)/.test(type) ? [{ eventType: `agent_backend_${type}`, payload: data }] : [];
  }
  if (event !== "messages" && event !== "messages-tuple") return [];
  const message = Array.isArray(data) ? data[0] : data;
  if (!isRecord(message)) return [];

  if (Array.isArray(message.tool_calls)) {
    return message.tool_calls.flatMap((toolCall) => {
      if (!isRecord(toolCall)) return [];
      const toolName = typeof toolCall.name === "string" ? toolCall.name : toolFunctionName(toolCall);
      if (!toolName) return [];
      const toolCallId = typeof toolCall.id === "string" ? toolCall.id : undefined;
      const args = toolCallArgs(toolCall);
      if (toolCallId) toolCallArgsById.set(toolCallId, args);
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

  const messageType = typeof message.type === "string" ? message.type.toLowerCase() : "";
  const role = typeof message.role === "string" ? message.role.toLowerCase() : "";
  if (messageType !== "tool" && role !== "tool") return [];
  const structured = structuredToolEvents(message.content);
  const failed = structured.some((event) => /_failed$/.test(event.eventType))
    || (typeof message.content === "string" && message.content.startsWith("Error:"));
  const toolName = typeof message.name === "string" ? message.name : "unknown";
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
  const fn = toolCall.function;
  if (isRecord(fn)) {
    if (isRecord(fn.arguments)) return fn.arguments;
    if (typeof fn.arguments === "string") {
      try {
        const parsed = JSON.parse(fn.arguments) as unknown;
        return isRecord(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }
  }
  return {};
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
    const path = readSourceString(args.path).slice(0, 500);
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
  return {};
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

function readPositiveInteger(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : 0;
  return Number.isInteger(number) && number > 0 ? number : undefined;
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
    if (!/^(?:plan_|artifact_|canvas_)/.test(envelope.event.eventType)) return [];
    const events: ToolEventRecord[] = [{ eventType: `agent_backend_${envelope.event.eventType}`, payload: envelope.event }];
    if (envelope.event.eventType === "artifact_staged" && Array.isArray(envelope.event.artifacts) && envelope.event.artifacts.some((artifact) => isRecord(artifact) && artifact.status === "committed")) {
      events.push({ eventType: "agent_backend_artifact_committed", payload: { ...envelope.event, eventType: "artifact_committed" } });
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
