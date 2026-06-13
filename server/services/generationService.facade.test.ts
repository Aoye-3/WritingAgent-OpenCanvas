import test from "node:test";
import assert from "node:assert/strict";
import { agentCards, defaultAgentSettings } from "../agentCards.js";
import { createGenerationService } from "./generationService.js";
import type { AgentRuntimeConfig } from "./agentDefinitionService.js";
import type { ChatClient } from "../providerRuntime.js";
import type { SQLiteStorageRepository } from "../storage.js";
import type { AgentRuntimeAdapter } from "../agentRuntimeAdapter.js";
import type { KnowledgeSearchInput } from "../knowledge/service.js";
import { resolveCanvasAction } from "./generation/canvasActionPolicy.js";

function runtimeConfig(): AgentRuntimeConfig {
  const agentCard = agentCards[0];
  const settings = defaultAgentSettings(agentCard);
  return {
    agentCard,
    settings: {
      ...settings,
      model: { ...settings.model, streaming: false, contextCount: 1 },
      tools: { ...settings.tools, clear_context: false }
    },
    availableTools: [],
    enabledTools: agentCard.toolRefs,
    toolPolicies: [],
    missingToolRefs: [],
    deprecatedToolRefs: [],
    availableSkills: [],
    missingSkillRefs: [],
    providerProfile: {
      id: "deepseek",
      label: "DeepSeek",
      defaultBaseURL: "https://api.deepseek.com",
      defaultModel: "deepseek-v4-flash",
      capabilities: {
        chatCompletions: true,
        streaming: true,
        toolCalls: true,
        thinking: true,
        reasoningContentPolicy: "preserve_when_tool_calling",
        jsonOutput: true,
        chatPrefixCompletion: true,
        supportsAssistantPrefix: true
      }
    }
  };
}

function runtimeConfigWithKnowledge(patch: Partial<AgentRuntimeConfig["settings"]["knowledge"]> = {}): AgentRuntimeConfig {
  const config = runtimeConfig();
  return {
    ...config,
    settings: {
      ...config.settings,
      knowledge: {
        ...config.settings.knowledge,
        ...patch
      },
      tools: {
        ...config.settings.tools,
        knowledge_base: true,
        clear_context: false
      }
    }
  };
}

function fakeAgentRuntime(config = runtimeConfig()): AgentRuntimeAdapter {
  return {
    resolveAgentCard: () => config.agentCard,
    listAgentCards: () => [config.agentCard],
    getAgentSettings: () => config.settings,
    saveAgentSettings: () => config.settings,
    getAgentRuntimeConfig: async () => config
  } as unknown as AgentRuntimeAdapter;
}

function fakeStorage(messages: Array<{ role: "user" | "assistant"; text: string }> = [], contextResetAt?: string) {
  const records: unknown[] = [];
  const canvasWriteRequests: unknown[] = [];
  return {
    records,
    canvasWriteRequests,
    storage: {
      ensureThread: async () => undefined,
      getThread: () => ({ id: "thread_test", projectId: "project_test", title: "Test", configuredModelApiId: "configured-test", contextResetAt, updatedAt: "" }),
      getProject: () => ({ id: "project_test", title: "Test", summary: "", updatedAt: "" }),
      getProjectModelBindings: () => ["configured-test"],
      getProjectSharedContext: () => undefined,
      createPlanIntake: () => ({ id: "plan_intake_test" }),
      getPlanRun: (_threadId: string, planId: string) => planId === "plan_intake_test"
        ? { id: planId, status: "draft", steps: [], artifacts: [] }
        : undefined,
      listPlanRuns: () => [{ id: "plan_intake_test", status: "draft" }],
      recordPlanActivity: () => undefined,
      listMessages: () => messages.map((message, index) => ({
        id: `msg_${index}`,
        threadId: "thread_test",
        role: message.role,
        text: message.text,
        usedMock: false,
        createdAt: new Date(index).toISOString()
      })),
      createCanvasWriteRequest: (_threadId: string, input: unknown) => {
        canvasWriteRequests.push(input);
        return {
          id: "write_1",
          operation: "create",
          nodeKind: "document",
          title: "Draft",
          status: "pending"
        };
      },
      recordRun: (input: unknown) => {
        records.push(input);
        return { runId: `run_${records.length}`, promptVersionId: "prompt_1", outputVersionId: "output_1" };
      }
    } as unknown as SQLiteStorageRepository
  };
}

