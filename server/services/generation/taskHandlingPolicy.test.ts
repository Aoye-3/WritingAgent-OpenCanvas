import test from "node:test";
import assert from "node:assert/strict";
import { isProcessClarificationText, resolveTaskHandlingPolicy, shouldAutoPreflightPlan } from "./taskHandlingPolicy.js";

test("classifies ordinary short questions as simple chat without Canvas", () => {
  const policy = resolveTaskHandlingPolicy({
    payload: { mode: "chat", locale: "zh", chatInstruction: "什么是 mutex？" }
  });

  assert.equal(policy.kind, "simple_chat");
  assert.equal(policy.canvasDeliveryMode, "none");
});

test("classifies durable skill work as a long task with progressive Canvas", () => {
  const policy = resolveTaskHandlingPolicy({
    payload: { mode: "chat", locale: "zh", chatInstruction: "帮我找最近 Agent 文献并做综述" },
    transientSkillCount: 2,
    thinkingMode: "enabled"
  });

  assert.equal(policy.kind, "long_task");
  assert.equal(policy.canvasDeliveryMode, "progressive");
});

test("does not treat enabled skills alone as Canvas delivery for short Q&A", () => {
  const policy = resolveTaskHandlingPolicy({
    payload: { mode: "chat", locale: "zh", chatInstruction: "什么是 mutex？" },
    transientSkillCount: 2,
    thinkingMode: "enabled"
  });

  assert.equal(policy.kind, "simple_chat");
  assert.equal(policy.canvasDeliveryMode, "none");
});

test("classifies explicit Canvas requests as explicit Canvas delivery", () => {
  const policy = resolveTaskHandlingPolicy({
    payload: { mode: "chat", locale: "zh", chatInstruction: "把这些内容整理到 Canvas 节点里" }
  });

  assert.equal(policy.kind, "explicit_canvas");
  assert.equal(policy.canvasDeliveryMode, "explicit");
});

test("classifies slash plan requests as Plan intake without Canvas", () => {
  const policy = resolveTaskHandlingPolicy({
    payload: { mode: "chat", locale: "zh", chatInstruction: "/plan 帮我做文献综述" }
  });

  assert.equal(policy.kind, "plan_intake");
  assert.equal(policy.canvasDeliveryMode, "none");
});

test("auto preflight triggers only for complex ordinary chat tasks", () => {
  assert.equal(shouldAutoPreflightPlan({
    payload: { mode: "chat", locale: "en", chatInstruction: "Research current agent planning systems and write a report with sources." }
  }), true);
  assert.equal(shouldAutoPreflightPlan({
    payload: { mode: "chat", locale: "en", chatInstruction: "What is a mutex?" }
  }), false);
  assert.equal(shouldAutoPreflightPlan({
    payload: { mode: "chat", locale: "en", chatInstruction: "/plan Research current agent planning systems." }
  }), false);
});

test("auto preflight respects an explicit server-side opt-out", () => {
  assert.equal(shouldAutoPreflightPlan({
    payload: {
      mode: "chat",
      locale: "en",
      chatInstruction: "Research current agent planning systems and write a report with sources.",
      contextValues: { autoPreflightPlan: { enabled: false } }
    }
  }), false);
});

test("detects process clarification text that must not become Canvas content", () => {
  assert.equal(isProcessClarificationText("好的！我需要先跟您确认几个关键点，确保文献综述的方向准确："), true);
  assert.equal(isProcessClarificationText("好的，我需要先明确几个关键方向："), true);
  assert.equal(isProcessClarificationText("开始检索前需要确定任务范围。"), true);
  assert.equal(isProcessClarificationText("Before I proceed, please clarify the target audience."), true);
  assert.equal(isProcessClarificationText("最终结论：应采用预算门禁和最终回写双重策略。"), false);
});
