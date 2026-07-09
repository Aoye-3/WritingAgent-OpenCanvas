import test from "node:test";
import assert from "node:assert/strict";
import { stableCanvasDeliveryId, withAgentClarificationResumeContext, withCanvasAction, withOrdinaryClarificationIntake } from "./generationService.js";

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

test("ordinary clarification intake summarizes answered ordinary rounds", () => {
  const instruction = "Review recent Agent literature.";
  const result = withOrdinaryClarificationIntake({
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

  const intake = (result.contextValues as { ordinaryClarificationIntake: { state: string; answeredRounds: number; remainingRounds: number; answeredSummary: string } }).ordinaryClarificationIntake;
  assert.equal(intake.state, "collecting");
  assert.equal(intake.answeredRounds, 1);
  assert.equal(intake.remainingRounds, 2);
  assert.match(intake.answeredSummary, /Which scope\? => Recent papers/);
});

test("ordinary clarification intake completes after three answered rounds", () => {
  const instruction = "Review recent Agent literature.";
  const result = withOrdinaryClarificationIntake({
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

  const intake = (result.contextValues as { ordinaryClarificationIntake: { state: string; answeredRounds: number; remainingRounds: number } }).ordinaryClarificationIntake;
  assert.equal(intake.state, "completed");
  assert.equal(intake.answeredRounds, 3);
  assert.equal(intake.remainingRounds, 0);
});

test("ordinary clarification intake does not replace skill intake guard policy", () => {
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

  const result = withOrdinaryClarificationIntake(payload as never, "thread_1", storageWithClarifications([
    answeredClarification("clarification_1", "Which scope?", "Recent papers", { intakeState: "intake_collecting" })
  ]));

  assert.equal(result, payload);
});

test("skill-scope clarification resume does not start ordinary intake", () => {
  const payload = {
    mode: "chat",
    locale: "zh",
    chatInstruction: "请围绕 Agent 使用 LLM 写 literature review\n\nSelected clarification: 正文中文 + 参考文献英文",
    transientSkillRefs: ["database-lookup", "literature-review"],
    contextValues: {
      agentClarification: {
        clarificationId: "agent_clarification_1",
        selectedOptionId: "zh_body_en_ref",
        answer: "正文中文 + 参考文献英文",
        resumeContext: {
          originalInstruction: "请围绕 Agent 使用 LLM 写 literature review",
          intakeState: "intake_collecting",
          intakeRound: 2,
          maxIntakeRounds: 3,
          answeredSummary: "全面概览"
        }
      }
    }
  } as const;

  const result = withOrdinaryClarificationIntake(payload as never, "thread_1", storageWithClarifications([
    answeredClarification("clarification_1", "Which scope?", "全面概览", { originalInstruction: "请围绕 Agent 使用 LLM 写 literature review" })
  ]));

  assert.equal(result, payload);
});

test("answered clarification resumes do not inject Canvas replace actions from option text", () => {
  const result = withCanvasAction({
    mode: "chat",
    locale: "zh",
    chatInstruction: "请围绕 Agent 使用 LLM 写 literature review\n\nSelected clarification: 全面概览 - 覆盖 Agent 使用 LLM 的多个核心方向",
    selectedCanvasNodeId: "node_delivery_thread_1_1_direct_1",
    contextValues: {
      agentClarification: {
        clarificationId: "agent_clarification_1",
        selectedOptionId: "broad_overview",
        answer: "全面概览",
        option: {
          id: "broad_overview",
          label: "全面概览",
          detail: "覆盖 Agent 使用 LLM 的多个核心方向"
        }
      }
    }
  } as never, "thread_1", {
    listMessages() {
      throw new Error("listMessages should not run for answered clarification resumes");
    }
  } as never);

  assert.equal(result.canvasAction, undefined);
  assert.equal((result.contextValues as { canvasAction?: unknown }).canvasAction, undefined);
});

test("ordinary Canvas edit instructions still inject Canvas actions", () => {
  const result = withCanvasAction({
    mode: "chat",
    locale: "zh",
    chatInstruction: "覆盖画布里的节点",
    selectedCanvasNodeId: "node_1"
  } as never, "thread_1", {
    listMessages() {
      return [{}, {}];
    }
  } as never);

  assert.equal(result.canvasAction?.operation, "replace");
  assert.equal(result.canvasAction?.requiresTool, true);
});
