import test from "node:test";
import assert from "node:assert/strict";
import { agentCards, defaultAgentSettings } from "../agentCards.js";
import { createGenerationService } from "./generationService.js";
import type { AgentRuntimeConfig } from "./agentDefinitionService.js";
import type { ChatClient } from "../providerRuntime.js";
import type { SQLiteStorageRepository } from "../storage.js";
import type { AgentRuntimeAdapter } from "../agentRuntimeAdapter.js";

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

function fakeAgentRuntime(config = runtimeConfig()): AgentRuntimeAdapter {
  return {
    resolveAgentCard: () => config.agentCard,
    listAgentCards: () => [config.agentCard],
    getAgentSettings: () => config.settings,
    saveAgentSettings: () => config.settings,
    getAgentRuntimeConfig: async () => config
  } as unknown as AgentRuntimeAdapter;
}

function fakeStorage(messages: Array<{ role: "user" | "assistant"; text: string }> = []) {
  const records: unknown[] = [];
  const canvasWriteRequests: unknown[] = [];
  return {
    records,
    canvasWriteRequests,
    storage: {
      ensureThread: async () => undefined,
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

test("generation facade records AgentBackend runs when AgentBackend is enabled", async () => {
  const { storage, records } = fakeStorage();
  const service = createGenerationService(storage, fakeAgentRuntime(), {
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
});

test("generation facade creates a pending Canvas write request for AgentBackend canvas intent", async () => {
  const { storage, records, canvasWriteRequests } = fakeStorage();
  const service = createGenerationService(storage, fakeAgentRuntime(), {
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
    toolState: { canvas_write: true }
  });

  assert.equal(canvasWriteRequests.length, 1);
  assert.deepEqual(canvasWriteRequests[0], {
    operation: "create",
    nodeKind: "document",
    title: "博客文章",
    content: "A 300-word podcast draft about global warming.",
    rationale: "Requested by the user from the chat instruction."
  });
  assert.ok((records[0] as { events: Array<{ payload: { tool?: string; requestId?: string } }> }).events.some((event) => event.payload.tool === "canvas_write" && event.payload.requestId === "write_1"));
});

test("generation facade recognizes Chinese and English Canvas write intents", async () => {
  for (const chatInstruction of ["请写入画板", "save to canvas", "write this"]) {
    const { storage, canvasWriteRequests } = fakeStorage();
    const service = createGenerationService(storage, fakeAgentRuntime(), {
      agentBackend: {
        getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
        runAgent: async () => ({
          text: "Reusable answer",
          finishReason: "stop",
          events: []
        })
      }
    });

    await service.generateAndRecord({
      mode: "chat",
      locale: "zh",
      agentCardId: "blog-post",
      chatInstruction,
      toolState: { canvas_write: true }
    });

    assert.equal(canvasWriteRequests.length, 1);
    assert.equal((canvasWriteRequests[0] as { content: string }).content, "Reusable answer");
  }
});

test("generation facade falls back to provider when AgentBackend returns no usable text", async () => {
  const { storage, records } = fakeStorage();
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => {
        throw new Error("AgentBackend returned an empty response");
      }
    },
    provider: {
      apiKey: "test-key",
      createClient: () => ({ createChatCompletion: async () => ({ choices: [] }) } as ChatClient),
      runAgent: async (input) => ({
        text: "Provider recovered text",
        finishReason: "stop",
        messages: input.messages,
        events: []
      })
    }
  });

  const result = await service.generateAndRecord({ mode: "chat", locale: "en", agentCardId: "blog-post", chatInstruction: "Hello" });

  assert.equal(result.provider, "deepseek");
  assert.equal(result.usedMock, false);
  assert.equal(result.text, "Provider recovered text");
  assert.ok((records[0] as { events: Array<{ eventType: string; payload: { fallback?: string } }> }).events.some((event) => event.eventType === "agent_backend_runtime_failed" && event.payload.fallback === "provider"));
});

test("generation facade blocks AgentBackend internal prompt output before recording", async () => {
  const { storage, records } = fakeStorage();
  const service = createGenerationService(storage, fakeAgentRuntime(), {
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
  assert.equal(result.text, "Provider recovered after internal AgentBackend output");
  assert.equal((records[0] as { output: string }).output.includes("# AgentCard"), false);
  assert.ok((records[0] as { events: Array<{ eventType: string }> }).events.some((event) => event.eventType === "internal_output_blocked"));
});

test("generation facade strips search result JSON from recorded assistant text", async () => {
  const { storage, records } = fakeStorage();
  const service = createGenerationService(storage, fakeAgentRuntime(), {
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

test("generation facade passes policy-aware tool context to provider runner", async () => {
  const { storage, records } = fakeStorage([
    { role: "user", text: "Old user" },
    { role: "assistant", text: "Old assistant" }
  ]);
  let observedToolContext: unknown;
  let observedMessages: unknown[] = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: false, baseUrl: "http://AgentBackend", assistantId: "lead_agent" })
    },
    provider: {
      apiKey: "test-key",
      createClient: () => ({ createChatCompletion: async () => ({ choices: [] }) } as ChatClient),
      runAgent: async (input) => {
        observedToolContext = input.toolContext;
        observedMessages = input.messages;
        return {
          text: "Provider text",
          finishReason: "stop",
          messages: input.messages,
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

  assert.equal(result.provider, "deepseek");
  assert.equal((observedToolContext as { selectedCanvasNodeId: string }).selectedCanvasNodeId, "node_123");
  assert.deepEqual((observedToolContext as { allowedToolRefs: string[] }).allowedToolRefs.includes("canvas_write"), true);
  assert.equal((observedToolContext as { toolState: Record<string, boolean> }).toolState.canvas_write, true);
  assert.ok(observedMessages.some((message) => (message as { content?: string }).content === "Old assistant"));
  assert.equal((records[0] as { mode: string }).mode, "chat");
});

test("generation facade applies per-run model thinking overrides", async () => {
  const { storage } = fakeStorage();
  let observedThinkingMode: unknown;
  let observedReasoningEffort: unknown;
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: false, baseUrl: "http://AgentBackend", assistantId: "lead_agent" })
    },
    provider: {
      apiKey: "test-key",
      createClient: () => ({ createChatCompletion: async () => ({ choices: [] }) } as ChatClient),
      runAgent: async (input) => {
        observedThinkingMode = input.modelSettings.thinkingMode;
        observedReasoningEffort = input.modelSettings.reasoningEffort;
        return {
          text: "Provider text",
          finishReason: "stop",
          messages: input.messages,
          events: []
        };
      }
    }
  });

  await service.generateAndRecord({
    mode: "chat",
    locale: "en",
    agentCardId: "blog-post",
    chatInstruction: "Think and search",
    toolState: { web_search: true },
    modelOverrides: { thinkingMode: "enabled", reasoningEffort: "max" }
  });

  assert.equal(observedThinkingMode, "enabled");
  assert.equal(observedReasoningEffort, "max");
});

test("generation facade honors clear_context and falls back to mock on provider failure", async () => {
  const { storage, records } = fakeStorage([{ role: "assistant", text: "Should not appear" }]);
  let observedMessages: unknown[] = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: false, baseUrl: "http://AgentBackend", assistantId: "lead_agent" })
    },
    provider: {
      apiKey: "test-key",
      createClient: () => ({ createChatCompletion: async () => ({ choices: [] }) } as ChatClient),
      runAgent: async (input) => {
        observedMessages = input.messages;
        throw new Error("provider down");
      }
    }
  });

  const result = await service.generateAndRecord({
    mode: "chat",
    locale: "zh",
    agentCardId: "blog-post",
    chatInstruction: "继续写",
    toolState: { clear_context: true }
  });

  assert.equal(result.provider, "mock");
  assert.equal(result.usedMock, true);
  assert.match(result.text, /Mock fallback/);
  assert.equal(observedMessages.some((message) => (message as { content?: string }).content === "Should not appear"), false);
  assert.equal((records[0] as { provider: string; errorMessage: string }).provider, "mock");
  assert.match((records[0] as { errorMessage: string }).errorMessage, /provider down/);
});
