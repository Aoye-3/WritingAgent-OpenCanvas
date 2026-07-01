import test from "node:test";
import assert from "node:assert/strict";
import { PlanExecutor } from "./planExecutor.js";
import { PlanOrchestrator } from "./planOrchestrator.js";

test("executor runs persisted plan steps sequentially without a frontend trigger", async () => {
  const plans: any[] = [{
    id: "plan_1",
    threadId: "thread_1",
    projectId: "project_1",
    status: "running",
    approval: "approved",
    currentStepId: "step_1",
    executionVersion: 1,
    steps: [{ id: "step_1", status: "pending" }, { id: "step_2", status: "pending" }]
  }];
  const calls: string[] = [];
  const storage = {
    getPlanRun: () => plans[0],
    getPlanExecution: () => ({ status: "running", currentStepId: plans[0].currentStepId, attempt: 0 }),
    claimPlanExecution: () => true,
    releasePlanExecutionLease: () => undefined,
    pausePlanRun: () => undefined
  };
  const executor = new PlanExecutor(storage as never, async (payload) => {
    calls.push(payload.stepId!);
    const step = plans[0].steps.find((item: { id: string }) => item.id === payload.stepId)!;
    step.status = "completed";
    const next = plans[0].steps.find((item: { status: string }) => item.status === "pending");
    plans[0].currentStepId = next?.id;
    if (!next) plans[0].status = "completed";
  });

  executor.wake("thread_1", "plan_1");
  await executor.whenIdle("plan_1");

  assert.deepEqual(calls, ["step_1", "step_2"]);
});

test("orchestrator attributes tool activity to the only running plan when the adapter omits planId", () => {
  const activities: unknown[] = [];
  const plan = { id: "plan_1", status: "running" };
  const storage = {
    listPlanRuns: () => [plan],
    getPlanRun: (_threadId: string, planId: string) => planId === plan.id ? plan : undefined,
    recordPlanActivity: (_threadId: string, _planId: string, activity: unknown) => activities.push(activity)
  };

  new PlanOrchestrator(storage as never).observe("thread_1", {
    eventType: "agent_backend_tool_started",
    payload: { toolName: "web_search" }
  });

  assert.deepEqual(activities, [{
    stepId: undefined,
    type: "tool_started",
    status: "running",
    summary: "Checking sources"
  }]);
});

test("executor renews its lease while a long step is running", async () => {
  let resolveGeneration!: () => void;
  const generation = new Promise<void>((resolve) => { resolveGeneration = resolve; });
  const renewals: string[] = [];
  const plan = {
    id: "plan_1", threadId: "thread_1", projectId: "project_1", status: "running",
    approval: "approved", currentStepId: "step_1", executionVersion: 1,
    steps: [{ id: "step_1", status: "pending" }]
  };
  const storage = {
    getPlanRun: () => plan,
    getPlanExecution: () => ({ status: "running", currentStepId: "step_1", attempt: 0 }),
    claimPlanExecution: () => true,
    renewPlanExecutionLease: (_threadId: string, _planId: string, owner: string) => { renewals.push(owner); return true; },
    releasePlanExecutionLease: () => undefined,
    pausePlanRun: () => undefined
  };
  const executor = new PlanExecutor(storage as never, async () => {
    await generation;
    plan.status = "completed";
  }, { heartbeatMs: 5 });
  executor.wake("thread_1", "plan_1");
  const deadline = Date.now() + 250;
  while (renewals.length < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  resolveGeneration();
  await executor.whenIdle("plan_1");
  assert.ok(renewals.length >= 2);
});
