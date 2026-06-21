import test from "node:test";
import assert from "node:assert/strict";
import { getSkillCatalog } from "./agentDefinitionService.js";

test("skill catalog exposes scientific security metadata without skill bodies", async () => {
  const catalog = await getSkillCatalog();
  const databaseLookup = catalog.find((skill) => skill.name === "database-lookup");

  assert.ok(databaseLookup);
  assert.equal("content" in databaseLookup, false);
  assert.equal(databaseLookup.executionMode, "sandbox");
  assert.equal(databaseLookup.riskLevel, "medium");
  assert.equal(databaseLookup.capabilityGroup, "science-db");
  assert.equal(databaseLookup.upstream?.repo, "K-Dense-AI/scientific-agent-skills");
  assert.deepEqual(databaseLookup.runtimeTools, ["read_file", "bash"]);
});
