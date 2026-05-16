import test from "node:test";
import assert from "node:assert/strict";
import { getProviderProfile, normalizeChatRequest } from "./providerRuntime.js";
import type { AgentSettings } from "./agentCards.js";

const baseModel: AgentSettings["model"] = {
  providerId: "deepseek",
  model: "deepseek-chat",
  temperature: 0.7,
  topP: 1,
  contextCount: 5,
  maxTokens: 2000,
  maxTokensEnabled: true,
  streaming: true,
  toolCallMode: "auto",
  maxToolCalls: 4
};

test("maps DeepSeek compatibility aliases and thinking mode", () => {
  const profile = getProviderProfile("deepseek");
  const request = normalizeChatRequest(profile, {
    modelSettings: { ...baseModel, model: "deepseek-reasoner" },
    messages: [{ role: "user", content: "Plan" }],
    tools: [],
    stream: false
  });

  assert.equal(request.model, "deepseek-v4-flash");
  assert.deepEqual(request.thinking, { type: "enabled", reasoning_effort: "high" });
  assert.equal(request.max_tokens, 2000);
});

test("normalizes tool_choice for chat completions providers", () => {
  const profile = getProviderProfile("openai-compatible");
  const request = normalizeChatRequest(profile, {
    modelSettings: { ...baseModel, providerId: "openai-compatible", toolCallMode: "function" },
    messages: [{ role: "user", content: "Use tools" }],
    tools: [{ type: "function", function: { name: "knowledge_base", description: "Search", parameters: { type: "object", properties: {}, additionalProperties: false } } }],
    stream: false
  });

  assert.equal(request.tool_choice, "required");
  assert.equal(request.tools?.[0]?.function.name, "knowledge_base");
});

test("uses auto tool choice for DeepSeek function mode", () => {
  const profile = getProviderProfile("deepseek");
  const request = normalizeChatRequest(profile, {
    modelSettings: { ...baseModel, providerId: "deepseek", toolCallMode: "function" },
    messages: [{ role: "user", content: "Use tools" }],
    tools: [{ type: "function", function: { name: "canvas_write", description: "Write", parameters: { type: "object", properties: {}, additionalProperties: false } } }],
    stream: false
  });

  assert.equal(request.tool_choice, "auto");
  assert.equal(request.tools?.[0]?.function.name, "canvas_write");
});

test("rejects invalid model settings before provider calls", () => {
  const profile = getProviderProfile("openai");
  assert.throws(
    () => normalizeChatRequest(profile, {
      modelSettings: { ...baseModel, providerId: "openai", temperature: 3 },
      messages: [{ role: "user", content: "Bad settings" }],
      tools: [],
      stream: false
    }),
    /temperature/
  );
});

test("normalizes DeepSeek prefix completion into assistant prefix request", () => {
  const profile = getProviderProfile("deepseek");
  const request = normalizeChatRequest(profile, {
    modelSettings: { ...baseModel, responseMode: "prefix_completion" },
    messages: [{ role: "user", content: "Continue this draft" }],
    tools: [],
    stream: false
  });

  assert.equal(request.baseURLOverride, "https://api.deepseek.com/beta");
  assert.equal(request.messages.at(-1)?.role, "assistant");
  assert.equal(request.messages.at(-1)?.prefix, true);
});

test("preserves DeepSeek reasoning_content on assistant tool-call messages", () => {
  const profile = getProviderProfile("deepseek");
  const request = normalizeChatRequest(profile, {
    modelSettings: { ...baseModel, providerId: "deepseek", thinkingMode: "enabled", reasoningEffort: "high" },
    messages: [
      { role: "user", content: "Use the canvas" },
      {
        role: "assistant",
        content: "I will search first.",
        reasoning_content: "private chain of thought",
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "knowledge_base", arguments: "{}" }
        }]
      } as never
    ],
    tools: [{ type: "function", function: { name: "knowledge_base", description: "Search", parameters: { type: "object", properties: {}, additionalProperties: false } } }],
    stream: false
  });

  assert.equal(request.thinking?.type, "enabled");
  assert.equal((request.messages[1] as Record<string, unknown>).reasoning_content, "private chain of thought");
});

test("strips provider-private assistant fields when DeepSeek message has no tool calls", () => {
  const profile = getProviderProfile("deepseek");
  const request = normalizeChatRequest(profile, {
    modelSettings: { ...baseModel, providerId: "deepseek" },
    messages: [
      { role: "user", content: "Use the canvas" },
      {
        role: "assistant",
        content: "I will create a write request.",
        reasoning_content: "private chain of thought"
      } as never
    ],
    tools: [],
    stream: false
  });

  assert.equal("reasoning_content" in (request.messages[1] as Record<string, unknown>), false);
  assert.deepEqual(request.messages[1], {
    role: "assistant",
    content: "I will create a write request."
  });
});

test("strips DeepSeek-only reasoning_content for OpenAI-compatible providers", () => {
  const profile = getProviderProfile("openai-compatible");
  const request = normalizeChatRequest(profile, {
    modelSettings: { ...baseModel, providerId: "openai-compatible" },
    messages: [
      {
        role: "assistant",
        content: "Calling a tool.",
        reasoning_content: "private chain of thought",
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "knowledge_base", arguments: "{}" }
        }]
      } as never
    ],
    tools: [{ type: "function", function: { name: "knowledge_base", description: "Search", parameters: { type: "object", properties: {}, additionalProperties: false } } }],
    stream: false
  });

  assert.equal("reasoning_content" in (request.messages[0] as Record<string, unknown>), false);
});

test("keeps explicit DeepSeek thinking when tool calls are enabled", () => {
  const profile = getProviderProfile("deepseek");
  const request = normalizeChatRequest(profile, {
    modelSettings: { ...baseModel, providerId: "deepseek", thinkingMode: "enabled", reasoningEffort: "high" },
    messages: [{ role: "user", content: "Search, then write" }],
    tools: [{ type: "function", function: { name: "web_search", description: "Search", parameters: { type: "object", properties: {}, additionalProperties: false } } }],
    stream: false
  });

  assert.deepEqual(request.thinking, { type: "enabled", reasoning_effort: "high" });
});

test("disables DeepSeek thinking by default when tool calls are enabled", () => {
  const profile = getProviderProfile("deepseek");
  const request = normalizeChatRequest(profile, {
    modelSettings: { ...baseModel, providerId: "deepseek", model: "deepseek-v4-flash", thinkingMode: undefined },
    messages: [{ role: "user", content: "Search, then write" }],
    tools: [{ type: "function", function: { name: "web_search", description: "Search", parameters: { type: "object", properties: {}, additionalProperties: false } } }],
    stream: false
  });

  assert.deepEqual(request.thinking, { type: "disabled" });
});

test("keeps DeepSeek thinking enabled for no-tool requests", () => {
  const profile = getProviderProfile("deepseek");
  const request = normalizeChatRequest(profile, {
    modelSettings: { ...baseModel, providerId: "deepseek", thinkingMode: "enabled", reasoningEffort: "max" },
    messages: [{ role: "user", content: "Think carefully" }],
    tools: [],
    stream: false
  });

  assert.deepEqual(request.thinking, { type: "enabled", reasoning_effort: "max" });
});

test("rejects prefix completion when provider does not support it", () => {
  const profile = getProviderProfile("openai-compatible");
  assert.throws(
    () => normalizeChatRequest(profile, {
      modelSettings: { ...baseModel, providerId: "openai-compatible", responseMode: "prefix_completion" },
      messages: [{ role: "user", content: "Continue this draft" }],
      tools: [],
      stream: false
    }),
    /prefix completion/
  );
});
