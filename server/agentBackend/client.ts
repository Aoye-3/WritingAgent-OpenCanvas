import type { StreamStatus } from "../agentRunLoop.js";
import type { AgentCard, AgentSettings } from "../agentCards.js";
import type { ChatMessage } from "../providerRuntime.js";
import type { ToolEventRecord } from "../toolRuntime.js";
import type { ToolState } from "../toolRegistry.js";
import { authenticatedAgentBackendFetch } from "./auth.js";
import { getAgentBackendRuntimeConfig, type AgentBackendRuntimeConfig } from "./config.js";
import { parseSseChunk } from "./sse.js";
import { buildAgentBackendRuntimeMetadata } from "./taskAgentMapping.js";

export type AgentBackendRunInput = {
  threadId: string;
  agentCard: AgentCard;
  settings?: AgentSettings;
  messages: ChatMessage[];
  prompt: string;
  allowedToolRefs?: string[];
  toolState?: ToolState;
  selectedCanvasNodeId?: string;
  contextValues?: Record<string, unknown>;
  chatInstruction?: string;
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
    throw new Error(`AgentBackend runtime returned HTTP ${response.status}`);
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

export function buildRunRequest(input: AgentBackendRunInput, config: AgentBackendRuntimeConfig) {
  const runtimeContext = buildAgentBackendRunContext(input.settings);
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
      facetwrite_allowed_tool_refs: input.allowedToolRefs ?? input.agentCard.toolRefs,
      facetwrite_tool_state: input.toolState ?? {},
      facetwrite_selected_canvas_node_id: input.selectedCanvasNodeId,
      facetwrite_context_values: input.contextValues ?? {},
      facetwrite_chat_instruction: input.chatInstruction ?? input.prompt,
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

function buildAgentBackendRunContext(settings?: AgentSettings) {
  if (!settings) return {};
  const thinkingMode = settings.model.thinkingMode ?? (settings.model.providerId === "deepseek" && settings.model.model === "deepseek-reasoner" ? "enabled" : "disabled");
  return {
    model_name: settings.model.model,
    thinking_enabled: thinkingMode === "enabled",
    reasoning_effort: normalizeAgentBackendReasoningEffort(settings.model.reasoningEffort)
  };
}

function normalizeAgentBackendReasoningEffort(effort: AgentSettings["model"]["reasoningEffort"]) {
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
  const textParts: string[] = [];
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
    text: (textParts.join("").trim() || finalValuesText || "").trim(),
    finishReason: "agent_backend_completed",
    usage,
    events
  };

  function handleEvents(parsedEvents: ReturnType<typeof parseSseChunk>) {
    for (const parsed of parsedEvents) {
      const text = extractText(parsed.event, parsed.data);
      if (text) {
        textParts.push(text);
        callbacks.onStatus?.({ phase: "writing", label: streamLabels.writing });
        callbacks.onToken?.(text);
      }
      if (parsed.event === "values") {
        finalValuesText = extractFinalValuesText(parsed.data) ?? finalValuesText;
      }

      const event = mapToolEvent(parsed.event, parsed.data);
      if (event) {
        events.push(event);
        callbacks.onStatus?.(statusFromToolEvent(event));
        callbacks.onToolEvent?.(event);
      }

      const nextUsage = extractUsage(parsed.data);
      if (nextUsage) usage = nextUsage;
    }
  }
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

function mapToolEvent(event: string, data: unknown): ToolEventRecord | undefined {
  if (event !== "custom" || !isRecord(data)) return undefined;
  const type = typeof data.type === "string" ? data.type : typeof data.event === "string" ? data.event : undefined;
  if (!type || !type.startsWith("task_")) return undefined;
  return {
    eventType: `agent_backend_${type}`,
    payload: data
  };
}

function extractUsage(data: unknown): unknown {
  if (!isRecord(data)) return undefined;
  return data.usage ?? data.token_usage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
