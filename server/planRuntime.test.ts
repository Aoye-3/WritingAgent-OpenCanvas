import test from "node:test";
import assert from "node:assert/strict";
import { PlanOrchestrator } from "./services/planOrchestrator.js";
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

test("validates Plan intake from persisted state instead of stream events", async () => {
  const storage = await isolatedStorage();
  await storage.ensureThread("thread_postcondition_intake", "project_postcondition_intake", "Research");
  const plan = storage.createPlanIntake("thread_postcondition_intake", { title: "Compare laptops", goal: "Choose scope" });
  const orchestrator = new PlanOrchestrator(storage);
  const payload = {
    mode: "chat" as const,
    locale: "en" as const,
    planGeneration: { phase: "intake" as const, planId: plan.id, phaseAttemptId: "intake_1" }
  };

  assert.throws(() => orchestrator.assertPostcondition("thread_postcondition_intake", payload), /persisted clarification/);
  storage.submitPlanClarification("thread_postcondition_intake", plan.id, {
    question: "Which comparison?",
    options: [
      { id: "latest", label: "Latest", description: "Compare current models", recommended: true },
      { id: "value", label: "Best value", description: "Compare lower-cost models", recommended: false }
    ],
    status: "pending"
  });
  assert.doesNotThrow(() => orchestrator.assertPostcondition("thread_postcondition_intake", payload));
});

