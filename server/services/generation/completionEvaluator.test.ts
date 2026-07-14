import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateRunCompletion } from "./completionEvaluator.js";
import type { GenerateRequest } from "../../contracts/generation.js";
import type { ToolEventRecord } from "../../toolRuntime.js";

const basePayload: GenerateRequest = {
  mode: "chat",
  locale: "en",
  agentCardId: "chat-agent"
};

const durableTaskGuardCases = JSON.parse(
  readFileSync(new URL("../../runtime/agentBackendAdapter/fixtures/durable-task-guard-cases.json", import.meta.url), "utf8")
) as Array<{ id: string; text: string; hasEvidence: boolean; expectContinuation: boolean }>;

test("completion evaluator completes only when final text exists and blockers are absent", () => {
  const verdict = evaluateRunCompletion({
    payload: basePayload,
    text: "Here is the final answer.",
    events: [],
    finishReason: "agent_backend_completed"
  });

  assert.equal(verdict.status, "completed");
  assert.match(verdict.reasons[0] ?? "", /Final answer exists/);
});

test("completion evaluator continues AgentBackend runs explicitly marked incomplete", () => {
  const verdict = evaluateRunCompletion({
    payload: basePayload,
    text: "A visible process update.",
    events: [],
    finishReason: "agent_backend_incomplete"
  });

  assert.equal(verdict.status, "continue");
  assert.match(verdict.missingRequirements.join(" "), /continue/i);
});

test("completion evaluator applies the shared action-promise fixture only to unevidenced durable tasks", () => {
  const durablePayload: GenerateRequest = {
    ...basePayload,
    chatInstruction: "Research the database and write a verified report",
    transientSkillRefs: ["database-lookup"],
    contextValues: {
      taskHandlingPolicy: { kind: "long_task", canvasDeliveryMode: "progressive", allowPlan: false },
      progressiveCanvasDelivery: { enabled: true }
    }
  };

  for (const fixture of durableTaskGuardCases) {
    const verdict = evaluateRunCompletion({
      payload: durablePayload,
      text: fixture.text,
      events: fixture.hasEvidence
        ? [{ eventType: "agent_backend_tool_completed", payload: { toolName: "web_search", toolCallId: fixture.id } }]
        : [],
      finishReason: "agent_backend_completed"
    });
    assert.equal(verdict.status === "continue", fixture.expectContinuation, fixture.id);
  }
});

test("completion evaluator keeps the screenshot action promise ready for simple chat", () => {
  const screenshotCase = durableTaskGuardCases.find((entry) => entry.id === "zh_screenshot_action_promise");
  assert.ok(screenshotCase);

  const verdict = evaluateRunCompletion({
    payload: basePayload,
    text: screenshotCase.text,
    events: [],
    finishReason: "agent_backend_completed"
  });

  assert.equal(verdict.status, "completed");
});

test("completion evaluator waits for pending clarification", () => {
  const events: ToolEventRecord[] = [{
    eventType: "agent_backend_agent_clarification_requested",
    payload: {
      type: "agent_clarification_requested",
      question: "Which scope?",
      options: [
        { id: "focused", label: "Focused", detail: "Use a narrow scope." },
        { id: "broad", label: "Broad", detail: "Use a broad scope." }
      ]
    }
  }];

  const verdict = evaluateRunCompletion({
    payload: basePayload,
    text: "",
    events,
    finishReason: "clarification_required"
  });

  assert.equal(verdict.status, "waiting");
  assert.match(verdict.missingRequirements[0] ?? "", /clarification/);
});

test("completion evaluator does not treat ordinary waiting timeline decisions as clarification", () => {
  const events: ToolEventRecord[] = [{
    eventType: "run_timeline_decision",
    payload: {
      eventType: "decision",
      status: "waiting",
      signal: "synthesis_gate",
      title: "Final synthesis"
    }
  }];

  const verdict = evaluateRunCompletion({
    payload: basePayload,
    text: "Synthesized final answer.",
    events,
    finishReason: "agent_backend_completed"
  });

  assert.equal(verdict.status, "completed");
});

