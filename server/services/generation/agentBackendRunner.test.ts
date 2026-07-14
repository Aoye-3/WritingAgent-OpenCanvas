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

test("limits progressive Canvas runs to intake tools before execution", async () => {
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
    runtimeConfig: { enabledTools: ["web_search", "canvas_write"], agentCard: {}, settings: {} } as never,
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

  assert.deepEqual(allowedToolRefs, ["ask_clarification", "agent_intake_complete"]);
});

test("keeps canvas_write for progressive Canvas execution runs when a Canvas action requires the tool", async () => {
  let allowedToolRefs: string[] = [];
  await runAgentBackendGeneration({
    payload: {
      mode: "chat",
      locale: "en",
      threadId: "thread_1",
      chatInstruction: "Create one Canvas node",
      contextValues: {
        agentIntake: { phase: "execution", completed: true },
        progressiveCanvasDelivery: { enabled: true }
      },
      canvasAction: { id: "canvas_action_1", operation: "create", risk: "low", requiresTool: true }
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
    runtimeConfig: { enabledTools: ["web_search", "canvas_write"], agentCard: {}, settings: {} } as never,
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

  assert.ok(allowedToolRefs.includes("canvas_write"));
  assert.ok(allowedToolRefs.includes("write_file"));
});

test("starts an execution run with full delivery tools after intake completion", async () => {
  const allowedToolRefsByRun: string[][] = [];
  const agentIntakeByRun: unknown[] = [];
  const result = await runAgentBackendGeneration({
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
    runtimeConfig: { enabledTools: ["web_search", "canvas_write"], agentCard: {}, settings: {} } as never,
    messages: [],
    prompt: "prompt"
  }, {
    getRuntimeConfig: () => ({ enabled: true } as never),
    runAgent: async (input) => {
      allowedToolRefsByRun.push(input.allowedToolRefs ?? []);
      agentIntakeByRun.push(input.contextValues?.agentIntake);
      if (allowedToolRefsByRun.length === 1) {
        return {
          text: "",
          finishReason: "agent_backend_completed",
          events: [{ eventType: "agent_backend_agent_intake_complete", payload: { summary: "Ready" } }]
        };
      }
      return {
        text: "Done",
        finishReason: "agent_backend_completed",
        events: [{ eventType: "agent_backend_canvas_node_committed", payload: { nodeId: "node_1" } }]
      };
    }
  });

  assert.deepEqual(allowedToolRefsByRun[0], ["ask_clarification", "agent_intake_complete"]);
  assert.equal(allowedToolRefsByRun[1]?.includes("web_search"), true);
  assert.equal(allowedToolRefsByRun[1]?.includes("canvas_write"), true);
  assert.equal(allowedToolRefsByRun[1]?.includes("write_file"), true);
  assert.equal(allowedToolRefsByRun[1]?.includes("present_files"), true);
  assert.deepEqual(agentIntakeByRun[1], { phase: "execution", completed: true });
  assert.equal(result?.text, "Done");
  assert.deepEqual(result?.events.map((event) => event.eventType), [
    "agent_backend_agent_intake_complete",
    "agent_backend_canvas_node_committed"
  ]);
});

test("starts answered clarification delivery runs in execution with file tools", async () => {
  let allowedToolRefs: string[] = [];
  let agentIntake: unknown;
  const result = await runAgentBackendGeneration({
    payload: {
      mode: "chat",
      locale: "en",
      threadId: "thread_1",
      chatInstruction: "Review recent agent literature\n\nSelected clarification: 2023-2026",
      transientSkillRefs: ["literature-review"],
      contextValues: {
        agentClarification: {
          clarificationId: "skill_clarification_1",
          selectedOptionId: "recent",
          answer: "2023-2026"
        },
        taskHandlingPolicy: { kind: "long_task" },
        canvas: { workflow: { mode: "batch_delivery" } },
        progressiveCanvasDelivery: {
          enabled: true,
          runtimeBudgetProfile: "low",
          recursionLimit: 80,
          modelCallLimit: 18,
          evidenceToolLimit: 8,
          bodyDraftWriteLimit: 2,
          synthesisReserveSteps: 16
        }
      },
      toolState: { web_search: true, canvas_write: true }
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
    runtimeConfig: { enabledTools: ["web_search", "canvas_write"], agentCard: {}, settings: {} } as never,
    messages: [],
    prompt: "prompt"
  }, {
    getRuntimeConfig: () => ({ enabled: true } as never),
    runAgent: async (input) => {
      allowedToolRefs = input.allowedToolRefs ?? [];
      agentIntake = input.contextValues?.agentIntake;
      return {
        text: "Done",
        finishReason: "agent_backend_completed",
        events: [{ eventType: "agent_backend_canvas_node_committed", payload: { nodeId: "node_1" } }]
      };
    }
  });

  assert.equal(allowedToolRefs.includes("web_search"), true);
  assert.equal(allowedToolRefs.includes("canvas_write"), true);
  assert.equal(allowedToolRefs.includes("write_file"), true);
  assert.equal(allowedToolRefs.includes("present_files"), true);
  assert.notDeepEqual(allowedToolRefs, ["ask_clarification", "agent_intake_complete"]);
  assert.deepEqual(agentIntake, { phase: "execution", completed: true });
  assert.equal(result?.text, "Done");
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

test("removes ask_clarification after transient skill intake enters execution", async () => {
  let allowedToolRefs: string[] = [];
  await runAgentBackendGeneration({
    payload: {
      mode: "chat",
      locale: "en",
      threadId: "thread_1",
      chatInstruction: "Review recent agent literature",
      transientSkillRefs: ["literature-review"],
      contextValues: {
        agentIntake: { phase: "execution", completed: true }
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

  assert.equal(allowedToolRefs.includes("ask_clarification"), false);
  assert.equal(allowedToolRefs.includes("web_search"), true);
});

test("keeps ordinary clarification intake ask-only after one answered round", async () => {
  let allowedToolRefs: string[] = [];
  let agentIntake: unknown;
  const result = await runAgentBackendGeneration({
    payload: {
      mode: "chat",
      locale: "en",
      threadId: "thread_1",
      chatInstruction: "Review recent papers\n\nSelected clarification: Recent sources",
      contextValues: {
        agentClarification: {
          clarificationId: "clarification_1",
          selectedOptionId: "recent",
          answer: "Recent sources"
        },
        ordinaryClarificationIntake: {
          mode: "ordinary",
          state: "collecting",
          maxRounds: 3,
          minAnsweredRoundsAfterFirstAsk: 2,
          answeredRounds: 1,
          remainingRounds: 2,
          answeredSummary: "1. Which sources? => Recent sources"
        }
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
      agentIntake = input.contextValues?.agentIntake;
      return {
        text: "",
        finishReason: "clarification_required",
        events: [{
          eventType: "agent_backend_agent_clarification_requested",
          payload: { question: "Which output?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }
        }]
      };
    }
  });

  assert.deepEqual(allowedToolRefs, ["ask_clarification"]);
  assert.equal(agentIntake, undefined);
  assert.equal(result?.finishReason, "clarification_required");
});

test("ordinary clarification intake can complete after two answered rounds", async () => {
  const allowedToolRefsByRun: string[][] = [];
  const agentIntakeByRun: unknown[] = [];
  const result = await runAgentBackendGeneration({
    payload: {
      mode: "chat",
      locale: "en",
      threadId: "thread_1",
      chatInstruction: "Review recent papers\n\nSelected clarification: Recent sources",
      contextValues: {
        agentClarification: {
          clarificationId: "clarification_1",
          selectedOptionId: "recent",
          answer: "Recent sources"
        },
        ordinaryClarificationIntake: {
          mode: "ordinary",
          state: "collecting",
          maxRounds: 3,
          minAnsweredRoundsAfterFirstAsk: 2,
          answeredRounds: 2,
          remainingRounds: 1,
          answeredSummary: "1. Which sources? => Recent sources\n2. Which output? => Markdown"
        }
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
      allowedToolRefsByRun.push(input.allowedToolRefs ?? []);
      agentIntakeByRun.push(input.contextValues?.agentIntake);
      if (allowedToolRefsByRun.length === 1) {
        return {
          text: "",
          finishReason: "agent_backend_completed",
          events: [{ eventType: "agent_backend_agent_intake_complete", payload: { summary: "Ready" } }]
        };
      }
      return {
        text: "Done",
        finishReason: "agent_backend_completed",
        events: []
      };
    }
  });

  assert.deepEqual(allowedToolRefsByRun[0], ["ask_clarification", "agent_intake_complete"]);
  assert.equal(allowedToolRefsByRun[1]?.includes("ask_clarification"), false);
  assert.equal(allowedToolRefsByRun[1]?.includes("web_search"), true);
  assert.deepEqual(agentIntakeByRun[1], { phase: "execution", completed: true });
  assert.deepEqual(result?.effectivePayload.contextValues?.agentIntake, { phase: "execution", completed: true });
  assert.equal((result?.effectivePayload.contextValues?.ordinaryClarificationIntake as { state?: unknown })?.state, "completed");
});

test("ordinary clarification intake round limit starts execution without ask_clarification", async () => {
  let allowedToolRefs: string[] = [];
  let ordinaryIntake: unknown;
  await runAgentBackendGeneration({
    payload: {
      mode: "chat",
      locale: "en",
      threadId: "thread_1",
      chatInstruction: "Review recent papers\n\nSelected clarification: Recent sources",
      contextValues: {
        agentClarification: {
          clarificationId: "clarification_1",
          selectedOptionId: "recent",
          answer: "Recent sources"
        },
        ordinaryClarificationIntake: {
          mode: "ordinary",
          state: "completed",
          maxRounds: 3,
          minAnsweredRoundsAfterFirstAsk: 2,
          answeredRounds: 3,
          remainingRounds: 0,
          answeredSummary: "1. Which sources? => Recent sources"
        }
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
      ordinaryIntake = input.contextValues?.ordinaryClarificationIntake;
      return {
        text: "Done",
        finishReason: "agent_backend_completed",
        events: []
      };
    }
  });

  assert.equal(allowedToolRefs.includes("ask_clarification"), false);
  assert.deepEqual(ordinaryIntake, { mode: "ordinary", state: "completed", maxRounds: 3, minAnsweredRoundsAfterFirstAsk: 2, answeredRounds: 3, remainingRounds: 0, answeredSummary: "1. Which sources? => Recent sources" });
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

test("skill clarification guard allows process narration for upstream Thinking classification", async () => {
  let allowedToolRefs: string[] = [];
  const result = await runAgentBackendGeneration({
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
    });

  assert.deepEqual(allowedToolRefs, ["ask_clarification"]);
  assert.ok(result);
  assert.equal(result.text.length > 0, true);
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

test("resumes AgentBackend run when answering a runtime-backed agent clarification", async () => {
  let resumePayload: unknown;
  let resumedThreadId = "";
  let runAgentCalled = false;
  const result = await runAgentBackendGeneration({
    payload: {
      mode: "chat",
      locale: "en",
      threadId: "facet_thread_1",
      chatInstruction: "Original task\n\nSelected clarification: Use recent sources",
      contextValues: {
        agentClarification: {
          clarificationId: "clarification_1",
          question: "Which scope should I use?",
          selectedOptionId: "recent",
          answer: "Use recent sources",
          option: { id: "recent", label: "Use recent sources", detail: "Prefer last 12 months" },
          resumeContext: {
            runtimeResume: {
              runtimeThreadId: "runtime_thread_1",
              runtimeRunId: "run_original",
              interruptId: "interrupt_1",
              checkpointId: "checkpoint_1"
            }
          }
        }
      }
    },
    threadId: "facet_thread_1",
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
    runAgent: async () => {
      runAgentCalled = true;
      return { text: "should not run", finishReason: "agent_backend_completed", events: [] };
    },
    resumeRun: async (input) => {
      resumedThreadId = input.threadId;
      resumePayload = input.resume;
      assert.equal(input.resumeOfRunId, "run_original");
      assert.equal(input.interruptId, "interrupt_1");
      assert.equal(input.checkpointId, "checkpoint_1");
      return {
        text: "Resumed",
        finishReason: "agent_backend_completed",
        events: []
      };
    }
  });

  assert.equal(runAgentCalled, false);
  assert.equal(resumedThreadId, "runtime_thread_1");
  assert.deepEqual(resumePayload, {
    type: "agent_clarification_answer",
    clarificationId: "clarification_1",
    question: "Which scope should I use?",
    selectedOptionId: "recent",
    answer: "Use recent sources",
    option: { id: "recent", label: "Use recent sources", detail: "Prefer last 12 months" }
  });
  assert.equal(result?.text, "Resumed");
});

test("retries a checkpoint resume once only when the failure occurred before streaming", async () => {
  let resumeCalls = 0;
  let freshRunCalled = false;
  const result = await runAgentBackendGeneration({
    payload: {
      mode: "chat",
      locale: "en",
      threadId: "facet_thread_1",
      contextValues: {
        agentClarification: {
          requiresRuntimeResume: true,
          clarificationId: "clarification_1",
          answer: "Recent sources",
          resumeContext: {
            runtimeResume: {
              runtimeThreadId: "runtime_thread_1",
              runtimeRunId: "runtime_run_1",
              interruptId: "interrupt_1"
            }
          }
        }
      }
    },
    threadId: "facet_thread_1",
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
    runAgent: async () => {
      freshRunCalled = true;
      return { text: "wrong", finishReason: "agent_backend_completed", events: [] };
    },
    resumeRun: async () => {
      resumeCalls += 1;
      if (resumeCalls === 1) {
        throw Object.assign(new Error("runtime returned 503 before stream"), { retryableBeforeStream: true });
      }
      return { text: "Resumed after retry", finishReason: "agent_backend_completed", events: [] };
    }
  });

  assert.equal(resumeCalls, 2);
  assert.equal(freshRunCalled, false);
  assert.equal(result?.text, "Resumed after retry");
});

test("rejects explicit runtime resume clarification answers that lack metadata", async () => {
  await assert.rejects(
    () => runAgentBackendGeneration({
      payload: {
        mode: "chat",
        locale: "en",
        threadId: "facet_thread_1",
        chatInstruction: "Selected clarification: Use recent sources",
        contextValues: {
          agentClarification: {
            requiresRuntimeResume: true,
            clarificationId: "clarification_1",
            question: "Which scope should I use?",
            answer: "Use recent sources"
          }
        }
      },
      threadId: "facet_thread_1",
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
      runAgent: async () => ({ text: "should not run", finishReason: "agent_backend_completed", events: [] })
    }),
    /missing runtime resume metadata/i
  );
});
