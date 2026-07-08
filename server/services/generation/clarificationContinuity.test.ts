import test from "node:test";
import assert from "node:assert/strict";
import { stableCanvasDeliveryId, withAgentClarificationResumeContext, withOrdinaryClarificationLoop } from "./generationService.js";

function answeredClarification(
  id: string,
  question: string,
  answer: string,
  resumeContext: Record<string, unknown>,
  updatedAt = "2026-01-01T00:00:00.000Z"
) {
  return {
    id,
    threadId: "thread_1",
    runId: `run_${id}`,
    status: "answered",
    question,
    options: [
      { id: "a", label: "A", detail: "A detail", recommended: false },
      { id: "b", label: "B", detail: "B detail", recommended: false }
    ],
    resumeContext,
    selectedOptionId: "a",
    selectedOptionLabel: answer,
    answer,
    createdAt: updatedAt,
    updatedAt
  };
}

function storageWithClarifications(clarifications: unknown[]) {
  return {
    listAgentClarifications() {
      return clarifications;
    }
  } as never;
}

test("clarification resume reuses the delivery id from resume context", () => {
  const deliveryId = stableCanvasDeliveryId("thread_1", {
    mode: "chat",
    locale: "en",
    chatInstruction: "Review recent Agent literature.\n\nSelected clarification: Multi-Agent systems",
    contextValues: {
      agentClarification: {
        clarificationId: "clarification_1",
        resumeContext: {
          canvas: { deliveryId: "delivery_thread_1_3_direct" }
        }
      }
    }
  }, {
    listMessages() {
      throw new Error("listMessages should not be needed for explicit clarification resumes");
    }
  } as never);

  assert.equal(deliveryId, "delivery_thread_1_3_direct");
});

test("ordinary chat messages still create a fresh delivery id from message sequence", () => {
  const deliveryId = stableCanvasDeliveryId("thread_1", {
    mode: "chat",
    locale: "en",
    chatInstruction: "Start a new review"
  }, {
    listMessages() {
      return [{}, {}];
    }
  } as never);

  assert.equal(deliveryId, "delivery_thread_1_3_direct");
});

test("progressive clarification events carry the active delivery id in resume context", () => {
  const event = withAgentClarificationResumeContext({
    eventType: "agent_backend_agent_clarification_requested",
    payload: {
      type: "agent_clarification_requested",
      question: "Which format should I use?",
      options: [{ id: "apa", label: "APA" }, { id: "mla", label: "MLA" }],
      resumeContext: {
        originalInstruction: "Review recent Agent literature.",
        canvas: { workflow: { mode: "batch_delivery" } }
      }
    }
  }, {
    mode: "chat",
    locale: "en",
    chatInstruction: "Review recent Agent literature.",
    contextValues: {
      canvas: { workflow: { mode: "batch_delivery" } }
    }
  }, "delivery_thread_1_3_direct");

  assert.equal((event.payload as { resumeContext: { canvas: { deliveryId: string } } }).resumeContext.canvas.deliveryId, "delivery_thread_1_3_direct");
});

test("progressive clarification resume context strips heavy Canvas content", () => {
  const event = withAgentClarificationResumeContext({
    eventType: "agent_backend_agent_clarification_requested",
    payload: {
      type: "agent_clarification_requested",
      question: "Which format should I use?",
      options: [{ id: "apa", label: "APA" }, { id: "mla", label: "MLA" }],
      resumeContext: {
        originalInstruction: "Review recent Agent literature.",
        canvas: {
          selectedNodeId: "node_1",
          selectedNode: { id: "node_1", kind: "document", title: "Draft", content: "Long body" },
          reference: { id: "ref_1", title: "Reference", content: "Long reference", preview: "Preview" }
        }
      }
    }
  }, {
    mode: "chat",
    locale: "en",
    chatInstruction: "Review recent Agent literature.",
    contextValues: {
      canvas: {
        selectedNodeId: "node_1",
        selectedNode: { id: "node_1", kind: "document", title: "Draft", content: "Long body" }
      }
    }
  }, "delivery_thread_1_3_direct");

  assert.deepEqual((event.payload as { resumeContext: { canvas: Record<string, unknown> } }).resumeContext.canvas, {
    selectedNodeId: "node_1",
    selectedNode: { id: "node_1", kind: "document", title: "Draft" },
    reference: { id: "ref_1", title: "Reference" },
    deliveryId: "delivery_thread_1_3_direct"
  });
});