test("completion evaluator clears clarification waiting after later delivery progress", () => {
  const events: ToolEventRecord[] = [
    {
      eventType: "agent_backend_agent_clarification_requested",
      payload: {
        type: "agent_clarification_requested",
        question: "Which scope?",
        options: [
          { id: "focused", label: "Focused", detail: "Use a narrow scope." },
          { id: "broad", label: "Broad", detail: "Use a broad scope." }
        ]
      }
    },
    {
      eventType: "agent_backend_tool_completed",
      payload: { toolName: "web_search", toolCallId: "call_search" }
    },
    {
      eventType: "canvas_delivery_body_final_committed",
      payload: { title: "Body", status: "committed" }
    }
  ];

  const verdict = evaluateRunCompletion({
    payload: basePayload,
    text: "Final answer after clarification.",
    events,
    finishReason: "agent_backend_completed"
  });

  assert.equal(verdict.status, "completed");
});

test("completion evaluator keeps clarification_required runs waiting despite later Canvas timeline progress", () => {
  const events: ToolEventRecord[] = [
    {
      eventType: "agent_backend_agent_clarification_requested",
      payload: {
        type: "agent_clarification_requested",
        question: "Which language?",
        options: [
          { id: "zh", label: "Chinese", detail: "Use Chinese body text." },
          { id: "en", label: "English", detail: "Use English body text." }
        ]
      }
    },
    {
      eventType: "run_timeline_canvas_node_committed",
      payload: {
        eventType: "canvas_node_committed",
        status: "completed",
        title: "Overview"
      }
    }
  ];

  const verdict = evaluateRunCompletion({
    payload: basePayload,
    text: "",
    events,
    finishReason: "clarification_required"
  });

  assert.equal(verdict.status, "waiting");
  assert.match(verdict.missingRequirements[0] ?? "", /clarification/);
});

test("completion evaluator continues when a tool action has no observation", () => {
  const events: ToolEventRecord[] = [{
    eventType: "agent_backend_tool_started",
    payload: { toolName: "web_search", toolCallId: "call_search" }
  }];

  const verdict = evaluateRunCompletion({
    payload: basePayload,
    text: "Premature answer",
    events,
    finishReason: "agent_backend_completed"
  });

  assert.equal(verdict.status, "continue");
  assert.match(verdict.missingRequirements[0] ?? "", /outstanding tool/);
});

test("completion evaluator marks required durable delivery as partial until committed", () => {
  const verdict = evaluateRunCompletion({
    payload: {
      ...basePayload,
      canvasAction: { id: "action_1", operation: "create", risk: "low", requiresTool: true }
    },
    text: "Draft prepared.",
    events: [],
    finishReason: "agent_backend_completed"
  });

  assert.equal(verdict.status, "partial");
  assert.match(verdict.missingRequirements[0] ?? "", /Canvas node|artifact|file/);
});

test("completion evaluator allows runtime budget gates to complete with final text", () => {
  const verdict = evaluateRunCompletion({
    payload: basePayload,
    text: "Synthesized from available evidence.",
    events: [{ eventType: "agent_backend_synthesis_gate", payload: { type: "synthesis_gate", reason: "budget_synthesis" } }],
    finishReason: "agent_backend_completed"
  });

  assert.equal(verdict.status, "completed");
  assert.match(verdict.reasons.join(" "), /budget gate/);
});

test("completion evaluator marks exhausted budget finalization retries partial even with fallback text", () => {
  const verdict = evaluateRunCompletion({
    payload: basePayload,
    text: "Budget finalization retry limit reached. Continue finalization from gathered evidence.",
    events: [{
      eventType: "agent_backend_synthesis_gate",
      payload: {
        type: "synthesis_gate",
        reason: "budget finalization retry exhausted",
        finalization_retry_exhausted: true
      }
    }],
    finishReason: "agent_backend_completed"
  });

  assert.equal(verdict.status, "partial");
  assert.match(verdict.missingRequirements[0] ?? "", /Continue finalization from gathered evidence/);
});

