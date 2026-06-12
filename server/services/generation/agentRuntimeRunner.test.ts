import test from "node:test";
import assert from "node:assert/strict";
import { runAgentRuntimeGeneration } from "./agentRuntimeRunner.js";

const input = {
  payload: { mode: "chat", locale: "en", chatInstruction: "Hello" }
} as Parameters<typeof runAgentRuntimeGeneration>[0];
const runtimeBase = {
  providerId: "agent-backend" as const,
  getStatus: async () => ({}),
  getConfigOverview: async () => ({}),
  getDashboard: async () => ({})
};

test("accepts a successful Plan phase with structured events and no assistant text", async () => {
  const result = await runAgentRuntimeGeneration(input, {
    ...runtimeBase,
    run: async () => ({
      text: "",
      finishReason: "agent_backend_completed",
      events: [{ eventType: "agent_backend_plan_created", payload: { type: "plan_created" } }]
    })
  });
  assert.equal(result?.text, "");
});

test("reports a diagnostic when a successful runtime has neither text nor state events", async () => {
  await assert.rejects(
    () => runAgentRuntimeGeneration(input, {
      ...runtimeBase,
      run: async () => ({ text: "", finishReason: "agent_backend_completed", events: [] })
    }),
    /no visible assistant text or structured Plan events/i
  );
});

test("rejects a Plan planning run that answers directly without updating Plan state", async () => {
  await assert.rejects(
    () => runAgentRuntimeGeneration({
      ...input,
      payload: { ...input.payload, chatInstruction: "/plan Compare two laptops" }
    }, {
      ...runtimeBase,
      run: async () => ({
        text: "Here is the completed comparison.",
        finishReason: "agent_backend_completed",
        events: []
      })
    }),
    /planning phase completed without a Plan state update/i
  );
});

test("rejects a Plan execution run that answers directly without advancing the step", async () => {
  await assert.rejects(
    () => runAgentRuntimeGeneration({
      ...input,
      payload: {
        ...input.payload,
        contextValues: { planExecution: { planId: "plan_1", stepId: "step_1" } }
      }
    }, {
      ...runtimeBase,
      run: async () => ({
        text: "The research is complete.",
        finishReason: "agent_backend_completed",
        events: []
      })
    }),
    /execution phase completed without a Plan or Artifact state update/i
  );
});

test("rejects a Plan execution run that updates the step without committing a Canvas artifact", async () => {
  await assert.rejects(
    () => runAgentRuntimeGeneration({
      ...input,
      payload: {
        ...input.payload,
        contextValues: { planExecution: { planId: "plan_1", stepId: "step_1" } }
      }
    }, {
      ...runtimeBase,
      run: async () => ({
        text: "Step complete.",
        finishReason: "agent_backend_completed",
        events: [{
          eventType: "agent_backend_plan_step_updated",
          payload: { planId: "plan_1", stepId: "step_1", status: "completed" }
        }]
      })
    }),
    /execution phase completed without committing a Canvas artifact/i
  );
});
