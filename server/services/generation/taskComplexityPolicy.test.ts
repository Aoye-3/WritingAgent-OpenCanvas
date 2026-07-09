import test from "node:test";
import assert from "node:assert/strict";
import { resolveTaskComplexity } from "./taskComplexityPolicy.js";

test("classifies short factual questions as simple without AgentPlan", () => {
  const decision = resolveTaskComplexity({
    payload: { mode: "chat", locale: "en", chatInstruction: "What is a mutex?" }
  });

  assert.equal(decision.complexity, "simple");
  assert.equal(decision.requiresAgentPlan, false);
  assert.equal(decision.recommendedStepCount, undefined);
});

test("forces slash plan requests into complex AgentPlan flow", () => {
  const decision = resolveTaskComplexity({
    payload: { mode: "chat", locale: "en", chatInstruction: "/plan Research agent planning architectures." }
  });

  assert.equal(decision.complexity, "complex");
  assert.equal(decision.requiresAgentPlan, true);
  assert.equal(decision.signals.includes("explicit_plan"), true);
  assert.equal(decision.recommendedStepCount, 3);
});

test("classifies any skill-assisted run as complex", () => {
  const decision = resolveTaskComplexity({
    payload: { mode: "chat", locale: "en", chatInstruction: "Go." },
    transientSkillCount: 1
  });

  assert.equal(decision.complexity, "complex");
  assert.equal(decision.requiresAgentPlan, true);
  assert.equal(decision.signals.includes("skill_assisted_task"), true);
  assert.equal(decision.recommendedStepCount, 3);
});

test("classifies full-chain architecture rewrites as complex", () => {
  const decision = resolveTaskComplexity({
    payload: {
      mode: "chat",
      locale: "zh",
      chatInstruction: "做全链路调研，重写前端、后端、DB 和 AgentBackend runtime 的计划架构，并补测试和预算恢复。"
    },
    thinkingMode: "enabled"
  });

  assert.equal(decision.complexity, "complex");
  assert.equal(decision.requiresAgentPlan, true);
  assert.equal(decision.signals.includes("multi_stage_intent"), true);
  assert.equal(decision.signals.includes("cross_system_scope"), true);
  assert.equal(decision.signals.includes("budget_or_reasoning_risk"), true);
  assert.equal(decision.recommendedStepCount, 5);
});

test("treats existing plan context as complex even with terse input", () => {
  const decision = resolveTaskComplexity({
    payload: {
      mode: "chat",
      locale: "en",
      chatInstruction: "continue",
      contextValues: { awaitingPlan: { id: "plan_1" } }
    }
  });

  assert.equal(decision.complexity, "complex");
  assert.equal(decision.requiresAgentPlan, true);
  assert.equal(decision.signals.includes("explicit_plan"), true);
  assert.equal(decision.signals.includes("persisted_plan_context"), true);
});