test("completion evaluator keeps checkpoint-only Canvas delivery partial", () => {
  const verdict = evaluateRunCompletion({
    payload: basePayload,
    text: "",
    events: [{
      eventType: "canvas_delivery_body_checkpoint_committed",
      payload: { title: "Body draft", status: "committed" }
    }],
    finishReason: "agent_backend_completed"
  });

  assert.equal(verdict.status, "partial");
  assert.match(verdict.missingRequirements[0] ?? "", /final answer|clarification/);
});

test("completion evaluator does not treat generic draft Canvas commits as terminal delivery", () => {
  const draftEvents: ToolEventRecord[][] = [
    [{
      eventType: "agent_backend_canvas_mutation_committed",
      payload: { eventType: "canvas_mutation_committed", status: "committed", phase: "research" }
    }],
    [{
      eventType: "run_timeline_canvas_node_committed",
      payload: {
        eventType: "canvas_node_committed",
        status: "completed",
        payload: { status: "draft", phase: "body_checkpoint" }
      }
    }],
    [{
      eventType: "run_timeline_canvas_node_committed",
      payload: {
        eventType: "canvas_node_committed",
        status: "completed",
        payload: { node: { metadata: { status: "recoverable", phase: "process_clarification" } } }
      }
    }]
  ];

  for (const events of draftEvents) {
    const verdict = evaluateRunCompletion({
      payload: basePayload,
      text: "",
      events,
      finishReason: "agent_backend_completed"
    });
    assert.equal(verdict.status, "partial");
  }
});

test("completion evaluator accepts a generic Canvas commit only with final terminal metadata", () => {
  const verdict = evaluateRunCompletion({
    payload: basePayload,
    text: "",
    events: [{
      eventType: "run_timeline_canvas_node_committed",
      payload: {
        eventType: "canvas_node_committed",
        status: "completed",
        payload: { status: "final", phase: "explicit_canvas_delivery" }
      }
    }],
    finishReason: "agent_backend_completed"
  });

  assert.equal(verdict.status, "completed");
});

test("completion evaluator keeps budget-gated checkpoint-only Canvas delivery partial", () => {
  const verdict = evaluateRunCompletion({
    payload: basePayload,
    text: "",
    events: [
      { eventType: "agent_backend_synthesis_gate", payload: { type: "synthesis_gate", reason: "budget_synthesis" } },
      {
        eventType: "canvas_delivery_body_checkpoint_committed",
        payload: { title: "Body draft", status: "committed" }
      }
    ],
    finishReason: "agent_backend_completed"
  });

  assert.equal(verdict.status, "partial");
  assert.match(verdict.missingRequirements[0] ?? "", /final answer|clarification/);
});

test("completion evaluator completes empty assistant text when durable delivery exists", () => {
  const verdict = evaluateRunCompletion({
    payload: basePayload,
    text: "",
    events: [{
      eventType: "canvas_delivery_file_document_committed",
      payload: { title: "Report", status: "committed" }
    }],
    finishReason: "agent_backend_completed"
  });

  assert.equal(verdict.status, "completed");
});

test("completion evaluator completes empty assistant text when final body delivery exists", () => {
  const verdict = evaluateRunCompletion({
    payload: basePayload,
    text: "",
    events: [{
      eventType: "canvas_delivery_body_final_committed",
      payload: { title: "Body", status: "committed" }
    }],
    finishReason: "agent_backend_completed"
  });

  assert.equal(verdict.status, "completed");
});

test("completion evaluator fails leaked internal runtime protocol", () => {
  const verdict = evaluateRunCompletion({
    payload: basePayload,
    text: '<DSML><invoke name="web_fetch"><parameter name="url">https://example.com</parameter></invoke></DSML>',
    events: [],
    finishReason: "agent_backend_completed"
  });

  assert.equal(verdict.status, "failed");
  assert.match(verdict.missingRequirements[0] ?? "", /clean user-facing answer/);
});
