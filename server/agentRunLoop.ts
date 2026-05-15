import type { AgentSettings } from "./agentCards.js";
import { getProviderProfile, normalizeChatRequest, type ChatClient, type ChatMessage } from "./providerRuntime.js";
import { executeToolCall, getEnabledToolDefinitions, type ToolEventRecord, type ToolExecutionContext } from "./toolRuntime.js";
import type { ToolState } from "./toolRegistry.js";
import type { ProviderId } from "./types.js";

export type AgentRunInput = {
  client: ChatClient;
  providerId: ProviderId;
  modelSettings: AgentSettings["model"];
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

function emit(events: ToolEventRecord[], callback: AgentRunInput["onToolEvent"], event: ToolEventRecord) {
  events.push(event);
  callback?.(event);
}
