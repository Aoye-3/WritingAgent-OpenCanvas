import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentCards, defaultAgentSettings } from "../agentCards.js";
import { createGenerationService } from "./generationService.js";
import type { AgentRuntimeConfig } from "./agentDefinitionService.js";
import type { ChatClient } from "../providerRuntime.js";
import type { SQLiteStorageRepository } from "../storage.js";
import type { AgentRuntimeAdapter } from "../agentRuntimeAdapter.js";
import type { KnowledgeSearchInput } from "../knowledge/service.js";
import type { ToolEventRecord } from "../toolRuntime.js";
import type { AgentRuntimePort } from "../runtime/agentRuntimePort.js";

function runtimeConfig(): AgentRuntimeConfig {
  const agentCard = agentCards[0];
  const settings = defaultAgentSettings(agentCard);
  return {
    agentCard,
    settings: {
      ...settings,
      tools: { ...settings.tools, clear_context: false }
    },
    availableTools: [],
    enabledTools: agentCard.toolRefs,
    toolPolicies: [],
    missingToolRefs: [],
    deprecatedToolRefs: [],
    availableSkills: [],
    missingSkillRefs: []
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

function answeredAgentClarification() {
  return {
    clarificationId: "skill_clarification_answered",
    selectedOptionId: "recent_focused",
    answer: "Use the recent focused scope."
  };
}

async function archiveMarkdownForTest(threadId: string, virtualPath: string, content: string) {
  const normalized = virtualPath.trim().replace(/\\/g, "/");
  const prefix = "/mnt/user-data/outputs/";
  assert.ok(normalized.startsWith(prefix));
  const relativePath = normalized.slice(prefix.length);
  const appRoot = process.env.FACETWRITE_APP_ROOT ?? ".facetwrite";
  const outputsRoot = path.resolve(process.cwd(), appRoot, "threads", threadId, "user-data", "outputs");
  const localPath = path.resolve(outputsRoot, relativePath);
  assert.ok(localPath.startsWith(`${outputsRoot}${path.sep}`));
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, content, "utf8");
  return {
    path: normalized,
    fileName: path.basename(localPath),
    size: Buffer.byteLength(content, "utf8"),
    localPath
  };
}

function fakeStorage(messages: Array<{ role: "user" | "assistant"; text: string }> = [], contextResetAt?: string) {
  const records: unknown[] = [];
  const agentClarifications: Array<Record<string, unknown>> = [];
  const canvasWriteRequests: unknown[] = [];
  const canvasNodes: Array<Record<string, unknown>> = [];
  const canvasEdges: Array<Record<string, unknown>> = [];
  const planState: Record<string, unknown> = {
    id: "plan_intake_test",
    status: "draft",
    approval: "pending",
    steps: [],
    artifacts: []
  };
  return {
    records,
    agentClarifications,
    canvasWriteRequests,
    canvasNodes,
    canvasEdges,
    planState,
    storage: {
      ensureThread: async () => undefined,
      getThread: () => ({ id: "thread_test", projectId: "project_test", title: "Test", configuredModelApiId: "configured-test", contextResetAt, updatedAt: "" }),
      getProject: () => ({ id: "project_test", title: "Test", summary: "", updatedAt: "" }),
      getProjectRuntimeSettings: () => ({
        runtimeBudgetProfile: "low",
        evidenceToolLimit: 8,
        bodyDraftWriteLimit: 2,
        modelCallLimit: 18,
        recursionLimit: 80,
        synthesisReserveSteps: 16
      }),
      getProjectModelBindings: () => ["configured-test"],
      getProjectSharedContext: () => undefined,
      getProjectBrief: () => ({ brief: {}, revision: 0 }),
      getTaskBrief: () => ({ brief: {}, revision: 0 }),
      createPlanIntake: (_threadId: string, input?: Record<string, unknown>) => {
        Object.assign(planState, input ?? {}, { id: "plan_intake_test" });
        return { id: "plan_intake_test" };
      },
      updatePlanMetadata: (_threadId: string, _planId: string, input: Record<string, unknown>) => {
        Object.assign(planState, input);
        return planState;
      },
      getPlanRun: (_threadId: string, planId: string) => planId === "plan_intake_test"
        ? planState
        : undefined,
      setPlanRunStatus: (_threadId: string, _planId: string, status: string, message = "") => {
        Object.assign(planState, { status, statusMessage: message });
        return planState;
      },
      listPlanRuns: () => [{ id: "plan_intake_test", status: "draft" }],
      updatePlanStep: (_threadId: string, _planId: string, stepId: string, patch: Record<string, unknown>) => {
        const steps = Array.isArray(planState.steps) ? planState.steps as Array<Record<string, unknown>> : [];
        const step = steps.find((item) => item.id === stepId);
        if (!step) return undefined;
        Object.assign(step, patch);
        if (patch.status === "completed") {
          const next = steps.find((item) => item.status === "pending");
          Object.assign(planState, {
            currentStepId: next?.id,
            status: next ? "running" : "completed"
          });
        }
        return step;
      },
      stagePlanArtifact: (_threadId: string, _planId: string, input: Record<string, unknown>) => {
        const artifacts = planState.artifacts as Array<Record<string, unknown>>;
        const existing = artifacts.find((item) => item.artifactId === input.artifactId);
        const artifact = {
          ...existing,
          ...input,
          id: String(input.artifactId),
          planRunId: "plan_intake_test",
          status: "staged"
        };
        if (existing) {
          Object.assign(existing, artifact);
          return existing;
        }
        artifacts.push(artifact);
        return artifact;
      },
      markPlanArtifactCommitted: (_threadId: string, _planId: string, artifactId: string, canvasTargetId: string) => {
        const artifacts = planState.artifacts as Array<Record<string, unknown>>;
        const artifact = artifacts.find((item) => item.artifactId === artifactId || item.id === artifactId);
        if (!artifact) return undefined;
        Object.assign(artifact, { status: "committed", canvasTargetId });
        return artifact;
      },
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
      createCanvasWriteSuggestion: () => ({ id: "suggestion_1", status: "pending" }),
      listAgentClarifications: () => agentClarifications,
      answerAgentClarification: (_threadId: string, clarificationId: string, input: Record<string, unknown>) => {
        const clarification = agentClarifications.find((item) => item.id === clarificationId);
        if (!clarification) return false;
        Object.assign(clarification, input, { status: "answered" });
        return true;
      },
      listCanvasNodes: () => canvasNodes,
      listCanvasEdges: () => canvasEdges,
      createCanvasNode: (_projectId: string, input: Record<string, unknown>) => {
        const node = { ...input, id: input.id ?? `node_${canvasNodes.length + 1}` };
        canvasNodes.push(node);
        return node;
      },
      updateCanvasNode: (_projectId: string, nodeId: string, patch: Record<string, unknown>) => {
        const node = canvasNodes.find((candidate) => candidate.id === nodeId);
        if (!node) return undefined;
        Object.assign(node, patch);
        return node;
      },
      createCanvasEdge: (_projectId: string, input: Record<string, unknown>) => {
        const edge = { ...input, id: input.id ?? `edge_${canvasEdges.length + 1}` };
        canvasEdges.push(edge);
        return edge;
      },
      recordRun: (input: unknown) => {
        records.push(input);
        const record = input as { events?: Array<{ eventType: string; payload: Record<string, unknown> }> };
        for (const event of record.events ?? []) {
          const payload = event.payload ?? {};
          if (event.eventType !== "agent_backend_agent_clarification_requested" && payload.type !== "agent_clarification_requested") continue;
          agentClarifications.push({
            id: String(payload.clarificationId ?? payload.toolCallId ?? `clarification_${agentClarifications.length + 1}`),
            status: "pending",
            question: payload.question,
            options: payload.options,
            resumeContext: payload.resumeContext ?? {}
          });
        }
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

  const result = await service.generateAndRecord({ mode: "structured", locale: "en", agentCardId: "blog-post", clientRequestId: "request_1" });

  assert.equal(result.provider, "agent-backend");
  assert.equal(result.usedMock, false);
  assert.equal(result.completion?.status, "completed");
  assert.equal((records[0] as { provider: string }).provider, "agent-backend");
  assert.equal((records[0] as { configuredModelApiId: string }).configuredModelApiId, "configured-test");
  assert.equal((records[0] as { clientRequestId: string }).clientRequestId, "request_1");
  assert.ok((records[0] as { events: ToolEventRecord[] }).events.some((event) => event.eventType === "completion_evaluated"));
});

test("generation facade blocks internal AgentBackend output without runtime failure", async () => {
  const { storage } = fakeStorage();
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => ({
        text: "LLM request failed: provider rejected reasoning_content",
        finishReason: "agent_backend_completed",
        events: []
      })
    }
  });

  const response = await service.generateAndRecord({ mode: "chat", locale: "en", agentCardId: "chat-agent", freeTextPrompt: "Hello" });

  assert.equal(response.provider, "agent-backend");
  assert.notEqual(response.finishReason, "runtime_failed");
  assert.equal(response.errorMessage, undefined);
  assert.equal(response.text, "");
  const events = response.events ?? [];
  assert.ok(response.completion);
  assert.ok(events.some((event) => event.eventType === "internal_output_blocked"));
  assert.equal(events.some((event) => event.eventType === "agent_backend_runtime_failed"), false);
  assert.notEqual(response.completion.status, "failed");
});

test("generation facade completes blocked internal output when durable delivery exists", async () => {
  const { storage } = fakeStorage();
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => ({
        text: "LLM request failed: provider rejected reasoning_content",
        finishReason: "agent_backend_completed",
        events: [{
          eventType: "canvas_delivery_file_document_committed",
          payload: { title: "Report", status: "committed" }
        }]
      })
    }
  });

  const response = await service.generateAndRecord({ mode: "chat", locale: "en", agentCardId: "chat-agent", freeTextPrompt: "Hello" });

  assert.equal(response.text, "");
  const events = response.events ?? [];
  assert.ok(response.completion);
  assert.equal(response.completion.status, "completed");
  assert.ok(events.some((event) => event.eventType === "internal_output_blocked"));
  assert.equal(events.some((event) => event.eventType === "agent_backend_runtime_failed"), false);
});

test("complex chat automatically enters preflight Plan generation", async () => {
  const { storage, planState } = fakeStorage();
  let observedPlanPhase = "";
  let observedPlanId = "";
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        observedPlanPhase = input.planPhase ?? "";
        observedPlanId = input.planId ?? "";
        Object.assign(planState, {
          status: "awaiting_approval",
          approval: "pending",
          steps: [
            { id: "step_1", title: "Gather evidence", status: "pending" },
            { id: "step_2", title: "Synthesize findings", status: "pending" }
          ]
        });
        return { text: "Plan ready", finishReason: "agent_backend_completed", events: [] };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: "Research agent planning systems and write a report with sources."
  });

  assert.equal(result.provider, "agent-backend");
  assert.equal(observedPlanPhase, "preflight");
  assert.equal(observedPlanId, "plan_intake_test");
  assert.equal(planState.status, "awaiting_approval");
  assert.equal((planState.steps as unknown[]).length, 2);
});

test("slash Plan with research skills keeps Plan clarification ownership", async () => {
  const { storage, planState } = fakeStorage();
  let allowedToolRefs: string[] = [];
  let observedPlanPhase = "";
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        allowedToolRefs = input.allowedToolRefs ?? [];
        observedPlanPhase = input.planGeneration?.phase ?? "";
        Object.assign(planState, {
          status: "awaiting_user",
          clarification: {
            question: "Which literature scope should I use?",
            options: [
              { id: "recent", label: "Recent", description: "Focus on recent Agent papers.", recommended: true },
              { id: "broad", label: "Broad", description: "Cover a broader Agent literature range.", recommended: false }
            ],
            status: "pending"
          }
        });
        return { text: "Which literature scope should I use?", finishReason: "agent_backend_completed", events: [] };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "zh",
    agentCardId: "chat-agent",
    chatInstruction: "/plan 帮我查找最近Agent相关的文献，并且做文献综述。",
    transientSkillRefs: ["database-lookup", "literature-review"]
  });

  assert.equal(result.provider, "agent-backend");
  assert.equal(observedPlanPhase, "intake");
  assert.ok(allowedToolRefs.includes("plan_clarification_submit"));
  assert.notDeepEqual(allowedToolRefs, ["ask_clarification"]);
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

test("generation loads Project and Task Briefs from persisted Thread state", async () => {
  const { storage } = fakeStorage();
  storage.getProjectBrief = () => ({ brief: { goal: "Persisted project goal" }, revision: 2 });
  storage.getTaskBrief = () => ({ brief: { objective: "Persisted task objective", deliverableType: "outline" }, revision: 3 });
  let observedPrompt = "";
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        observedPrompt = input.prompt;
        return { text: "Brief-aware response", finishReason: "stop", events: [] };
      }
    }
  });

  await service.generateAndRecord({ mode: "chat", locale: "en", agentCardId: "chat-agent", chatInstruction: "Continue" });

  assert.match(observedPrompt, /# Project Brief\n- Project goal: Persisted project goal/);
  assert.match(observedPrompt, /# Current Task Brief\n- Task objective: Persisted task objective\n- Expected deliverable: outline/);
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

test("direct Canvas delivery is committed by the server planner without copying assistant chatter", async () => {
  const { storage, canvasWriteRequests, canvasNodes, canvasEdges } = fakeStorage();
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => ({
        text: [
          "新闻搜索和总结已经完成！",
          "我已经通过网络搜索获取了最新新闻，并将详细总结更新到了画板。",
          "",
          "画板内容现在包含：",
          "1. **科技领域** - AI 投资与模型竞争继续升温。",
          "2. **财经市场** - 股市与跨境基金出现波动。",
          "",
          "## 来源",
          "- [News A](https://news.example/a)"
        ].join("\n"),
        finishReason: "stop",
        events: [{
          eventType: "agent_backend_tool_completed",
          payload: {
            toolName: "web_search",
            sources: [{ title: "News A", url: "https://news.example/a" }]
          }
        }]
      })
    }
  });

  const result = await service.generateAndRecord({
    mode: "chat",
    locale: "zh",
    agentCardId: "blog-post",
    chatInstruction: "帮我查最近新闻，然后总结到画板里",
    toolState: { web_search: true }
  });

  assert.equal(result.provider, "agent-backend");
  assert.equal(canvasWriteRequests.length, 0);
  assert.deepEqual(canvasNodes.map((node) => node.title), ["整体概述", "正文", "来源"]);
  assert.equal(String(canvasNodes[1]?.content).includes("新闻搜索和总结已经完成"), false);
  assert.equal(String(canvasNodes[1]?.content).includes("我已经通过网络搜索"), false);
  assert.match(String(canvasNodes[1]?.content), /科技领域/);
  assert.equal(canvasEdges.length, 2);
});

