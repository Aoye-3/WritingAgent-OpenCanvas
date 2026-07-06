import test from "node:test";
import assert from "node:assert/strict";
import { stableCanvasDeliveryId, withAgentClarificationResumeContext } from "./generationService.js";

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
