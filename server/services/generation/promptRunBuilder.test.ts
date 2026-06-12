import test from "node:test";
import assert from "node:assert/strict";
import { defaultAgentSettings, getAgentCard } from "../../agentCards.js";
import { resolveModelSettings } from "./promptRunBuilder.js";

test("model settings require an explicitly resolved Model Config", async () => {
  const settings = defaultAgentSettings(getAgentCard("blog-post")).model;

  await assert.rejects(() => resolveModelSettings(settings), /select an enabled project model/i);
});

test("model settings use the explicitly resolved backend Model Config", async () => {
  const settings = defaultAgentSettings(getAgentCard("blog-post")).model;
  const resolved = await resolveModelSettings(settings, {
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
});
