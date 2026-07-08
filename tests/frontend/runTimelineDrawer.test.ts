import test from "node:test";
import assert from "node:assert/strict";
import { deriveAssistantRunTraceState } from "../../src/features/workspace/components/AssistantRunTrace";
import { agentPlanTraceTarget, latestBudgetLimitFailure } from "../../src/features/workspace/components/AICollaborationDrawer";

test("assistant run trace auto expands while running and collapses after completion", () => {
  assert.deepEqual(deriveAssistantRunTraceState({
    events: [{ id: "1", eventType: "phase_started", status: "running", title: "Thinking", summary: "", sequence: 1, createdAt: "2026-06-14T00:00:00.000Z" }],
    userExpanded: undefined
  }), { expanded: true, failed: false, running: true });

  assert.deepEqual(deriveAssistantRunTraceState({
    events: [{ id: "2", eventType: "run_completed", status: "completed", title: "Done", summary: "", sequence: 2, createdAt: "2026-06-14T00:00:01.000Z" }],
    userExpanded: undefined
  }), { expanded: false, failed: false, running: false });
});

test("assistant run trace lets terminal completion override earlier running events", () => {
  assert.deepEqual(deriveAssistantRunTraceState({
    events: [
      { id: "1", eventType: "phase_started", status: "running", title: "Thinking", summary: "", sequence: 1, createdAt: "2026-06-14T00:00:00.000Z" },
      { id: "2", eventType: "tool_started", status: "running", title: "Web search", summary: "", sequence: 2, createdAt: "2026-06-14T00:00:01.000Z" },
      { id: "3", eventType: "run_completed", status: "completed", title: "Done", summary: "", sequence: 3, createdAt: "2026-06-14T00:00:02.000Z" }
    ],
    userExpanded: undefined
  }), { expanded: false, failed: false, running: false });
});

test("assistant run trace stays open on failure", () => {
  assert.equal(deriveAssistantRunTraceState({
    events: [{ id: "3", eventType: "run_failed", status: "failed", title: "Failed", summary: "", sequence: 3, createdAt: "2026-06-14T00:00:02.000Z" }],
    userExpanded: undefined
  }).expanded, true);
});

test("drawer derives AgentPlan trace target from the latest plan-bound event", () => {
  const plan = {
    id: "plan_1",
    currentStepId: "step_1"
  };

  assert.deepEqual(agentPlanTraceTarget([
    { id: "1", eventType: "tool_started", status: "running", title: "Old", summary: "", sequence: 1, createdAt: "2026-06-14T00:00:00.000Z", payload: { planId: "plan_1", stepId: "step_1" } },
    { id: "2", eventType: "tool_completed", status: "completed", title: "New", summary: "", sequence: 2, createdAt: "2026-06-14T00:00:01.000Z", payload: { agentPlanId: "plan_1", agentPlanStepId: "step_2" } }
  ], [plan as never]), { planId: "plan_1", stepId: "step_2" });
});

test("drawer treats exhausted budget finalization retries as resumable budget failures", () => {
  assert.equal(latestBudgetLimitFailure([{
    id: "message_1",
    role: "assistant",
    text: "Budget finalization retry limit reached.",
    completion: {
      status: "partial",
      reasons: ["The runtime reached a budget gate and could not complete finalization after repeated prompts."],
      missingRequirements: ["Continue finalization from gathered evidence."],
      evaluatedAt: "2026-07-08T00:00:00.000Z"
    },
    timeline: [{
      id: "event_1",
      eventType: "decision",
      status: "running",
      title: "Final synthesis",
      summary: "Budget finalization retry exhausted.",
      sequence: 1,
      createdAt: "2026-07-08T00:00:00.000Z",
      payload: {
        type: "synthesis_gate",
        reason: "budget finalization retry exhausted",
        finalization_retry_exhausted: true
      }
    }]
  }]), true);
});
