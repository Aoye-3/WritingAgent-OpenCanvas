import test from "node:test";
import assert from "node:assert/strict";
import {
  agentClarificationFromRecord,
  hasUnresolvedAgentClarificationTrace,
  latestPendingAgentClarification
} from "../../src/features/workspace/components/AICollaborationDrawer";
import type { AgentClarification } from "../../src/features/agents/types";
import type { CollaborationMessage } from "../../src/features/generation/types";

test("persisted pending Agent clarification maps to an actionable composer prompt", () => {
  const clarification: AgentClarification = {
    id: "stored_q2",
    threadId: "thread_1",
    runId: "run_1",
    status: "pending",
    question: "Which time range should the review cover?",
    options: [
      { id: "recent_3", label: "Recent 3 years", detail: "2023-2026", recommended: true },
      { id: "recent_5", label: "Recent 5 years", detail: "2021-2026", recommended: false }
    ],
    resumeContext: {
      originalInstruction: "Review recent Agent literature.",
      transientSkillRefs: ["literature-review"],
      runtimeBudgetProfile: "high",
      canvas: { workflow: { mode: "batch_delivery" } }
    },
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:01.000Z"
  };

  const prompt = agentClarificationFromRecord(clarification);

  assert.equal(prompt?.clarificationId, "stored_q2");
  assert.equal(prompt?.question, "Which time range should the review cover?");
  assert.equal(prompt?.options[0]?.id, "recent_3");
  assert.equal(prompt?.resumeContext?.originalInstruction, "Review recent Agent literature.");
  assert.deepEqual(prompt?.resumeContext?.transientSkillRefs, ["literature-review"]);
  assert.equal(prompt?.resumeContext?.runtimeBudgetProfile, "high");
});

test("timeline fallback keeps the latest Agent clarification actionable when toolCallId is reused", () => {
  const messages = [assistantWithTimeline([
    clarificationEvent(1, "call_reused", "Which Agent scope?", [
      { id: "multi_agent", label: "Multi-agent systems", detail: "Coordination and collaboration", recommended: true },
      { id: "agent_frameworks", label: "Agent frameworks", detail: "Runtime and tooling", recommended: false }
    ]),
    clarificationEvent(2, "call_reused", "Which time range?", [
      { id: "recent_3", label: "Recent 3 years", detail: "2023-2026", recommended: true },
      { id: "recent_5", label: "Recent 5 years", detail: "2021-2026", recommended: false }
    ])
  ])];

  const prompt = latestPendingAgentClarification(messages);

  assert.equal(prompt?.clarificationId, "call_reused");
  assert.equal(prompt?.question, "Which time range?");
  assert.deepEqual(prompt?.options.map((option) => option.id), ["recent_3", "recent_5"]);
});

test("waiting Agent clarification trace without options is detected as recoverable", () => {
  const messages = [assistantWithTimeline([{
    id: "timeline_waiting",
    eventType: "decision",
    status: "waiting",
    title: "Clarification needed",
    summary: "Waiting for user choice",
    sequence: 1,
    payload: { eventType: "agent_backend_agent_clarification_requested" },
    createdAt: "2026-06-24T00:00:00.000Z"
  }])];

  assert.equal(latestPendingAgentClarification(messages), undefined);
  assert.equal(hasUnresolvedAgentClarificationTrace(messages), true);
});

function assistantWithTimeline(timeline: CollaborationMessage["timeline"]): CollaborationMessage {
  return {
    id: "assistant_1",
    role: "assistant",
    text: "",
    timeline
  };
}

function clarificationEvent(
  sequence: number,
  toolCallId: string,
  question: string,
  options: Array<{ id: string; label: string; detail: string; recommended: boolean }>
): NonNullable<CollaborationMessage["timeline"]>[number] {
  return {
    id: `timeline_${sequence}`,
    eventType: "decision",
    status: "waiting",
    title: "Clarification needed",
    summary: question,
    sequence,
    payload: {
      eventType: "agent_backend_agent_clarification_requested",
      toolCallId,
      question,
      options
    },
    createdAt: `2026-06-24T00:00:0${sequence}.000Z`
  };
}
