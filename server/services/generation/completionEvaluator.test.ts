import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRunCompletion } from "./completionEvaluator.js";
import type { GenerateRequest } from "../../contracts/generation.js";
import type { ToolEventRecord } from "../../toolRuntime.js";

const basePayload: GenerateRequest = {
  mode: "chat",
  locale: "en",
  agentCardId: "chat-agent"
};

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
    finishReason: "clarification_required"
  });

  assert.equal(verdict.status, "completed");
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
