import test from "node:test";
import assert from "node:assert/strict";
import { runAgentCompletion, runAgentCompletionStream } from "./agentRunLoop.js";
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

test("keeps DeepSeek reasoning_content across thinking tool-call turns", async () => {
  let secondRequestReasoning: unknown;
  const client: ChatClient = {
    async createChatCompletion(request) {
      const hasToolResult = request.messages.some((message) => message.role === "tool");
      if (!hasToolResult) {
        return {
          choices: [{
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: "I will check the local context.",
              reasoning_content: "Need local context before answering.",
              tool_calls: [{
                id: "call_1",
                type: "function",
                function: { name: "knowledge_base", arguments: JSON.stringify({ query: "draft", limit: 1 }) }
              }]
            }
          }]
        };
      }

      secondRequestReasoning = request.messages.find((message) => message.role === "assistant" && message.tool_calls?.length)?.reasoning_content;
      return {
        choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Final answer" } }]
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
      maxToolCalls: 4,
      thinkingMode: "enabled",
      reasoningEffort: "high"
    },
    messages: [{ role: "user", content: "Use context" }],
    allowedToolRefs: ["knowledge_base"],
    toolState: { knowledge_base: true },
    toolContext: { contextValues: { currentDraft: "Draft body" }, chatInstruction: "Use context" }
  });

  assert.equal(result.text, "Final answer");
  assert.equal(secondRequestReasoning, "Need local context before answering.");
});

test("streams provider assistant tokens before final result", async () => {
  const tokens: string[] = [];
  const statuses: string[] = [];
  const client: ChatClient = {
    async createChatCompletion() {
      throw new Error("non-streaming path should not be used");
    },
    async *createChatCompletionStream() {
      yield { choices: [{ delta: { content: "Hello" } }] };
      yield { choices: [{ delta: { content: " stream" } }] };
      yield { choices: [{ finish_reason: "stop", delta: {} }] };
    }
  };

  const result = await runAgentCompletionStream({
    client,
    providerId: "openai",
    modelSettings: {
      providerId: "openai",
      model: "gpt-4.1-mini",
      temperature: 0.7,
      topP: 1,
      contextCount: 5,
      maxTokens: 2000,
      maxTokensEnabled: false,
      streaming: true,
      toolCallMode: "none",
      maxToolCalls: 0
    },
    messages: [{ role: "user", content: "Say hello" }],
    allowedToolRefs: [],
    toolState: {},
    toolContext: {},
    onToken: (token) => tokens.push(token),
    onStatus: (status) => statuses.push(status.phase)
  });

  assert.equal(result.text, "Hello stream");
  assert.deepEqual(tokens, ["Hello", " stream"]);
  assert.ok(statuses.includes("thinking"));
  assert.ok(statuses.includes("writing"));
  assert.ok(statuses.includes("finalizing"));
});

test("awaits provider stream promises before iterating chunks", async () => {
  const client: ChatClient = {
    async createChatCompletion() {
      throw new Error("non-streaming path should not be used");
    },
    createChatCompletionStream: () => Promise.resolve((async function* () {
      yield { choices: [{ delta: { content: "Promise stream" } }] };
      yield { choices: [{ finish_reason: "stop", delta: {} }] };
    })())
  };

  const result = await runAgentCompletionStream({
    client,
    providerId: "silicon",
    modelSettings: {
      providerId: "silicon",
      model: "deepseek-ai/DeepSeek-V3.2",
      temperature: 0.7,
      topP: 1,
      contextCount: 5,
      maxTokens: 2000,
      maxTokensEnabled: false,
      streaming: true,
      toolCallMode: "none",
      maxToolCalls: 0
    },
    messages: [{ role: "user", content: "Say hello" }],
    allowedToolRefs: [],
    toolState: {},
    toolContext: {}
  });

  assert.equal(result.text, "Promise stream");
});

test("streaming provider loop continues after streamed tool calls", async () => {
  const events: ToolEventRecord[] = [];
  const statuses: string[] = [];
  const tokens: string[] = [];
  let requestCount = 0;
  const client: ChatClient = {
    async createChatCompletion() {
      throw new Error("non-streaming path should not be used");
    },
    async *createChatCompletionStream() {
      requestCount += 1;
      if (requestCount === 1) {
        yield {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "knowledge_base", arguments: "{\"query\":\"draft\"," }
              }]
            }
          }]
        };
        yield {
          choices: [{
            finish_reason: "tool_calls",
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: "\"limit\":1}" }
              }]
            }
          }]
        };
        return;
      }
      yield { choices: [{ delta: { content: "Final answer" } }] };
      yield { choices: [{ finish_reason: "stop", delta: {} }] };
    }
  };

  const result = await runAgentCompletionStream({
    client,
    providerId: "openai",
    modelSettings: {
      providerId: "openai",
      model: "gpt-4.1-mini",
      temperature: 0.7,
      topP: 1,
      contextCount: 5,
      maxTokens: 2000,
      maxTokensEnabled: false,
      streaming: true,
      toolCallMode: "auto",
      maxToolCalls: 4
    },
    messages: [{ role: "user", content: "Use context" }],
    allowedToolRefs: ["knowledge_base"],
    toolState: { knowledge_base: true },
    toolContext: { contextValues: { currentDraft: "Draft body" }, chatInstruction: "Use context" },
    onToolEvent: (event) => events.push(event),
    onStatus: (status) => statuses.push(status.phase),
    onToken: (token) => tokens.push(token)
  });

  assert.equal(result.text, "Final answer");
  assert.deepEqual(tokens, ["Final answer"]);
  assert.equal(events.map((event) => event.eventType).join(","), "tool_call_requested,tool_call_completed");
  assert.ok(statuses.includes("searching"));
});
