import type { AgentCard, AgentSettings } from "../agentCards.js";
import type { ChatMessage } from "../providerRuntime.js";
import type { ToolEventRecord } from "../toolRuntime.js";
import { getDeerFlowRuntimeConfig, type DeerFlowRuntimeConfig } from "./config.js";
import { buildDeerFlowRuntimeMetadata } from "./taskAgentMapping.js";
import { parseSseChunk } from "./sse.js";

export type DeerFlowRunInput = {
  threadId: string;
  agentCard: AgentCard;
  settings?: AgentSettings;
  messages: ChatMessage[];
  prompt: string;
  fetchImpl?: typeof fetch;
  config?: DeerFlowRuntimeConfig;
  onToolEvent?: (event: ToolEventRecord) => void;
};

export type DeerFlowRunResult = {
  text: string;
  finishReason: string;
  usage?: unknown;
  events: ToolEventRecord[];
};

export async function runDeerFlowAgent(input: DeerFlowRunInput): Promise<DeerFlowRunResult> {
  const config = input.config ?? getDeerFlowRuntimeConfig();
  if (!config.enabled) {
    throw new Error("DeerFlow runtime is disabled");
  }

  const fetcher = input.fetchImpl ?? fetch;
  const response = await fetcher(`${config.baseUrl}/api/runs/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildRunRequest(input, config))
  });

  if (!response.ok) {
    throw new Error(`DeerFlow runtime returned HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error("DeerFlow runtime returned an empty stream");
  }

  return readDeerFlowStream(response.body, input.onToolEvent);
}

export function buildRunRequest(input: DeerFlowRunInput, config: DeerFlowRuntimeConfig) {
  return {
    assistant_id: config.assistantId,
    input: {
      messages: input.messages.map((message) => ({
        role: message.role,
        content: message.content ?? ""
      }))
    },
    metadata: buildDeerFlowRuntimeMetadata(input.agentCard, input.settings),
    config: {
      configurable: {
        thread_id: input.threadId
      }
    },
    context: {
      facetwrite_prompt: input.prompt
    },
    stream_mode: ["messages-tuple", "custom", "values"],
    stream_subgraphs: true,
    if_not_exists: "create",
    on_disconnect: "cancel",
    on_completion: "keep"
  };
}

async function readDeerFlowStream(body: ReadableStream<Uint8Array>, onToolEvent?: (event: ToolEventRecord) => void): Promise<DeerFlowRunResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events: ToolEventRecord[] = [];
  const textParts: string[] = [];
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
    text: textParts.join("").trim(),
    finishReason: "deerflow_completed",
    usage,
    events
  };

  function handleEvents(parsedEvents: ReturnType<typeof parseSseChunk>) {
    for (const parsed of parsedEvents) {
      const text = extractText(parsed.event, parsed.data);
      if (text) textParts.push(text);

      const event = mapToolEvent(parsed.event, parsed.data);
      if (event) {
        events.push(event);
        onToolEvent?.(event);
      }

      const nextUsage = extractUsage(parsed.data);
      if (nextUsage) usage = nextUsage;
    }
  }
}

function extractText(event: string, data: unknown): string | undefined {
  if (event === "messages" || event === "messages-tuple") {
    return textFromMessageTuple(data);
  }
  if (event === "token" || event === "message") {
    return textFromUnknown(data);
  }
  if (event === "values") {
    return textFromValues(data);
  }
  return undefined;
}

function textFromMessageTuple(data: unknown): string | undefined {
  if (Array.isArray(data)) {
    return textFromUnknown(data[0]);
  }
  return textFromUnknown(data);
}

function textFromValues(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  const messages = data.messages;
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  return textFromUnknown(messages[messages.length - 1]);
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
    eventType: `deerflow_${type}`,
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
