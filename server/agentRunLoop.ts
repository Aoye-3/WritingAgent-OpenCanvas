import type { ConversationModelRuntimeSettings } from "./agentCards.js";
import { getProviderProfile, normalizeChatRequest, type ChatClient, type ChatCompletionStreamChunk, type ChatMessage, type ChatToolCall } from "./providerRuntime.js";
import { executeToolCall, getEnabledToolDefinitions, type ToolEventRecord, type ToolExecutionContext } from "./toolRuntime.js";
import type { ToolState } from "./toolRegistry.js";
import type { ProviderId } from "./types.js";

export type AgentRunInput = {
  client: ChatClient;
  providerId: ProviderId;
  modelSettings: ConversationModelRuntimeSettings;
  messages: ChatMessage[];
  allowedToolRefs: string[];
  toolState?: ToolState;
  toolContext: ToolExecutionContext;
  onToolEvent?: (event: ToolEventRecord) => void;
};

export type AgentRunResult = {
  text: string;
  finishReason: string;
  usage?: unknown;
  messages: ChatMessage[];
  events: ToolEventRecord[];
};

export type StreamStatus = {
  phase: "thinking" | "searching" | "writing" | "finalizing";
  label: string;
};

export type AgentRunStreamCallbacks = {
  onToken?: (token: string) => void;
  onStatus?: (status: StreamStatus) => void;
};

const streamLabels = {
  thinking: "正在思考",
  searching: "正在查找资料",
  writing: "正在生成回复",
  finalizing: "正在整理要点"
} as const;

export async function runAgentCompletion(input: AgentRunInput): Promise<AgentRunResult> {
  const profile = getProviderProfile(input.providerId);
  const tools = getEnabledToolDefinitions(input.allowedToolRefs, input.toolState);
  const messages = [...input.messages];
  const events: ToolEventRecord[] = [];
  const maxToolCalls = input.modelSettings.toolCallMode === "none" ? 0 : input.modelSettings.maxToolCalls;
  let toolCallsUsed = 0;

  while (true) {
    const response = await input.client.createChatCompletion(normalizeChatRequest(profile, {
      modelSettings: input.modelSettings,
      messages,
      tools,
      stream: false
    }));
    const choice = response.choices[0];
    const message = choice?.message;
    if (!message) {
      throw new Error("Provider returned no chat completion choices");
    }

    messages.push(message);
    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return {
        text: message.content?.trim() ?? "",
        finishReason: choice.finish_reason ?? "stop",
        usage: response.usage,
        messages,
        events
      };
    }

    if (toolCallsUsed + toolCalls.length > maxToolCalls) {
      emit(events, input.onToolEvent, {
        eventType: "tool_loop_stopped",
        payload: { reason: "max_tool_calls", maxToolCalls, requested: toolCallsUsed + toolCalls.length }
      });
      return {
        text: "The agent stopped because the maximum number of tool calls was reached.",
        finishReason: "max_tool_calls",
        usage: response.usage,
        messages,
        events
      };
    }

    for (const call of toolCalls) {
      toolCallsUsed += 1;
      emit(events, input.onToolEvent, {
        eventType: "tool_call_requested",
        payload: { id: call.id, name: call.function.name, arguments: call.function.arguments }
      });

      try {
        const result = await executeToolCall(call, input.toolContext);
        emit(events, input.onToolEvent, {
          eventType: result.ok ? "tool_call_completed" : "tool_call_failed",
          payload: { id: call.id, name: call.function.name, ...result.payload }
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: result.content });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Tool execution failed";
        emit(events, input.onToolEvent, {
          eventType: "tool_call_failed",
          payload: { id: call.id, name: call.function.name, error: messageText }
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: messageText });
      }
    }
  }
}