test("non-stream Plan execution commits progressive Canvas delivery before completing the step", async () => {
  const { storage, planState, canvasNodes, records } = fakeStorage();
  Object.assign(planState, {
    projectId: "project_test",
    threadId: "thread_test",
    status: "running",
    approval: "approved",
    currentStepId: "step_1",
    executionVersion: 1,
    steps: [{ id: "step_1", title: "Deliver research", status: "pending", attempt: 0 }],
    artifacts: []
  });
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.({
          eventType: "agent_backend_tool_completed",
          payload: {
            toolName: "web_search",
            sources: [{ title: "News A", url: "https://news.example/a" }]
          }
        });
        return {
          text: [
            "# Result",
            "",
            "The requested research has been completed and written into Canvas.",
            "",
            "## Sources",
            "- [News A](https://news.example/a)"
          ].join("\n"),
          finishReason: "stop",
          events: []
        };
      }
    }
  });

  const result = await service.generateAndRecord({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: "Continue approved plan plan_intake_test. Execute only step step_1.",
    planPhase: "execution",
    planId: "plan_intake_test",
    stepId: "step_1",
    planGeneration: { phase: "execution", planId: "plan_intake_test", stepId: "step_1", phaseAttemptId: "exec_1" },
    contextValues: {
      planExecution: { planId: "plan_intake_test", stepId: "step_1" },
      canvas: { workflow: { mode: "batch_delivery" } }
    },
    toolState: { web_search: true }
  });

  assert.equal(result.provider, "agent-backend");
  assert.ok(canvasNodes.some((node) => node.kind === "document"));
  assert.equal((planState.steps as Array<{ status: string }>)[0]?.status, "completed");
  assert.equal(planState.status, "completed");
  assert.equal((planState.artifacts as Array<{ status: string; canvasTargetId?: string }>)[0]?.status, "committed");
  assert.ok((planState.artifacts as Array<{ status: string; canvasTargetId?: string }>)[0]?.canvasTargetId);
  const recordedEvents = ((records[0] as { events?: Array<{ eventType: string; payload: Record<string, unknown> }> })?.events ?? []);
  const researchEvent = recordedEvents.find((event) => event.eventType === "canvas_delivery_research_committed");
  assert.ok(researchEvent);
  assert.equal(researchEvent.payload.researchIndex, 1);
  assert.equal(researchEvent.payload.evidenceCount, 1);
  assert.equal(researchEvent.payload.bodyDraftWriteLimit, 2);
  assert.equal(researchEvent.payload.evidenceToolLimit, 8);
  assert.equal(researchEvent.payload.nextPhaseHint, "body_checkpoint");
});

test("direct Canvas delivery treats process clarification text as recoverable output", async () => {
  const { storage, canvasNodes, records } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => ({
        text: "I've loaded the Systematic Literature Review skill. Let me clarify a few things before proceeding.",
        finishReason: "agent_backend_completed",
        events: []
      })
    }
  });

  const result = await service.generateAndRecord({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: "Review recent agent literature and organize the results in Canvas.",
    transientSkillRefs: ["literature-review"],
    contextValues: { agentClarification: answeredAgentClarification() },
    toolState: { web_search: true }
  }, (event) => events.push(event as typeof events[number]));

  assert.equal(result.provider, "agent-backend");
  assert.equal(result.text.includes("Let me clarify"), false);
  assert.equal(records.length, 1);
  assert.equal(canvasNodes.length, 1);
  assert.equal(canvasNodes[0]?.title, "Clarification needed");
  assert.equal(String(canvasNodes[0]?.content).includes("Let me clarify"), false);
  assert.equal(events.some((event) => event.eventType === "agent_backend_runtime_failed"), false);
});

test("direct Canvas delivery fails without creating nodes when AgentBackend returns no content", async () => {
  const { storage, canvasNodes, records } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => ({
        text: "",
        finishReason: "agent_backend_completed",
        events: []
      })
    }
  });

  await assert.rejects(
    () => service.generateAndRecord({
      mode: "chat",
      locale: "zh",
      agentCardId: "chat-agent",
      chatInstruction: "帮我总结一下最新的Macbook和上一代之间的区别，我想选一个买。把相关信息整理到Canvas里",
      toolState: { web_search: true }
    }, (event) => events.push(event as typeof events[number])),
    /no visible assistant text or structured lifecycle events/i
  );

  assert.equal(canvasNodes.length, 0);
  assert.equal(records.length, 0);
  assert.ok(events.some((event) => event.eventType === "agent_backend_runtime_failed" && event.payload.fallback === "none"));
});

test("streaming direct Canvas delivery keeps progressive placeholders when AgentBackend returns no content", async () => {
  const { storage, canvasNodes, records } = fakeStorage();
  const tokens: string[] = [];
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => ({
        text: "",
        finishReason: "agent_backend_completed",
        events: []
      })
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "zh",
    agentCardId: "chat-agent",
    chatInstruction: "\u628a\u76f8\u5173\u4fe1\u606f\u6574\u7406\u5230Canvas\u91cc",
    toolState: { web_search: true }
  }, {
    onToken: (token) => tokens.push(token),
    onToolEvent: (event) => events.push(event as typeof events[number])
  });

  assert.equal(tokens.join(""), "");
  assert.equal(result.provider, "agent-backend");
  assert.equal(result.usedMock, false);
  assert.equal(result.completion?.status, "failed");
  assert.match(result.errorMessage ?? "", /no visible assistant text or structured lifecycle events/i);
  assert.equal(canvasNodes.length, 3);
  assert.ok(canvasNodes.some((node) => node.metadata && (node.metadata as { phase?: string }).phase === "outline"));
  assert.ok(canvasNodes.some((node) => node.metadata && (node.metadata as { phase?: string }).phase === "body"));
  assert.ok(canvasNodes.some((node) => node.metadata && (node.metadata as { phase?: string }).phase === "failure"));
  assert.equal(records.length, 1);
  assert.ok(events.some((event) => event.eventType === "canvas_delivery_outline_committed"));
  assert.ok(events.some((event) => event.eventType === "canvas_delivery_failed_summary_committed"));
  assert.ok(events.some((event) => event.eventType === "agent_backend_runtime_failed" && event.payload.fallback === "none"));
});

test("streaming direct Canvas delivery commits a link-only research reference after search sources", async () => {
  const { storage, canvasNodes, records } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.({
          eventType: "agent_backend_tool_completed",
          payload: {
            toolName: "web_search",
            query: "LLM agent survey 2025",
            sources: [{ title: "Agent Survey", url: "https://example.com/agent-survey", snippet: "A survey of LLM agents." }]
          }
        });
        throw new Error("Recursion limit of 100 reached without hitting a stop condition.");
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "zh",
    agentCardId: "chat-agent",
    chatInstruction: "\u9605\u8bfb\u6280\u672f\u6587\u6863\uff0c\u628a\u6bcf\u8f6e\u641c\u7d22\u548c\u67e5\u627e\u7684\u7ed3\u679c\u5b58\u5230\u753b\u5e03\uff0c\u6700\u540e\u751f\u6210\u6574\u4f53\u6982\u8ff0\u8282\u70b9",
    toolState: { web_search: true }
  }, {
    onToolEvent: (event) => events.push(event as typeof events[number])
  });

  assert.equal(result.completion?.status, "failed");
  assert.match(result.errorMessage ?? "", /Recursion limit of 100 reached/);
  assert.equal(records.length, 1);
  const researchNode = canvasNodes.find((node) => node.title === "\u7814\u7a76\u6458\u5f55 1");
  assert.ok(researchNode);
  assert.ok(String(researchNode.content).includes("[Agent Survey](https://example.com/agent-survey)"));
  assert.equal(String(researchNode.content).includes("LLM agent survey 2025"), false);
  assert.equal(String(researchNode.content).includes("\u5de5\u5177"), false);
  assert.equal(String(researchNode.content).includes("\u67e5\u8be2"), false);
  assert.equal(String(researchNode.content).includes("URL:"), false);
  assert.equal(String(researchNode.content).includes("A survey of LLM agents."), false);
  const bodyNode = canvasNodes.find((node) => node.title === "\u6b63\u6587\u8349\u7a3f");
  assert.ok(bodyNode);
  assert.ok(String(bodyNode.content).includes("\u5de5\u4f5c\u6b63\u6587\u8349\u7a3f"));
  assert.equal(String(bodyNode.content).includes("\u6b63\u5728\u751f\u6210\u5185\u5bb9"), false);
  const researchEvent = events.find((event) => event.eventType === "canvas_delivery_research_committed");
  assert.ok(researchEvent);
  assert.equal(researchEvent.payload.researchIndex, 1);
  assert.equal(researchEvent.payload.evidenceCount, 1);
  assert.equal(researchEvent.payload.bodyDraftWriteCount, 0);
  assert.equal(researchEvent.payload.bodyDraftWriteLimit, 2);
  assert.equal(researchEvent.payload.evidenceToolLimit, 8);
  assert.equal(researchEvent.payload.nextPhaseHint, "body_checkpoint");
  const bodyCheckpointEvent = events.find((event) => event.eventType === "canvas_delivery_body_checkpoint_committed");
  assert.ok(bodyCheckpointEvent);
  assert.equal(bodyCheckpointEvent.payload.evidenceCount, 1);
  assert.equal(bodyCheckpointEvent.payload.bodyDraftWriteCount, 1);
  assert.equal(bodyCheckpointEvent.payload.bodyDraftWriteLimit, 2);
  assert.equal(bodyCheckpointEvent.payload.evidenceToolLimit, 8);
  assert.equal(bodyCheckpointEvent.payload.nextPhaseHint, "continue_research");
});

test("streaming direct Canvas delivery skips research references when search has no linked sources", async () => {
  const { storage, canvasNodes, records } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.({
          eventType: "agent_backend_tool_completed",
          payload: {
            toolName: "web_search",
            query: "LLM agent survey 2025",
            summary: "Search completed, but no displayable source URLs were returned."
          }
        });
        throw new Error("Recursion limit of 100 reached without hitting a stop condition.");
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "zh",
    agentCardId: "chat-agent",
    chatInstruction: "\u9605\u8bfb\u6280\u672f\u6587\u6863\uff0c\u628a\u6bcf\u8f6e\u641c\u7d22\u548c\u67e5\u627e\u7684\u7ed3\u679c\u5b58\u5230\u753b\u5e03\uff0c\u6700\u540e\u751f\u6210\u6574\u4f53\u6982\u8ff0\u8282\u70b9",
    toolState: { web_search: true }
  }, {
    onToolEvent: (event) => events.push(event as typeof events[number])
  });

  assert.equal(result.completion?.status, "failed");
  assert.match(result.errorMessage ?? "", /Recursion limit of 100 reached/);
  assert.equal(records.length, 1);
  assert.equal(canvasNodes.some((node) => node.title === "\u7814\u7a76\u6458\u5f55 1"), false);
  assert.equal(canvasNodes.some((node) => String(node.content).includes("Search completed")), false);
  assert.equal(events.some((event) => event.eventType === "canvas_delivery_research_committed"), false);
  assert.equal(events.some((event) => event.eventType === "canvas_delivery_body_checkpoint_committed"), false);
});

test("streaming direct Canvas delivery dedupes repeated research evidence keys", async () => {
  const { storage, canvasNodes } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        for (let index = 0; index < 2; index += 1) {
          input.onToolEvent?.({
            eventType: "agent_backend_tool_completed",
            payload: {
              toolName: "web_search",
              query: "LLM agent survey 2025",
              sources: [{ title: "Agent Survey", url: "https://example.com/agent-survey" }]
            }
          });
        }
        throw new Error("Recursion limit of 100 reached without hitting a stop condition.");
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "zh",
    agentCardId: "chat-agent",
    chatInstruction: "\u9605\u8bfb\u6280\u672f\u6587\u6863\uff0c\u628a\u6bcf\u8f6e\u641c\u7d22\u548c\u67e5\u627e\u7684\u7ed3\u679c\u5b58\u5230\u753b\u5e03\uff0c\u6700\u540e\u751f\u6210\u6574\u4f53\u6982\u8ff0\u8282\u70b9",
    toolState: { web_search: true }
  }, {
    onToolEvent: (event) => events.push(event as typeof events[number])
  });

  assert.equal(result.completion?.status, "failed");
  assert.match(result.errorMessage ?? "", /Recursion limit of 100 reached/);
  assert.equal(canvasNodes.filter((node) => String(node.title).startsWith("\u7814\u7a76\u6458\u5f55")).length, 1);
  assert.equal(events.filter((event) => event.eventType === "canvas_delivery_research_committed").length, 1);
});

