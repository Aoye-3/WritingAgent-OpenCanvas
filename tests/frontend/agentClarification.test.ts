import test from "node:test";
import assert from "node:assert/strict";
import {
  agentClarificationAnsweredKeys,
  agentClarificationRecordKeys,
  agentClarificationFromRecord,
  buildAgentClarificationSubmission,
  hasUnresolvedAgentClarificationTrace,
  latestPendingAgentClarification,
  mergeAgentClarificationDisplayRecords
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

test("answered Agent clarification records suppress matching pending records and timeline fallback", () => {
  const answered: AgentClarification = {
    id: "agent_clarification_stable",
    threadId: "thread_1",
    runId: "run_1",
    status: "answered",
    question: "Which time range?",
    options: [
      { id: "recent_3", label: "Recent 3 years", detail: "2023-2026", recommended: true },
      { id: "recent_5", label: "Recent 5 years", detail: "2021-2026", recommended: false }
    ],
    selectedOptionId: "recent_3",
    answer: "Recent 3 years",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:02.000Z"
  };
  const answeredKeys = new Set(agentClarificationRecordKeys(answered));
  const pending = { ...answered, id: "call_reused", status: "pending" as const, selectedOptionId: undefined, answer: undefined };
  const messages = [assistantWithTimeline([
    clarificationEvent(1, "call_reused", "Which time range?", answered.options)
  ])];

  assert.equal(agentClarificationFromRecord(pending, answeredKeys), undefined);
  assert.equal(latestPendingAgentClarification(messages, answeredKeys), undefined);
});

test("optimistic answered Agent clarification remains visible until persisted answered record replaces it", () => {
  const pending: AgentClarification = {
    id: "agent_clarification_scope",
    threadId: "thread_1",
    runId: "run_1",
    status: "pending",
    question: "Which Agent scope?",
    options: [
      { id: "multi_agent", label: "Multi-agent systems", detail: "Coordination", recommended: true },
      { id: "agent_frameworks", label: "Agent frameworks", detail: "Runtime tooling", recommended: false }
    ],
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z"
  };
  const optimistic: AgentClarification = {
    ...pending,
    runId: "pending",
    status: "answered",
    selectedOptionId: "multi_agent",
    selectedOptionLabel: "Multi-agent systems",
    answer: "Multi-agent systems",
    updatedAt: "2026-06-24T00:00:01.000Z"
  };
  const persisted: AgentClarification = {
    ...optimistic,
    runId: "run_1",
    updatedAt: "2026-06-24T00:00:02.000Z"
  };

  assert.deepEqual(
    mergeAgentClarificationDisplayRecords([pending], [optimistic]).filter((item) => item.status === "answered").map((item) => item.answer),
    ["Multi-agent systems"]
  );
  assert.deepEqual(
    mergeAgentClarificationDisplayRecords([persisted], [optimistic]).filter((item) => item.status === "answered").map((item) => item.runId),
    ["run_1"]
  );
});

test("answering one Agent clarification does not suppress a later different clarification", () => {
  const answered: AgentClarification = {
    id: "agent_clarification_scope",
    threadId: "thread_1",
    runId: "run_1",
    status: "answered",
    question: "Which Agent scope?",
    options: [
      { id: "multi_agent", label: "Multi-agent systems", detail: "Coordination", recommended: true },
      { id: "agent_frameworks", label: "Agent frameworks", detail: "Runtime tooling", recommended: false }
    ],
    selectedOptionId: "multi_agent",
    answer: "Multi-agent systems",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:01.000Z"
  };
  const messages = [assistantWithTimeline([
    clarificationEvent(1, "call_format", "Which citation format?", [
      { id: "apa", label: "APA", detail: "APA 7th edition", recommended: true },
      { id: "mla", label: "MLA", detail: "MLA 9th edition", recommended: false }
    ])
  ])];

  assert.equal(latestPendingAgentClarification(messages, new Set(agentClarificationAnsweredKeys(answered)))?.question, "Which citation format?");
});

test("custom Agent clarification answer builds an optimistic record and resume request without selecting a fixed option", () => {
  const clarification = agentClarificationFromRecord({
    id: "agent_clarification_scope",
    threadId: "thread_1",
    runId: "run_1",
    status: "pending",
    question: "Which scope should I use?",
    options: [
      { id: "recent", label: "Recent papers", detail: "2023-2026", recommended: true },
      { id: "broad", label: "Broad survey", detail: "2018-2026", recommended: false }
    ],
    resumeContext: {
      originalInstruction: "Review Agent literature.",
      transientSkillRefs: ["literature-review"],
      disabledSkillRefs: ["newsletter-generation"],
      runtimeBudgetProfile: "high",
      canvas: { workflow: { mode: "batch_delivery" } }
    },
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:01.000Z"
  });
  assert.ok(clarification);

  const submission = buildAgentClarificationSubmission({
    clarification,
    currentThreadId: "thread_1",
    answerText: "Use 25 papers from 2022-2026, APA 7, with a methods table.",
    enabledSkillRefs: [],
    disabledSkillRefs: [],
    runtimeBudgetProfile: "medium"
  });

  assert.equal(submission.optimisticClarification.selectedOptionId, "custom");
  assert.equal(submission.optimisticClarification.selectedOptionLabel, "Custom answer");
  assert.equal(submission.optimisticClarification.answer, "Use 25 papers from 2022-2026, APA 7, with a methods table.");
  assert.match(submission.instructionText, /Selected clarification: Use 25 papers/);
  assert.deepEqual(submission.requestContext.transientSkillRefs, ["literature-review"]);
  assert.deepEqual(submission.requestContext.disabledSkillRefs, ["newsletter-generation"]);
  assert.equal(submission.requestContext.runtimeBudgetProfile, "high");
  assert.deepEqual(submission.requestContext.canvas, { workflow: { mode: "batch_delivery" } });
  assert.deepEqual(submission.requestContext.agentClarification, {
    clarificationId: "agent_clarification_scope",
    question: "Which scope should I use?",
    selectedOptionId: "custom",
    answer: "Use 25 papers from 2022-2026, APA 7, with a methods table.",
    option: { id: "custom", label: "Custom answer", detail: "Use 25 papers from 2022-2026, APA 7, with a methods table.", recommended: false },
    resumeContext: clarification.resumeContext,
    originalInstruction: "Review Agent literature."
  });
});

test("waiting Agent clarification trace without options is detected as recoverable", () => {
  const messages = [assistantWithTimeline([{
    id: "timeline_waiting",
    eventType: "decision",
    status: "waiting",
    title: "Clarification needed",
    summary: "Waiting for user choice",
    sequence: 1,
    payload: {
      eventType: "agent_backend_agent_clarification_requested",
      toolCallId: "call_missing_options",
      question: "Which region should the literature review cover?"
    },
    createdAt: "2026-06-24T00:00:00.000Z"
  }])];

  assert.equal(latestPendingAgentClarification(messages), undefined);
  assert.equal(hasUnresolvedAgentClarificationTrace(messages), true);
});

test("a newer malformed Agent clarification does not resurrect an older choice card", () => {
  const messages = [assistantWithTimeline([
    clarificationEvent(1, "call_region", "Which region?", [
      { id: "global", label: "Global", detail: "Worldwide literature", recommended: true },
      { id: "us_china", label: "US and China", detail: "Policy comparison", recommended: false }
    ]),
    {
      id: "timeline_waiting",
      eventType: "decision",
      status: "waiting",
      title: "Clarification needed",
      summary: "Waiting for user choice",
      sequence: 2,
      payload: {
        eventType: "agent_backend_agent_clarification_requested",
        toolCallId: "call_scope",
        question: "Which scope should the literature review cover?"
      },
      createdAt: "2026-06-24T00:00:02.000Z"
    }
  ])];

  assert.equal(latestPendingAgentClarification(messages), undefined);
  assert.equal(hasUnresolvedAgentClarificationTrace(messages), true);
});

test("answered Agent clarification records suppress missing-options recovery trace by question", () => {
  const answered: AgentClarification = {
    id: "agent_clarification_stable",
    threadId: "thread_1",
    runId: "run_1",
    status: "answered",
    question: "Which region should the literature review cover?",
    options: [
      { id: "global", label: "Global", detail: "Worldwide literature", recommended: true },
      { id: "us_china", label: "US and China", detail: "Policy comparison", recommended: false }
    ],
    selectedOptionId: "global",
    answer: "Global",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:02.000Z"
  };
  const messages = [assistantWithTimeline([{
    id: "timeline_waiting",
    eventType: "decision",
    status: "waiting",
    title: "Clarification needed",
    summary: "Waiting for user choice",
    sequence: 1,
    payload: {
      eventType: "agent_backend_agent_clarification_requested",
      toolCallId: "call_missing_options",
      question: "Which region should the literature review cover?"
    },
    createdAt: "2026-06-24T00:00:00.000Z"
  }])];

  assert.equal(hasUnresolvedAgentClarificationTrace(messages, new Set(agentClarificationAnsweredKeys(answered))), false);
});

test("Agent clarification fallback ignores waits before the latest user reply", () => {
  const messages = [
    assistantWithTimeline([{
      id: "timeline_waiting",
      eventType: "decision",
      status: "waiting",
      title: "Clarification needed",
      summary: "Waiting for user choice",
      sequence: 1,
      payload: {
        eventType: "agent_backend_agent_clarification_requested",
        toolCallId: "call_missing_options",
        question: "Which region should the literature review cover?"
      },
      createdAt: "2026-06-24T00:00:00.000Z"
    }]),
    { id: "user_recovery", role: "user", text: "Please continue with the original task." }
  ];

  assert.equal(latestPendingAgentClarification(messages), undefined);
  assert.equal(hasUnresolvedAgentClarificationTrace(messages), false);
});

test("Agent clarification fallback is cleared when runtime continues with tools", () => {
  const messages = [assistantWithTimeline([{
    id: "timeline_waiting",
    eventType: "decision",
    status: "waiting",
    title: "Clarification needed",
    summary: "Waiting for user choice",
    sequence: 1,
    payload: {
      eventType: "agent_backend_agent_clarification_requested",
      toolCallId: "call_missing_options",
      question: "Which region should the literature review cover?"
    },
    createdAt: "2026-06-24T00:00:00.000Z"
  }, {
    id: "timeline_tool",
    eventType: "tool",
    status: "running",
    title: "WebSearch",
    summary: "Web search is running",
    sequence: 2,
    payload: { eventType: "agent_backend_tool_started", toolName: "WebSearch" },
    createdAt: "2026-06-24T00:00:01.000Z"
  }])];

  assert.equal(hasUnresolvedAgentClarificationTrace(messages), false);
});

test("runtime-only waiting signals do not trigger missing-options clarification recovery", () => {
  const messages = [assistantWithTimeline([{
    id: "timeline_runtime_waiting",
    eventType: "decision",
    status: "waiting",
    title: "Waiting for your choice",
    summary: "Waiting for user input",
    sequence: 1,
    payload: { signal: "waiting_for_user", source: "runtime" },
    createdAt: "2026-06-24T00:00:00.000Z"
  }])];

  assert.equal(latestPendingAgentClarification(messages), undefined);
  assert.equal(hasUnresolvedAgentClarificationTrace(messages), false);
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
