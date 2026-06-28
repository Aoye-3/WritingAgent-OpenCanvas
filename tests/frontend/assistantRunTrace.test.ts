import test from "node:test";
import assert from "node:assert/strict";
import { deriveAssistantRunTraceState, formatAssistantRunTraceDetail } from "../../src/features/workspace/components/AssistantRunTrace";

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
  }), "invalid_clarification · options=2 · shape=missing_recommended · hasQuestion=true");
});