test("streaming skill long task creates Canvas progress without explicit Canvas wording", async () => {
  const { storage, canvasNodes, records } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.({
          eventType: "agent_backend_tool_completed",
          payload: {
            toolName: "read_file",
            path: "/mnt/skills/public/writing-review/literature-review/SKILL.md",
            snippet: "# Literature Review\nInternal workflow guidance"
          }
        });
        input.onToolEvent?.({
          eventType: "agent_backend_tool_completed",
          payload: {
            toolName: "web_search",
            query: "parallel-cli candidate papers",
            summary: "parallel-cli search completed with 10 candidate papers",
            sources: [{ title: "Candidate papers", url: "https://example.com/candidate-papers" }]
          }
        });
        throw new Error("Recursion limit of 100 reached without hitting a stop condition.");
      }
    }
  });

  const result = await service.generateAndRecordStream({
      mode: "chat",
      locale: "zh",
      agentCardId: "chat-agent",
      chatInstruction: "帮我查找最近Agent相关的文献，并且做文献综述",
      transientSkillRefs: ["database-lookup", "literature-review"],
      modelOverrides: { thinkingMode: "enabled" },
      contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, agentClarification: answeredAgentClarification() },
      toolState: { web_search: true }
    }, {
      onToolEvent: (event) => events.push(event as typeof events[number])
  });

  assert.equal(result.completion?.status, "failed");
  assert.match(result.errorMessage ?? "", /Recursion limit of 100 reached/);
  assert.equal(records.length, 1);
  assert.ok(canvasNodes.some((node) => node.title === "整体概述"));
  assert.ok(canvasNodes.some((node) => node.title === "正文"));
  assert.equal(canvasNodes.some((node) => String(node.content).includes("literature-review/SKILL.md")), false);
  assert.equal(canvasNodes.some((node) => String(node.content).includes("/mnt/skills/")), false);
  assert.equal(canvasNodes.some((node) => node.title === "进度摘录 2"), false);
  const progressNode = canvasNodes.find((node) => node.title === "进度摘录 1");
  assert.ok(progressNode);
  assert.ok(String(progressNode.content).includes("[Candidate papers](https://example.com/candidate-papers)"));
  assert.equal(String(progressNode.content).includes("parallel-cli search completed"), false);
  assert.equal(String(progressNode.content).includes("Tool:"), false);
  assert.equal(String(progressNode.content).includes("Query:"), false);
  assert.ok(canvasNodes.some((node) => node.title === "运行失败" && String(node.content).includes("Recursion limit of 100 reached")));
  assert.ok(events.some((event) => event.eventType === "canvas_delivery_outline_committed"));
  assert.ok(events.some((event) => event.eventType === "canvas_delivery_research_committed"));
  assert.ok(events.some((event) => event.eventType === "canvas_delivery_body_checkpoint_committed"));
  assert.ok(events.some((event) => event.eventType === "canvas_delivery_failed_summary_committed"));
});

test("streaming short Q&A stays conversation-only even when skills are enabled", async () => {
  const { storage, canvasNodes, records } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => ({
        text: "Mutex is a synchronization primitive that protects shared state.",
        finishReason: "agent_backend_completed",
        events: []
      })
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: "What is a mutex?",
    transientSkillRefs: ["database-lookup", "literature-review"],
    modelOverrides: { thinkingMode: "enabled" },
    contextValues: { canvas: { workflow: { mode: "batch_delivery" } } }
  }, {
    onToolEvent: (event) => events.push(event as typeof events[number])
  });

  assert.equal(result.usedMock, false);
  assert.equal(records.length, 1);
  assert.equal(canvasNodes.length, 0);
  assert.equal(events.some((event) => event.eventType.startsWith("canvas_delivery_")), false);
});

test("skill scope guard lets AgentBackend ask clarification before vague Chinese literature search", async () => {
  const { storage, canvasNodes, records } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const timelineEvents: Array<{ status: string; payload?: Record<string, unknown> }> = [];
  let agentCalled = false;
  let allowedToolRefs: string[] = [];
  let observedContextValues: Record<string, unknown> = {};
  const originalInstruction = "\u5e2e\u6211\u67e5\u627e\u6700\u8fd1 Agent \u76f8\u5173\u7684\u6587\u732e\uff0c\u5e76\u4e14\u505a\u6587\u732e\u7efc\u8ff0\u3002";
  const clarificationEvent: ToolEventRecord = {
    eventType: "agent_backend_agent_clarification_requested",
    payload: {
      type: "agent_clarification_requested",
      toolCallId: "runtime_clarification_1",
      clarificationId: "runtime_clarification_1",
      question: "Which Agent literature scope should I review?",
      options: [
        { id: "recent_review", label: "\u8fd1\u4e24\u5e74\u7efc\u8ff0", detail: "Focus on 2025-2026 representative papers.", recommended: true },
        { id: "broad_scan", label: "\u5e7f\u6cdb\u626b\u63cf", detail: "Cover a wider time range and topic set." }
      ]
    }
  };
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        agentCalled = true;
        allowedToolRefs = input.allowedToolRefs ?? [];
        observedContextValues = input.contextValues ?? {};
        input.onToolEvent?.(clarificationEvent);
        return {
          text: "",
          finishReason: "clarification_required",
          events: [clarificationEvent]
        };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "zh",
    agentCardId: "chat-agent",
    chatInstruction: originalInstruction,
    transientSkillRefs: ["database-lookup", "literature-review"],
    runtimeBudgetProfile: "high",
    contextValues: { canvas: { workflow: { mode: "batch_delivery" } } },
    toolState: { web_search: true }
  }, {
    onToolEvent: (event) => events.push(event as typeof events[number]),
    onTimelineEvent: (event) => timelineEvents.push(event)
  });

  assert.equal(agentCalled, true);
  assert.deepEqual(allowedToolRefs, ["ask_clarification"]);
  assert.equal((observedContextValues.facetwrite_clarification_policy as { mode?: string }).mode, "skill_scope_guard");
  assert.equal(records.length, 1);
  assert.equal(result.finishReason, "clarification_required");
  assert.equal(canvasNodes.length, 0);
  assert.ok(events.some((event) => event.eventType === "agent_backend_agent_clarification_requested"));
  assert.equal(events.some((event) => event.eventType === "agent_backend_tool_started"), false);
  assert.equal(events.some((event) => event.eventType === "agent_backend_tool_completed"), false);
  assert.equal(events.some((event) => event.eventType.startsWith("canvas_delivery_")), false);
  const clarification = events.find((event) => event.eventType === "agent_backend_agent_clarification_requested");
  const resumeContext = clarification?.payload.resumeContext as Record<string, unknown> | undefined;
  assert.equal(resumeContext?.originalInstruction, originalInstruction);
  assert.deepEqual(resumeContext?.transientSkillRefs, ["database-lookup", "literature-review"]);
  assert.equal(resumeContext?.runtimeBudgetProfile, "high");
  assert.deepEqual((resumeContext?.canvas as { workflow?: unknown } | undefined)?.workflow, { mode: "batch_delivery" });
  const timelineClarification = timelineEvents.find((event) => event.payload?.eventType === "agent_backend_agent_clarification_requested");
  assert.equal(timelineClarification?.status, "waiting");
});

test("clarification-required AgentBackend run is waiting and deduplicates repeated clarification events", async () => {
  const { storage, records } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const timelineEvents: Array<{ eventType: string; status: string; payload?: Record<string, unknown> }> = [];
  const clarificationEvent: ToolEventRecord = {
    eventType: "agent_backend_agent_clarification_requested",
    payload: {
      type: "agent_clarification_requested",
      toolCallId: "call_reused",
      question: "Which time range should the review cover?",
      options: [
        { id: "recent_3", label: "Recent 3 years", detail: "2023-2026", recommended: true },
        { id: "recent_5", label: "Recent 5 years", detail: "2021-2026" }
      ]
    }
  };
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.(clarificationEvent);
        return {
          text: "",
          finishReason: "clarification_required",
          events: [clarificationEvent]
        };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: "Review recent agent literature",
    transientSkillRefs: ["literature-review"],
    toolState: { web_search: true }
  }, {
    onToolEvent: (event) => events.push(event as typeof events[number]),
    onTimelineEvent: (event) => timelineEvents.push(event)
  });

  assert.equal(result.finishReason, "clarification_required");
  assert.equal(records.length, 1);
  const record = records[0] as { finishReason?: string; events?: Array<{ eventType: string }> };
  assert.equal(record.finishReason, "clarification_required");
  assert.equal(record.events?.filter((event) => event.eventType === "agent_backend_agent_clarification_requested").length, 1);
  assert.equal(record.events?.some((event) => event.eventType === "run_timeline_run_completed"), false);
  assert.equal(timelineEvents.some((event) => event.eventType === "run_completed"), false);
  assert.equal(timelineEvents.find((event) => event.payload?.eventType === "agent_backend_agent_clarification_requested")?.status, "waiting");
  assert.equal(events.filter((event) => event.eventType === "agent_backend_agent_clarification_requested").length, 1);
});

test("clarification dedupe preserves runtime resume metadata for storage", async () => {
  const { storage, records, agentClarifications } = fakeStorage();
  const question = "Which time range should the review cover?";
  const options = [
    { id: "recent_5", label: "Recent 5 years", detail: "2021-2026", recommended: true },
    { id: "recent_10", label: "Recent 10 years", detail: "2016-2026" }
  ];
  const toolCallEvent: ToolEventRecord = {
    eventType: "agent_backend_agent_clarification_requested",
    payload: {
      type: "agent_clarification_requested",
      source: "ask_clarification",
      toolName: "ask_clarification",
      toolCallId: "call_reused",
      question,
      options
    }
  };
  const runtimeInterruptEvent: ToolEventRecord = {
    eventType: "agent_backend_agent_clarification_requested",
    payload: {
      type: "agent_clarification_requested",
      source: "runtime_interrupt",
      toolName: "ask_clarification",
      toolCallId: "interrupt_1",
      question,
      options,
      resumeContext: {
        runtimeResume: {
          runtimeThreadId: "runtime_thread_1",
          runtimeRunId: "runtime_run_1",
          interruptId: "interrupt_1",
          checkpointId: "checkpoint_1"
        }
      }
    }
  };
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.(toolCallEvent);
        input.onToolEvent?.(runtimeInterruptEvent);
        return {
          text: "",
          finishReason: "clarification_required",
          events: [toolCallEvent, runtimeInterruptEvent]
        };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: "Review recent agent literature",
    transientSkillRefs: ["literature-review"],
    toolState: { web_search: true }
  });

  assert.equal(result.finishReason, "clarification_required");
  const record = records[0] as { events?: Array<{ eventType: string; payload: Record<string, unknown> }> };
  const clarifications = record.events?.filter((event) => event.eventType === "agent_backend_agent_clarification_requested") ?? [];
  assert.equal(clarifications.length, 1);
  assert.equal(clarifications[0]?.payload.source, "runtime_interrupt");
  assert.deepEqual((clarifications[0]?.payload.resumeContext as Record<string, unknown> | undefined)?.runtimeResume, {
    runtimeThreadId: "runtime_thread_1",
    runtimeRunId: "runtime_run_1",
    interruptId: "interrupt_1",
    checkpointId: "checkpoint_1"
  });
  assert.equal(agentClarifications.length, 1);
  assert.deepEqual((agentClarifications[0]?.resumeContext as Record<string, unknown> | undefined)?.runtimeResume, {
    runtimeThreadId: "runtime_thread_1",
    runtimeRunId: "runtime_run_1",
    interruptId: "interrupt_1",
    checkpointId: "checkpoint_1"
  });
});

test("invalid Agent clarification options are repaired by retrying ask_clarification", async () => {
  const { storage, records } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  let calls = 0;
  let repairPolicy: Record<string, unknown> | undefined;
  const invalidEvent: ToolEventRecord = {
    eventType: "agent_backend_agent_clarification_invalid",
    payload: {
      type: "agent_clarification_invalid",
      toolName: "ask_clarification",
      toolCallId: "call_bad_options",
      status: "failed",
      reason: "too_many_options",
      hasQuestion: true,
      optionCount: 4,
      summary: "Agent clarification payload was invalid"
    }
  };
  const repairedEvent: ToolEventRecord = {
    eventType: "agent_backend_agent_clarification_requested",
    payload: {
      type: "agent_clarification_requested",
      toolName: "ask_clarification",
      toolCallId: "call_repaired_options",
      question: "Which citation format should I use?",
      options: [
        { id: "apa", label: "APA 7th", detail: "Author-date references.", recommended: true },
        { id: "ieee", label: "IEEE", detail: "Numbered engineering references." }
      ]
    }
  };
  const runtime: AgentRuntimePort = {
    providerId: "agent-backend",
    run: async (input) => {
      calls += 1;
      if (calls === 1) {
        input.onToolEvent?.(invalidEvent);
        return { text: "", finishReason: "clarification_required", events: [invalidEvent] };
      }
      repairPolicy = input.payload.contextValues?.facetwrite_clarification_policy as Record<string, unknown> | undefined;
      input.onToolEvent?.(repairedEvent);
      return { text: "", finishReason: "clarification_required", events: [repairedEvent] };
    },
    getStatus: async () => ({}),
    getConfigOverview: async () => ({}),
    getDashboard: async () => ({})
  };
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentRuntime: runtime
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: "Review recent agent literature",
    transientSkillRefs: ["literature-review"],
    toolState: { web_search: true }
  }, {
    onToolEvent: (event) => events.push(event as typeof events[number])
  });

  assert.equal(calls, 2);
  assert.equal(result.finishReason, "clarification_required");
  assert.equal(repairPolicy?.source, "server_clarification_repair");
  assert.equal(repairPolicy?.invalidReason, "too_many_options");
  assert.equal(repairPolicy?.invalidOptionCount, 4);
  assert.equal(events.some((event) => event.eventType === "agent_backend_agent_clarification_invalid"), false);
  assert.equal(events.filter((event) => event.eventType === "agent_backend_agent_clarification_requested").length, 1);
  assert.equal(records.length, 1);
  const record = records[0] as { events?: Array<{ eventType: string }> };
  assert.equal(record.events?.some((event) => event.eventType === "agent_backend_agent_clarification_invalid"), false);
  assert.equal(record.events?.filter((event) => event.eventType === "agent_backend_agent_clarification_requested").length, 1);
});

test("answered Agent clarification preserves resume context for follow-up clarification", async () => {
  const { storage, records } = fakeStorage();
  const originalInstruction = "Review recent Agent literature and write a survey.";
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => ({
        text: "",
        finishReason: "clarification_required",
        events: [{
          eventType: "agent_backend_agent_clarification_requested",
          payload: {
            type: "agent_clarification_requested",
            toolCallId: "call_time_range",
            question: "Which time range should the review cover?",
            options: [
              { id: "recent_3", label: "Recent 3 years", detail: "2023-2026", recommended: true },
              { id: "recent_5", label: "Recent 5 years", detail: "2021-2026" }
            ]
          }
        }]
      })
    }
  });

  await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: `${originalInstruction}\n\nSelected clarification: Multi-agent systems`,
    transientSkillRefs: ["database-lookup", "literature-review"],
    runtimeBudgetProfile: "high",
    contextValues: {
      canvas: { workflow: { mode: "batch_delivery" } },
      agentClarification: {
        clarificationId: "agent_clarification_scope",
        originalInstruction,
        selectedOptionId: "multi_agent",
        answer: "Multi-agent systems"
      }
    },
    toolState: { web_search: true }
  });

  const record = records[0] as { events?: Array<{ eventType: string; payload: Record<string, unknown> }> };
  const clarification = record.events?.find((event) => event.eventType === "agent_backend_agent_clarification_requested");
  const resumeContext = clarification?.payload.resumeContext as Record<string, unknown> | undefined;
  assert.equal(resumeContext?.originalInstruction, originalInstruction);
  assert.deepEqual(resumeContext?.transientSkillRefs, ["database-lookup", "literature-review"]);
  assert.equal(resumeContext?.runtimeBudgetProfile, "high");
  assert.deepEqual((resumeContext?.canvas as { workflow?: unknown } | undefined)?.workflow, { mode: "batch_delivery" });
});

