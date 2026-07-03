import test from "node:test";
import assert from "node:assert/strict";

import { isThinkingSupportedModel, modelSettingsToThinkingChoice } from "../../src/features/workspace/components/AIComposer";

test("thinking support follows the selected model record", () => {
  assert.equal(isThinkingSupportedModel({ supportsThinking: true }), true);
  assert.equal(isThinkingSupportedModel({ providerId: "deepseek", modelId: "deepseek-v4-flash", supportsThinking: false }), true);
  assert.equal(isThinkingSupportedModel({ providerId: "silicon", modelId: "deepseek-ai/DeepSeek-V3.2" }), true);
  assert.equal(isThinkingSupportedModel({ providerId: "deepseek", modelId: "deepseek-chat" }), false);
});

test("thinking choice stays disabled until the selected model enables thinking", () => {
  assert.equal(modelSettingsToThinkingChoice({ supportsThinking: true, thinkingMode: "enabled" }), "high");
  assert.equal(modelSettingsToThinkingChoice({ supportsThinking: true }), "disabled");
  assert.equal(modelSettingsToThinkingChoice({ supportsThinking: false, thinkingMode: "enabled" }), "disabled");
});