test("execution clarification events carry plan execution context in resume context", () => {
  const event = withAgentClarificationResumeContext({
    eventType: "agent_backend_agent_clarification_requested",
    payload: {
      type: "agent_clarification_requested",
      question: "Which source should I use?",
      options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      resumeContext: {
        originalInstruction: "Continue approved plan."
      }
    }
  }, {
    mode: "chat",
    locale: "en",
    chatInstruction: "Continue approved plan plan_1. Execute only step step_1.",
    planPhase: "execution",
    planId: "plan_1",
    stepId: "step_1",
    contextValues: {
      planExecution: { planId: "plan_1", stepId: "step_1" }
    }
  });

  assert.deepEqual(
    (event.payload as { resumeContext: { planExecution: { planId: string; stepId: string } } }).resumeContext.planExecution,
    { planId: "plan_1", stepId: "step_1" }
  );
});

test("ordinary clarification loop summarizes answered ordinary rounds", () => {
  const instruction = "Review recent Agent literature.";
  const result = withOrdinaryClarificationLoop({
    mode: "chat",
    locale: "en",
    chatInstruction: instruction,
    contextValues: {
      agentClarification: {
        resumeContext: { originalInstruction: instruction }
      }
    }
  } as never, "thread_1", storageWithClarifications([
    answeredClarification("clarification_1", "Which scope?", "Recent papers", { originalInstruction: instruction }),
    answeredClarification("clarification_2", "Which database?", "arXiv", {
      originalInstruction: instruction,
      facetwrite_clarification_policy: { mode: "skill_scope_guard" }
    })
  ]));

  const loop = (result.contextValues as { ordinaryClarificationLoop: { answeredRounds: number; remainingRounds: number; answeredSummary: string } }).ordinaryClarificationLoop;
  assert.equal(loop.answeredRounds, 1);
  assert.equal(loop.remainingRounds, 2);
  assert.match(loop.answeredSummary, /Which scope\? => Recent papers/);
});

test("ordinary clarification loop stops after three answered rounds", () => {
  const instruction = "Review recent Agent literature.";
  const result = withOrdinaryClarificationLoop({
    mode: "chat",
    locale: "en",
    chatInstruction: instruction,
    contextValues: {
      agentClarification: {
        resumeContext: { originalInstruction: instruction }
      }
    }
  } as never, "thread_1", storageWithClarifications([
    answeredClarification("clarification_1", "Which scope?", "Recent papers", { originalInstruction: instruction }, "2026-01-01T00:00:00.000Z"),
    answeredClarification("clarification_2", "Which format?", "Markdown", { originalInstruction: instruction }, "2026-01-01T00:01:00.000Z"),
    answeredClarification("clarification_3", "Which audience?", "Engineering", { originalInstruction: instruction }, "2026-01-01T00:02:00.000Z")
  ]));

  const loop = (result.contextValues as { ordinaryClarificationLoop: { answeredRounds: number; remainingRounds: number } }).ordinaryClarificationLoop;
  assert.equal(loop.answeredRounds, 3);
  assert.equal(loop.remainingRounds, 0);
});

test("ordinary clarification loop does not replace skill intake guard policy", () => {
  const payload = {
    mode: "chat",
    locale: "en",
    chatInstruction: "Research recent papers",
    contextValues: {
      facetwrite_clarification_policy: {
        mode: "skill_scope_guard",
        intakeState: "intake_collecting"
      }
    }
  } as const;

  const result = withOrdinaryClarificationLoop(payload as never, "thread_1", storageWithClarifications([
    answeredClarification("clarification_1", "Which scope?", "Recent papers", { intakeState: "intake_collecting" })
  ]));

  assert.equal(result, payload);
});