test("answered intake clarification keeps research skills in clarification guard until scope is sufficient", async () => {
  const { storage } = fakeStorage();
  let allowedToolRefs: string[] = [];
  let observedContextValues: Record<string, unknown> = {};
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        allowedToolRefs = input.allowedToolRefs ?? [];
        observedContextValues = input.contextValues ?? {};
        return {
          text: "",
          finishReason: "clarification_required",
          events: [{
            eventType: "agent_backend_agent_clarification_requested",
            payload: {
              type: "agent_clarification_requested",
              toolCallId: "call_format",
              question: "Which citation format should I use?",
              options: [
                { id: "apa", label: "APA 7", detail: "Use APA 7th edition.", recommended: true },
                { id: "ieee", label: "IEEE", detail: "Use numeric IEEE citations." }
              ]
            }
          }]
        };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    threadId: "thread_test",
    agentCardId: "chat-agent",
    chatInstruction: "Review recent Agent literature\n\nSelected clarification: Multi-agent systems",
    transientSkillRefs: ["database-lookup", "literature-review"],
    contextValues: {
      canvas: { workflow: { mode: "batch_delivery" } },
      agentClarification: {
        clarificationId: "agent_clarification_scope",
        question: "Which Agent scope?",
        selectedOptionId: "multi_agent",
        answer: "Multi-agent systems",
        option: { id: "multi_agent", label: "Multi-agent systems", detail: "Coordination and workflows." }
      }
    },
    toolState: { web_search: true, knowledge_base: true }
  });

  assert.equal(result.finishReason, "clarification_required");
  assert.deepEqual(allowedToolRefs, ["ask_clarification"]);
  const policy = observedContextValues.facetwrite_clarification_policy as Record<string, unknown>;
  assert.equal(policy.mode, "skill_scope_guard");
  assert.equal(policy.intakeState, "intake_collecting");
  assert.equal(policy.intakeRound, 2);
  assert.match(String(policy.answeredSummary), /Multi-agent systems/);
});

test("answered intake slot suppresses repeated citation-format clarification from backend", async () => {
  const { storage, agentClarifications, records } = fakeStorage();
  let observedContextValues: Record<string, unknown> = {};
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        observedContextValues = input.contextValues ?? {};
        return {
          text: "",
          finishReason: "clarification_required",
          events: [{
            eventType: "agent_backend_agent_clarification_requested",
            payload: {
              type: "agent_clarification_requested",
              toolCallId: "call_citation_repeat",
              question: "Which citation style should I use?",
              options: [
                { id: "ieee", label: "IEEE", detail: "Use IEEE numeric citations." },
                { id: "apa", label: "APA 7", detail: "Use APA 7th edition.", recommended: true },
                { id: "nature", label: "Nature", detail: "Use Nature style." }
              ]
            }
          }]
        };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    threadId: "thread_test",
    agentCardId: "chat-agent",
    chatInstruction: "Prepare a bibliography about autonomous workflows.\n\nSelected clarification: APA 7",
    transientSkillRefs: ["database-lookup", "literature-review"],
    contextValues: {
      agentClarification: {
        clarificationId: "agent_clarification_citation",
        question: "Which citation format should the review use?",
        selectedOptionId: "apa",
        answer: "APA 7",
        option: { id: "apa", label: "APA 7", detail: "Use APA 7th edition." },
        resumeContext: {
          intakeRound: 1,
          answeredSummary: "Citation format: APA 7"
        }
      }
    },
    toolState: { web_search: true, knowledge_base: true }
  });

  const policy = observedContextValues.facetwrite_clarification_policy as Record<string, unknown>;
  assert.deepEqual(policy.answeredSlots, ["citation_format"]);
  assert.equal((policy.missingSlots as string[]).includes("citation format"), false);
  assert.equal(result.finishReason, "clarification_required");
  assert.equal(agentClarifications.length, 0);
  const record = records[0] as { events?: Array<{ eventType: string; payload: Record<string, unknown> }> };
  assert.ok(record.events?.some((event) => event.eventType === "agent_backend_duplicate_clarification_suppressed"));
});

test("agent intake suppresses equivalent answered clarification without runtime slot id", async () => {
  const { storage, agentClarifications, records } = fakeStorage();
  let calls = 0;
  const firstClarification: ToolEventRecord = {
    eventType: "agent_backend_agent_clarification_requested",
    payload: {
      type: "agent_clarification_requested",
      toolCallId: "call_citation_initial",
      clarificationId: "call_citation_initial",
      question: "Which citation format should I use?",
      options: [
        { id: "apa", label: "APA 7", detail: "Use APA 7th edition.", recommended: true },
        { id: "ieee", label: "IEEE", detail: "Use IEEE numeric citations." }
      ]
    }
  };
  const repeatedClarification: ToolEventRecord = {
    eventType: "agent_backend_agent_clarification_requested",
    payload: {
      type: "agent_clarification_requested",
      toolCallId: "call_citation_repeat",
      clarificationId: "call_citation_repeat",
      question: "Which citation style should the bibliography use?",
      options: [
        { id: "apa", label: "APA 7", detail: "Use APA 7th edition.", recommended: true },
        { id: "ieee", label: "IEEE", detail: "Use IEEE numeric citations." }
      ]
    }
  };
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        calls += 1;
        const event = calls === 1 ? firstClarification : repeatedClarification;
        input.onToolEvent?.(event);
        return {
          text: "",
          finishReason: "clarification_required",
          events: [event]
        };
      }
    }
  });

  const first = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    threadId: "thread_intake_repeat",
    agentCardId: "chat-agent",
    chatInstruction: "Prepare a bibliography about autonomous workflows.",
    transientSkillRefs: ["database-lookup", "literature-review"],
    toolState: { web_search: true, knowledge_base: true }
  });

  assert.equal(first.finishReason, "clarification_required");
  assert.equal(agentClarifications.length, 1);
  assert.equal(agentClarifications[0]?.status, "pending");

  const second = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    threadId: "thread_intake_repeat",
    agentCardId: "chat-agent",
    chatInstruction: "Prepare a bibliography about autonomous workflows.\n\nSelected clarification: APA 7",
    transientSkillRefs: ["database-lookup", "literature-review"],
    contextValues: {
      agentClarification: {
        clarificationId: "call_citation_initial",
        question: "Which citation format should I use?",
        selectedOptionId: "apa",
        answer: "APA 7",
        option: { id: "apa", label: "APA 7", detail: "Use APA 7th edition." },
        resumeContext: {
          intakeRound: 1,
          answeredSummary: "Citation format: APA 7"
        }
      }
    },
    toolState: { web_search: true, knowledge_base: true }
  });

  assert.equal(second.finishReason, "clarification_required");
  assert.equal(agentClarifications.length, 1);
  assert.equal(agentClarifications[0]?.status, "answered");
  const secondRecord = records.at(-1) as { events?: Array<{ eventType: string; payload: Record<string, unknown> }> };
  assert.ok(secondRecord.events?.some((event) => event.eventType === "agent_backend_duplicate_clarification_suppressed"));
  assert.equal(secondRecord.events?.some((event) => event.eventType === "agent_backend_agent_clarification_requested"), false);
});

test("research skill answered clarification stays in intake until completion", async () => {
  const { storage } = fakeStorage();
  let allowedToolRefs: string[] = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        allowedToolRefs = input.allowedToolRefs ?? [];
        return {
          text: "Continuing with the scoped literature review.",
          finishReason: "agent_backend_completed",
          events: []
        };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    threadId: "thread_test",
    agentCardId: "chat-agent",
    chatInstruction: [
      "Review recent Agent literature.",
      "",
      "Selected clarification: Multi-agent systems",
      "Selected clarification: 2023-2026",
      "Selected clarification: 30 papers, APA format"
    ].join("\n"),
    transientSkillRefs: ["database-lookup", "literature-review"],
    contextValues: {
      agentClarification: {
        clarificationId: "agent_clarification_format",
        selectedOptionId: "format_apa",
        answer: "30 papers, APA format",
        resumeContext: {
          intakeRound: 3,
          answeredSummary: "Scope: Multi-agent systems; Time range: 2023-2026; Format: 30 papers, APA format"
        }
      }
    },
    toolState: { web_search: true, knowledge_base: true }
  });

  assert.equal(result.finishReason, "agent_backend_completed");
  assert.deepEqual(allowedToolRefs, ["ask_clarification", "agent_intake_complete"]);
});

test("clarification process narration with appended sources is not recorded as assistant body text", async () => {
  const { storage, records } = fakeStorage();
  const clarificationEvent: ToolEventRecord = {
    eventType: "agent_backend_agent_clarification_requested",
    payload: {
      type: "agent_clarification_requested",
      toolName: "ask_clarification",
      toolCallId: "call_scope",
      question: "Could you confirm the review scope?",
      options: [
        { id: "medium_20_apa", label: "20 papers, APA format", detail: "Moderate scope.", recommended: true },
        { id: "full_30_apa", label: "30 papers, APA format", detail: "Fuller scope." }
      ]
    }
  };
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.({
          eventType: "agent_backend_tool_completed",
          payload: {
            type: "tool_completed",
            toolName: "web_search",
            sources: [{ title: "Paper A", url: "https://example.com/a" }]
          }
        });
        input.onToolEvent?.(clarificationEvent);
        return {
          text: "Now I have the full skill. Let me proceed with Phase 1 by clarifying the scope and format with the user.",
          finishReason: "agent_backend_completed",
          events: [clarificationEvent]
        };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    threadId: "thread_test",
    agentCardId: "chat-agent",
    chatInstruction: "Review recent Agent literature",
    transientSkillRefs: ["literature-review"],
    contextValues: { agentClarification: answeredAgentClarification() },
    toolState: { web_search: true }
  });

  assert.equal(result.finishReason, "clarification_required");
  assert.equal(result.text, "");
  assert.equal((records[0] as { output: string }).output, "");
});

test("answered Agent clarification falls back to matching pending question when ids differ", async () => {
  const { storage, agentClarifications } = fakeStorage();
  agentClarifications.push({
    id: "agent_clarification_stable_hash",
    status: "pending",
    question: "Which time range should the review cover?",
    options: [
      { id: "recent_3", label: "Recent 3 years", detail: "2023-2026", recommended: true },
      { id: "recent_5", label: "Recent 5 years", detail: "2021-2026", recommended: false }
    ],
    resumeContext: {}
  });
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => ({
        text: "Continuing with the selected scope.",
        finishReason: "agent_backend_completed",
        events: []
      })
    }
  });

  await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    threadId: "thread_test",
    agentCardId: "chat-agent",
    chatInstruction: "Continue the review",
    contextValues: {
      agentClarification: {
        clarificationId: "call_from_live_timeline",
        question: "Which time range should the review cover?",
        selectedOptionId: "recent_3",
        answer: "Recent 3 years",
        option: { id: "recent_3", label: "Recent 3 years", detail: "2023-2026", recommended: true }
      }
    }
  });

  assert.equal(agentClarifications[0]?.status, "answered");
  assert.equal(agentClarifications[0]?.selectedOptionId, "recent_3");
});

test("streaming generation suppresses Canvas active heartbeat after Agent clarification waiting", async () => {
  const { storage } = fakeStorage();
  const timelineEvents: Array<{ title: string; status: string; payload?: Record<string, unknown> }> = [];
  const clarificationEvent: ToolEventRecord = {
    eventType: "agent_backend_agent_clarification_requested",
    payload: {
      type: "agent_clarification_requested",
      toolCallId: "call_clarify",
      question: "Which time range should the review cover?",
      options: [
        { id: "recent_3", label: "Recent 3 years", detail: "2023-2026", recommended: true },
        { id: "recent_5", label: "Recent 5 years", detail: "2021-2026" }
      ]
    }
  };
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.({
          eventType: "canvas_delivery_body_checkpoint_committed",
          payload: { type: "canvas_delivery_body_checkpoint_committed", status: "committed" }
        });
        input.onToolEvent?.(clarificationEvent);
        input.onRuntimeSignal?.({ type: "heartbeat", label: "Agent Runtime is still working...", payload: { comment: "heartbeat" } });
        return {
          text: "",
          finishReason: "clarification_required",
          events: [clarificationEvent]
        };
      }
    }
  });

  await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    threadId: "thread_test",
    agentCardId: "chat-agent",
    chatInstruction: "Review recent Agent literature",
    transientSkillRefs: ["literature-review"],
    contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, agentClarification: answeredAgentClarification() },
    toolState: { web_search: true }
  }, {
    onTimelineEvent: (event) => timelineEvents.push(event)
  });

  assert.equal(timelineEvents.some((event) => event.payload?.signal === "heartbeat" || /Agent Runtime active|仍在运行/.test(event.title)), false);
  assert.equal(timelineEvents.some((event) => event.payload?.eventType === "agent_backend_agent_clarification_requested" && event.status === "waiting"), true);
});

