import test from "node:test";
import assert from "node:assert/strict";
import { defaultAgentSettings, getAgentCard } from "../agentCards.js";
import { buildAgentRuntimeConfig, normalizeAgentSettings } from "./agentDefinitionService.js";

test("normalizes settings by adding catalog-backed tools with defaults", () => {
  const card = getAgentCard("chat-agent");
  const base = defaultAgentSettings(card);
  const normalized = normalizeAgentSettings(
    { ...base, tools: { knowledge_base: true } },
    { tools: { knowledge_base: false } },
    ["knowledge_base", "canvas_write"]
  );

  assert.equal(normalized.tools.knowledge_base, false);
  assert.equal(normalized.tools.canvas_write, true);
});

test("defaults to a neutral ChatAgent without Agent-owned model settings", () => {
  const card = getAgentCard();
  const settings = defaultAgentSettings(card);

  assert.equal(card.id, "chat-agent");
  assert.equal(card.title.en, "ChatAgent");
  assert.equal("model" in (settings as unknown as Record<string, unknown>), false);
});

test("normalizes legacy saved Agent model payloads without persisting model identity", () => {
  const card = getAgentCard("blog-post");
  const normalized = normalizeAgentSettings(
    defaultAgentSettings(card),
    {
      model: {
        configuredModelApiId: "legacy-config",
        providerId: "deepseek",
        model: "deepseek-chat",
        temperature: 1.4
      }
    } as never,
    card.toolRefs
  );

  assert.equal(card.id, "chat-agent");
  assert.equal("model" in (normalized as unknown as Record<string, unknown>), false);
});

test("normalizes settings by dropping tools that are not allowed by AgentCard", () => {
  const card = getAgentCard("chat-agent");
  const normalized = normalizeAgentSettings(defaultAgentSettings(card), { tools: { web_search: true, canvas_write: false } }, card.toolRefs);

  assert.equal(normalized.tools.web_search, true);
  assert.equal(normalized.tools.canvas_write, false);
});

test("builds runtime config with tool policies and deprecated refs", async () => {
  const card = getAgentCard("chat-agent");
  const settings = {
    ...defaultAgentSettings(card),
    tools: { canvas_write: true, web_search: true, artifact_stage: true }
  };
  const runtimeConfig = await buildAgentRuntimeConfig(card, settings);

  assert.ok(runtimeConfig.availableTools.some((tool) => tool.name === "canvas_write" && tool.riskLevel === "medium" && !tool.requiresApproval));
  assert.ok(runtimeConfig.toolPolicies.some((policy) => policy.name === "canvas_write" && !policy.requiresApproval && policy.canAutoRun));
  assert.deepEqual(runtimeConfig.deprecatedToolRefs, ["artifact_stage"]);
});