const fakeModelRuntime = {
  resolveConfiguredModel: async () => ({
    id: "configured-test",
    providerId: "deepseek" as const,
    modelId: "deepseek-test",
    modelName: "DeepSeek Test",
    modelType: "chat",
    apiKey: "test-key",
    baseURL: "https://api.deepseek.test",
    enabled: true,
    createdAt: "",
    updatedAt: ""
  }),
  isModelReady: () => true
};

function fakeKnowledgeService(observedSearches: KnowledgeSearchInput[]) {
  return {
    search: async (input: KnowledgeSearchInput) => {
      observedSearches.push(input);
      return [{
        id: 1,
        baseId: "kb_orchid",
        baseName: "Orchid Base",
        content: "The project codename is ORCHID-9137.",
        score: 0.91,
        source: "orchid-note",
        title: "Orchid memo",
        metadata: {}
      }];
    }
  };
}

test("generation facade records AgentBackend runs when AgentBackend is enabled", async () => {
  const { storage, records } = fakeStorage();
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => ({
        text: "AgentBackend text",
        finishReason: "stop",
        usage: { total_tokens: 3 },
        events: [{ eventType: "agent_backend_task_completed", payload: { ok: true } }]
      })
    }
  });

  const result = await service.generateAndRecord({ mode: "structured", locale: "en", agentCardId: "blog-post" });

  assert.equal(result.provider, "agent-backend");
  assert.equal(result.usedMock, false);
  assert.equal((records[0] as { provider: string }).provider, "agent-backend");
  assert.equal((records[0] as { configuredModelApiId: string }).configuredModelApiId, "configured-test");
});

test("generation accepts the selected conversation model without a project binding", async () => {
  const { storage } = fakeStorage();
  storage.getProjectModelBindings = () => [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => ({
        text: "AgentBackend text",
        finishReason: "stop",
        events: []
      })
    }
  });

  const result = await service.generateAndRecord({
    mode: "chat",
    locale: "en",
    agentCardId: "blog-post",
    freeTextPrompt: "Hello"
  });

  assert.equal(result.provider, "agent-backend");
});

test("generation facade does not copy assistant text into Canvas without a tool call", async () => {
  const { storage, records, canvasWriteRequests } = fakeStorage();
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => ({
        text: "A 300-word podcast draft about global warming.",
        finishReason: "stop",
        events: []
      })
    }
  });

  await service.generateAndRecord({
    mode: "chat",
    locale: "zh",
    agentCardId: "blog-post",
    chatInstruction: "帮我写个关于气候变暖的播客，300字。放到画板里。",
    toolState: { canvas_write: true },
    canvasAction: { id: "canvas_action_not_required", operation: "delete", risk: "high", requiresTool: false }
  });

  assert.equal(canvasWriteRequests.length, 0);
  return;
  assert.deepEqual(canvasWriteRequests[0], {
    operation: "create",
    nodeKind: "document",
    title: "博客文章",
    content: "A 300-word podcast draft about global warming.",
    rationale: "Requested by the user from the chat instruction."
  });
  assert.ok((records[0] as { events: Array<{ payload: { tool?: string; requestId?: string } }> }).events.some((event) => event.payload.tool === "canvas_write" && event.payload.requestId === "write_1"));
});