test("streaming generation forwards public runtime progress evidence through progress and timeline", async () => {
  const { storage } = fakeStorage();
  const progressEvents: Array<{ summary: string; visibility?: string; source?: string; evidence?: unknown }> = [];
  const timelineEvents: Array<{ summary: string; payload?: Record<string, unknown> }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onRuntimeSignal?.({
          type: "agent_progress_reported",
          label: "I verified the public update stream.",
          payload: {
            type: "agent_progress_reported",
            runId: "runtime_run_public",
            threadId: "thread_test",
            phase: "verification",
            status: "running",
            summary: "I verified the public update stream.",
            next: "Next I will run the focused tests.",
            evidence: [
              { kind: "subagent", label: "frontend explorer", ref: "agent:trace" },
              { kind: "tool", label: "tool arguments hidden" },
              { kind: "unknown", label: "ignored" },
              "runtime checkpoint"
            ],
            visibility: "public",
            source: "agent_public_update",
            createdAt: "2026-07-03T00:00:00.000Z",
            prompt: "hidden"
          }
        });
        return {
          text: "Done.",
          finishReason: "agent_backend_completed",
          events: []
        };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    threadId: "thread_test",
    agentCardId: "chat-agent",
    chatInstruction: "Check public progress updates"
  }, {
    onProgressEvent: (event) => progressEvents.push(event),
    onTimelineEvent: (event) => timelineEvents.push(event)
  });

  const publicProgress = progressEvents.find((event) => event.source === "agent_public_update");
  const publicTimeline = timelineEvents.find((event) => event.payload?.source === "agent_public_update");

  assert.equal(result.text, "Done.");
  assert.equal(publicProgress?.visibility, "public");
  assert.equal(publicProgress?.summary, "I verified the public update stream.");
  assert.deepEqual(publicProgress?.evidence, [
    { kind: "subagent", label: "frontend explorer", ref: "agent:trace" },
    { kind: "runtime", label: "runtime checkpoint" }
  ]);
  assert.equal(publicTimeline?.summary, "I verified the public update stream.");
  assert.deepEqual(publicTimeline?.payload?.evidence, publicProgress?.evidence);
  assert.equal(JSON.stringify(publicProgress).includes("prompt"), false);
  assert.equal(JSON.stringify(publicProgress).includes("arguments"), false);
});

test("skill scope guard fills default budget and Canvas resume context when runtime sends a partial resume", async () => {
  const { storage } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const originalInstruction = "Find recent Agent literature and write a review.";
  const clarificationEvent: ToolEventRecord = {
    eventType: "agent_backend_agent_clarification_requested",
    payload: {
      type: "agent_clarification_requested",
      clarificationId: "runtime_partial_resume",
      question: "Which Agent literature scope should I review?",
      options: [
        { id: "recent_review", label: "Recent review", detail: "Focus on 2025-2026 papers.", recommended: true },
        { id: "broad_scan", label: "Broad scan", detail: "Cover a wider time range." }
      ],
      resumeContext: {
        canvas: { runtimeMarker: true }
      }
    }
  };
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.(clarificationEvent);
        return {
          text: "",
          finishReason: "clarification_required",
          events: [clarificationEvent]
        };
      }
    }
  });

  await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: originalInstruction,
    transientSkillRefs: ["database-lookup", "literature-review"],
    contextValues: { canvas: { workflow: { mode: "batch_delivery" } } },
    toolState: { web_search: true }
  }, {
    onToolEvent: (event) => events.push(event as typeof events[number])
  });

  const clarification = events.find((event) => event.eventType === "agent_backend_agent_clarification_requested");
  const resumeContext = clarification?.payload.resumeContext as Record<string, unknown> | undefined;
  assert.equal(resumeContext?.originalInstruction, originalInstruction);
  assert.deepEqual(resumeContext?.transientSkillRefs, ["database-lookup", "literature-review"]);
  assert.equal(resumeContext?.runtimeBudgetProfile, "low");
  assert.deepEqual((resumeContext?.canvas as { workflow?: unknown } | undefined)?.workflow, { mode: "batch_delivery" });
  assert.equal((resumeContext?.canvas as { runtimeMarker?: boolean } | undefined)?.runtimeMarker, true);
});

test("skill scope guard routes process narration through Canvas recovery instead of assistant body", async () => {
  const { storage, canvasNodes, records } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => ({
        text: "\u597d\u7684\uff0c\u6211\u9700\u8981\u5148\u660e\u786e\u51e0\u4e2a\u5173\u952e\u65b9\u5411\uff1a",
        finishReason: "agent_backend_completed",
        events: []
      })
    }
  });

  const result = await service.generateAndRecordStream({
      mode: "chat",
      locale: "zh",
      agentCardId: "chat-agent",
      chatInstruction: "\u5e2e\u6211\u67e5\u627e\u6700\u8fd1 Agent \u76f8\u5173\u7684\u6587\u732e\uff0c\u5e76\u4e14\u505a\u6587\u732e\u7efc\u8ff0\u3002",
      transientSkillRefs: ["database-lookup", "literature-review"],
      contextValues: { canvas: { workflow: { mode: "batch_delivery" } } },
      toolState: { web_search: true }
    }, { onToolEvent: (event) => events.push(event) });

  assert.equal(result.text.includes("\u9700\u8981\u5148\u660e\u786e"), false);
  assert.ok(canvasNodes.length > 0);
  assert.equal(canvasNodes.some((node) => String(node.content).includes("\u9700\u8981\u5148\u660e\u786e")), false);
  assert.equal(records.length, 1);
  assert.ok(events.some((event) => event.eventType.startsWith("canvas_")));
});

test("skill scope guard covers installed research skills beyond literature and database lookup", async () => {
  const guardedSkills = [
    { skill: "paper-lookup", instruction: "Search papers about AI agents" },
    { skill: "systematic-literature-review", instruction: "Do a survey of agent memory research" },
    { skill: "deep-research", instruction: "Research the AI agent market" },
    { skill: "github-deep-research", instruction: "Analyze open source agent repositories on GitHub" },
    { skill: "citation-management", instruction: "Find citations about agent evaluation" },
    { skill: "newsletter-generation", instruction: "Create a weekly AI agent news digest" },
    { skill: "consulting-analysis", instruction: "Create an industry research report about AI agents" }
  ];

  for (const { skill, instruction } of guardedSkills) {
    const { storage, canvasNodes } = fakeStorage();
    let allowedToolRefs: string[] = [];
    const clarificationEvent: ToolEventRecord = {
      eventType: "agent_backend_agent_clarification_requested",
      payload: {
        type: "agent_clarification_requested",
        clarificationId: `clarify_${skill}`,
        question: "What scope should I use?",
        options: [{ id: "a", label: "Recent" }, { id: "b", label: "Broad" }]
      }
    };
    const service = createGenerationService(storage, fakeAgentRuntime(), {
      modelRuntime: fakeModelRuntime,
      agentBackend: {
        getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
        runAgent: async (input) => {
          allowedToolRefs = input.allowedToolRefs ?? [];
          input.onToolEvent?.(clarificationEvent);
          return { text: "", finishReason: "clarification_required", events: [clarificationEvent] };
        }
      }
    });

    const result = await service.generateAndRecordStream({
      mode: "chat",
      locale: "en",
      agentCardId: "chat-agent",
      chatInstruction: instruction,
      transientSkillRefs: [skill],
      contextValues: { canvas: { workflow: { mode: "batch_delivery" } } },
      toolState: { web_search: true }
    });

    assert.equal(result.finishReason, "clarification_required", skill);
    assert.deepEqual(allowedToolRefs, ["ask_clarification"], skill);
    assert.equal(canvasNodes.length, 0, skill);
  }
});

test("skill scope guard does not block ordinary writing skills", async () => {
  const { storage, records } = fakeStorage();
  let allowedToolRefs: string[] = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        allowedToolRefs = input.allowedToolRefs ?? [];
        return { text: "Drafted outline", finishReason: "agent_backend_completed", events: [] };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: "Research a topic and draft a blog post outline",
    transientSkillRefs: ["blog-post"],
    contextValues: { autoPreflightPlan: { enabled: false } },
    toolState: { web_search: true }
  });

  assert.equal(result.text, "Drafted outline");
  assert.notDeepEqual(allowedToolRefs, ["ask_clarification"]);
  assert.equal(records.length, 1);
});

test("streaming generic long task creates Canvas progress from evidence tools", async () => {
  const { storage, canvasNodes, records } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.({
          eventType: "agent_backend_tool_completed",
          payload: {
            toolName: "web_fetch",
            url: "https://example.com/runtime-notes",
            snippet: "Fetched runtime notes with useful implementation details.",
            sources: [{ title: "Runtime notes", url: "https://example.com/runtime-notes" }]
          }
        });
        throw new Error("Recursion limit of 100 reached without hitting a stop condition.");
      }
    }
  });

  const result = await service.generateAndRecordStream({
      mode: "chat",
      locale: "en",
      agentCardId: "chat-agent",
      chatInstruction: "Audit dependency risks and report what you find",
      contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, autoPreflightPlan: { enabled: false } }
    }, {
      onToolEvent: (event) => events.push(event as typeof events[number])
  });

  assert.equal(result.completion?.status, "failed");
  assert.match(result.errorMessage ?? "", /Recursion limit of 100 reached/);
  assert.equal(records.length, 1);
  assert.ok(canvasNodes.some((node) => node.title === "Overview"));
  assert.ok(canvasNodes.some((node) => node.title === "Body draft" && String(node.content).includes("Working body draft")));
  const progressNode = canvasNodes.find((node) => node.title === "Progress note 1");
  assert.ok(progressNode);
  assert.ok(String(progressNode.content).includes("[Runtime notes](https://example.com/runtime-notes)"));
  assert.equal(String(progressNode.content).includes("Fetched runtime notes"), false);
  assert.equal(String(progressNode.content).includes("Tool:"), false);
  assert.equal(String(progressNode.content).includes("URL:"), false);
  assert.ok(canvasNodes.some((node) => node.title === "Run failed" && String(node.content).includes("Recursion limit of 100 reached")));
  assert.ok(events.some((event) => event.eventType === "canvas_delivery_research_committed"));
  assert.ok(events.some((event) => event.eventType === "canvas_delivery_body_checkpoint_committed"));
  assert.ok(events.some((event) => event.eventType === "canvas_delivery_failed_summary_committed"));
});

test("streaming generic long task skips web fetch references without linked sources", async () => {
  const { storage, canvasNodes, records } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.({
          eventType: "agent_backend_tool_completed",
          payload: {
            toolName: "web_fetch",
            url: "https://example.com/runtime-notes",
            snippet: "Fetched runtime notes with useful implementation details."
          }
        });
        throw new Error("Recursion limit of 100 reached without hitting a stop condition.");
      }
    }
  });

  const result = await service.generateAndRecordStream({
      mode: "chat",
      locale: "en",
      agentCardId: "chat-agent",
      chatInstruction: "Audit dependency risks and report what you find",
      contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, autoPreflightPlan: { enabled: false } }
    }, {
      onToolEvent: (event) => events.push(event as typeof events[number])
  });

  assert.equal(result.completion?.status, "failed");
  assert.match(result.errorMessage ?? "", /Recursion limit of 100 reached/);
  assert.equal(records.length, 1);
  assert.ok(canvasNodes.some((node) => node.title === "Overview"));
  assert.equal(canvasNodes.some((node) => node.title === "Progress note 1"), false);
  assert.equal(canvasNodes.some((node) => String(node.content).includes("Fetched runtime notes")), false);
  assert.equal(events.some((event) => event.eventType === "canvas_delivery_research_committed"), false);
  assert.equal(events.some((event) => event.eventType === "canvas_delivery_body_checkpoint_committed"), false);
  assert.ok(events.some((event) => event.eventType === "canvas_delivery_failed_summary_committed"));
});

test("progressive Canvas keeps body drafts until evidence budget and finalizes Body from agent answer", async () => {
  const { storage, canvasNodes, records } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        for (let index = 1; index <= 16; index += 1) {
          input.onToolEvent?.({
            eventType: "agent_backend_tool_completed",
            payload: {
              toolName: "web_fetch",
              url: `https://example.com/source-${index}`,
              snippet: `Evidence ${index}`,
              sources: [{ title: `Source ${index}`, url: `https://example.com/source-${index}` }]
            }
          });
        }
        return {
          text: "# Final report\n\nThis is the final synthesized answer.",
          finishReason: "agent_backend_completed",
          events: []
        };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: "Research and summarize agent runtime budgets",
    contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, autoPreflightPlan: { enabled: false } }
  }, {
    onToolEvent: (event) => events.push(event as typeof events[number])
  });

  assert.equal(result.usedMock, false);
  assert.equal(records.length, 1);
  assert.ok(events.some((event) => event.eventType === "canvas_delivery_synthesis_started"));
  const checkpoints = events.filter((event) => event.eventType === "canvas_delivery_body_checkpoint_committed");
  assert.equal(checkpoints.length, 2);
  const checkpoint = checkpoints.at(-1);
  assert.equal(checkpoint?.payload.draftIndex, 2);
  assert.equal(checkpoint?.payload.draftLimit, 2);
  assert.equal((checkpoint?.payload.node as { title?: string } | undefined)?.title, "Body draft");
  assert.ok(String((checkpoint?.payload.node as { content?: string } | undefined)?.content ?? "").includes("Working body draft"));
  assert.ok(String((checkpoint?.payload.node as { content?: string } | undefined)?.content ?? "").startsWith("# Body draft"));
  assert.ok(canvasNodes.some((node) => node.title === "Progress note 3"));
  assert.ok(canvasNodes.some((node) => node.title === "Progress note 8"));
  const draft = canvasNodes.find((node) => node.title === "Body draft");
  assert.ok(draft);
  assert.ok(String(draft.content).includes("Evidence 2"));
  assert.equal(String(draft.content).includes("Evidence 8"), false);
  const body = canvasNodes.find((node) => node.title === "Body");
  assert.ok(body);
  assert.equal(String(body.content).includes("Working body draft"), false);
  assert.ok(String(body.content).includes("This is the final synthesized answer."));
  assert.ok(events.some((event) => event.eventType === "canvas_delivery_body_final_committed"));
});

