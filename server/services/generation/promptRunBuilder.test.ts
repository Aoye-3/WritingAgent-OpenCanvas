import test from "node:test";
import assert from "node:assert/strict";
import { resolveModelSettings, resolveResponseLocale, userMessageForRun } from "./promptRunBuilder.js";

test("model settings require an explicitly resolved Model Config", async () => {
  await assert.rejects(() => resolveModelSettings(undefined), /select an enabled project model/i);
});

test("model settings use the explicitly resolved backend Model Config", async () => {
  const resolved = await resolveModelSettings({
    id: "deepseek--configured",
    providerId: "deepseek",
    modelId: "deepseek-configured",
    modelName: "Configured DeepSeek",
    modelType: "chat",
    apiKey: "sk-test",
    baseURL: "https://api.deepseek.example",
    enabled: true,
    createdAt: "",
    updatedAt: ""
  });

  assert.equal(resolved.configuredModelApiId, "deepseek--configured");
  assert.equal(resolved.providerId, "deepseek");
  assert.equal(resolved.model, "deepseek-configured");
  assert.equal(resolved.temperature, 0.7);
  assert.equal(resolved.contextCount, 5);
});

test("model settings ignore legacy Agent-owned model identity and use conversation runtime overrides", async () => {
  const resolved = await resolveModelSettings({
    id: "openai--configured",
    providerId: "openai",
    modelId: "gpt-4.1",
    modelName: "GPT 4.1",
    modelType: "chat",
    apiKey: "sk-test",
    baseURL: "https://api.openai.example",
    enabled: true,
    createdAt: "",
    updatedAt: ""
  }, {
    temperature: 0.2,
    contextCount: 12,
    streaming: false,
    toolCallMode: "none",
    maxToolCalls: 0
  }, {
    thinkingMode: "enabled",
    reasoningEffort: "high"
  });

  assert.equal(resolved.providerId, "openai");
  assert.equal(resolved.model, "gpt-4.1");
  assert.equal(resolved.temperature, 0.2);
  assert.equal(resolved.contextCount, 12);
  assert.equal(resolved.streaming, false);
  assert.equal(resolved.toolCallMode, "none");
  assert.equal(resolved.maxToolCalls, 0);
  assert.equal(resolved.thinkingMode, "enabled");
  assert.equal(resolved.reasoningEffort, "high");
});

test("response locale follows the user's instruction language before UI locale", () => {
  assert.equal(resolveResponseLocale({
    locale: "en",
    chatInstruction: "帮我总结一下这份资料"
  }), "zh");

  assert.equal(resolveResponseLocale({
    locale: "zh",
    chatInstruction: "Summarize this document for a product manager."
  }), "en");

  assert.equal(resolveResponseLocale({
    locale: "zh"
  }), "zh");
});

test("clarification resume runs do not persist synthetic chat instructions as user messages", () => {
  assert.equal(userMessageForRun({
    mode: "chat",
    locale: "en",
    chatInstruction: "Review recent Agent literature.\n\nSelected clarification: Multi-Agent systems",
    contextValues: {
      agentClarification: {
        clarificationId: "clarification_1",
        selectedOptionId: "multi_agent",
        answer: "Multi-Agent systems"
      }
    }
  }, "ChatAgent"), undefined);

  assert.equal(userMessageForRun({
    mode: "chat",
    locale: "en",
    chatInstruction: "Review recent Agent literature."
  }, "ChatAgent"), "Review recent Agent literature.");
});
