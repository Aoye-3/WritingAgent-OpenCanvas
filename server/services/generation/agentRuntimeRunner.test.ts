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
  assert.equal(result?.effectivePayload, input.payload);
});

test("reports a diagnostic when a successful runtime has neither text nor state events", async () => {
  await assert.rejects(
    () => runAgentRuntimeGeneration(input, {
      ...runtimeBase,
      run: async () => ({ text: "", finishReason: "agent_backend_completed", events: [] })
    }),
    /no visible assistant text or structured lifecycle events/i
  );
});

test("rejects empty server-managed Canvas delivery instead of pretending it completed", async () => {
  await assert.rejects(
    () => runAgentRuntimeGeneration({
      ...input,
      payload: {
        ...input.payload,
        chatInstruction: "put this into canvas nodes",
        canvasAction: { id: "canvas_action_direct", operation: "create", risk: "low", requiresTool: false }
      }
    }, {
      ...runtimeBase,
      run: async () => ({ text: "", finishReason: "agent_backend_completed", events: [] })
    }),
    /no visible assistant text or structured lifecycle events/i
  );
});

test("accepts required Canvas action after canvas_write commits", async () => {
  const result = await runAgentRuntimeGeneration({
      ...input,
      payload: {
        ...input.payload,
        chatInstruction: "Create one Canvas node",
        canvasAction: { id: "canvas_action_1", operation: "create", risk: "low", requiresTool: true }
      }
    }, {
      ...runtimeBase,
      run: async () => ({
        text: "",
        finishReason: "agent_backend_completed",
        events: [{ eventType: "agent_backend_canvas_mutation_committed", payload: { nodeId: "node_1" } }]
      })
    });
  assert.equal(result?.events[0]?.eventType, "agent_backend_canvas_mutation_committed");
});

test("accepts required Canvas action after final body delivery commits", async () => {
  const result = await runAgentRuntimeGeneration({
      ...input,
      payload: {
        ...input.payload,
        chatInstruction: "Write this to Canvas",
        canvasAction: { id: "canvas_action_1", operation: "create", risk: "low", requiresTool: true }
      }
    }, {
      ...runtimeBase,
      run: async () => ({
        text: "",
        finishReason: "agent_backend_completed",
        events: [{ eventType: "canvas_delivery_body_final_committed", payload: { nodeId: "node_final" } }]
      })
    });
  assert.equal(result?.events[0]?.eventType, "canvas_delivery_body_final_committed");
});

test("accepts required Canvas action after file document delivery commits", async () => {
  const result = await runAgentRuntimeGeneration({
      ...input,
      payload: {
        ...input.payload,
        chatInstruction: "Save this report to Canvas",
        canvasAction: { id: "canvas_action_1", operation: "create", risk: "low", requiresTool: true }
      }
    }, {
      ...runtimeBase,
      run: async () => ({
        text: "",
        finishReason: "agent_backend_completed",
        events: [{ eventType: "canvas_delivery_file_document_committed", payload: { nodeId: "file_1" } }]
      })
    });
  assert.equal(result?.events[0]?.eventType, "canvas_delivery_file_document_committed");
});

test("rejects required Canvas action with only recoverable delivery checkpoints", async () => {
  await assert.rejects(
    () => runAgentRuntimeGeneration({
      ...input,
      payload: {
        ...input.payload,
        chatInstruction: "Write this to Canvas",
        canvasAction: { id: "canvas_action_1", operation: "create", risk: "low", requiresTool: true }
      }
    }, {
      ...runtimeBase,
      run: async () => ({
        text: "I have a draft.",
        finishReason: "agent_backend_completed",
        events: [
          { eventType: "canvas_delivery_research_committed", payload: { nodeId: "research_1" } },
          { eventType: "canvas_delivery_body_checkpoint_committed", payload: { nodeId: "draft_1" } }
        ]
      })
    }),
    /Canvas action completed without/i
  );
});

test("rejects required Canvas action with only failed summary delivery", async () => {
  await assert.rejects(
    () => runAgentRuntimeGeneration({
      ...input,
      payload: {
        ...input.payload,
        chatInstruction: "Write this to Canvas",
        canvasAction: { id: "canvas_action_1", operation: "create", risk: "low", requiresTool: true }
      }
    }, {
      ...runtimeBase,
      run: async () => ({
        text: "The run failed.",
        finishReason: "agent_backend_completed",
        events: [{ eventType: "canvas_delivery_failed_summary_committed", payload: { nodeId: "failed_1" } }]
      })
    }),
    /Canvas action completed without/i
  );
});

test("defers Plan planning postconditions to persisted state validation", async () => {
  const result = await runAgentRuntimeGeneration({
      ...input,
      payload: { ...input.payload, chatInstruction: "/plan Compare two laptops" }
    }, {
      ...runtimeBase,
      run: async () => ({
        text: "Here is the completed comparison.",
        finishReason: "agent_backend_completed",
        events: []
      })
    });
  assert.equal(result?.text, "Here is the completed comparison.");
});

test("defers Plan execution postconditions to persisted state validation", async () => {
  const result = await runAgentRuntimeGeneration({
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
    });
  assert.equal(result?.text, "The research is complete.");
});

test("does not treat execution events as the authoritative postcondition", async () => {
  const result = await runAgentRuntimeGeneration({
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
    });
  assert.equal(result?.text, "Step complete.");
});

test("accepts a Plan execution run after the current step artifact is committed", async () => {
  const result = await runAgentRuntimeGeneration({
      ...input,
      payload: {
        ...input.payload,
        contextValues: { planExecution: { planId: "plan_1", stepId: "step_1" } }
      }
    }, {
      ...runtimeBase,
      run: async () => ({
        text: "Artifact ready.",
        finishReason: "agent_backend_completed",
        events: [{
          eventType: "agent_backend_artifact_committed",
          payload: { planId: "plan_1", artifacts: [{ stepId: "step_1", status: "committed" }] }
        }]
      })
    });
  assert.equal(result?.text, "Artifact ready.");
});