test("progressive Canvas creates a file document node for Markdown output files", async () => {
  const appRoot = `.facetwrite-test/md-runtime-archive-${Date.now()}`;
  const previousRoot = process.env.FACETWRITE_APP_ROOT;
  process.env.FACETWRITE_APP_ROOT = appRoot;
  try {
    const { storage, canvasNodes, canvasEdges } = fakeStorage();
    const longMarkdown = `# Full report\n\n${"Long section content. ".repeat(200)}`;
    const service = createGenerationService(storage, fakeAgentRuntime(), {
      modelRuntime: fakeModelRuntime,
      archiveMarkdownOutput: (threadId, virtualPath) => archiveMarkdownForTest(threadId, virtualPath, longMarkdown),
      agentBackend: {
        getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
        runAgent: async (input) => {
          input.onToolEvent?.({
            eventType: "agent_backend_tool_completed",
            payload: {
              toolName: "write_file",
              path: "/mnt/user-data/outputs/report.md",
              snippet: longMarkdown
            }
          });
          input.onToolEvent?.({
            eventType: "agent_backend_tool_completed",
            payload: {
              toolName: "present_files",
              filepaths: ["/mnt/user-data/outputs/report.md"]
            }
          });
          return {
            text: "The Markdown report is ready.",
            finishReason: "agent_backend_completed",
            events: []
          };
        }
      }
    });

    await service.generateAndRecordStream({
      mode: "chat",
      locale: "en",
      threadId: "thread_runtime_archive",
      agentCardId: "chat-agent",
      chatInstruction: "Research and write a detailed report",
      contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, autoPreflightPlan: { enabled: false } }
    });

    const fileNodes = canvasNodes.filter((node) => node.kind === "file_document");
    assert.equal(fileNodes.length, 1);
    assert.equal((fileNodes[0]?.metadata as { fileDocument?: { status?: string } }).fileDocument?.status, "presented");
    assert.equal((fileNodes[0]?.metadata as { fileDocument?: { threadId?: string } }).fileDocument?.threadId, "thread_runtime_archive");
    assert.equal(fileNodes[0]?.includeInProjectContext, false);
    assert.equal(String(fileNodes[0]?.content).includes("Long section content."), false);
    assert.ok(String(fileNodes[0]?.content).includes("/mnt/user-data/outputs/report.md"));
    assert.ok(canvasEdges.some((edge) => edge.targetNodeId === fileNodes[0]?.id));
    const saved = await readFile(path.resolve(process.cwd(), appRoot, "threads", "thread_runtime_archive", "user-data", "outputs", "report.md"), "utf8");
    assert.ok(saved.includes("Long section content."));
  } finally {
    if (previousRoot === undefined) {
      delete process.env.FACETWRITE_APP_ROOT;
    } else {
      process.env.FACETWRITE_APP_ROOT = previousRoot;
    }
    await rm(path.resolve(process.cwd(), appRoot), { recursive: true, force: true });
  }
});

test("progressive Canvas prefers a readable Markdown output over fallback when runtime archive fails", async () => {
  const appRoot = `.facetwrite-test/md-runtime-local-output-${Date.now()}`;
  const previousRoot = process.env.FACETWRITE_APP_ROOT;
  process.env.FACETWRITE_APP_ROOT = appRoot;
  try {
    const { storage, canvasNodes } = fakeStorage();
    const reportPath = "/mnt/user-data/outputs/real-report.md";
    const reportMarkdown = `# Real report\n\n${"Verified local output. ".repeat(180)}`;
    const fallbackCandidate = `# Fallback candidate\n\n${"This text should not become the document path. ".repeat(220)}`;
    const service = createGenerationService(storage, fakeAgentRuntime(), {
      modelRuntime: fakeModelRuntime,
      archiveMarkdownOutput: async (threadId, virtualPath) => {
        await archiveMarkdownForTest(threadId, virtualPath, reportMarkdown);
        throw new Error("runtime artifact missing");
      },
      agentBackend: {
        getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
        runAgent: async (input) => {
          input.onToolEvent?.({
            eventType: "agent_backend_tool_completed",
            payload: { toolName: "write_file", path: reportPath }
          });
          input.onToolEvent?.({
            eventType: "agent_backend_tool_completed",
            payload: { toolName: "present_files", filepaths: [reportPath] }
          });
          return {
            text: fallbackCandidate,
            finishReason: "agent_backend_completed",
            events: []
          };
        }
      }
    });

    await service.generateAndRecordStream({
      mode: "chat",
      locale: "en",
      threadId: "thread_runtime_local_output",
      agentCardId: "chat-agent",
      chatInstruction: "Research and write a detailed report",
      contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, autoPreflightPlan: { enabled: false } }
    });

    const fileNodes = canvasNodes.filter((node) => node.kind === "file_document");
    assert.equal(fileNodes.length, 1);
    const fileDocument = (fileNodes[0]?.metadata as { fileDocument?: { path?: string } }).fileDocument;
    assert.equal(fileDocument?.path, reportPath);
    assert.equal(fileDocument?.path?.includes("facetwrite-delivery-"), false);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.FACETWRITE_APP_ROOT;
    } else {
      process.env.FACETWRITE_APP_ROOT = previousRoot;
    }
    await rm(path.resolve(process.cwd(), appRoot), { recursive: true, force: true });
  }
});

test("progressive Canvas finalizes files after clarification when runtime keeps working", async () => {
  const appRoot = `.facetwrite-test/md-after-clarification-${Date.now()}`;
  const previousRoot = process.env.FACETWRITE_APP_ROOT;
  process.env.FACETWRITE_APP_ROOT = appRoot;
  try {
    const { storage, canvasNodes, records } = fakeStorage();
    const reportPath = "/mnt/user-data/outputs/Systematic_Literature_Review_AI_Agents.md";
    const reportMarkdown = `# Systematic Literature Review\n\n${"Agent literature synthesis. ".repeat(160)}`;
    const service = createGenerationService(storage, fakeAgentRuntime(), {
      modelRuntime: fakeModelRuntime,
      archiveMarkdownOutput: (threadId, virtualPath) => archiveMarkdownForTest(threadId, virtualPath, reportMarkdown),
      agentBackend: {
        getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
        runAgent: async (input) => {
          const emitted: ToolEventRecord[] = [];
          const emit = (event: ToolEventRecord) => {
            emitted.push(event);
            input.onToolEvent?.(event);
          };
          emit({
            eventType: "agent_backend_agent_clarification_requested",
            payload: {
              type: "agent_clarification_requested",
              toolCallId: "call_citation_format",
              question: "您希望文献综述使用哪种引用格式？",
              options: [
                { id: "apa", label: "APA 7th", detail: "社会科学常用格式", recommended: true },
                { id: "ieee", label: "IEEE", detail: "工程领域常用格式" }
              ]
            }
          });
          emit({
            eventType: "agent_backend_tool_started",
            payload: { type: "tool_started", toolName: "web_search", toolCallId: "call_search" }
          });
          emit({
            eventType: "agent_backend_tool_completed",
            payload: {
              type: "tool_completed",
              toolName: "web_search",
              toolCallId: "call_search",
              query: "recent AI agent survey",
              sources: [{ title: "Agent survey", url: "https://example.com/agent-survey" }]
            }
          });
          emit({
            eventType: "agent_backend_tool_completed",
            payload: { type: "tool_completed", toolName: "write_file", toolCallId: "call_write", path: reportPath }
          });
          emit({
            eventType: "agent_backend_tool_completed",
            payload: { type: "tool_completed", toolName: "present_files", toolCallId: "call_present", filepaths: [reportPath] }
          });
          return {
            text: "",
            finishReason: "clarification_required",
            events: emitted
          };
        }
      }
    });

    const result = await service.generateAndRecordStream({
      mode: "chat",
      locale: "zh",
      threadId: "thread_after_clarification",
      agentCardId: "chat-agent",
      chatInstruction: "帮我查找最近Agent相关的文献，并且做文献综述。",
      transientSkillRefs: ["database-lookup", "literature-review"],
      contextValues: {
        canvas: { workflow: { mode: "batch_delivery" } },
        agentClarification: answeredAgentClarification()
      },
      toolState: { web_search: true }
    });

    assert.notEqual(result.finishReason, "clarification_required");
    assert.equal(records.length, 1);
    assert.notEqual((records[0] as { finishReason?: string }).finishReason, "clarification_required");
    const fileNode = canvasNodes.find((node) => node.kind === "file_document");
    assert.ok(fileNode);
    assert.ok(String(fileNode.content).includes(reportPath));
    assert.ok(canvasNodes.some((node) => node.title === "正文"));
    const body = canvasNodes.find((node) => node.title === "正文");
    assert.ok(String(body?.content).includes("Systematic Literature Review"));
  } finally {
    if (previousRoot === undefined) {
      delete process.env.FACETWRITE_APP_ROOT;
    } else {
      process.env.FACETWRITE_APP_ROOT = previousRoot;
    }
    await rm(path.resolve(process.cwd(), appRoot), { recursive: true, force: true });
  }
});

test("progressive Canvas does not create a file document node when runtime Markdown archive fails", async () => {
  const { storage, canvasNodes } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    archiveMarkdownOutput: async () => {
      throw new Error("runtime artifact missing");
    },
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.({
          eventType: "agent_backend_tool_completed",
          payload: {
            toolName: "write_file",
            path: "/mnt/user-data/outputs/missing.md"
          }
        });
        input.onToolEvent?.({
          eventType: "agent_backend_tool_completed",
          payload: {
            toolName: "present_files",
            filepaths: ["/mnt/user-data/outputs/missing.md"]
          }
        });
        return {
          text: "The Markdown report is ready.",
          finishReason: "agent_backend_completed",
          events: []
        };
      }
    }
  });

  await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    threadId: "thread_runtime_archive_missing",
    agentCardId: "chat-agent",
    chatInstruction: "Research and write a detailed report",
    contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, autoPreflightPlan: { enabled: false } }
  }, {
    onToolEvent: (event) => events.push(event as typeof events[number])
  });

  assert.equal(canvasNodes.filter((node) => node.kind === "file_document").length, 0);
  const archiveFailure = events.find((event) => event.eventType === "canvas_delivery_file_document_archive_failed");
  assert.equal(archiveFailure?.payload.path, "/mnt/user-data/outputs/missing.md");
  assert.match(String(archiveFailure?.payload.error), /runtime artifact missing/);
});

test("progressive Canvas falls back to a Markdown file document after multiple web searches", async () => {
  const appRoot = `.facetwrite-test/md-delivery-${Date.now()}`;
  const previousRoot = process.env.FACETWRITE_APP_ROOT;
  process.env.FACETWRITE_APP_ROOT = appRoot;
  try {
    const { storage, canvasNodes, canvasEdges } = fakeStorage();
    const longText = `# Full literature report\n\n${"Long section content. ".repeat(220)}UNIQUE_TAIL_SHOULD_ONLY_BE_IN_FILE`;
    const service = createGenerationService(storage, fakeAgentRuntime(), {
      modelRuntime: fakeModelRuntime,
      agentBackend: {
        getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
        runAgent: async (input) => {
          for (let index = 1; index <= 2; index += 1) {
            input.onToolEvent?.({
              eventType: "agent_backend_tool_completed",
              payload: {
                toolName: "web_search",
                query: `agent literature ${index}`,
                sources: [{ title: `Source ${index}`, url: `https://example.com/${index}` }]
              }
            });
          }
          return {
            text: longText,
            finishReason: "agent_backend_completed",
            events: []
          };
        }
      }
    });

    const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
    const result = await service.generateAndRecordStream({
      mode: "chat",
      locale: "en",
      threadId: "thread_md_fallback",
      agentCardId: "chat-agent",
      chatInstruction: "Review recent agent literature and write a detailed report",
      contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, agentClarification: answeredAgentClarification() },
      toolState: { web_search: true }
    }, {
      onToolEvent: (event) => events.push(event as typeof events[number])
    });

    const fileNodes = canvasNodes.filter((node) => node.kind === "file_document");
    assert.equal(fileNodes.length, 1);
    const fileDocument = (fileNodes[0]?.metadata as { fileDocument?: { path?: string; status?: string } }).fileDocument;
    assert.equal(fileDocument?.status, "presented");
    assert.ok(fileDocument?.path?.startsWith("/mnt/user-data/outputs/facetwrite-delivery-"));

    const body = canvasNodes.find((node) => node.title === "Body");
    assert.ok(body);
    assert.ok(String(body.content).includes("Full literature report"));
    assert.ok(String(body.content).includes("Long section content."));
    assert.equal(String(body.content).includes("UNIQUE_TAIL_SHOULD_ONLY_BE_IN_FILE"), false);
    assert.equal(result.text.includes("UNIQUE_TAIL_SHOULD_ONLY_BE_IN_FILE"), false);
    assert.ok(result.text.includes("/mnt/user-data/outputs/"));
    assert.ok(canvasEdges.some((edge) => edge.targetNodeId === fileNodes[0]?.id));
    assert.ok(events.some((event) => event.eventType === "agent_backend_tool_completed" && event.payload.toolName === "write_file" && event.payload.source === "server_fallback"));
    const fileNodeEvent = events.find((event) => event.eventType === "canvas_delivery_file_document_committed");
    assert.ok(fileNodeEvent?.payload.node);

    const fileName = fileDocument?.path?.split("/").at(-1) ?? "";
    const saved = await readFile(path.resolve(process.cwd(), appRoot, "threads", "thread_md_fallback", "user-data", "outputs", fileName), "utf8");
    assert.ok(saved.includes("UNIQUE_TAIL_SHOULD_ONLY_BE_IN_FILE"));
  } finally {
    if (previousRoot === undefined) {
      delete process.env.FACETWRITE_APP_ROOT;
    } else {
      process.env.FACETWRITE_APP_ROOT = previousRoot;
    }
    await rm(path.resolve(process.cwd(), appRoot), { recursive: true, force: true });
  }
});

