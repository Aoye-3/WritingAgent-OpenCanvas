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
      facetwrite_plan_step_id: planStepId || undefined
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
    onStatus?: (status: StreamStatus) => void;
  } = {}
): Promise<AgentBackendRunResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events: ToolEventRecord[] = [];
  const textByMessageId = new Map<string, string[]>();
  const unkeyedText: string[] = [];
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
      const messageId = extractMessageId(parsed.event, parsed.data);
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

      const toolEvents = mapToolEvents(parsed.event, parsed.data);
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

function mapToolEvents(event: string, data: unknown): ToolEventRecord[] {
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
      const toolName = typeof toolCall.name === "string" ? toolCall.name : undefined;
      if (!toolName) return [];
      const started: ToolEventRecord = {
        eventType: "agent_backend_tool_started",
        payload: {
          type: "tool_started",
          toolName,
          toolCallId: typeof toolCall.id === "string" ? toolCall.id : undefined
        }
      };
      return toolName === "canvas_write"
        ? [started, {
            eventType: "agent_backend_canvas_mutation_started",
            payload: {
              type: "canvas_mutation_started",
              toolName,
              toolCallId: typeof toolCall.id === "string" ? toolCall.id : undefined
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
  const terminal: ToolEventRecord = {
    eventType: failed ? "agent_backend_tool_failed" : "agent_backend_tool_completed",
    payload: {
      type: failed ? "tool_failed" : "tool_completed",
      toolName: typeof message.name === "string" ? message.name : "unknown",
      toolCallId: typeof message.tool_call_id === "string" ? message.tool_call_id : undefined,
      ...(structured[0]?.payload?.reason ? { reason: structured[0].payload.reason } : {}),
      ...(structured[0]?.payload?.summary ? { summary: structured[0].payload.summary } : {})
    }
  };
  return [terminal, ...structured];
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
