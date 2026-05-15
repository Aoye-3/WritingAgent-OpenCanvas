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
  return {
    records,
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
      createCanvasWriteRequest: () => ({
        id: "write_1",
        operation: "create",
        nodeKind: "document",
        title: "Draft",
        status: "pending"
      }),
      recordRun: (input: unknown) => {
        records.push(input);
        return { runId: `run_${records.length}`, promptVersionId: "prompt_1", outputVersionId: "output_1" };
      }
    } as unknown as SQLiteStorageRepository
  };
}

test("generation facade records DeerFlow runs when DeerFlow is enabled", async () => {
  const { storage, records } = fakeStorage();
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    deerflow: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://deerflow", assistantId: "lead_agent" }),
      runAgent: async () => ({
        text: "DeerFlow text",
        finishReason: "stop",
        usage: { total_tokens: 3 },
        events: [{ eventType: "deerflow_task_completed", payload: { ok: true } }]
      })
    }
  });

  const result = await service.generateAndRecord({ mode: "structured", locale: "en", agentCardId: "blog-post" });

  assert.equal(result.provider, "deerflow");
  assert.equal(result.usedMock, false);
  assert.equal((records[0] as { provider: string }).provider, "deerflow");
});

test("generation facade passes policy-aware tool context to provider runner", async () => {
  const { storage, records } = fakeStorage([
    { role: "user", text: "Old user" },
    { role: "assistant", text: "Old assistant" }
  ]);
  let observedToolContext: unknown;
  let observedMessages: unknown[] = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    deerflow: {
      getRuntimeConfig: () => ({ enabled: false, baseUrl: "http://deerflow", assistantId: "lead_agent" })
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

test("generation facade honors clear_context and falls back to mock on provider failure", async () => {
  const { storage, records } = fakeStorage([{ role: "assistant", text: "Should not appear" }]);
  let observedMessages: unknown[] = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    deerflow: {
      getRuntimeConfig: () => ({ enabled: false, baseUrl: "http://deerflow", assistantId: "lead_agent" })
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