test("progressive Canvas recovers final body and fallback Markdown from committed canvas_write content", async () => {
  const appRoot = `.facetwrite-test/md-recovered-${Date.now()}`;
  const previousRoot = process.env.FACETWRITE_APP_ROOT;
  process.env.FACETWRITE_APP_ROOT = appRoot;
  try {
    const { storage, canvasNodes } = fakeStorage();
    const references = Array.from({ length: 6 }, (_, index) => {
      const id = `2503.${String(21460 + index).padStart(5, "0")}`;
      return `- [Paper ${index + 1}](https://arxiv.org/abs/${id})`;
    }).join("\n");
    const recoveredMarkdown = [
      "# Systematic Literature Review: AI Agents",
      "",
      "## Summary",
      "",
      "| ID | Paper | Theme |",
      "|---|---|---|",
      "| S1 | Comprehensive Review of AI Agents | Overview |",
      "| S2 | Survey on LLM Agents | Architecture |",
      "| S3 | Memory for Autonomous Agents | Memory |",
      "",
      "## Core Findings",
      "",
      "- Agent architectures converge around planning, memory, tool use, and multi-agent coordination.",
      "- Evaluation remains fragmented across safety, tool-use accuracy, and long-horizon autonomy.",
      "- Production deployment depends on observability, governance, and cost controls.",
      "",
      "## Research Gaps",
      "",
      "- Unified long-horizon benchmarks.",
      "- Interoperability standards across agent frameworks.",
      "- Trustworthy memory and provenance mechanisms.",
      "",
      "## Detailed Synthesis",
      "",
      "Detailed analysis paragraph. ".repeat(160),
      "",
      "## References",
      "",
      references,
      "",
      "UNIQUE_RECOVERED_TAIL"
    ].join("\n");
    const service = createGenerationService(storage, fakeAgentRuntime(), {
      modelRuntime: fakeModelRuntime,
      agentBackend: {
        getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
        runAgent: async (input) => {
          for (let index = 1; index <= 2; index += 1) {
            input.onToolEvent?.({
              eventType: "agent_backend_tool_completed",
              payload: {
                toolName: "web_search",
                query: `agent literature ${index}`,
                sources: [{ title: `Search ${index}`, url: `https://example.com/search-${index}` }]
              }
            });
          }
          return {
            text: "I've loaded the Systematic Literature Review skill. Let me clarify a few things before proceeding.",
            finishReason: "agent_backend_completed",
            events: [{
              eventType: "agent_backend_canvas_mutation_committed",
              payload: {
                tool: "canvas_write",
                eventType: "canvas_mutation_committed",
                content: recoveredMarkdown
              }
            }]
          };
        }
      }
    });

    const result = await service.generateAndRecordStream({
      mode: "chat",
      locale: "en",
      threadId: "thread_md_recovered",
      agentCardId: "chat-agent",
      chatInstruction: "Review recent agent literature and write a detailed report",
      transientSkillRefs: ["literature-review"],
      contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, agentClarification: answeredAgentClarification() },
      toolState: { web_search: true }
    });

    const body = canvasNodes.find((node) => node.title === "Body");
    assert.ok(body);
    assert.ok(String(body.content).includes("Core Findings"));
    assert.ok(String(body.content).includes("Comprehensive Review of AI Agents"));
    assert.equal(String(body.content).includes("Let me clarify"), false);
    assert.equal(String(body.content).includes("UNIQUE_RECOVERED_TAIL"), false);

    const referencesNode = canvasNodes.find((node) => node.title === "References");
    assert.ok(referencesNode);
    assert.ok(String(referencesNode.content).includes("https://arxiv.org/abs/2503.21460"));

    const fileNodes = canvasNodes.filter((node) => node.kind === "file_document");
    assert.equal(fileNodes.length, 1);
    assert.ok(result.text.includes("/mnt/user-data/outputs/"));
    const fileDocument = (fileNodes[0]?.metadata as { fileDocument?: { path?: string } }).fileDocument;
    const fileName = fileDocument?.path?.split("/").at(-1) ?? "";
    const saved = await readFile(path.resolve(process.cwd(), appRoot, "threads", "thread_md_recovered", "user-data", "outputs", fileName), "utf8");
    assert.ok(saved.includes("UNIQUE_RECOVERED_TAIL"));
    assert.equal(saved.includes("Let me clarify"), false);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.FACETWRITE_APP_ROOT;
    } else {
      process.env.FACETWRITE_APP_ROOT = previousRoot;
    }
    await rm(path.resolve(process.cwd(), appRoot), { recursive: true, force: true });
  }
});

test("progressive Canvas does not create a fallback Markdown document from clarification chatter", async () => {
  const { storage, canvasNodes } = fakeStorage();
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        for (let index = 1; index <= 2; index += 1) {
          input.onToolEvent?.({
            eventType: "agent_backend_tool_completed",
            payload: {
              toolName: "web_search",
              query: `agent literature ${index}`,
              sources: [{ title: `Search ${index}`, url: `https://example.com/search-${index}` }]
            }
          });
        }
        return {
          text: "I've loaded the Systematic Literature Review skill. Let me clarify a few things before proceeding.",
          finishReason: "agent_backend_completed",
          events: []
        };
      }
    }
  });

  await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    threadId: "thread_md_chatter",
    agentCardId: "chat-agent",
    chatInstruction: "Review recent agent literature and write a detailed report",
    transientSkillRefs: ["literature-review"],
    contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, agentClarification: answeredAgentClarification() },
    toolState: { web_search: true }
  });

  assert.equal(canvasNodes.some((node) => node.kind === "file_document"), false);
  assert.ok(canvasNodes.some((node) => node.title === "Clarification needed"));
  assert.equal(canvasNodes.some((node) => String(node.content).includes("Let me clarify")), false);
});

test("progressive Canvas finalizes reference links from committed canvas_write sources", async () => {
  const { storage, canvasNodes, records } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const searchSources = Array.from({ length: 12 }, (_, index) => ({
    title: `Search result ${index + 1}`,
    url: `https://search.example/${index + 1}`
  }));
  const paperSources = Array.from({ length: 12 }, (_, index) => {
    const paperId = `2503.${String(21460 + index).padStart(5, "0")}`;
    return {
      title: paperId,
      url: `https://arxiv.org/abs/${paperId}`
    };
  });
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        const searchEvent = {
          eventType: "agent_backend_tool_completed" as const,
          payload: {
            toolName: "web_search",
            query: "recent LLM agent papers",
            sources: searchSources
          }
        };
        input.onToolEvent?.(searchEvent);
        return {
          text: "# Literature review\n\nThe final literature map is complete.",
          finishReason: "agent_backend_completed",
          events: [
            searchEvent,
            {
              eventType: "agent_backend_canvas_mutation_committed",
              payload: {
                tool: "canvas_write",
                eventType: "canvas_mutation_committed",
                nodeId: "node_literature_map",
                sources: paperSources
              }
            }
          ]
        };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: "Review recent agent literature and produce a literature review",
    transientSkillRefs: ["database-lookup", "literature-review"],
      contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, agentClarification: answeredAgentClarification() },
    toolState: { web_search: true }
  }, {
    onToolEvent: (event) => events.push(event as typeof events[number])
  });

  assert.equal(result.usedMock, false);
  assert.equal(records.length, 1);
  const references = canvasNodes.find((node) => node.title === "References");
  assert.ok(references);
  assert.ok(String(references.content).includes("https://arxiv.org/abs/2503.21460"));
  assert.equal(String(references.content).includes("https://arxiv.org/abs/2503.21471"), true);
  assert.ok(String(references.content).indexOf("https://arxiv.org/abs/2503.21460") < String(references.content).indexOf("https://search.example/1"));
  assert.ok(events.some((event) => event.eventType === "canvas_delivery_sources_committed" && event.payload.sourceCount === 24));
});

test("progressive Canvas ignores ask_clarification events during ordinary long task finalization", async () => {
  const { storage, canvasNodes, records } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.({
          eventType: "agent_backend_tool_completed",
          payload: {
            type: "tool_completed",
            toolName: "ask_clarification",
            toolCallId: "call_clarify",
            summary: "请选择文献综述的时间范围。"
          }
        });
        return {
          text: "# Literature review summary\n\nFinal synthesized summary after choosing the default 2025-2026 window.",
          finishReason: "agent_backend_completed",
          events: []
        };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "zh",
    agentCardId: "chat-agent",
    chatInstruction: "帮我查找最近Agent相关的文献，并且做文献综述",
    transientSkillRefs: ["database-lookup", "literature-review"],
    contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, agentClarification: answeredAgentClarification() },
    toolState: { web_search: true }
  }, {
    onToolEvent: (event) => events.push(event as typeof events[number])
  });

  assert.match(result.text, /Document ready|文档已生成|Literature review summary/);
  assert.equal(records.length, 1);
  const body = canvasNodes.find((node) => node.title === "正文");
  assert.ok(body);
  assert.ok(String(body.content).includes("Final synthesized summary"));
  assert.equal(canvasNodes.some((node) => node.title === "等待用户确认"), false);
  assert.equal(canvasNodes.some((node) => node.title === "运行失败"), false);
  assert.equal(events.some((event) => event.eventType === "canvas_delivery_failed_summary_committed"), false);
  assert.equal(events.some((event) => event.eventType === "agent_backend_runtime_failed"), false);
});

test("progressive Canvas emits waiting clarification timeline without creating a Canvas node", async () => {
  const { storage, canvasNodes, records } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const timelineEvents: Array<{ status: string; payload?: Record<string, unknown> }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.({
          eventType: "agent_backend_agent_clarification_requested",
          payload: {
            type: "agent_clarification_requested",
            toolCallId: "call_clarify",
            question: "Which review scope should I use?",
            status: "pending",
            options: [
              { id: "focused", label: "Focused", detail: "Use the existing core papers.", recommended: true },
              { id: "broad", label: "Broad", detail: "Run an additional web search.", recommended: false }
            ]
          }
        });
        return {
          text: "# Literature review summary\n\nFinal synthesized summary after choosing the default 2025-2026 window.",
          finishReason: "agent_backend_completed",
          events: []
        };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: "Review recent agent literature and produce a literature review",
    transientSkillRefs: ["database-lookup", "literature-review"],
    contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, agentClarification: answeredAgentClarification() },
    toolState: { web_search: true }
  }, {
    onToolEvent: (event) => events.push(event as typeof events[number]),
    onTimelineEvent: (event) => timelineEvents.push(event)
  });

  assert.match(result.text, /Document ready|Literature review summary/);
  assert.equal(records.length, 1);
  assert.equal(canvasNodes.some((node) => node.kind === "clarification"), false);
  const body = canvasNodes.find((node) => node.title === "Body");
  assert.ok(body);
  assert.ok(String(body.content).includes("Final synthesized summary"));
  assert.equal(String(body.content).includes("Which review scope should I use?"), false);
  assert.ok(events.some((event) => event.eventType === "agent_backend_agent_clarification_requested"));
  assert.equal(events.some((event) => event.eventType === "canvas_delivery_clarification_committed"), false);
  const clarificationTimeline = timelineEvents.find((event) => event.payload?.eventType === "agent_backend_agent_clarification_requested");
  assert.equal(clarificationTimeline?.status, "waiting");
  assert.equal(clarificationTimeline?.payload?.question, "Which review scope should I use?");
  assert.equal(events.some((event) => event.eventType === "canvas_delivery_failed_summary_committed"), false);
  assert.equal(events.some((event) => event.eventType === "agent_backend_runtime_failed"), false);
});

test("progressive Canvas maps native string option clarification into waiting timeline", async () => {
  const { storage, canvasNodes } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const timelineEvents: Array<{ status: string; payload?: Record<string, unknown> }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.({
          eventType: "agent_backend_agent_clarification_requested",
          payload: {
            type: "agent_clarification_requested",
            toolCallId: "call_clarify",
            question: "Which review scope should I use?",
            status: "pending",
            options: ["Focused review", "Broad review", "Fast scan"]
          }
        });
        return {
          text: "# Literature review summary\n\nFinal synthesized summary after choosing the default scope.",
          finishReason: "agent_backend_completed",
          events: []
        };
      }
    }
  });

  await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: "Review recent agent literature and produce a literature review",
    transientSkillRefs: ["database-lookup", "literature-review"],
    contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, agentClarification: answeredAgentClarification() },
    toolState: { web_search: true }
  }, {
    onToolEvent: (event) => events.push(event as typeof events[number]),
    onTimelineEvent: (event) => timelineEvents.push(event)
  });

  assert.equal(canvasNodes.some((node) => node.kind === "clarification"), false);
  const clarificationTimeline = timelineEvents.find((event) => event.payload?.eventType === "agent_backend_agent_clarification_requested");
  assert.equal(clarificationTimeline?.status, "waiting");
  const payload = clarificationTimeline?.payload as { options?: Array<{ label: string; recommended: boolean }> } | undefined;
  assert.deepEqual(payload?.options?.map((option) => ({ label: option.label, recommended: option.recommended })), [
    { label: "Focused review", recommended: true },
    { label: "Broad review", recommended: false },
    { label: "Fast scan", recommended: false }
  ]);
  assert.ok(events.some((event) => event.eventType === "agent_backend_agent_clarification_requested"));
  assert.equal(events.some((event) => event.eventType === "canvas_delivery_clarification_committed"), false);
});

test("progressive Canvas filters raw tool output from progress and final body nodes", async () => {
  const { storage, canvasNodes } = fakeStorage();
  const noisyHtml = "<html><body><p>Skip to main content Donate > raw arXiv page chrome</p></body></html>";
  const skillText = "Error invoking tool 'read_file' with kwargs {'path':'/mnt/skills/public/systematic-literature-review/SKILL.md'}\n--- name: systematic-literature-review description: Use this skill when the user wants a systematic literature review";
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.({
          eventType: "agent_backend_tool_completed",
          payload: {
            toolName: "web_fetch",
            url: "https://arxiv.org/abs/2503.21460",
            snippet: noisyHtml,
            sources: [{ title: "Survey on LLM Agents", url: "https://arxiv.org/abs/2503.21460" }]
          }
        });
        input.onToolEvent?.({
          eventType: "agent_backend_tool_completed",
          payload: {
            toolName: "read_file",
            path: "/mnt/skills/public/systematic-literature-review/SKILL.md",
            summary: skillText
          }
        });
        return {
          text: [
            "# Final synthesis",
            "",
            "The review identifies evaluation gaps, memory infrastructure, and multi-agent coordination as the main themes.",
            noisyHtml,
            skillText,
            "",
            "## References",
            "- [Survey on LLM Agents](https://arxiv.org/abs/2503.21460)"
          ].join("\n"),
          finishReason: "agent_backend_completed",
          events: []
        };
      }
    }
  });

  await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    threadId: "thread_sanitize_tool_output",
    agentCardId: "chat-agent",
    chatInstruction: "Review recent agent literature and produce a detailed report",
    transientSkillRefs: ["literature-review"],
    contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, agentClarification: answeredAgentClarification() },
    toolState: { web_search: true }
  });

  const body = canvasNodes.find((node) => node.title === "Body");
  assert.ok(body);
  assert.ok(String(body.content).includes("evaluation gaps"));
  for (const node of canvasNodes) {
    const content = String(node.content);
    assert.equal(content.includes("<html>"), false);
    assert.equal(content.includes("/mnt/skills/"), false);
    assert.equal(content.includes("Error invoking tool"), false);
    assert.equal(content.includes("description: Use this skill"), false);
  }
});

