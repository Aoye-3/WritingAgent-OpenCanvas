import test from "node:test";
import assert from "node:assert/strict";
import { runAgentCompletion } from "./agentRunLoop.js";
import type { ChatClient } from "./providerRuntime.js";
import type { ToolEventRecord } from "./toolRuntime.js";

test("continues after tool calls and records tool events", async () => {
  const events: ToolEventRecord[] = [];
  const client: ChatClient = {
    async createChatCompletion(request) {
      const hasToolResult = request.messages.some((message) => message.role === "tool");
      if (!hasToolResult) {
        return {
          choices: [{
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "call_1",
                type: "function",
                function: { name: "knowledge_base", arguments: JSON.stringify({ query: "draft", limit: 1 }) }
              }]
            }
          }]
        };
      }

      return {
        choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Final answer" } }],
        usage: { total_tokens: 12 }
      };
    }
  };

  const result = await runAgentCompletion({
    client,
    providerId: "deepseek",
    modelSettings: {
      providerId: "deepseek",
      model: "deepseek-v4-flash",
      temperature: 0.7,
      topP: 1,
      contextCount: 5,
      maxTokens: 2000,
      maxTokensEnabled: false,
      streaming: false,
      toolCallMode: "auto",
      maxToolCalls: 4
    },
    messages: [{ role: "user", content: "Use context" }],
    allowedToolRefs: ["knowledge_base"],
    toolState: { knowledge_base: true },
    toolContext: { contextValues: { currentDraft: "Draft body" }, chatInstruction: "Use context" },
    onToolEvent: (event) => events.push(event)
  });

  assert.equal(result.text, "Final answer");
  assert.equal(result.finishReason, "stop");
  assert.equal(events.map((event) => event.eventType).join(","), "tool_call_requested,tool_call_completed");
});