test("explicit Canvas intent requires a structured Canvas tool result", async () => {
  for (const chatInstruction of ["请写入画板", "save to canvas", "write this"]) {
    const { storage, canvasWriteRequests } = fakeStorage();
    const service = createGenerationService(storage, fakeAgentRuntime(), {
      modelRuntime: fakeModelRuntime,
      agentBackend: {
        getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
        runAgent: async () => ({
          text: "Reusable answer",
          finishReason: "stop",
          events: []
        })
      }
    });

    const generate = () => service.generateAndRecord({
      mode: "chat",
      locale: "zh",
      agentCardId: "blog-post",
      chatInstruction,
      toolState: { canvas_write: true }
    });
    if (resolveCanvasAction({ threadId: "test", instruction: chatInstruction })) {
      await assert.rejects(generate, /Canvas action completed without a committed node or pending approval request/);
    } else {
      await generate();
    }

    assert.equal(canvasWriteRequests.length, 0);
  }
});

test("generation facade falls back to mock without calling provider when AgentBackend fails", async () => {
  const { storage, records } = fakeStorage();
  let providerCalls = 0;
    const service = createGenerationService(storage, fakeAgentRuntime(), {
      mockFallbackEnabled: true,
      modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => {
        throw new Error("AgentBackend returned an empty response");
      }
    },
    provider: {
      apiKey: "test-key",
      createClient: () => ({ createChatCompletion: async () => ({ choices: [] }) } as ChatClient),
      runAgent: async () => {
        providerCalls += 1;
        throw new Error("Provider must not be called");
      }
    }
  });

  const result = await service.generateAndRecord({ mode: "chat", locale: "en", agentCardId: "blog-post", chatInstruction: "Hello" });

  assert.equal(result.provider, "mock");
  assert.equal(result.usedMock, true);
  assert.equal(providerCalls, 0);
  assert.match(result.errorMessage ?? "", /AgentBackend returned an empty response/);
  assert.ok((records[0] as { events: Array<{ eventType: string; payload: { fallback?: string } }> }).events.some((event) => event.eventType === "agent_backend_runtime_failed" && event.payload.fallback === "mock"));
});

test("generation facade exposes runtime failure without recording a mock result by default", async () => {
  const { storage, records } = fakeStorage();
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => {
        throw new Error("AgentBackend down");
      }
    }
  });

  await assert.rejects(
    () => service.generateAndRecord({ mode: "chat", locale: "en", agentCardId: "blog-post", chatInstruction: "Hello" }),
    (error: unknown) => (error as { code?: string }).code === "runtime_unavailable"
  );
  assert.equal(records.length, 0);
});

test("generation facade reports Plan protocol violations without labeling them as runtime fallback", async () => {
  const { storage } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => {
        throw new Error("Plan planning phase completed without a Plan state update.");
      }
    }
  });

  await assert.rejects(
    () => service.generateAndRecord(
      { mode: "chat", locale: "en", agentCardId: "blog-post", chatInstruction: "/plan Compare laptops" },
      (event) => events.push(event)
    ),
    /Plan planning phase completed/
  );
  assert.equal(events.at(-1)?.eventType, "agent_backend_plan_protocol_failed");
  assert.equal(events.at(-1)?.payload.fallback, "none");
});

test("generation facade blocks AgentBackend internal prompt output before recording", async () => {
  const { storage, records } = fakeStorage();
    const service = createGenerationService(storage, fakeAgentRuntime(), {
      mockFallbackEnabled: true,
      modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => ({
        text: "You are FacetWrite's writing assistant.\n\n# AgentCard\nAgent: Blog Post\n# Output Contract\nReturn article.",
        finishReason: "stop",
        events: []
      })
    },
    provider: {
      apiKey: "test-key",
      createClient: () => ({ createChatCompletion: async () => ({ choices: [] }) } as ChatClient),
      runAgent: async (input) => ({
        text: "Provider recovered after internal AgentBackend output",
        finishReason: "stop",
        messages: input.messages,
        events: []
      })
    }
  });

  const result = await service.generateAndRecord({ mode: "chat", locale: "en", agentCardId: "blog-post", chatInstruction: "Hello" });

  assert.equal(result.text.includes("# AgentCard"), false);
  assert.equal(result.provider, "mock");
  assert.equal(result.usedMock, true);
  assert.match(result.text, /mock fallback mode/);
  assert.equal((records[0] as { output: string }).output.includes("# AgentCard"), false);
  assert.ok((records[0] as { events: Array<{ eventType: string }> }).events.some((event) => event.eventType === "internal_output_blocked"));
});

