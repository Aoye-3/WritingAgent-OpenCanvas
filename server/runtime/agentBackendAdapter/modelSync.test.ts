import test from "node:test";
import assert from "node:assert/strict";
import { createModelRuntimeSyncService } from "./modelSync.js";

const configuredModels = [
  {
    id: "openai-config",
    providerId: "openai",
    modelId: "gpt-test",
    modelName: "GPT Test",
    modelType: "chat",
    apiKey: "sk-secret",
    baseURL: "https://api.example",
    enabled: true,
    createdAt: "",
    updatedAt: ""
  },
  {
    id: "unsupported-config",
    providerId: "anthropic",
    modelId: "claude-test",
    modelName: "Claude Test",
    modelType: "chat",
    apiKey: "anthropic-secret",
    baseURL: "https://anthropic.example",
    enabled: true,
    createdAt: "",
    updatedAt: ""
  }
] as const;

test("model runtime sync marks supported and unsupported models without exposing keys", async () => {
  let pushedModels: Array<{ use: string }> = [];
  const service = createModelRuntimeSyncService({
    loadModels: async () => [...configuredModels],
    pushModels: async (models) => {
      pushedModels = models;
      return { count: models.length };
    }
  });

  await service.sync();

  assert.equal(service.isModelReady("openai-config"), true);
  assert.equal(service.isModelReady("unsupported-config"), false);
  assert.deepEqual(service.getStatus().models.map((model) => [model.configuredModelApiId, model.status]), [
    ["openai-config", "synced"],
    ["unsupported-config", "unsupported"]
  ]);
  assert.equal(JSON.stringify(service.getStatus()).includes("sk-secret"), false);
  assert.equal(JSON.stringify(service.getStatus()).includes("anthropic-secret"), false);
  assert.equal(pushedModels[0]?.use, "langchain_openai:ChatOpenAI");
});

test("model runtime sync records a safe degraded status when push fails", async () => {
  const service = createModelRuntimeSyncService({
    loadModels: async () => [configuredModels[0]],
    pushModels: async () => {
      throw new Error("Authorization token sk-secret rejected");
    }
  });

  await assert.rejects(() => service.sync(), /synchronization failed/i);

  assert.equal(service.isModelReady("openai-config"), false);
  assert.equal(service.getStatus().models[0]?.status, "failed");
  assert.equal(service.getStatus().models[0]?.errorMessage, "AgentBackend model synchronization failed.");
});

test("syncs registry providers that use the OpenAI protocol", async () => {
  let pushed: Array<{ model: string }> = [];
  const service = createModelRuntimeSyncService({
    loadModels: async () => [{ ...configuredModels[0], id: "silicon-model", providerId: "silicon", modelId: "Qwen/Qwen3.5-35B-A3B" }],
    pushModels: async (models) => (pushed = models, { count: models.length })
  });
  await service.sync();
  assert.equal(service.isModelReady("silicon-model"), true);
  assert.equal(pushed[0]?.model, "Qwen/Qwen3.5-35B-A3B");
});

test("syncs DeepSeek models with explicit thinking enable and disable settings", async () => {
  let pushed: Array<{
    supports_thinking: boolean;
    supports_reasoning_effort: boolean;
    supports_tool_choice_with_thinking: true | false | "unknown";
    when_thinking_enabled?: unknown;
    when_thinking_disabled?: unknown;
  }> = [];
  const service = createModelRuntimeSyncService({
    loadModels: async () => [{
      ...configuredModels[0],
      id: "deepseek-config",
	      providerId: "deepseek",
	      modelId: "deepseek-v4-flash",
      supportsThinking: true,
	      baseURL: "https://api.deepseek.com"
    }],
    pushModels: async (models) => (pushed = models, { count: models.length })
  });

  await service.sync();

  assert.equal(service.isModelReady("deepseek-config"), true);
  assert.equal(pushed[0]?.supports_thinking, true);
  assert.equal(pushed[0]?.supports_reasoning_effort, false);
  assert.equal(pushed[0]?.supports_tool_choice_with_thinking, false);
  assert.deepEqual(pushed[0]?.when_thinking_enabled, {
    extra_body: { thinking: { type: "enabled" } }
  });
  assert.deepEqual(pushed[0]?.when_thinking_disabled, {
    extra_body: { thinking: { type: "disabled" } }
  });
});

test("syncs thinking support from the configured model record", async () => {
  let pushed: Array<{
    supports_thinking: boolean;
    when_thinking_enabled?: unknown;
    when_thinking_disabled?: unknown;
  }> = [];
  const service = createModelRuntimeSyncService({
    loadModels: async () => [{
      ...configuredModels[0],
      id: "silicon-deepseek-v32",
      providerId: "silicon",
      modelId: "deepseek-ai/DeepSeek-V3.2",
      supportsThinking: true
    }],
    pushModels: async (models) => (pushed = models, { count: models.length })
  });

  await service.sync();

  assert.equal(service.isModelReady("silicon-deepseek-v32"), true);
  assert.equal(pushed[0]?.supports_thinking, true);
  assert.deepEqual(pushed[0]?.when_thinking_enabled, {
    extra_body: { thinking: { type: "enabled" } }
  });
});