test("progressive Canvas treats process clarification text as recoverable output, not failure", async () => {
  const { storage, canvasNodes, records } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.({
          eventType: "agent_backend_tool_completed",
          payload: {
            toolName: "web_search",
            query: "agent literature review",
            sources: [{ title: "Agent survey", url: "https://example.com/agent-survey", snippet: "Useful paper list." }]
          }
        });
        return {
          text: "好的！我需要先跟您确认几个关键点，确保文献综述的方向准确：",
          finishReason: "agent_backend_completed",
          events: []
        };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: "Review recent Agent literature and summarize the findings",
    transientSkillRefs: ["database-lookup", "literature-review"],
    contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, agentClarification: answeredAgentClarification() }
  }, {
    onToolEvent: (event) => events.push(event as typeof events[number])
  });

  assert.equal(records.length, 1);
  assert.equal(result.text.includes("clarify"), false);
  const body = canvasNodes.find((node) => node.title === "Body");
  assert.ok(body);
  assert.equal(String(body.content).includes("clarify"), false);
  assert.ok(String(body.content).includes("did not return complete deliverable body content"));
  const recovery = canvasNodes.find((node) => node.title === "Clarification needed");
  assert.ok(recovery);
  assert.equal(String(recovery.content).includes("clarify"), false);
  assert.ok(events.some((event) => event.eventType === "canvas_delivery_body_final_committed"));
  assert.equal(events.some((event) => event.eventType === "canvas_delivery_failed_summary_committed"), false);
});

test("progressive Canvas completes internal output block when Canvas delivery exists", async () => {
  const { storage, records } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const tokens: string[] = [];
  const committedEvent: ToolEventRecord = {
    eventType: "canvas_delivery_body_final_committed",
    payload: { deliveryId: "delivery_internal_output", title: "Body" }
  };
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToken?.('< | | DSML | | tool_calls> < / | / DSML / / invoke name="webfetch">');
        input.onToolEvent?.(committedEvent);
        return {
          text: '< | | DSML | | tool_calls> < / | / DSML / / invoke name="webfetch">',
          finishReason: "agent_backend_completed",
          events: [committedEvent]
        };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: "Review recent Agent literature and summarize the findings",
    transientSkillRefs: ["database-lookup", "literature-review"],
    contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, agentClarification: answeredAgentClarification() }
  }, {
    onToken: (token) => tokens.push(token),
    onToolEvent: (event) => events.push(event as typeof events[number])
  });

  assert.notEqual(result.completion?.status, "failed");
  assert.notEqual(result.finishReason, "runtime_failed");
  assert.equal(records.length, 1);
  const record = records[0] as { events?: Array<{ eventType: string }> };
  assert.ok(record.events?.some((event) => event.eventType === "internal_output_blocked"));
  assert.ok(record.events?.some((event) => event.eventType === "canvas_delivery_body_final_committed"));
  assert.equal(record.events?.some((event) => event.eventType === "agent_backend_runtime_failed"), false);
  assert.equal(record.events?.some((event) => event.eventType === "canvas_delivery_failed_summary_committed"), false);
  assert.equal(events.some((event) => event.eventType === "agent_backend_runtime_failed"), false);
  assert.equal(tokens.join("").includes("webfetch"), false);
});

test("progressive Canvas blocks leaked skill DSML as final body", async () => {
  const { storage, canvasNodes, records } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const tokens: string[] = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToken?.('< | | DSML | | tool_calls> < / | / DSML / / invoke name="webfetch">');
        input.onToolEvent?.({
          eventType: "agent_backend_tool_completed",
          payload: {
            toolName: "web_search",
            summary: '< | | DSML | | tool_calls> < / | / DSML / / invoke name="webfetch">',
            sources: [{ title: "Agent paper", url: "https://example.com/agent-paper", snippet: '< | | DSML | | parameter name="maxcontentlength">5000' }]
          }
        });
        return {
          text: '< | | DSML | | tool_calls> < / | / DSML / / invoke name="webfetch"> < | | DSML | | parameter name="url" string="true">https://arxiv.org/abs/2504.19678< / | / DSML | | parameter> < | | DSML | | parameter name="maxcontentlength" string="false">5000< / | / DSML | | parameter> < / | / DSML | | invoke> < / | / DSML | | tool_calls>',
          finishReason: "agent_backend_completed",
          events: []
        };
      }
    }
  });

  const result = await service.generateAndRecordStream({
      mode: "chat",
      locale: "zh",
      agentCardId: "chat-agent",
      chatInstruction: "帮我查找最近Agent相关的文献，并且做文献综述",
      transientSkillRefs: ["database-lookup", "literature-review"],
      contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, agentClarification: answeredAgentClarification() }
    }, {
      onToken: (token) => tokens.push(token),
      onToolEvent: (event) => events.push(event as typeof events[number])
  });

  assert.notEqual(result.completion?.status, "failed");
  assert.equal(result.errorMessage, undefined);
  assert.equal(records.length, 1);
  assert.equal(tokens.join("").includes("webfetch"), false);
  assert.equal(canvasNodes.some((node) => /DSML|tool_calls|webfetch|invoke|parameter|maxcontentlength|2504\.19678/i.test(String(node.content))), false);
  assert.ok(canvasNodes.some((node) => node.title === "正文草稿" && String(node.content).includes("工作正文草稿")));
  assert.equal(events.some((event) => event.eventType === "canvas_delivery_failed_summary_committed"), false);
  assert.equal(events.some((event) => event.eventType === "canvas_delivery_body_final_committed"), false);
  const record = records[0] as { events?: Array<{ eventType: string }> };
  assert.ok(record.events?.some((event) => event.eventType === "internal_output_blocked"));
  assert.equal(record.events?.some((event) => event.eventType === "agent_backend_runtime_failed"), false);
});

test("progressive Canvas notes sanitize unsafe tool snippets", async () => {
  const { storage, canvasNodes } = fakeStorage();
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.({
          eventType: "agent_backend_tool_completed",
          payload: {
            toolName: "read_file",
            path: "/mnt/user-data/workspace/.env",
            snippet: "OPENAI_API_KEY=sk-secret\n# AgentCard\nprivate prompt\n< | | DSML | | tool_calls> < / | / DSML / / invoke name=\"webfetch\">"
          }
        });
        throw new Error("Recursion limit of 100 reached without hitting a stop condition.");
      }
    }
  });

  const result = await service.generateAndRecordStream({
      mode: "chat",
      locale: "en",
      agentCardId: "chat-agent",
      chatInstruction: "Audit the project files",
      transientSkillRefs: ["database-lookup"],
      contextValues: { canvas: { workflow: { mode: "batch_delivery" } } }
  });

  assert.equal(result.completion?.status, "failed");
  assert.match(result.errorMessage ?? "", /Recursion limit of 100 reached/);
  const text = canvasNodes.map((node) => String(node.content)).join("\n");
  assert.equal(text.includes("sk-secret"), false);
  assert.equal(text.includes("OPENAI_API_KEY"), false);
  assert.equal(text.includes("# AgentCard"), false);
  assert.equal(/DSML|tool_calls|webfetch|invoke/i.test(text), false);
});

test("streaming direct Canvas delivery progressively creates placeholders and finalizes stable nodes", async () => {
  const { storage, canvasNodes, canvasEdges } = fakeStorage();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const reasoningTokens: string[] = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => ({
        text: [
          "# MacBook Comparison",
          "M3 improves CPU and GPU performance.",
          "",
          "# Buying Advice",
          "Choose M3 for longer support.",
          "",
          "## Sources",
          "- [Apple](https://example.com/apple)"
        ].join("\n"),
        finishReason: "agent_backend_completed",
        events: [{
          eventType: "agent_backend_tool_completed",
          payload: {
            toolName: "web_search",
            sources: [{ title: "Apple", url: "https://example.com/apple" }]
          }
        }]
      })
    }
  });

  const progressEvents: Array<{ title?: string; summary: string; visibility?: string }> = [];
  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: "Compare MacBook generations and organize the relevant information in Canvas.",
    toolState: { web_search: true }
  }, {
    onReasoningToken: (token) => reasoningTokens.push(token),
    onProgressEvent: (event) => progressEvents.push(event),
    onToolEvent: (event) => events.push(event as typeof events[number])
  });

  assert.equal(result.usedMock, false);
  assert.equal(result.text.includes("Creating outline"), false);
  assert.equal(reasoningTokens.join("").includes("Preparing context"), false);
  assert.ok(progressEvents.every((event) => event.visibility !== "raw"));
  assert.ok(progressEvents.some((event) => event.title === "Preparing run" && event.summary.includes("Preparing task context")));
  assert.ok(progressEvents.some((event) => event.title === "Deliverable update" && event.summary.includes("Canvas updates")));
  assert.ok(progressEvents.some((event) => event.summary.includes("reconciling Canvas nodes")));
  assert.ok(events.some((event) => event.eventType === "canvas_delivery_outline_committed"));
  assert.ok(canvasNodes.length >= 3);
  assert.ok(canvasEdges.length >= 2);
  assert.ok(canvasNodes.some((node) => node.title === "MacBook Comparison" && String(node.content).includes("M3 improves")));
  assert.ok(canvasNodes.some((node) => node.kind === "reference" && String(node.content).includes("https://example.com/apple")));
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

test("generation accepts a persisted Plan clarification when the stream event is missing", async () => {
  const { storage, planState } = fakeStorage();
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => {
        Object.assign(planState, {
          status: "awaiting_user",
          clarification: { question: "Which models?", options: [], status: "pending" }
        });
        return { text: "Which models?", finishReason: "stop", events: [] };
      }
    }
  });

  const result = await service.generateAndRecord({ mode: "chat", locale: "en", agentCardId: "blog-post", chatInstruction: "/plan Compare laptops" });
  assert.equal(result.provider, "agent-backend");
});

test("generation records recovery when a Plan success event was not persisted", async () => {
  const { storage, planState } = fakeStorage();
  const activities: Array<Record<string, unknown>> = [];
  storage.recordPlanActivity = (_threadId, _planId, input) => {
    activities.push(input);
    return {
      id: `activity_${activities.length}`,
      threadId: _threadId,
      planRunId: _planId,
      runId: input.runId,
      stepId: input.stepId,
      type: input.type,
      status: input.status,
      summary: String(input.summary ?? ""),
      detail: input.detail ?? {},
      sequence: activities.length,
      createdAt: new Date(0).toISOString()
    };
  };
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => ({
        text: "Which models?",
        finishReason: "stop",
        events: [{ eventType: "agent_backend_plan_waiting_for_user", payload: { planId: "plan_intake_test" } }]
      })
    }
  });

  const result = await service.generateAndRecord({ mode: "chat", locale: "en", agentCardId: "blog-post", chatInstruction: "/plan Compare laptops" });

  assert.equal(result.provider, "agent-backend");
  assert.equal(planState.status, "failed");
  assert.match(String(planState.statusMessage), /persisted clarification/);
  assert.equal(activities.at(-1)?.type, "plan_failed");
  assert.equal(activities.at(-1)?.status, "needs_recovery");
});

test("generation facade blocks AgentBackend internal prompt output without fallback", async () => {
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
  assert.equal(result.provider, "agent-backend");
  assert.equal(result.usedMock, false);
  assert.equal(result.text, "");
  assert.equal(result.errorMessage, undefined);
  assert.equal((records[0] as { output: string }).output.includes("# AgentCard"), false);
  assert.ok((records[0] as { events: Array<{ eventType: string }> }).events.some((event) => event.eventType === "internal_output_blocked"));
  assert.equal((records[0] as { events: Array<{ eventType: string }> }).events.some((event) => event.eventType === "agent_backend_runtime_failed"), false);
});

test("generation facade blocks provider-unavailable AgentBackend text without fallback", async () => {
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

  assert.equal(result.provider, "agent-backend");
  assert.equal(result.usedMock, false);
  assert.equal(result.text, "");
  assert.equal((records[0] as { errorMessage?: string }).errorMessage, undefined);
  assert.ok((records[0] as { events: Array<{ eventType: string }> }).events.some((event) => event.eventType === "internal_output_blocked"));
  assert.equal((records[0] as { events: Array<{ eventType: string }> }).events.some((event) => event.eventType === "agent_backend_runtime_failed"), false);
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

test("streaming generation applies transient skills without saving them to Agent settings", async () => {
  const { storage } = fakeStorage();
  const config = runtimeConfig();
  let observedPrompt = "";
  const timelineEvents: Array<{ title: string; summary: string; payload?: Record<string, unknown> }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(config), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        observedPrompt = input.prompt;
        return {
          text: "Transient skill response",
          finishReason: "stop",
          events: []
        };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "zh",
    agentCardId: "chat-agent",
    chatInstruction: "帮我总结一下",
    transientSkillRefs: ["summary"],
    contextValues: { autoPreflightPlan: { enabled: false } }
  }, {
    onTimelineEvent: (event) => timelineEvents.push(event)
  });

  assert.equal(result.provider, "agent-backend");
  assert.match(observedPrompt, /# Loaded Skills/);
  assert.match(observedPrompt, /## summary/);
  assert.deepEqual(config.settings.prompt.skillRefs, []);
  const skillEvent = timelineEvents.find((event) => event.payload?.source === "composer");
  assert.equal(skillEvent?.title, "使用技能");
  assert.equal(skillEvent?.summary, "使用技能：summary");
  assert.deepEqual(skillEvent?.payload, { source: "composer", skillRefs: ["summary"] });
});

test("streaming generation can disable Agent default skills for one request", async () => {
  const { storage } = fakeStorage();
  const config = runtimeConfig();
  config.agentCard = { ...config.agentCard, skillRefs: ["summary"] };
  config.settings = {
    ...config.settings,
    prompt: {
      ...config.settings.prompt,
      skillRefs: ["summary"]
    }
  };
  let observedPrompt = "";
  const service = createGenerationService(storage, fakeAgentRuntime(config), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        observedPrompt = input.prompt;
        return {
          text: "Default skill disabled response",
          finishReason: "stop",
          events: []
        };
      }
    }
  });

  await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: "Answer normally",
    disabledSkillRefs: ["summary"]
  });

  assert.doesNotMatch(observedPrompt, /## summary/);
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