test("generation facade falls back to mock when AgentBackend returns a provider-unavailable message", async () => {
  const { storage, records } = fakeStorage();
    const service = createGenerationService(storage, fakeAgentRuntime(), {
      mockFallbackEnabled: true,
      modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => ({
        text: "The configured LLM provider is temporarily unavailable after multiple retries. Please wait a moment and continue the conversation.",
        finishReason: "agent_backend_completed",
        events: []
      })
    },
    provider: {
      apiKey: "test-key",
      createClient: () => ({ createChatCompletion: async () => ({ choices: [] }) } as ChatClient),
      runAgent: async (input) => ({
        text: "Provider recovered after AgentBackend provider failure",
        finishReason: "stop",
        messages: input.messages,
        events: []
      })
    }
  });

  const result = await service.generateAndRecord({ mode: "chat", locale: "en", agentCardId: "blog-post", chatInstruction: "Hello" });

  assert.equal(result.provider, "mock");
  assert.equal(result.usedMock, true);
  assert.match((records[0] as { errorMessage: string }).errorMessage, /internal runtime output/);
});

test("streaming generation falls back to mock without calling provider when AgentBackend fails", async () => {
  const { storage } = fakeStorage();
  let providerCalls = 0;
  const tokens: string[] = [];
    const service = createGenerationService(storage, fakeAgentRuntime(), {
      mockFallbackEnabled: true,
      modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => {
        throw new Error("AgentBackend stream failed");
      }
    },
    provider: {
      apiKey: "test-key",
      createClient: () => ({ createChatCompletion: async () => ({ choices: [] }) } as ChatClient),
      runAgentStream: async () => {
        providerCalls += 1;
        throw new Error("Provider must not be called");
      }
    }
  });

  const result = await service.generateAndRecordStream(
    { mode: "chat", locale: "en", agentCardId: "blog-post", chatInstruction: "Hello" },
    { onToken: (token) => tokens.push(token) }
  );

  assert.equal(result.provider, "mock");
  assert.equal(result.usedMock, true);
  assert.equal(providerCalls, 0);
  assert.match(result.errorMessage ?? "", /AgentBackend stream failed/);
  assert.equal(tokens.join(""), result.text);
});

test("generation facade strips search result JSON from recorded assistant text", async () => {
  const { storage, records } = fakeStorage();
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    mockFallbackEnabled: true,
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => ({
        text: '好的，我来搜索一下。{"query":"2026 news","results":[{"title":"raw"}]}整理摘要如下。',
        finishReason: "stop",
        events: []
      })
    }
  });

  const result = await service.generateAndRecord({ mode: "chat", locale: "zh", agentCardId: "blog-post", chatInstruction: "搜索最近新闻" });

  assert.equal(result.text.includes('"query"'), false);
  assert.equal(result.text.includes('"results"'), false);
  assert.equal((records[0] as { output: string }).output.includes('"results"'), false);
});

test("generation facade passes policy-aware tool context to AgentBackend", async () => {
  const { storage, records } = fakeStorage([
    { role: "user", text: "Old user" },
    { role: "assistant", text: "Old assistant" }
  ]);
  let observedInput: unknown;
  let observedMessages: unknown[] = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        observedInput = input;
        observedMessages = input.messages;
        return {
          text: "AgentBackend text",
          finishReason: "stop",
          events: []
        };
      }
    }
  });

  const result = await service.generateAndRecord({
    mode: "chat",
    locale: "en",
    agentCardId: "blog-post",
    threadId: "thread_provider_facade",
    chatInstruction: "Use canvas",
    toolState: { canvas_write: true },
    selectedCanvasNodeId: "node_123"
  });

  assert.equal(result.provider, "agent-backend");
  assert.equal((observedInput as { selectedCanvasNodeId: string }).selectedCanvasNodeId, "node_123");
  assert.deepEqual((observedInput as { allowedToolRefs: string[] }).allowedToolRefs.includes("canvas_write"), true);
  assert.equal((observedInput as { toolState: Record<string, boolean> }).toolState.canvas_write, true);
  assert.ok(observedMessages.some((message) => (message as { content?: string }).content === "Old assistant"));
  assert.equal((records[0] as { mode: string }).mode, "chat");
});

