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
    modelSettings: {
      configuredModelApiId: "model_1",
      providerId: "deepseek",
      model: "deepseek-chat",
      temperature: 0.7,
      topP: 1,
      contextCount: 5,
      maxTokens: 2000,
      maxTokensEnabled: false,
      streaming: true,
      toolCallMode: "auto",
      maxToolCalls: 20
    },
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

test("forwards file delivery tools for progressive Canvas runs", async () => {
  let allowedToolRefs: string[] = [];
  await runAgentBackendGeneration({
    payload: {
      mode: "chat",
      locale: "en",
      threadId: "thread_1",
      chatInstruction: "Review recent agent literature",
      contextValues: {
        progressiveCanvasDelivery: { enabled: true }
      }
    },
    threadId: "thread_1",
    projectId: "project_1",
    configuredModelApiId: "model_1",
    modelSettings: {
      configuredModelApiId: "model_1",
      providerId: "deepseek",
      model: "deepseek-chat",
      temperature: 0.7,
      topP: 1,
      contextCount: 5,
      maxTokens: 2000,
      maxTokensEnabled: false,
      streaming: true,
      toolCallMode: "auto",
      maxToolCalls: 20
    },
    runtimeConfig: { enabledTools: ["web_search"], agentCard: {}, settings: {} } as never,
    messages: [],
    prompt: "prompt"
  }, {
    getRuntimeConfig: () => ({ enabled: true } as never),
    runAgent: async (input) => {
      allowedToolRefs = input.allowedToolRefs ?? [];
      return {
        text: "Done",
        finishReason: "agent_backend_completed",
        events: []
      };
    }
  });

  assert.ok(allowedToolRefs.includes("write_file"));
  assert.ok(allowedToolRefs.includes("present_files"));
});

test("rejects empty server-managed Canvas delivery", async () => {
  await assert.rejects(
    () => runAgentBackendGeneration({
      payload: {
        mode: "chat",
        locale: "en",
        threadId: "thread_1",
        chatInstruction: "put this into canvas nodes",
        canvasAction: { id: "canvas_action_direct", operation: "create", risk: "low", requiresTool: false }
      },
      threadId: "thread_1",
      projectId: "project_1",
      configuredModelApiId: "model_1",
      modelSettings: {
        configuredModelApiId: "model_1",
        providerId: "deepseek",
        model: "deepseek-chat",
        temperature: 0.7,
        topP: 1,
        contextCount: 5,
        maxTokens: 2000,
        maxTokensEnabled: false,
        streaming: true,
        toolCallMode: "auto",
        maxToolCalls: 20
      },
      runtimeConfig: { enabledTools: [], agentCard: {}, settings: {} } as never,
      messages: [],
      prompt: "prompt"
    }, {
      getRuntimeConfig: () => ({ enabled: true } as never),
      runAgent: async () => ({
        text: "",
        finishReason: "agent_backend_completed",
        events: []
      })
    }),
    /no visible assistant text or structured lifecycle events/i
  );
});
