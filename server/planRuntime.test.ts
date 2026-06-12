import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("persists plan approval, step progress, waiting state, and retry", async () => {
  const storage = await isolatedStorage();
  await storage.ensureThread("thread_plan", "project_plan", "Research");

  const plan = storage.createPlanRun("thread_plan", {
    title: "Research product",
    goal: "Collect evidence and prepare Canvas artifacts",
    steps: [{ id: "sources", title: "Collect sources" }, { id: "summary", title: "Summarise" }]
  });
  assert.equal(plan.status, "awaiting_approval");
  assert.deepEqual(plan.steps.map((step: { status: string }) => step.status), ["pending", "pending"]);

  storage.approvePlanRun("thread_plan", plan.id);
  storage.updatePlanStep("thread_plan", plan.id, "sources", { status: "running" });
  storage.updatePlanStep("thread_plan", plan.id, "sources", { status: "failed", error: "Search timed out" });
  const retried = storage.retryPlanStep("thread_plan", plan.id, "sources");
  assert.equal(retried?.status, "pending");
  assert.equal(retried?.attempt, 1);

  const waiting = storage.setPlanWaitingForUser("thread_plan", plan.id, "Which market?");
  assert.equal(waiting?.status, "awaiting_user");
  assert.equal(waiting?.statusMessage, "Which market?");
  const resumed = storage.resumePlanWithAnswer("thread_plan", plan.id, "UK market");
  assert.equal(resumed?.status, "running");
  assert.equal(resumed?.statusMessage, "UK market");
});

test("upserts artifacts by stable artifact id", async () => {
  const storage = await isolatedStorage();
  await storage.ensureThread("thread_artifact", "project_artifact", "Research");
  const plan = storage.createPlanRun("thread_artifact", {
    title: "Research product",
    goal: "Prepare artifacts",
    steps: [{ id: "research", title: "Research" }]
  });
  storage.approvePlanRun("thread_artifact", plan.id);
  storage.updatePlanStep("thread_artifact", plan.id, "research", { status: "running" });

  storage.stagePlanArtifact("thread_artifact", plan.id, {
    artifactId: "official-summary",
    stepId: "research",
    type: "text",
    title: "Official summary",
    payload: { content: "First", nodeKind: "reference" }
  });
  storage.stagePlanArtifact("thread_artifact", plan.id, {
    artifactId: "official-summary",
    stepId: "research",
    type: "text",
    title: "Official summary",
    payload: { content: "Updated", nodeKind: "reference" }
  });

  const restored = storage.getPlanRun("thread_artifact", plan.id);
  assert.equal(restored?.artifacts.length, 1);
  assert.equal((restored?.artifacts[0]?.payload as { content: string }).content, "Updated");
});

test("resumes pre-approval clarification on the same draft plan", async () => {
  const storage = await isolatedStorage();
  await storage.ensureThread("thread_clarify", "project_clarify", "Research");
  const plan = storage.createPlanRun("thread_clarify", {
    title: "Clarify product research",
    goal: "Collect the missing scope before approval",
    steps: [{ id: "clarify", title: "Clarify the requested comparison" }]
  });

  const waiting = storage.setPlanWaitingForUser("thread_clarify", plan.id, "Which market and budget?");
  assert.equal(waiting?.approval, "pending");
  assert.equal(waiting?.status, "awaiting_user");

  const resumed = storage.resumePlanWithAnswer("thread_clarify", plan.id, "China, CNY 5,000");
  assert.equal(resumed?.id, plan.id);
  assert.equal(resumed?.approval, "pending");
  assert.equal(resumed?.status, "draft");
  assert.equal(resumed?.statusMessage, "China, CNY 5,000");
});

test("artifacts are restricted to the currently running step", async () => {
  const storage = await isolatedStorage();
  await storage.ensureThread("thread_step_artifact", "project_step_artifact", "Research");
  const plan = storage.createPlanRun("thread_step_artifact", {
    title: "Research",
    goal: "Produce step artifacts",
    steps: [{ id: "sources", title: "Sources" }, { id: "summary", title: "Summary" }]
  });
  storage.approvePlanRun("thread_step_artifact", plan.id);
  storage.updatePlanStep("thread_step_artifact", plan.id, "sources", { status: "running" });

  assert.throws(() => storage.stagePlanArtifact("thread_step_artifact", plan.id, {
    artifactId: "summary-early",
    stepId: "summary",
    type: "text",
    title: "Summary",
    payload: { content: "Too early" }
  }), /currently running step/i);
});

test("revises a pending plan in place and returns it to approval", async () => {
  const storage = await isolatedStorage();
  await storage.ensureThread("thread_revise", "project_revise", "Research");
  const plan = storage.createPlanRun("thread_revise", {
    title: "Initial scope",
    goal: "Clarify",
    steps: [{ id: "clarify", title: "Clarify" }]
  });
  storage.setPlanWaitingForUser("thread_revise", plan.id, "Which market?");
  storage.resumePlanWithAnswer("thread_revise", plan.id, "China");

  const revised = storage.revisePlanRun("thread_revise", plan.id, {
    title: "China phone research",
    goal: "Compare current Xiaomi phones",
    steps: [{ id: "sources", title: "Collect sources" }, { id: "compare", title: "Compare models" }]
  });
  assert.equal(revised?.id, plan.id);
  assert.equal(revised?.status, "awaiting_approval");
  assert.equal(revised?.approval, "pending");
  assert.deepEqual(revised?.steps.map((step: { id: string }) => step.id), ["sources", "compare"]);
});

async function isolatedStorage() {
  process.env.FACETWRITE_APP_ROOT = await mkdtemp(path.join(os.tmpdir(), "facetwrite-plan-"));
  const module = await import(`./storage.js?plan=${Date.now()}-${Math.random()}`);
  return module.createStorage();
}