export async function runAgentCompletionStream(input: AgentRunInput & AgentRunStreamCallbacks): Promise<AgentRunResult> {
  if (!input.client.createChatCompletionStream) {
    const result = await runAgentCompletion(input);
    input.onStatus?.({ phase: "writing", label: streamLabels.writing });
    input.onToken?.(result.text);
    return result;
  }

  const profile = getProviderProfile(input.providerId);
  const tools = getEnabledToolDefinitions(input.allowedToolRefs, input.toolState);
  const messages = [...input.messages];
  const events: ToolEventRecord[] = [];
  const maxToolCalls = input.modelSettings.toolCallMode === "none" ? 0 : input.modelSettings.maxToolCalls;
  let toolCallsUsed = 0;
  let usage: unknown;

  input.onStatus?.({ phase: "thinking", label: streamLabels.thinking });

  while (true) {
    const response = await input.client.createChatCompletionStream(normalizeChatRequest(profile, {
      modelSettings: input.modelSettings,
      messages,
      tools,
      stream: true
    }));
    const assistant = await readAssistantStream(response, (token) => {
      input.onStatus?.({ phase: "writing", label: streamLabels.writing });
      input.onToken?.(token);
    });
    usage = assistant.usage ?? usage;
    const message: ChatMessage = {
      role: "assistant",
      content: assistant.content || null,
      ...(assistant.toolCalls.length ? { tool_calls: assistant.toolCalls } : {})
    };

    messages.push(message);
    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      input.onStatus?.({ phase: "finalizing", label: streamLabels.finalizing });
      return {
        text: message.content?.trim() ?? "",
        finishReason: assistant.finishReason ?? "stop",
        usage,
        messages,
        events
      };
    }

    if (toolCallsUsed + toolCalls.length > maxToolCalls) {
      emit(events, input.onToolEvent, {
        eventType: "tool_loop_stopped",
        payload: { reason: "max_tool_calls", maxToolCalls, requested: toolCallsUsed + toolCalls.length }
      });
      return {
        text: "The agent stopped because the maximum number of tool calls was reached.",
        finishReason: "max_tool_calls",
        usage,
        messages,
        events
      };
    }

    for (const call of toolCalls) {
      toolCallsUsed += 1;
      input.onStatus?.({ phase: "searching", label: streamLabels.searching });
      emit(events, input.onToolEvent, {
        eventType: "tool_call_requested",
        payload: { id: call.id, name: call.function.name, arguments: call.function.arguments }
      });

      try {
        const result = await executeToolCall(call, input.toolContext);
        emit(events, input.onToolEvent, {
          eventType: result.ok ? "tool_call_completed" : "tool_call_failed",
          payload: { id: call.id, name: call.function.name, ...result.payload }
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: result.content });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Tool execution failed";
        emit(events, input.onToolEvent, {
          eventType: "tool_call_failed",
          payload: { id: call.id, name: call.function.name, error: messageText }
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: messageText });
      }
    }
  }
}

async function readAssistantStream(
  chunks: AsyncIterable<ChatCompletionStreamChunk>,
  onToken: (token: string) => void
) {
  const content: string[] = [];
  const toolCalls = new Map<number, ChatToolCall>();
  let finishReason: string | null | undefined;
  let usage: unknown;

  for await (const chunk of chunks) {
    usage = chunk.usage ?? usage;
    const choice = chunk.choices[0];
    if (!choice) continue;
    finishReason = choice.finish_reason ?? finishReason;
    const delta = choice.delta;
    if (!delta) continue;

    if (typeof delta.content === "string" && delta.content.length > 0) {
      content.push(delta.content);
      onToken(delta.content);
    }

    for (const part of delta.tool_calls ?? []) {
      const index = part.index ?? 0;
      const current = toolCalls.get(index) ?? {
        id: "",
        type: "function" as const,
        function: { name: "", arguments: "" }
      };
      toolCalls.set(index, {
        id: typeof part.id === "string" && part.id ? part.id : current.id || `call_${index}`,
        type: "function",
        function: {
          name: typeof part.function?.name === "string" ? current.function.name + part.function.name : current.function.name,
          arguments: typeof part.function?.arguments === "string" ? current.function.arguments + part.function.arguments : current.function.arguments
        }
      });
    }
  }

  return {
    content: content.join(""),
    finishReason,
    usage,
    toolCalls: [...toolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => call)
      .filter((call) => call.function.name)
  };
}

function emit(events: ToolEventRecord[], callback: AgentRunInput["onToolEvent"], event: ToolEventRecord) {
  events.push(event);
  callback?.(event);
}
