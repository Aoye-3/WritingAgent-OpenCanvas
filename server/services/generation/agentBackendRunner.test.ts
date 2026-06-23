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
  assert.ok(allowedToolRefs.includes("ask_clarification"));
});

test("forwards ask_clarification for transient skill runs", async () => {
  let allowedToolRefs: string[] = [];
  await runAgentBackendGeneration({
    payload: {
      mode: "chat",
      locale: "en",
      threadId: "thread_1",
      chatInstruction: "Review recent agent literature",
      transientSkillRefs: ["literature-review"]
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

  assert.ok(allowedToolRefs.includes("ask_clarification"));
});

test("skill clarification guard only allows ask_clarification and accepts structured clarification without text", async () => {
  let allowedToolRefs: string[] = [];
  const result = await runAgentBackendGeneration({
    payload: {
      mode: "chat",
      locale: "en",
      threadId: "thread_1",
      chatInstruction: "Review recent agent literature",
      transientSkillRefs: ["literature-review"],
      contextValues: {
        facetwrite_clarification_policy: { mode: "skill_scope_guard" }
      },
      toolState: { web_search: true, knowledge_base: true }
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
    runtimeConfig: { enabledTools: ["web_search", "knowledge_base"], agentCard: {}, settings: {} } as never,
    messages: [],
    prompt: "prompt"
  }, {
    getRuntimeConfig: () => ({ enabled: true } as never),
    runAgent: async (input) => {
      allowedToolRefs = input.allowedToolRefs ?? [];
      return {
        text: "",
        finishReason: "clarification_required",
        events: [{
          eventType: "agent_backend_agent_clarification_requested",
          payload: {
            type: "agent_clarification_requested",
            question: "Which scope should I use?",
            options: [{ id: "recent", label: "Recent" }, { id: "broad", label: "Broad" }]
          }
        }]
      };
    }
  });

  assert.deepEqual(allowedToolRefs, ["ask_clarification"]);
  assert.ok(result);
  assert.equal(result.finishReason, "clarification_required");
});

test("skill clarification guard rejects plain text clarification without a structured event", async () => {
  let allowedToolRefs: string[] = [];
  await assert.rejects(
    () => runAgentBackendGeneration({
      payload: {
        mode: "chat",
        locale: "zh",
        threadId: "thread_1",
        chatInstruction: "帮我查找最近 Agent 相关文献并做综述",
        transientSkillRefs: ["literature-review"],
        contextValues: {
          facetwrite_clarification_policy: { mode: "skill_scope_guard" }
        },
        toolState: { web_search: true }
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
          text: "我需要先明确几个关键方向：",
          finishReason: "agent_backend_completed",
          events: []
        };
      }
    }),
    /skill scope guard requires a structured ask_clarification response/i
  );

  assert.deepEqual(allowedToolRefs, ["ask_clarification"]);
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
