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