test("generation facade injects Knowledge References into AgentBackend messages", async () => {
  const { storage, records } = fakeStorage();
  const observedSearches: KnowledgeSearchInput[] = [];
  let observedMessages: unknown[] = [];
  const service = createGenerationService(storage, fakeAgentRuntime(runtimeConfigWithKnowledge({
    enabled: true,
    baseIds: ["kb_orchid"],
    documentCount: 2,
    threshold: 0.4
  })), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        observedMessages = input.messages;
        return {
          text: "The codename is ORCHID-9137.",
          finishReason: "stop",
          events: []
        };
      }
    },
    knowledge: fakeKnowledgeService(observedSearches) as never
  });

  await service.generateAndRecord({
    mode: "chat",
    locale: "en",
    agentCardId: "blog-post",
    chatInstruction: "What is the project codename?",
    toolState: { knowledge_base: true }
  });

  const userMessage = observedMessages.at(-1) as { role: string; content: string };
  assert.equal(userMessage.role, "user");
  assert.match(userMessage.content, /Knowledge References:/);
  assert.match(userMessage.content, /ORCHID-9137/);
  assert.deepEqual(observedSearches[0], {
    query: "What is the project codename?",
    baseIds: ["kb_orchid"],
    limit: 2,
    threshold: 0.4
  });
  assert.ok((records[0] as { events: Array<{ eventType: string; payload: { resultCount?: number } }> }).events.some((event) => event.eventType === "knowledge_search_completed" && event.payload.resultCount === 1));
});

test("generation facade skips knowledge search when disabled by settings or tool state", async () => {
  for (const setup of [
    { knowledgeEnabled: false, toolEnabled: true },
    { knowledgeEnabled: true, toolEnabled: false }
  ]) {
    const { storage } = fakeStorage();
    const observedSearches: KnowledgeSearchInput[] = [];
    let observedMessages: unknown[] = [];
    const service = createGenerationService(storage, fakeAgentRuntime(runtimeConfigWithKnowledge({
      enabled: setup.knowledgeEnabled,
      baseIds: ["kb_orchid"]
    })), {
      modelRuntime: fakeModelRuntime,
      agentBackend: {
        getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
        runAgent: async (input) => {
          observedMessages = input.messages;
          return {
            text: "No knowledge context",
            finishReason: "stop",
            events: []
          };
        }
      },
      knowledge: fakeKnowledgeService(observedSearches) as never
    });

    await service.generateAndRecord({
      mode: "chat",
      locale: "en",
      agentCardId: "blog-post",
      chatInstruction: "What is the project codename?",
      toolState: { knowledge_base: setup.toolEnabled }
    });

    const userMessage = observedMessages.at(-1) as { content: string };
    assert.equal(observedSearches.length, 0);
    assert.equal(userMessage.content.includes("Knowledge References:"), false);
    assert.equal(userMessage.content.includes("ORCHID-9137"), false);
  }
});

test("generation facade excludes messages before the persisted context reset boundary", async () => {
  const { storage, records } = fakeStorage([{ role: "assistant", text: "Should not appear" }], new Date(1).toISOString());
  let observedMessages: unknown[] = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    mockFallbackEnabled: true,
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        observedMessages = input.messages;
        throw new Error("AgentBackend down");
      }
    }
  });

  const result = await service.generateAndRecord({
    mode: "chat",
    locale: "zh",
    agentCardId: "blog-post",
    chatInstruction: "继续写",
    toolState: {}
  });

  assert.equal(result.provider, "mock");
  assert.equal(result.usedMock, true);
  assert.match(result.text, /Mock fallback/);
  assert.equal(observedMessages.some((message) => (message as { content?: string }).content === "Should not appear"), false);
  assert.equal((records[0] as { provider: string; errorMessage: string }).provider, "mock");
  assert.match((records[0] as { errorMessage: string }).errorMessage, /AgentBackend down/);
});
