import test from "node:test";
import assert from "node:assert/strict";
import { defaultAgentSettings, getAgentCard } from "../../agentCards.js";
import { buildAgentBackendSubagentConfig } from "./taskAgentMapping.js";

test("builds AgentBackend subagent config from an AgentCard and settings", () => {
  const card = getAgentCard("blog-post");
  const settings = {
    ...defaultAgentSettings(card),
    tools: { knowledge_base: true, web_search: false, canvas_write: false },
    prompt: {
      ...defaultAgentSettings(card).prompt,
      identityPrompt: "Custom chat identity",
      skillRefs: []
    }
  };

  const config = buildAgentBackendSubagentConfig(card, settings);

  assert.equal(card.id, "chat-agent");
  assert.equal(config.name, "facetwrite-chat-agent");
  assert.equal(config.systemPrompt, "Custom chat identity");
  assert.deepEqual(config.skills, []);
  assert.ok(config.tools.includes("knowledge_base"));
  assert.equal(config.tools.includes("web_search"), false);
  assert.equal(config.tools.includes("canvas_write"), false);
  assert.equal(config.model, "inherit");
});
