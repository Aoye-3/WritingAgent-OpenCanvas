import test from "node:test";
import assert from "node:assert/strict";
import { runAgentBackendGeneration } from "./agentBackendRunner.js";

test("forwards enabled stage-specific Plan tools even when Agent settings hide them", async () => {
  let allowedToolRefs: string[] = [];
  await runAgentBackendGeneration({
    payload: {
      mode: "chat",
      locale: "en",
      threadId: "thread_1",
      planPhase: "intake",
      planId: "plan_1",
      toolState: { plan_clarification_submit: true }
    },
    threadId: "thread_1",
    projectId: "project_1",
    configuredModelApiId: "model_1",
    runtimeConfig: { enabledTools: [], agentCard: {}, settings: {} } as never,
    messages: [],
    prompt: "prompt"
  }, {
    getRuntimeConfig: () => ({ enabled: true } as never),
    runAgent: async (input) => {
      allowedToolRefs = input.allowedToolRefs ?? [];
      return {
        text: "",
        finishReason: "agent_backend_completed",
        events: [{ eventType: "agent_backend_plan_waiting_for_user", payload: { planId: "plan_1" } }]
      };
    }
  });
  assert.ok(allowedToolRefs.includes("plan_clarification_submit"));
});
