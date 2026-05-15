import test from "node:test";
import assert from "node:assert/strict";
import { defaultAgentSettings, getAgentCard } from "../agentCards.js";
import { buildAgentRuntimeConfig, normalizeAgentSettings } from "./agentDefinitionService.js";

test("normalizes settings by adding catalog-backed tools with defaults", () => {
  const card = getAgentCard("blog-post");
  const base = defaultAgentSettings(card);
  const normalized = normalizeAgentSettings(
    { ...base, tools: { knowledge_base: true } },
    { tools: { knowledge_base: false } },
    ["knowledge_base", "canvas_write"]
  );

  assert.equal(normalized.tools.knowledge_base, false);
  assert.equal(normalized.tools.canvas_write, true);
});

test("normalizes settings by dropping tools that are not allowed by AgentCard", () => {
  const card = getAgentCard("rewrite-polish");
  const normalized = normalizeAgentSettings(defaultAgentSettings(card), { tools: { web_search: true, canvas_write: false } }, card.toolRefs);

  assert.equal(normalized.tools.web_search, undefined);
  assert.equal(normalized.tools.canvas_write, false);
});

test("builds runtime config with tool policies and deprecated refs", async () => {
  const card = getAgentCard("email-writer");
  const settings = {
    ...defaultAgentSettings(card),
    tools: { quick_messages: true, canvas_write: true, web_search: true }
  };
  const runtimeConfig = await buildAgentRuntimeConfig(card, settings);

  assert.ok(runtimeConfig.availableTools.some((tool) => tool.name === "canvas_write" && tool.requiresApproval));
  assert.ok(runtimeConfig.toolPolicies.some((policy) => policy.name === "canvas_write" && policy.requiresApproval && !policy.canAutoRun));
  assert.deepEqual(runtimeConfig.deprecatedToolRefs, ["web_search"]);
});
