import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("project-local Plan skills enforce intake then approval-ready planning", async () => {
  const root = path.resolve("modules", "agent-runtime", "skills", "public");
  const brainstorming = await readFile(path.join(root, "brainstorming", "SKILL.md"), "utf8");
  const writingPlans = await readFile(path.join(root, "writing-plans", "SKILL.md"), "utf8");

  assert.match(brainstorming, /plan_clarification_submit/);
  assert.match(brainstorming, /2-3 mutually exclusive options/);
  assert.match(writingPlans, /plan_revision_submit/);
  assert.match(writingPlans, /Do not execute steps/);
});
