import test from "node:test";
import assert from "node:assert/strict";
import { deriveAssistantRunTraceState, filterAssistantRunTraceEvents, formatAssistantRunTraceDetail } from "../../src/features/workspace/components/AssistantRunTrace";

test("assistant run trace derives failed and running states from visible events", () => {
  assert.deepEqual(deriveAssistantRunTraceState({
    events: [
      { id: "1", eventType: "phase_started", status: "running", title: "Preparing", summary: "", sequence: 1, createdAt: "2026-06-14T00:00:00.000Z" },
      { id: "2", eventType: "tool_started", status: "running", title: "Web search", summary: "", sequence: 2, createdAt: "2026-06-14T00:00:01.000Z" }
    ],
    userExpanded: undefined
  }), { expanded: true, failed: false, running: true });

  assert.deepEqual(deriveAssistantRunTraceState({
    events: [
      { id: "3", eventType: "run_failed", status: "failed", title: "Failed", summary: "", sequence: 3, createdAt: "2026-06-14T00:00:02.000Z" }
    ],
    userExpanded: undefined
  }), { expanded: true, failed: true, running: false });
});

test("assistant run trace exposes safe failed payload diagnostics", () => {
  assert.equal(formatAssistantRunTraceDetail({
    status: "failed",
    payload: {
      reason: "invalid_clarification",
      optionCount: 2,
      optionShape: "missing_recommended",
      hasQuestion: true
    }
  }), "invalid_clarification \u00b7 options=2 \u00b7 shape=missing_recommended \u00b7 hasQuestion=true");
});

test("assistant run trace filters to the active AgentPlan step", () => {
  const events = [
    { id: "1", eventType: "tool_started", status: "running", title: "Read", summary: "", sequence: 1, createdAt: "2026-06-14T00:00:00.000Z", payload: { planId: "plan_1", stepId: "step_1" } },
    { id: "2", eventType: "tool_completed", status: "completed", title: "Read", summary: "", sequence: 2, createdAt: "2026-06-14T00:00:01.000Z", payload: { agentPlanId: "plan_1", agentPlanStepId: "step_2" } },
    { id: "3", eventType: "tool_completed", status: "completed", title: "Other", summary: "", sequence: 3, createdAt: "2026-06-14T00:00:02.000Z", payload: { planId: "plan_2", stepId: "step_1" } }
  ] as const;

  assert.deepEqual(
    filterAssistantRunTraceEvents([...events], { planId: "plan_1", stepId: "step_2" }).map((event) => event.id),
    ["2"]
  );
});