test("rejects a Plan event when the revision was not persisted", async () => {
  const storage = await isolatedStorage();
  await storage.ensureThread("thread_postcondition_revision", "project_postcondition_revision", "Research");
  const plan = storage.createPlanIntake("thread_postcondition_revision", { title: "Compare laptops", goal: "Choose scope" });
  const orchestrator = new PlanOrchestrator(storage);

  assert.throws(() => orchestrator.assertPostcondition("thread_postcondition_revision", {
    mode: "chat",
    locale: "en",
    planGeneration: { phase: "revise", planId: plan.id, phaseAttemptId: "revise_1" }
  }), /approval-ready persisted Plan/);
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

test("persists and answers a structured Plan clarification", async () => {
  const storage = await isolatedStorage();
  await storage.ensureThread("thread_choice", "project_choice", "Research");
  const plan = storage.createPlanRun("thread_choice", {
    title: "Clarify purchase priorities",
    goal: "Collect one decision before planning",
    steps: [{ id: "intake", title: "Clarify intent" }],
    clarification: {
      question: "What matters most?",
      options: [
        { id: "value", label: "Best value", description: "Balance price and capability", recommended: true },
        { id: "power", label: "Maximum power", description: "Prefer performance", recommended: false }
      ],
      status: "pending"
    }
  });
  storage.setPlanWaitingForUser("thread_choice", plan.id, "What matters most?");

  const answered = storage.resumePlanWithAnswer("thread_choice", plan.id, { optionId: "value" });

  assert.equal(answered?.clarification?.status, "answered");
  assert.equal(answered?.clarification?.selectedOptionId, "value");
  assert.equal(answered?.status, "draft");
});

test("completes a Plan only after its final step has a committed artifact", async () => {
  const storage = await isolatedStorage();
  await storage.ensureThread("thread_complete", "project_complete", "Research");
  const plan = storage.createPlanRun("thread_complete", {
    title: "Deliver result",
    goal: "Write one durable artifact",
    steps: [{ id: "deliver", title: "Deliver" }]
  });
  storage.approvePlanRun("thread_complete", plan.id);
  storage.updatePlanStep("thread_complete", plan.id, "deliver", { status: "running" });
  assert.throws(() => storage.updatePlanStep("thread_complete", plan.id, "deliver", { status: "completed" }), /Artifact is committed/i);
  storage.stagePlanArtifact("thread_complete", plan.id, {
    artifactId: "result",
    stepId: "deliver",
    type: "text",
    title: "Result",
    payload: { content: "Done" }
  });
  storage.markPlanArtifactCommitted("thread_complete", plan.id, "result", "canvas_result");
  storage.updatePlanStep("thread_complete", plan.id, "deliver", { status: "completed" });

  assert.equal(storage.getPlanRun("thread_complete", plan.id)?.status, "completed");
  assert.equal(storage.getPlanExecution("thread_complete", plan.id)?.status, "completed");
});

test("product runtime advances an execution step after its artifact commits", async () => {
  const storage = await isolatedStorage();
  await storage.ensureThread("thread_orchestrated", "project_orchestrated", "Research");
  const plan = storage.createPlanRun("thread_orchestrated", {
    title: "Deliver result",
    goal: "Keep step status server-owned",
    steps: [{ id: "deliver", title: "Deliver" }, { id: "review", title: "Review" }]
  });
  storage.approvePlanRun("thread_orchestrated", plan.id);
  const orchestrator = new PlanOrchestrator(storage);
  const payload = {
    mode: "chat" as const,
    locale: "en" as const,
    contextValues: { planExecution: { planId: plan.id, stepId: "deliver" } }
  };

  orchestrator.prepare("thread_orchestrated", payload);
  storage.stagePlanArtifact("thread_orchestrated", plan.id, {
    artifactId: "result",
    stepId: "deliver",
    type: "text",
    title: "Result",
    payload: { content: "Done" }
  });
  storage.markPlanArtifactCommitted("thread_orchestrated", plan.id, "result", "canvas_result");
  orchestrator.complete("thread_orchestrated", payload);

  const advanced = storage.getPlanRun("thread_orchestrated", plan.id);
  assert.equal(advanced?.steps[0]?.status, "completed");
  assert.equal(advanced?.currentStepId, "review");
  assert.deepEqual(storage.listPlanActivities("thread_orchestrated", plan.id).map((activity: { type: string }) => activity.type), [
    "plan_ready",
    "step_started",
    "step_completed"
  ]);
});

test("persists Plan activities and resumes a paused execution", async () => {
  const storage = await isolatedStorage();
  await storage.ensureThread("thread_activity", "project_activity", "Research");
  const plan = storage.createPlanRun("thread_activity", {
    title: "Deliver result",
    goal: "Keep execution visible and recoverable",
    steps: [{ id: "research", title: "Research" }]
  });
  storage.approvePlanRun("thread_activity", plan.id);
  storage.recordPlanActivity("thread_activity", plan.id, {
    stepId: "research",
    type: "step_started",
    status: "running",
    summary: "Research step started"
  });

  const paused = storage.pausePlanRun("thread_activity", plan.id, "Conversation changed");
  assert.equal(paused?.status, "paused");
  assert.equal(storage.getPlanExecution("thread_activity", plan.id)?.status, "paused");

  const resumed = storage.resumePlanRun("thread_activity", plan.id);
  assert.equal(resumed?.status, "running");
  assert.equal(storage.getPlanExecution("thread_activity", plan.id)?.status, "running");
  assert.deepEqual(storage.listPlanActivities("thread_activity", plan.id).map((activity: { type: string }) => activity.type), [
    "plan_ready",
    "step_started",
    "plan_paused",
    "plan_resumed"
  ]);
});

test("creates and refreshes a deletable Canvas Plan projection", async () => {
  const storage = await isolatedStorage();
  await storage.ensureThread("thread_projection", "project_projection", "Research");
  const plan = storage.createPlanRun("thread_projection", {
    title: "Compare laptops",
    goal: "Choose the best laptop",
    steps: [{ id: "compare", title: "Compare models" }]
  });

  const projected = storage.getPlanRun("thread_projection", plan.id);
  assert.ok(projected?.canvasNodeId);
  const node = storage.listCanvasNodes("project_projection").find((item: { id: string }) => item.id === projected?.canvasNodeId);
  assert.equal(node?.kind, "plan");
  assert.match(node?.content ?? "", /\[ \] Compare models/);
  const initialProjection = (node?.metadata as { planProjection?: { steps?: Array<{ id: string; title: string; status: string }>; artifactCount?: number } })?.planProjection;
  assert.equal(initialProjection?.steps?.[0]?.id, "compare");
  assert.equal(initialProjection?.steps?.[0]?.title, "Compare models");
  assert.equal(initialProjection?.steps?.[0]?.status, "pending");

  storage.approvePlanRun("thread_projection", plan.id);
  storage.updatePlanStep("thread_projection", plan.id, "compare", { status: "running" });
  storage.stagePlanArtifact("thread_projection", plan.id, {
    artifactId: "comparison",
    stepId: "compare",
    type: "text",
    title: "Comparison",
    payload: { content: "Done" }
  });
  storage.markPlanArtifactCommitted("thread_projection", plan.id, "comparison", "canvas_comparison");
  storage.updatePlanStep("thread_projection", plan.id, "compare", { status: "completed" });
  const refreshed = storage.listCanvasNodes("project_projection").find((item: { id: string }) => item.id === projected?.canvasNodeId);
  assert.match(refreshed?.content ?? "", /\[x\] Compare models/);
  const refreshedProjection = (refreshed?.metadata as { planProjection?: { steps?: Array<{ id: string; status: string }>; artifactCount?: number } })?.planProjection;
  assert.equal(refreshedProjection?.artifactCount, 1);
  assert.equal(refreshedProjection?.steps?.[0]?.status, "completed");

  storage.deleteCanvasNode("project_projection", projected!.canvasNodeId!);
  assert.equal(storage.getPlanRun("thread_projection", plan.id)?.status, "completed");
  const recovered = storage.setPlanRunStatus("thread_projection", plan.id, "completed", "Archived");
  assert.ok(recovered?.canvasNodeId);
  assert.notEqual(recovered?.canvasNodeId, projected?.canvasNodeId);
  assert.equal(storage.listCanvasNodes("project_projection").some((item: { id: string }) => item.id === recovered?.canvasNodeId), true);
});

async function isolatedStorage() {
  process.env.FACETWRITE_APP_ROOT = await mkdtemp(path.join(os.tmpdir(), "facetwrite-plan-"));
  const module = await import(`./storage.js?plan=${Date.now()}-${Math.random()}`);
  return module.createStorage();
}
