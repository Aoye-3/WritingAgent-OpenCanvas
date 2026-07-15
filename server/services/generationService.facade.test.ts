import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
import type { DurableContinuationDescriptor } from "../storageTypes.js";
import { isAgentIntakeExecution } from "./generation/agentIntakePolicy.js";

const durableTaskGuardCases = JSON.parse(
  readFileSync(new URL("../runtime/agentBackendAdapter/fixtures/durable-task-guard-cases.json", import.meta.url), "utf8")
) as Array<{ id: string; text: string; hasEvidence: boolean; expectContinuation: boolean }>;

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
  const persistedByClientRequest = new Map<string, Record<string, unknown>>();
  const agentClarifications: Array<Record<string, unknown>> = [];
  const canvasWriteRequests: unknown[] = [];
  const canvasNodes: Array<Record<string, unknown>> = [];
  const canvasEdges: Array<Record<string, unknown>> = [];
  const projectRuntimeSettings = {
    runtimeBudgetProfile: "low" as const,
    evidenceToolLimit: 8,
    bodyDraftWriteLimit: 2,
    modelCallLimit: 18,
    recursionLimit: 80,
    synthesisReserveSteps: 16
  };
  const planState: Record<string, unknown> = {
    id: "plan_intake_test",
    status: "draft",
    approval: "pending",
    steps: [],
    artifacts: []
  };
  const durable: {
    current?: {
      state: "ready" | "claimed" | "completed" | "failed" | "superseded";
      descriptor: DurableContinuationDescriptor;
      sourceRunId?: string;
      claimToken?: string;
      attempts: number;
      lastError?: string;
    };
  } = {};
  return {
    records,
    agentClarifications,
    canvasWriteRequests,
    canvasNodes,
    canvasEdges,
    projectRuntimeSettings,
    planState,
    durable,
    storage: {
      ensureThread: async () => undefined,
      getThread: () => ({ id: "thread_test", projectId: "project_test", title: "Test", configuredModelApiId: "configured-test", contextResetAt, updatedAt: "" }),
      getProject: () => ({ id: "project_test", title: "Test", summary: "", updatedAt: "" }),
      getProjectRuntimeSettings: () => ({ ...projectRuntimeSettings }),
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
      queueAgentClarificationAnswer: (_threadId: string, clarificationId: string, input: Record<string, unknown>) => {
        const clarification = agentClarifications.find((item) => item.id === clarificationId);
        if (!clarification) return { outcome: "not_found" };
        if (clarification.status === "answered") {
          const same = clarification.selectedOptionId === input.selectedOptionId
            && clarification.selectedOptionLabel === input.selectedOptionLabel
            && clarification.answer === input.answer;
          if (!same) return { outcome: "conflict", clarification };
          if (clarification.resumeState !== "failed") return { outcome: "idempotent", clarification };
        }
        const resumeContext = clarification.resumeContext as Record<string, unknown> | undefined;
        const runtimeResume = resumeContext?.runtimeResume as Record<string, unknown> | undefined;
        const resumable = Boolean(runtimeResume?.runtimeThreadId && runtimeResume.runtimeRunId && runtimeResume.interruptId);
        Object.assign(clarification, input, {
          status: "answered",
          resumeState: resumable ? "queued" : "not_resumable",
          resumeError: undefined
        });
        return { outcome: resumable ? "queued" : "not_resumable", clarification };
      },
      claimAgentClarificationResume: (_threadId: string, clarificationId: string) => {
        const clarification = agentClarifications.find((item) => item.id === clarificationId);
        if (!clarification || clarification.resumeState !== "queued") return false;
        clarification.resumeState = "resuming";
        clarification.resumeAttempts = Number(clarification.resumeAttempts ?? 0) + 1;
        return true;
      },
      failAgentClarificationResume: (_threadId: string, clarificationId: string, error: string) => {
        const clarification = agentClarifications.find((item) => item.id === clarificationId);
        if (!clarification || clarification.resumeState !== "resuming") return false;
        clarification.resumeState = "failed";
        clarification.resumeError = error;
        return true;
      },
      readDurableContinuation: () => durable.current,
      claimDurableContinuation: () => {
        if (durable.current?.state === "claimed") {
          throw Object.assign(new Error("durable_continuation_in_progress"), { code: "durable_continuation_in_progress" });
        }
        if (!durable.current || (durable.current.state !== "ready" && durable.current.state !== "failed")) {
          throw Object.assign(new Error("durable_continuation_unavailable"), { code: "durable_continuation_unavailable" });
        }
        durable.current = {
          ...durable.current,
          state: "claimed",
          attempts: durable.current.attempts + 1,
          claimToken: `claim_${durable.current.attempts + 1}`,
          lastError: undefined
        };
        return durable.current;
      },
      supersedeDurableContinuation: () => {
        if (!durable.current || (durable.current.state !== "ready" && durable.current.state !== "failed")) return false;
        durable.current = { ...durable.current, state: "superseded", claimToken: undefined };
        return true;
      },
      failDurableContinuation: (_threadId: string, claimToken: string, error: string) => {
        if (durable.current?.state !== "claimed" || durable.current.claimToken !== claimToken) return false;
        durable.current = { ...durable.current, state: "failed", claimToken: undefined, lastError: error };
        return true;
      },
      readDurableContinuationCanvas: () => ({
        nodes: canvasNodes,
        edges: canvasEdges,
        objects: [],
        workflow: { mode: "batch_delivery", stage: "draft" }
      }),
      listDurableContinuationEvidence: () => [],
      readGenerationByClientRequest: (_threadId: string, clientRequestId?: string) => clientRequestId
        ? persistedByClientRequest.get(clientRequestId)
        : undefined,
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
        const resumedClarificationId = (input as { resumedClarificationId?: string }).resumedClarificationId;
        if (resumedClarificationId) {
          const clarification = agentClarifications.find((item) => item.id === resumedClarificationId);
          if (clarification?.resumeState === "resuming") {
            clarification.resumeState = (input as { errorMessage?: string }).errorMessage ? "failed" : "succeeded";
            clarification.resumeError = (input as { errorMessage?: string }).errorMessage;
            clarification.resumedRuntimeRunId = (input as { runtimeRunId?: string }).runtimeRunId;
          }
        }
        for (const event of record.events ?? []) {
          const payload = event.payload ?? {};
          if (event.eventType !== "agent_backend_agent_clarification_requested" && payload.type !== "agent_clarification_requested") continue;
          agentClarifications.push({
            id: String(payload.clarificationId ?? payload.toolCallId ?? `clarification_${agentClarifications.length + 1}`),
            status: "pending",
            question: payload.question,
            options: payload.options,
            resumeContext: payload.resumeContext ?? {},
            resumeState: (payload.resumeContext as Record<string, unknown> | undefined)?.runtimeResume ? "awaiting_answer" : "not_resumable",
            resumeAttempts: 0
          });
        }
        const continuation = input as {
          durableContinuationDescriptor?: DurableContinuationDescriptor;
          durableContinuationClaimToken?: string;
          completion?: { status?: string };
          errorMessage?: string;
          clientRequestId?: string;
        };
        const hasResumableClarification = (record.events ?? []).some((event) => {
          const payload = event.payload ?? {};
          const resumeContext = payload.resumeContext && typeof payload.resumeContext === "object" && !Array.isArray(payload.resumeContext)
            ? payload.resumeContext as Record<string, unknown>
            : {};
          const runtimeResume = resumeContext.runtimeResume && typeof resumeContext.runtimeResume === "object" && !Array.isArray(resumeContext.runtimeResume)
            ? resumeContext.runtimeResume as Record<string, unknown>
            : {};
          return (event.eventType === "agent_backend_agent_clarification_requested" || payload.type === "agent_clarification_requested")
            && typeof payload.question === "string"
            && Array.isArray(payload.options)
            && payload.options.length >= 2
            && typeof runtimeResume.runtimeThreadId === "string"
            && typeof runtimeResume.runtimeRunId === "string"
            && typeof runtimeResume.interruptId === "string";
        });
        const shouldRequeue = continuation.completion?.status === "continue"
          || continuation.completion?.status === "partial"
          || continuation.completion?.status === "waiting" && !hasResumableClarification;
        if (shouldRequeue && continuation.durableContinuationDescriptor) {
          durable.current = {
            state: "ready",
            descriptor: continuation.durableContinuationDescriptor,
            sourceRunId: `run_${records.length}`,
            attempts: durable.current?.attempts ?? 0
          };
        } else if (continuation.durableContinuationClaimToken && durable.current?.claimToken === continuation.durableContinuationClaimToken) {
          durable.current = {
            ...durable.current,
            state: continuation.completion?.status === "failed" ? "failed" : "completed",
            claimToken: undefined,
            ...(continuation.completion?.status === "failed" ? { lastError: continuation.errorMessage ?? "durable_continuation_run_failed" } : {})
          };
        }
        const saved = { runId: `run_${records.length}`, promptVersionId: "prompt_1", outputVersionId: "output_1" };
        if (continuation.clientRequestId) {
          const stored = input as Record<string, unknown>;
          persistedByClientRequest.set(continuation.clientRequestId, {
            ...saved,
            threadId: stored.threadId,
            text: stored.output,
            prompt: stored.prompt,
            provider: stored.provider,
            usedMock: stored.usedMock,
            errorMessage: stored.errorMessage,
            events: stored.events,
            finishReason: stored.finishReason,
            runtimeRunId: stored.runtimeRunId,
            runtimeThreadId: stored.runtimeThreadId,
            completion: stored.completion,
            usage: stored.usage
          });
        }
        return saved;
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
  assert.equal(result.completion?.status, "completed");
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

test("non-stream incomplete AgentBackend output remains visible without terminal side effects", async () => {
  const screenshotCase = durableTaskGuardCases.find((entry) => entry.id === "zh_screenshot_action_promise");
  assert.ok(screenshotCase);
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
      runAgent: async () => ({
        text: screenshotCase.text,
        finishReason: "agent_backend_incomplete",
        events: []
      })
    }
  });

  const result = await service.generateAndRecord({
    mode: "chat",
    locale: "zh",
    agentCardId: "chat-agent",
    chatInstruction: "Continue approved plan plan_intake_test. Execute only step step_1.",
    planPhase: "execution",
    planId: "plan_intake_test",
    stepId: "step_1",
    planGeneration: { phase: "execution", planId: "plan_intake_test", stepId: "step_1", phaseAttemptId: "exec_incomplete" },
    contextValues: {
      planExecution: { planId: "plan_intake_test", stepId: "step_1" },
      canvas: { workflow: { mode: "batch_delivery" } }
    }
  });

  const record = records[0] as { output: string; completion?: { status?: string }; events?: ToolEventRecord[] };
  assert.equal(result.text, screenshotCase.text);
  assert.equal(result.completion?.status, "continue");
  assert.equal(record.output, screenshotCase.text);
  assert.equal(record.completion?.status, "continue");
  assert.notEqual((planState.steps as Array<{ status: string }>)[0]?.status, "completed");
  assert.notEqual(planState.status, "completed");
  assert.equal(canvasNodes.some((node) => (node.metadata as { status?: string } | undefined)?.status === "final"), false);
  assert.equal(record.events?.some((event) => event.eventType === "canvas_delivery_body_final_committed"), false);
  assert.equal(record.events?.some((event) => event.eventType === "run_timeline_run_completed"), false);
  assert.ok(record.events?.some((event) => event.eventType === "run_timeline_run_incomplete"));
});

test("streaming incomplete AgentBackend output skips Canvas finalization and run completion", async () => {
  const screenshotCase = durableTaskGuardCases.find((entry) => entry.id === "zh_screenshot_action_promise");
  assert.ok(screenshotCase);
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
  const timelineEvents: Array<{ eventType: string }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToken?.(screenshotCase.text);
        return {
          text: screenshotCase.text,
          finishReason: "agent_backend_incomplete",
          events: []
        };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "zh",
    agentCardId: "chat-agent",
    chatInstruction: "Continue approved plan plan_intake_test. Execute only step step_1.",
    planPhase: "execution",
    planId: "plan_intake_test",
    stepId: "step_1",
    planGeneration: { phase: "execution", planId: "plan_intake_test", stepId: "step_1", phaseAttemptId: "exec_stream_incomplete" },
    contextValues: {
      planExecution: { planId: "plan_intake_test", stepId: "step_1" },
      canvas: { workflow: { mode: "batch_delivery" } }
    }
  }, {
    onTimelineEvent: (event) => timelineEvents.push(event)
  });

  const record = records[0] as { output: string; completion?: { status?: string }; events?: ToolEventRecord[] };
  assert.equal(result.text, screenshotCase.text);
  assert.equal(result.completion?.status, "continue");
  assert.equal(record.output, screenshotCase.text);
  assert.equal(record.completion?.status, "continue");
  assert.notEqual((planState.steps as Array<{ status: string }>)[0]?.status, "completed");
  assert.notEqual(planState.status, "completed");
  assert.equal(canvasNodes.some((node) => (node.metadata as { status?: string } | undefined)?.status === "final"), false);
  assert.equal(timelineEvents.some((event) => event.eventType === "run_completed"), false);
  assert.ok(timelineEvents.some((event) => event.eventType === "run_incomplete"));
  assert.equal(record.events?.some((event) => event.eventType === "canvas_delivery_body_final_committed"), false);
});

test("clarification protocol failure skips Canvas finalization despite replayed terminal delivery evidence", async () => {
  const { storage, canvasNodes, records } = fakeStorage();
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => ({
        text: "# Literature review\n\n## Summary\nA stale document is available.",
        finishReason: "clarification_required",
        events: [{
          eventType: "canvas_delivery_file_document_committed",
          payload: {
            status: "committed",
            path: "/mnt/user-data/outputs/old-literature-review.md",
            title: "old-literature-review.md"
          }
        }]
      })
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: "Write a new literature review from the existing Canvas content.",
    transientSkillRefs: ["literature-review"],
    contextValues: {
      taskHandlingPolicy: { kind: "long_task", canvasDeliveryMode: "progressive", allowPlan: false },
      progressiveCanvasDelivery: { enabled: true },
      canvas: { workflow: { mode: "batch_delivery" } }
    }
  });

  const record = records[0] as { completion?: { status?: string }; events?: ToolEventRecord[] };
  assert.equal(result.completion?.status, "failed");
  assert.equal(record.completion?.status, "failed");
  assert.equal(canvasNodes.some((node) => (node.metadata as { status?: string } | undefined)?.status === "final"), false);
  assert.equal(record.events?.some((event) => event.eventType === "run_timeline_run_completed"), false);
});

test("non-stream completed AgentBackend promise is continued before terminal side effects", async () => {
  const promiseCase = durableTaskGuardCases.find((entry) => entry.id === "english_proceed_promise");
  assert.ok(promiseCase);
  const { storage, canvasNodes, planState, records } = fakeStorage();
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => ({
        text: promiseCase.text,
        finishReason: "agent_backend_completed",
        events: []
      })
    }
  });

  const result = await service.generateAndRecord({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: "Research database records and write a verified report",
    transientSkillRefs: ["database-lookup"],
    contextValues: {
      autoPreflightPlan: { enabled: false },
      agentClarification: answeredAgentClarification(),
      canvas: { workflow: { mode: "batch_delivery" } }
    }
  });

  const record = records[0] as { completion?: { status?: string }; events?: ToolEventRecord[] };
  assert.equal(result.text, promiseCase.text);
  assert.equal(result.completion?.status, "continue");
  assert.equal(record.completion?.status, "continue");
  assert.equal(canvasNodes.some((node) => (node.metadata as { status?: string } | undefined)?.status === "final"), false);
  assert.equal(record.events?.some((event) => event.eventType === "canvas_delivery_body_final_committed"), false);
  assert.equal(record.events?.some((event) => event.eventType === "run_timeline_run_completed"), false);
  assert.notEqual(planState.status, "completed");
});

test("streaming completed AgentBackend promise is continued before terminal side effects", async () => {
  const promiseCase = durableTaskGuardCases.find((entry) => entry.id === "english_continue_promise");
  assert.ok(promiseCase);
  const { storage, canvasNodes, planState, records } = fakeStorage();
  const timelineEvents: Array<{ eventType: string }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToken?.(promiseCase.text);
        return {
          text: promiseCase.text,
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
    chatInstruction: "Research database records and write a verified report",
    transientSkillRefs: ["database-lookup"],
    contextValues: {
      autoPreflightPlan: { enabled: false },
      agentClarification: answeredAgentClarification(),
      canvas: { workflow: { mode: "batch_delivery" } }
    }
  }, {
    onTimelineEvent: (event) => timelineEvents.push(event)
  });

  const record = records[0] as { completion?: { status?: string }; events?: ToolEventRecord[] };
  assert.equal(result.text, promiseCase.text);
  assert.equal(result.completion?.status, "continue");
  assert.equal(record.completion?.status, "continue");
  assert.equal(canvasNodes.some((node) => (node.metadata as { status?: string } | undefined)?.status === "final"), false);
  assert.equal(timelineEvents.some((event) => event.eventType === "run_completed"), false);
  assert.equal(record.events?.some((event) => event.eventType === "canvas_delivery_body_final_committed"), false);
  assert.notEqual(planState.status, "completed");
});

test("streaming post-evidence promise cannot become final Canvas Markdown", async () => {
  const promiseCase = durableTaskGuardCases.find((entry) => entry.id === "post_evidence_synthesis");
  assert.ok(promiseCase);
  const { storage, canvasNodes, planState, records } = fakeStorage();
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.({
          eventType: "agent_backend_tool_completed",
          payload: {
            toolName: "web_search",
            toolCallId: "search_before_promise",
            sources: [{ title: "Evidence", url: "https://example.com/evidence" }]
          }
        });
        return {
          text: promiseCase.text,
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
    chatInstruction: "Research database records and write a verified report",
    transientSkillRefs: ["database-lookup"],
    contextValues: {
      autoPreflightPlan: { enabled: false },
      agentClarification: answeredAgentClarification(),
      canvas: { workflow: { mode: "batch_delivery" } }
    }
  });

  const record = records[0] as { completion?: { status?: string }; events?: ToolEventRecord[] };
  assert.equal(result.completion?.status, "continue");
  assert.equal(record.completion?.status, "continue");
  assert.equal(canvasNodes.some((node) => (node.metadata as { status?: string } | undefined)?.status === "final"), false);
  assert.equal(record.events?.some((event) => event.eventType === "canvas_delivery_body_final_committed"), false);
  assert.equal(record.events?.some((event) => event.eventType === "run_timeline_run_completed"), false);
  assert.notEqual(planState.status, "completed");
});

test("non-stream direct Canvas delivery does not finalize a post-evidence action promise", async () => {
  const promiseCase = durableTaskGuardCases.find((entry) => entry.id === "post_evidence_synthesis");
  assert.ok(promiseCase);
  const { storage, canvasNodes, planState, records } = fakeStorage();
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.({
          eventType: "agent_backend_tool_completed",
          payload: { toolName: "database_query", toolCallId: "query_before_direct_promise" }
        });
        return { text: promiseCase.text, finishReason: "agent_backend_completed", events: [] };
      }
    }
  });

  const result = await service.generateAndRecord({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: "Create the requested recommendation as editable Canvas nodes",
    transientSkillRefs: ["database-lookup"],
    contextValues: { autoPreflightPlan: { enabled: false }, canvas: { workflow: { mode: "batch_delivery" } } }
  });

  const record = records.at(-1) as { completion?: { status?: string }; events?: ToolEventRecord[] };
  assert.equal(result.completion?.status, "continue");
  assert.equal(record.completion?.status, "continue");
  assert.equal(canvasNodes.some((node) => (node.metadata as { status?: string } | undefined)?.status === "final"), false);
  assert.equal(record.events?.some((event) => event.eventType === "run_timeline_run_completed"), false);
  assert.notEqual(planState.status, "completed");
});

test("streaming direct Canvas delivery does not finalize a post-evidence action promise", async () => {
  const promiseCase = durableTaskGuardCases.find((entry) => entry.id === "post_evidence_synthesis");
  assert.ok(promiseCase);
  const { storage, canvasNodes, planState, records } = fakeStorage();
  const timelineEvents: Array<{ eventType: string }> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.({
          eventType: "agent_backend_tool_completed",
          payload: { toolName: "database_query", toolCallId: "query_before_stream_direct_promise" }
        });
        input.onToken?.(promiseCase.text);
        return { text: promiseCase.text, finishReason: "agent_backend_completed", events: [] };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: "Create the requested recommendation as editable Canvas nodes",
    transientSkillRefs: ["database-lookup"],
    contextValues: { autoPreflightPlan: { enabled: false }, canvas: { workflow: { mode: "batch_delivery" } } }
  }, { onTimelineEvent: (event) => timelineEvents.push(event) });

  const record = records.at(-1) as { completion?: { status?: string }; events?: ToolEventRecord[] };
  assert.equal(result.completion?.status, "continue");
  assert.equal(record.completion?.status, "continue");
  assert.equal(canvasNodes.some((node) => (node.metadata as { status?: string } | undefined)?.status === "final"), false);
  assert.equal(timelineEvents.some((event) => event.eventType === "run_completed"), false);
  assert.equal(record.events?.some((event) => event.eventType === "run_timeline_run_completed"), false);
  assert.notEqual(planState.status, "completed");
});

test("non-stream checkpoint-only Canvas evidence remains non-completed", async () => {
  const { storage, canvasNodes, planState, records } = fakeStorage();
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        input.onToolEvent?.({
          eventType: "agent_backend_tool_completed",
          payload: {
            toolName: "web_search",
            toolCallId: "search_checkpoint_only",
            sources: [{ title: "Draft evidence", url: "https://example.com/draft" }]
          }
        });
        return { text: "Progress checkpoint saved.", finishReason: "agent_backend_completed", events: [] };
      }
    }
  });

  const result = await service.generateAndRecord({
    mode: "chat",
    locale: "en",
    agentCardId: "chat-agent",
    chatInstruction: "Research database records and write a verified report",
    transientSkillRefs: ["database-lookup"],
    contextValues: {
      autoPreflightPlan: { enabled: false },
      agentClarification: answeredAgentClarification(),
      canvas: { workflow: { mode: "batch_delivery" } }
    }
  });

  const record = records[0] as { completion?: { status?: string }; events?: ToolEventRecord[] };
  assert.equal(result.completion?.status, "partial");
  assert.equal(record.completion?.status, "partial");
  assert.ok(record.events?.some((event) => event.eventType === "canvas_delivery_body_checkpoint_committed"));
  assert.equal(canvasNodes.some((node) => (node.metadata as { status?: string } | undefined)?.status === "final"), false);
  assert.equal(record.events?.some((event) => event.eventType === "canvas_delivery_body_final_committed"), false);
  assert.equal(record.events?.some((event) => event.eventType === "run_timeline_run_completed"), false);
  assert.notEqual(planState.status, "completed");
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

test("persisted clarification metadata resumes the checkpoint and retains the answer on failure", async () => {
  const { storage, agentClarifications } = fakeStorage();
  agentClarifications.push({
    id: "clarification_1",
    threadId: "thread_test",
    runId: "run_waiting",
    status: "pending",
    question: "Which scope should I use?",
    options: [
      { id: "recent", label: "Recent sources", detail: "Use the last 12 months", recommended: true },
      { id: "broad", label: "Broad scan", detail: "Cover the full field" }
    ],
    resumeContext: {
      originalInstruction: "Review agent literature",
      transientSkillRefs: [],
      disabledSkillRefs: [],
      canvas: {},
      runtimeResume: {
        runtimeThreadId: "runtime_thread_1",
        runtimeRunId: "runtime_run_1",
        interruptId: "interrupt_1",
        checkpointId: "checkpoint_1"
      }
    },
    resumeState: "awaiting_answer",
    resumeAttempts: 0
  });
  let freshRunCalled = false;
  let resumeRunCalled = false;
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => {
        freshRunCalled = true;
        throw new Error("fresh run must not be used for a persisted clarification answer");
      },
      resumeRun: async (input) => {
        resumeRunCalled = true;
        assert.equal(input.threadId, "runtime_thread_1");
        assert.equal(input.resumeOfRunId, "runtime_run_1");
        assert.equal(input.interruptId, "interrupt_1");
        assert.equal(input.checkpointId, "checkpoint_1");
        throw new Error("runtime unavailable");
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    threadId: "thread_test",
    agentCardId: "chat-agent",
    chatInstruction: "Review agent literature\n\nSelected clarification: Recent sources",
    contextValues: {
      agentClarification: {
        clarificationId: "clarification_1",
        question: "Which scope should I use?",
        selectedOptionId: "recent",
        answer: "Recent sources",
        option: { id: "recent", label: "Recent sources", detail: "Use the last 12 months" }
      }
    }
  });

  assert.equal(result.finishReason, "runtime_failed");
  assert.equal(freshRunCalled, false);
  assert.equal(resumeRunCalled, true);
  assert.equal(agentClarifications[0]?.status, "answered");
  assert.equal(agentClarifications[0]?.answer, "Recent sources");
  assert.equal(agentClarifications[0]?.resumeState, "failed");
  assert.equal(agentClarifications[0]?.resumeAttempts, 1);
});

test("checkpoint intake completion requests final supplement before fresh execution", async () => {
  const { storage, agentClarifications, records } = fakeStorage();
  agentClarifications.push({
    id: "clarification_resume_before_supplement",
    threadId: "thread_test",
    runId: "run_waiting",
    status: "pending",
    question: "Which time range should the review cover?",
    options: [
      { id: "recent", label: "Recent sources", detail: "Use the last two years", recommended: true },
      { id: "broad", label: "Broad scan", detail: "Cover the full field" }
    ],
    resumeContext: {
      runtimeResume: {
        runtimeThreadId: "runtime_thread_1",
        runtimeRunId: "runtime_run_1",
        interruptId: "interrupt_1",
        checkpointId: "checkpoint_1"
      }
    },
    resumeState: "awaiting_answer",
    resumeAttempts: 0
  });
  let freshRunCalls = 0;
  let resumeRunCalls = 0;
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => {
        freshRunCalls += 1;
        return { text: "Executed after final confirmation.", finishReason: "agent_backend_completed", events: [] };
      },
      resumeRun: async () => {
        resumeRunCalls += 1;
        return {
          text: "",
          finishReason: "agent_backend_completed",
          events: [{ eventType: "agent_backend_agent_intake_complete", payload: { summary: "Ready" } }]
        };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    threadId: "thread_test",
    agentCardId: "chat-agent",
    chatInstruction: "Continue the literature review",
    contextValues: {
      agentClarification: {
        clarificationId: "clarification_resume_before_supplement",
        question: "Which time range should the review cover?",
        selectedOptionId: "recent",
        answer: "Recent sources",
        option: { id: "recent", label: "Recent sources", detail: "Use the last two years" }
      },
      agentIntake: { phase: "execution", completed: true }
    }
  });

  assert.equal(freshRunCalls, 0);
  assert.equal(resumeRunCalls, 1);
  assert.equal(result.finishReason, "final_supplement_required");
  assert.equal(agentClarifications[0]?.resumeState, "succeeded");

  const request = (records.at(-1) as { events?: ToolEventRecord[] }).events
    ?.find((event) => event.eventType === "agent_final_supplement_requested");
  assert.equal(request?.payload.question, "Is there anything else to add?");
  const finalSupplementId = String(request?.payload.finalSupplementId);
  const requestContext = request?.payload.requestContext as Record<string, unknown>;

  const executed = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    threadId: "thread_test",
    agentCardId: "chat-agent",
    chatInstruction: "Continue the literature review",
    contextValues: {
      ...requestContext,
      finalSupplement: { finalSupplementId, action: "execute" }
    }
  });

  assert.equal(executed.finishReason, "agent_backend_completed");
  assert.equal(resumeRunCalls, 1);
  assert.equal(freshRunCalls, 1);
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
  assert.equal(policy.maxIntakeRounds, 5);
  assert.match(String(policy.answeredSummary), /Multi-agent systems/);
  assert.equal((policy.missingSlots as string[]).includes("citation format"), true);
  assert.equal((policy.missingSlots as string[]).includes("output structure"), true);
  assert.match(String(policy.instruction), /Question quality strategy/);
  assert.match(String(policy.instruction), /Socratic clarification/);
  assert.match(String(policy.instruction), /highest-impact missing slot/);
  assert.match(String(policy.instruction), /low-value generic confirmation/);
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

test("answered clarification requests final supplement before execution", async () => {
  const { storage, records } = fakeStorage();
  let calls = 0;
  const events: ToolEventRecord[] = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => {
        calls += 1;
        return { text: "Executed", finishReason: "agent_backend_completed", events: [] };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "zh",
    threadId: "thread_test",
    agentCardId: "chat-agent",
    chatInstruction: "写一份 Agent 调研报告\n\nSelected clarification: recent systems",
    contextValues: {
      agentClarification: {
        clarificationId: "agent_clarification_scope",
        question: "Which scope?",
        selectedOptionId: "recent",
        answer: "recent systems"
      },
      agentIntake: { phase: "execution", completed: true }
    }
  }, {
    onToolEvent: (event) => events.push(event)
  });

  assert.equal(calls, 0);
  assert.equal(result.finishReason, "final_supplement_required");
  assert.equal(events.some((event) => event.eventType === "agent_final_supplement_requested"), true);
  const record = records[0] as { events?: ToolEventRecord[] };
  const request = record.events?.find((event) => event.eventType === "agent_final_supplement_requested");
  assert.equal(request?.payload.question, "是否还有要补充的？");
  assert.equal(Boolean((request?.payload.requestContext as Record<string, unknown>).finalSupplement), false);
});

test("final supplement execute answer resumes execution and records the answer", async () => {
  const { storage, records } = fakeStorage();
  let calls = 0;
  let observedContextValues: Record<string, unknown> = {};
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        calls += 1;
        observedContextValues = input.contextValues ?? {};
        return { text: "Executed", finishReason: "agent_backend_completed", events: [] };
      }
    }
  });

  const result = await service.generateAndRecordStream({
    mode: "chat",
    locale: "en",
    threadId: "thread_test",
    agentCardId: "chat-agent",
    chatInstruction: "Write the report\n\nSelected clarification: recent systems",
    contextValues: {
      agentClarification: {
        clarificationId: "agent_clarification_scope",
        question: "Which scope?",
        selectedOptionId: "recent",
        answer: "recent systems"
      },
      agentIntake: { phase: "execution", completed: true },
      finalSupplement: {
        finalSupplementId: "final_supplement_1",
        action: "execute"
      }
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.finishReason, "agent_backend_completed");
  assert.equal(Boolean(observedContextValues.finalSupplement), false);
  const record = records[0] as { events?: ToolEventRecord[] };
  assert.equal(record.events?.some((event) => event.eventType === "agent_final_supplement_answered"), true);
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
      ],
      resumeContext: {
        runtimeResume: {
          runtimeThreadId: "runtime_thread_intake",
          runtimeRunId: "runtime_run_intake",
          interruptId: "interrupt_citation",
          checkpointId: "checkpoint_citation"
        }
      }
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
        const event = firstClarification;
        input.onToolEvent?.(event);
        return {
          text: "",
          finishReason: "clarification_required",
          events: [event]
        };
      },
      resumeRun: async (input) => {
        calls += 1;
        input.onToolEvent?.(repeatedClarification);
        return {
          text: "",
          finishReason: "clarification_required",
          events: [repeatedClarification]
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

test("research skill answered clarification resumes execution with low delivery budget", async () => {
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
      "Selected clarification: Continue with 30 papers, APA format"
    ].join("\n"),
    transientSkillRefs: ["database-lookup", "literature-review"],
    contextValues: {
      agentClarification: {
        clarificationId: "agent_clarification_format",
        selectedOptionId: "format_apa",
        answer: "Continue with 30 papers, APA format",
        resumeContext: {
          runtimeBudgetProfile: "low",
          canvas: { workflow: { mode: "batch_delivery" } },
          intakeRound: 3,
          answeredSummary: "Scope: Multi-agent systems; Time range: 2023-2026; Format: 30 papers, APA format"
        }
      },
      finalSupplement: {
        finalSupplementId: "final_supplement_budget",
        action: "execute"
      }
    },
    toolState: { web_search: true, knowledge_base: true }
  });

  assert.equal(result.finishReason, "agent_backend_completed");
  assert.equal(allowedToolRefs.includes("web_search"), true, JSON.stringify(allowedToolRefs));
  assert.equal(allowedToolRefs.includes("write_file"), true);
  assert.equal(allowedToolRefs.includes("present_files"), true);
  assert.notDeepEqual(allowedToolRefs, ["ask_clarification", "agent_intake_complete"]);
  assert.deepEqual(observedContextValues.agentIntake, { phase: "execution", completed: true });
  const delivery = observedContextValues.progressiveCanvasDelivery as Record<string, unknown>;
  assert.equal(delivery.enabled, true);
  assert.equal(delivery.runtimeBudgetProfile, "low");
  assert.equal(delivery.recursionLimit, 80);
  assert.equal(delivery.modelCallLimit, 18);
  assert.equal(delivery.evidenceToolLimit, 8);
  assert.equal(delivery.forceSynthesisAfterEvidence, true);
});

test("research skill recognizes timeline grouping from the selected option detail", async () => {
  const { storage } = fakeStorage();
  let allowedToolRefs: string[] = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        allowedToolRefs = input.allowedToolRefs ?? [];
        return { text: "开始检索。", finishReason: "agent_backend_completed", events: [] };
      }
    }
  });

  await service.generateAndRecordStream({
    mode: "chat",
    locale: "zh",
    threadId: "thread_test",
    agentCardId: "chat-agent",
    chatInstruction: "帮我查找与 Agent 相关的文献",
    transientSkillRefs: ["literature-review"],
    contextValues: {
      agentClarification: {
        clarificationId: "clarification_output_structure",
        selectedOptionId: "timeline",
        answer: "方案一",
        option: { id: "timeline", label: "方案一", detail: "按时间线分组" },
        resumeContext: {
          intakeRound: 2,
          answeredSummary: "AI Agent；不限时间；精选核心文献列表；APA 格式"
        }
      }
    },
    toolState: { web_search: true, knowledge_base: true }
  });

  assert.equal(allowedToolRefs.includes("ask_clarification"), false, JSON.stringify(allowedToolRefs));
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
    resumeContext: {
      runtimeResume: {
        runtimeThreadId: "runtime_thread_1",
        runtimeRunId: "runtime_run_1",
        interruptId: "interrupt_1",
        checkpointId: "checkpoint_1"
      }
    },
    resumeState: "awaiting_answer",
    resumeAttempts: 0
  });
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => {
        throw new Error("fresh run must not be used for a persisted clarification answer");
      },
      resumeRun: async () => ({
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

test("progressive Canvas creates a file document node after the complete references node", async () => {
  const appRoot = `.facetwrite-test/md-runtime-archive-${Date.now()}`;
  const previousRoot = process.env.FACETWRITE_APP_ROOT;
  process.env.FACETWRITE_APP_ROOT = appRoot;
  try {
    const { storage, canvasNodes, canvasEdges } = fakeStorage();
    const longMarkdown = `# Full report\n\n${"Long section content. ".repeat(200)}`;
    const sources = Array.from({ length: 6 }, (_, index) => ({
      title: `Agent paper ${index + 1}`,
      url: `https://example.com/agent-paper-${index + 1}`
    }));
    const service = createGenerationService(storage, fakeAgentRuntime(), {
      modelRuntime: fakeModelRuntime,
      archiveMarkdownOutput: (threadId, virtualPath) => archiveMarkdownForTest(threadId, virtualPath, longMarkdown),
      agentBackend: {
        getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
        runAgent: async (input) => {
          input.onToolEvent?.({
            eventType: "agent_backend_tool_completed",
            payload: {
              toolName: "web_search",
              query: "recent agent papers",
              sources
            }
          });
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
    const references = canvasNodes.find((node) => node.title === "References");
    assert.ok(references);
    for (const source of sources) {
      assert.ok(String(references.content).includes(source.url));
    }
    assert.ok(canvasEdges.some((edge) => edge.sourceNodeId === references.id && edge.targetNodeId === fileNodes[0]?.id));
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

test("progressive Canvas uses Markdown summary section for the Body summary node", async () => {
  const appRoot = `.facetwrite-test/md-summary-section-${Date.now()}`;
  const previousRoot = process.env.FACETWRITE_APP_ROOT;
  process.env.FACETWRITE_APP_ROOT = appRoot;
  try {
    const { storage, canvasNodes } = fakeStorage();
    const reportPath = "/mnt/user-data/outputs/summary-report.md";
    const reportMarkdown = [
      "# AI Transparency Review",
      "",
      "## Summary",
      "",
      "This concise summary should be shown on the Canvas body summary node.",
      "",
      "## Detailed Analysis",
      "",
      "UNIQUE_DEEP_FILE_CONTENT_SHOULD_ONLY_BE_IN_MARKDOWN_FILE",
      "Long detailed analysis. ".repeat(120)
    ].join("\n");
    const service = createGenerationService(storage, fakeAgentRuntime(), {
      modelRuntime: fakeModelRuntime,
      archiveMarkdownOutput: (threadId, virtualPath) => archiveMarkdownForTest(threadId, virtualPath, reportMarkdown),
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
            text: "Document ready.",
            finishReason: "agent_backend_completed",
            events: []
          };
        }
      }
    });

    await service.generateAndRecordStream({
      mode: "chat",
      locale: "en",
      threadId: "thread_md_summary_section",
      agentCardId: "chat-agent",
      chatInstruction: "Research and write a detailed report",
      contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, autoPreflightPlan: { enabled: false } }
    });

    const body = canvasNodes.find((node) => node.title === "Body");
    assert.ok(body);
    assert.ok(String(body.content).startsWith("# Body summary"));
    assert.ok(String(body.content).includes("concise summary should be shown"));
    assert.equal(String(body.content).includes("UNIQUE_DEEP_FILE_CONTENT_SHOULD_ONLY_BE_IN_MARKDOWN_FILE"), false);
    const fileNode = canvasNodes.find((node) => node.kind === "file_document");
    assert.ok(fileNode);
    assert.ok(String(fileNode.content).includes(reportPath));
    const saved = await readFile(path.resolve(process.cwd(), appRoot, "threads", "thread_md_summary_section", "user-data", "outputs", "summary-report.md"), "utf8");
    assert.ok(saved.includes("UNIQUE_DEEP_FILE_CONTENT_SHOULD_ONLY_BE_IN_MARKDOWN_FILE"));
  } finally {
    if (previousRoot === undefined) {
      delete process.env.FACETWRITE_APP_ROOT;
    } else {
      process.env.FACETWRITE_APP_ROOT = previousRoot;
    }
    await rm(path.resolve(process.cwd(), appRoot), { recursive: true, force: true });
  }
});

test("progressive Canvas fallback Body summary does not copy deep Markdown body sections", async () => {
  const appRoot = `.facetwrite-test/md-summary-fallback-${Date.now()}`;
  const previousRoot = process.env.FACETWRITE_APP_ROOT;
  process.env.FACETWRITE_APP_ROOT = appRoot;
  try {
    const { storage, canvasNodes } = fakeStorage();
    const reportPath = "/mnt/user-data/outputs/no-summary-report.md";
    const reportMarkdown = [
      "# Full Report",
      "",
      "This opening paragraph gives a compact overview of the result and should be enough for the Canvas summary.",
      "",
      "## Detailed Analysis",
      "",
      "UNIQUE_DEEP_FALLBACK_BODY_SHOULD_ONLY_BE_IN_MARKDOWN_FILE",
      "Detailed body content. ".repeat(80)
    ].join("\n");
    const service = createGenerationService(storage, fakeAgentRuntime(), {
      modelRuntime: fakeModelRuntime,
      archiveMarkdownOutput: (threadId, virtualPath) => archiveMarkdownForTest(threadId, virtualPath, reportMarkdown),
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
            text: "Document ready.",
            finishReason: "agent_backend_completed",
            events: []
          };
        }
      }
    });

    await service.generateAndRecordStream({
      mode: "chat",
      locale: "en",
      threadId: "thread_md_summary_fallback",
      agentCardId: "chat-agent",
      chatInstruction: "Research and write a detailed report",
      contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, autoPreflightPlan: { enabled: false } }
    });

    const body = canvasNodes.find((node) => node.title === "Body");
    assert.ok(body);
    assert.ok(String(body.content).startsWith("# Body summary"));
    assert.ok(String(body.content).includes("compact overview"));
    assert.equal(String(body.content).includes("UNIQUE_DEEP_FALLBACK_BODY_SHOULD_ONLY_BE_IN_MARKDOWN_FILE"), false);
    const saved = await readFile(path.resolve(process.cwd(), appRoot, "threads", "thread_md_summary_fallback", "user-data", "outputs", "no-summary-report.md"), "utf8");
    assert.ok(saved.includes("UNIQUE_DEEP_FALLBACK_BODY_SHOULD_ONLY_BE_IN_MARKDOWN_FILE"));
  } finally {
    if (previousRoot === undefined) {
      delete process.env.FACETWRITE_APP_ROOT;
    } else {
      process.env.FACETWRITE_APP_ROOT = previousRoot;
    }
    await rm(path.resolve(process.cwd(), appRoot), { recursive: true, force: true });
  }
});

test("progressive Canvas Body summary ignores outline table of contents", async () => {
  const appRoot = `.facetwrite-test/md-summary-outline-${Date.now()}`;
  const previousRoot = process.env.FACETWRITE_APP_ROOT;
  process.env.FACETWRITE_APP_ROOT = appRoot;
  try {
    const { storage, canvasNodes } = fakeStorage();
    const reportPath = "/mnt/user-data/outputs/outline-summary-report.md";
    const reportMarkdown = [
      "# AI Transparency Review",
      "",
      "This narrative opening paragraph belongs in the Canvas summary when no explicit summary section exists.",
      "",
      "## Detailed Analysis",
      "",
      "UNIQUE_OUTLINE_DEEP_BODY_SHOULD_ONLY_BE_IN_MARKDOWN_FILE",
      "Detailed body content. ".repeat(80)
    ].join("\n");
    const service = createGenerationService(storage, fakeAgentRuntime(), {
      modelRuntime: fakeModelRuntime,
      archiveMarkdownOutput: (threadId, virtualPath) => archiveMarkdownForTest(threadId, virtualPath, reportMarkdown),
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
            text: [
              "Done.",
              "",
              "```facetwrite_canvas_delivery",
              JSON.stringify({
                assistant_reply: "Document ready.",
                outline_markdown: "# Overview\n- Mini Literature Review completed",
                body_markdown: reportMarkdown
              }),
              "```"
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
      threadId: "thread_md_summary_outline",
      agentCardId: "chat-agent",
      chatInstruction: "Research and write a detailed report",
      contextValues: { canvas: { workflow: { mode: "batch_delivery" } }, autoPreflightPlan: { enabled: false } }
    });

    const body = canvasNodes.find((node) => node.title === "Body");
    assert.ok(body);
    assert.ok(String(body.content).includes("narrative opening paragraph"));
    assert.equal(String(body.content).includes("Mini Literature Review completed"), false);
    assert.equal(String(body.content).includes("UNIQUE_OUTLINE_DEEP_BODY_SHOULD_ONLY_BE_IN_MARKDOWN_FILE"), false);
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
    assert.ok(String(body?.content).includes("Agent literature synthesis"), String(body?.content));
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
    assert.ok(String(body.content).startsWith("# Body summary"));
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
    assert.ok(String(body.content).includes("Comprehensive Review of AI Agents"));
    assert.equal(String(body.content).includes("Detailed Synthesis"), false);
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

test("progressive Canvas keeps process clarification text non-terminal", async () => {
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
  assert.equal(result.completion?.status, "partial");
  assert.equal(canvasNodes.some((node) => (node.metadata as { status?: string } | undefined)?.status === "final"), false);
  assert.equal(events.some((event) => event.eventType === "canvas_delivery_body_final_committed"), false);
  const record = records[0] as { events?: ToolEventRecord[] };
  assert.ok(record.events?.some((event) => event.eventType === "run_timeline_run_incomplete"));
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
    contextValues: {
      agentIntake: { phase: "execution", completed: true }
    },
    selectedCanvasNodeId: "node_123"
  });

  assert.equal(result.provider, "agent-backend");
  assert.equal((observedInput as { selectedCanvasNodeId: string }).selectedCanvasNodeId, "node_123");
  assert.deepEqual((observedInput as { allowedToolRefs: string[] }).allowedToolRefs.includes("canvas_write"), true, JSON.stringify((observedInput as { allowedToolRefs: string[] }).allowedToolRefs));
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

test("incomplete generation persists a server-whitelisted durable descriptor", async () => {
  const { storage, durable, records } = fakeStorage();
  const allowedToolRefsByRun: string[][] = [];
  const contextValuesByRun: Array<Record<string, unknown>> = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        allowedToolRefsByRun.push(input.allowedToolRefs ?? []);
        contextValuesByRun.push(input.contextValues ?? {});
        return allowedToolRefsByRun.length === 1
          ? {
            text: "I'll proceed with the implementation now.",
            finishReason: "agent_backend_completed",
            events: []
          }
          : {
            text: "The finished report is delivered.",
            finishReason: "stop",
            events: [{
              eventType: "canvas_delivery_body_committed",
              payload: { deliveryId: durable.current?.descriptor.deliveryId, nodeId: "node_finished", title: "Finished report" }
            }]
          };
      }
    }
  });

  await service.generateAndRecord({
    mode: "chat",
    locale: "en",
    threadId: "thread_test",
    projectId: "project_test",
    agentCardId: "blog-post",
    chatInstruction: "Research the evidence and deliver the finished report",
    transientSkillRefs: ["research"],
    runtimeBudgetProfile: "high",
    contextValues: {
      arbitraryClientValue: "must not persist",
      runtimeResume: { checkpointId: "secret" },
      durableContinuation: { claimToken: "client-token" },
      autoPreflightPlan: { enabled: false },
      agentClarification: {
        ...answeredAgentClarification(),
        resumeContext: {
          runtimeBudgetProfile: "high",
          canvas: { workflow: { mode: "batch_delivery" } },
          intakeRound: 3,
          answeredSummary: "Scope: recent; Time range: 2023-2026; Format: finished report"
        }
      },
      finalSupplement: {
        finalSupplementId: "final_supplement_continue",
        action: "execute"
      },
      agentIntake: { executionPhase: "execute" },
      taskHandlingPolicy: {
        kind: "simple_chat",
        canvasDeliveryMode: "none",
        allowPlan: true,
        arbitrary: { credential: "forged" }
      },
      progressiveCanvasDelivery: {
        enabled: true,
        runtimeBudgetProfile: "low",
        recursionLimit: 999,
        modelCallLimit: 999,
        evidenceToolLimit: 999,
        bodyDraftWriteLimit: 999,
        synthesisReserveSteps: 999,
        forceSynthesisAfterEvidence: false,
        evidenceTools: ["forged_tool"],
        trigger: "forged_trigger",
        credentials: { token: "forged" }
      },
      canvas: { workflow: { mode: "batch_delivery" } }
    }
  });

  assert.equal((records[0] as { completion?: { status?: string } }).completion?.status, "continue");
  assert.ok((records[0] as { durableContinuationDescriptor?: DurableContinuationDescriptor }).durableContinuationDescriptor);
  assert.equal(durable.current?.state, "ready");
  assert.equal(durable.current?.descriptor.resolvedInstruction, "Research the evidence and deliver the finished report");
  assert.deepEqual(durable.current?.descriptor.transientSkillRefs, ["research"]);
  assert.deepEqual(durable.current?.descriptor.safeContext?.taskHandlingPolicy, {
    kind: "long_task",
    canvasDeliveryMode: "progressive",
    allowPlan: false
  });
  assert.equal((durable.current?.descriptor.safeContext?.progressiveCanvasDelivery as { recursionLimit?: number })?.recursionLimit, 140);
  assert.deepEqual(durable.current?.descriptor.safeContext?.agentIntake, { phase: "execution", completed: true });
  assert.doesNotMatch(JSON.stringify(durable.current?.descriptor), /arbitraryClientValue|runtimeResume|secret|client-token|forged|executionPhase/);

  await service.generateAndRecord({
    mode: "chat",
    locale: "en",
    threadId: "thread_test",
    chatInstruction: "continue"
  });

  assert.equal(isAgentIntakeExecution(contextValuesByRun[1]), true);
  assert.deepEqual(contextValuesByRun[1]?.agentIntake, { phase: "execution", completed: true });
  assert.equal(allowedToolRefsByRun[1]?.includes("write_file"), true);
  assert.equal(allowedToolRefsByRun[1]?.includes("present_files"), true);
  assert.notDeepEqual(allowedToolRefsByRun[1], ["ask_clarification", "agent_intake_complete"]);
});

test("ordinary intake execution persists its effective payload for durable continuation", async () => {
  const { storage, durable, records, agentClarifications } = fakeStorage();
  const originalInstruction = "Research the evidence and deliver the finished report";
  agentClarifications.push(
    {
      id: "ordinary_answer_1",
      status: "answered",
      question: "Which sources should I prioritize?",
      answer: "Recent primary sources",
      updatedAt: "2026-07-14T10:00:00.000Z",
      resumeContext: { originalInstruction }
    },
    {
      id: "ordinary_answer_2",
      status: "answered",
      question: "Which format should I deliver?",
      answer: "A finished Markdown report",
      updatedAt: "2026-07-14T10:01:00.000Z",
      resumeContext: { originalInstruction }
    }
  );
  const allowedToolRefsByRun: string[][] = [];
  const contextValuesByRun: Array<Record<string, unknown>> = [];
  const promptsByRun: string[] = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        allowedToolRefsByRun.push(input.allowedToolRefs ?? []);
        contextValuesByRun.push(input.contextValues ?? {});
        promptsByRun.push(input.prompt);
        if (allowedToolRefsByRun.length === 1) {
          return {
            text: "",
            finishReason: "agent_backend_completed",
            events: [{ eventType: "agent_backend_agent_intake_complete", payload: { summary: "Ready" } }]
          };
        }
        if (allowedToolRefsByRun.length === 2) {
          return {
            text: "I'll continue with the research and delivery.",
            finishReason: "agent_backend_completed",
            events: []
          };
        }
        return {
          text: "The finished report is delivered.",
          finishReason: "stop",
          events: [{
            eventType: "canvas_delivery_body_committed",
            payload: { deliveryId: durable.current?.descriptor.deliveryId, nodeId: "node_ordinary_finished", title: "Finished report" }
          }]
        };
      }
    }
  });

  await service.generateAndRecord({
    mode: "chat",
    locale: "en",
    threadId: "thread_test",
    projectId: "project_test",
    agentCardId: "blog-post",
    chatInstruction: `${originalInstruction}\n\nSelected clarification: A finished Markdown report`,
    transientSkillRefs: ["writing"],
    contextValues: {
      autoPreflightPlan: { enabled: false },
      agentClarification: {
        clarificationId: "ordinary_current",
        selectedOptionId: "markdown",
        answer: "A finished Markdown report",
        resumeContext: { originalInstruction }
      },
      ordinaryClarificationIntake: {
        mode: "ordinary",
        state: "completed",
        maxRounds: 99,
        minAnsweredRoundsAfterFirstAsk: 99,
        answeredRounds: 99,
        remainingRounds: 0,
        answeredSummary: "FORGED"
      },
      canvas: { workflow: { mode: "batch_delivery" } }
    }
  });

  assert.deepEqual(allowedToolRefsByRun[0], ["ask_clarification", "agent_intake_complete"]);
  assert.equal(allowedToolRefsByRun[1]?.includes("write_file"), true);
  assert.equal(durable.current?.state, "ready");
  assert.deepEqual(durable.current?.descriptor.safeContext?.agentIntake, { phase: "execution", completed: true });
  assert.equal((durable.current?.descriptor.safeContext?.ordinaryClarificationIntake as { state?: unknown })?.state, "completed");
  assert.doesNotMatch(JSON.stringify(contextValuesByRun), /FORGED/);
  assert.doesNotMatch(promptsByRun.join("\n"), /FORGED/);
  assert.doesNotMatch(JSON.stringify(durable.current?.descriptor), /FORGED/);

  await service.generateAndRecord({
    mode: "chat",
    locale: "en",
    threadId: "thread_test",
    chatInstruction: "continue"
  });

  assert.equal(isAgentIntakeExecution(contextValuesByRun[2]), true);
  assert.equal(allowedToolRefsByRun[2]?.includes("write_file"), true);
  assert.notDeepEqual(allowedToolRefsByRun[2], ["ask_clarification", "agent_intake_complete"]);
  assert.equal((records.at(-1) as { userMessage?: string }).userMessage, "continue");
});

test("concurrent manual continuations invoke Runtime once and preserve literal continuation history", async () => {
  const { storage, durable, records } = fakeStorage();
  durable.current = {
    state: "ready",
    attempts: 0,
    sourceRunId: "run_source",
    descriptor: {
      version: 1,
      resolvedInstruction: "Finish the original research report",
      agentCardId: "blog-post",
      projectId: "project_test",
      transientSkillRefs: ["research"],
      runtimeBudgetProfile: "high",
      deliveryId: "delivery_original",
      workflowMode: "batch_delivery",
      safeContext: { taskHandlingPolicy: { executionMode: "progressive", canvasDeliveryMode: "progressive" } }
    }
  };
  let runtimeCalls = 0;
  let resumeCalls = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let observedInstruction = "";
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        runtimeCalls += 1;
        observedInstruction = input.chatInstruction ?? "";
        await blocked;
        return { text: "The original research report is complete.", finishReason: "stop", events: [] };
      },
      resumeRun: async () => {
        resumeCalls += 1;
        return { text: "must not resume", finishReason: "stop", events: [] };
      }
    }
  });

  const first = service.generateAndRecord({ mode: "chat", locale: "zh", threadId: "thread_test", chatInstruction: "继续" });
  await Promise.resolve();
  const second = service.generateAndRecord({ mode: "chat", locale: "zh", threadId: "thread_test", chatInstruction: "继续" });
  release();
  const [firstResult, secondResult] = await Promise.allSettled([first, second]);

  assert.equal(firstResult.status, "fulfilled");
  assert.equal(secondResult.status, "rejected");
  assert.equal((secondResult as PromiseRejectedResult).reason.code, "durable_continuation_in_progress");
  assert.equal(runtimeCalls, 1);
  assert.equal(resumeCalls, 0);
  assert.equal(observedInstruction, "Finish the original research report");
  assert.equal((records.at(-1) as { userMessage?: string }).userMessage, "继续");
  assert.equal(durable.current?.state, "completed");
});

test("substantive request cannot steal a claimed continuation before Runtime", async () => {
  const { storage, durable } = fakeStorage();
  durable.current = {
    state: "ready",
    attempts: 0,
    sourceRunId: "run_source",
    descriptor: {
      version: 1,
      resolvedInstruction: "Finish the original report",
      agentCardId: "blog-post",
      projectId: "project_test",
      deliveryId: "delivery_original",
      workflowMode: "batch_delivery"
    }
  };
  let runtimeCalls = 0;
  let release!: () => void;
  let signalStarted!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => {
        runtimeCalls += 1;
        signalStarted();
        await blocked;
        return { text: "The original report is complete.", finishReason: "stop", events: [] };
      }
    }
  });

  const claimant = service.generateAndRecord({
    mode: "chat", locale: "en", threadId: "thread_test", chatInstruction: "continue"
  });
  await started;
  const substantive = service.generateAndRecord({
    mode: "chat", locale: "en", threadId: "thread_test", chatInstruction: "Start a different report"
  });
  await assert.rejects(substantive, (error: unknown) => error instanceof Error
    && "code" in error
    && error.code === "durable_continuation_in_progress");
  assert.equal(runtimeCalls, 1);

  release();
  await claimant;
  assert.equal(durable.current?.state, "completed");
});

test("typed Plan execution continuation claims and restores plan references before Runtime", async () => {
  const { storage, durable, planState } = fakeStorage();
  Object.assign(planState, {
    status: "running",
    approval: "approved",
    steps: [{ id: "step_2", title: "Complete the approved step", status: "pending" }],
    artifacts: []
  });
  durable.current = {
    state: "ready",
    attempts: 0,
    sourceRunId: "run_source",
    descriptor: {
      version: 1,
      resolvedInstruction: "Complete the approved Plan step",
      agentCardId: "blog-post",
      projectId: "project_test",
      deliveryId: "delivery_plan_execution",
      workflowMode: "batch_delivery",
      plan: {
        phase: "execution",
        planId: "plan_intake_test",
        stepId: "step_2",
        phaseAttemptId: "attempt_2",
        executionVersion: 4
      }
    }
  };
  let observed: Record<string, unknown> | undefined;
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        observed = {
          instruction: input.chatInstruction,
          planPhase: input.planPhase,
          planId: input.planId,
          stepId: input.stepId,
          planGeneration: input.planGeneration
        };
        return {
          text: "The approved Plan step is complete.",
          finishReason: "stop",
          events: [{
            eventType: "canvas_delivery_body_committed",
            payload: { deliveryId: "delivery_plan_execution", nodeId: "node_plan", title: "Plan output" }
          }]
        };
      }
    }
  });

  await service.generateAndRecord({
    mode: "chat",
    locale: "en",
    threadId: "thread_test",
    chatInstruction: "continue",
    planPhase: "execution",
    planId: "plan_intake_test",
    stepId: "step_2",
    contextValues: { planExecution: { planId: "plan_intake_test", stepId: "step_2" } }
  });

  assert.deepEqual(observed, {
    instruction: "Complete the approved Plan step",
    planPhase: "execution",
    planId: "plan_intake_test",
    stepId: "step_2",
    planGeneration: {
      phase: "execution",
      planId: "plan_intake_test",
      stepId: "step_2",
      phaseAttemptId: "attempt_2",
      executionVersion: 4
    }
  });
  assert.equal(durable.current?.state, "ready");
  assert.equal(durable.current?.attempts, 1);
});

test("failed continuation preserves its descriptor and retries with an incremented attempt", async () => {
  const { storage, durable } = fakeStorage();
  durable.current = {
    state: "ready",
    attempts: 0,
    sourceRunId: "run_source",
    descriptor: {
      version: 1,
      resolvedInstruction: "Finish the original task",
      agentCardId: "blog-post",
      projectId: "project_test",
      deliveryId: "delivery_original",
      workflowMode: "batch_delivery"
    }
  };
  let fail = true;
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    mockFallbackEnabled: true,
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => {
        if (fail) throw new Error("runtime exploded");
        return { text: "The task is complete.", finishReason: "stop", events: [] };
      }
    }
  });

  await assert.rejects(() => service.generateAndRecord({ mode: "chat", locale: "en", threadId: "thread_test", chatInstruction: "continue" }));
  assert.equal(durable.current?.state, "failed");
  assert.equal(durable.current?.descriptor.resolvedInstruction, "Finish the original task");
  assert.equal(durable.current?.attempts, 1);

  fail = false;
  await service.generateAndRecord({ mode: "chat", locale: "en", threadId: "thread_test", chatInstruction: "continue" });
  assert.equal(durable.current?.state, "completed");
  assert.equal(durable.current?.attempts, 2);
});

test("continuation preserves the resolved progressive budget after project settings change", async () => {
  const { storage, durable, projectRuntimeSettings } = fakeStorage();
  Object.assign(projectRuntimeSettings, {
    runtimeBudgetProfile: "low",
    evidenceToolLimit: 2,
    bodyDraftWriteLimit: 1,
    modelCallLimit: 6,
    recursionLimit: 20,
    synthesisReserveSteps: 3
  });
  const resolvedBudget = {
    enabled: true,
    runtimeBudgetProfile: "high",
    recursionLimit: 137,
    modelCallLimit: 41,
    evidenceToolLimit: 17,
    bodyDraftWriteLimit: 6,
    synthesisReserveSteps: 13,
    forceSynthesisAfterEvidence: true,
    evidenceTools: ["web_search", "write_file"],
    trigger: "skill_long_task"
  };
  durable.current = {
    state: "ready",
    attempts: 0,
    sourceRunId: "run_source",
    descriptor: {
      version: 1,
      resolvedInstruction: "Finish the budgeted research report",
      agentCardId: "blog-post",
      projectId: "project_test",
      transientSkillRefs: ["research"],
      runtimeBudgetProfile: "high",
      deliveryId: "delivery_budget",
      workflowMode: "batch_delivery",
      safeContext: {
        autoPreflightPlan: { enabled: false },
        taskHandlingPolicy: { canvasDeliveryMode: "progressive" },
        progressiveCanvasDelivery: resolvedBudget,
        runtimeBudgetProfile: "high"
      }
    }
  };
  let observedBudget: unknown;
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        observedBudget = input.contextValues?.progressiveCanvasDelivery;
        return { text: "The budgeted report is complete.", finishReason: "stop", events: [] };
      }
    }
  });

  await service.generateAndRecord({
    mode: "chat",
    locale: "en",
    threadId: "thread_test",
    chatInstruction: "continue"
  });

  assert.deepEqual(observedBudget, resolvedBudget);
});

test("continuation Runtime receives authoritative Canvas content and stored delivery identity", async () => {
  const { storage, durable, canvasNodes } = fakeStorage();
  canvasNodes.push({
    id: "node_live",
    kind: "document",
    title: "Live report",
    content: "Authoritative current report body",
    x: 10,
    y: 20,
    width: 300,
    height: 200,
    metadata: {},
    includeInProjectContext: true
  });
  durable.current = {
    state: "ready",
    attempts: 0,
    sourceRunId: "run_source",
    descriptor: {
      version: 1,
      resolvedInstruction: "Finish the live report",
      agentCardId: "blog-post",
      projectId: "project_test",
      deliveryId: "delivery_authoritative",
      workflowMode: "batch_delivery",
      selectedCanvasNodeId: "node_live"
    }
  };
  let runtimeCanvas: unknown;
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        runtimeCanvas = input.contextValues?.canvas;
        return { text: "The live report is complete.", finishReason: "stop", events: [] };
      }
    }
  });

  await service.generateAndRecord({
    mode: "chat", locale: "en", threadId: "thread_test", chatInstruction: "continue",
    contextValues: { canvas: { nodes: [{ id: "client", content: "stale client body" }] } }
  });

  const canvas = runtimeCanvas as {
    deliveryId: string;
    selectedCanvasNodeId: string;
    nodes: Array<{ id: string; content: string }>;
  };
  assert.equal(canvas.deliveryId, "delivery_authoritative");
  assert.equal(canvas.selectedCanvasNodeId, "node_live");
  assert.deepEqual(canvas.nodes.map((node) => ({ id: node.id, content: node.content })), [
    { id: "node_live", content: "Authoritative current report body" }
  ]);
  assert.doesNotMatch(JSON.stringify(canvas), /stale client body/);
});

test("streaming continuation restores the task and closes its claim", async () => {
  const { storage, durable, records } = fakeStorage();
  durable.current = {
    state: "ready",
    attempts: 0,
    sourceRunId: "run_source",
    descriptor: {
      version: 1,
      resolvedInstruction: "Finish the streamed task",
      agentCardId: "blog-post",
      projectId: "project_test",
      deliveryId: "delivery_stream",
      workflowMode: "batch_delivery"
    }
  };
  let observedInstruction = "";
  const tokens: string[] = [];
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        observedInstruction = input.chatInstruction ?? "";
        input.onToken?.("Finished");
        return { text: "The streamed task is complete.", finishReason: "stop", events: [] };
      }
    }
  });

  await service.generateAndRecordStream(
    { mode: "chat", locale: "en", threadId: "thread_test", chatInstruction: "resume" },
    { onToken: (token) => tokens.push(token) }
  );

  assert.equal(observedInstruction, "Finish the streamed task");
  assert.deepEqual(tokens, ["Finished"]);
  assert.equal((records.at(-1) as { userMessage?: string }).userMessage, "resume");
  assert.equal(durable.current?.state, "completed");
});

test("incomplete continuation requeues and clarification continuation completes the durable claim", async () => {
  const { storage, durable } = fakeStorage();
  durable.current = {
    state: "ready",
    attempts: 0,
    sourceRunId: "run_source",
    descriptor: {
      version: 1,
      resolvedInstruction: "Finish the original research task",
      agentCardId: "blog-post",
      projectId: "project_test",
      transientSkillRefs: ["research"],
      deliveryId: "delivery_original",
      workflowMode: "batch_delivery",
      safeContext: {
        autoPreflightPlan: { enabled: false },
        agentIntake: { executionPhase: "execute" },
        taskHandlingPolicy: { executionMode: "progressive", canvasDeliveryMode: "progressive" }
      }
    }
  };
  let clarification = false;
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => clarification ? ({
        text: "",
        finishReason: "agent_backend_completed",
        runtimeRunId: "runtime_run_2",
        runtimeThreadId: "thread_test",
        events: [{
          eventType: "agent_backend_agent_clarification_requested",
          payload: {
            type: "agent_clarification_requested",
            clarificationId: "clarification_2",
            question: "Which final format?",
            options: [
              { id: "report", label: "Report", detail: "Use a report.", recommended: true },
              { id: "brief", label: "Brief", detail: "Use a brief." }
            ],
            resumeContext: {
              runtimeResume: {
                runtimeThreadId: "thread_test",
                runtimeRunId: "runtime_run_2",
                interruptId: "interrupt_2",
                checkpointId: "checkpoint_2"
              }
            }
          }
        }]
      }) : ({
        text: "I'll continue working on this now.",
        finishReason: "agent_backend_incomplete",
        events: []
      })
    }
  });

  await service.generateAndRecord({ mode: "chat", locale: "en", threadId: "thread_test", chatInstruction: "continue" });
  assert.equal(durable.current?.state, "ready");
  assert.equal(durable.current?.attempts, 1);

  clarification = true;
  const result = await service.generateAndRecord({ mode: "chat", locale: "en", threadId: "thread_test", chatInstruction: "continue" });
  assert.equal(result.finishReason, "clarification_required");
  assert.equal(durable.current?.state, "completed");
  assert.equal(durable.current?.attempts, 2);
});

test("three claimed attempts restore the safe evidence union from both prior attempts", async () => {
  const promiseCase = durableTaskGuardCases.find((entry) => entry.id === "post_evidence_synthesis");
  assert.ok(promiseCase);
  const { storage, durable } = fakeStorage();
  durable.current = {
    state: "ready",
    attempts: 0,
    sourceRunId: "run_source",
    descriptor: {
      version: 1,
      resolvedInstruction: "Research database records, synthesize the evidence, and write the completed recommendation report",
      agentCardId: "blog-post",
      projectId: "project_test",
      transientSkillRefs: ["database-lookup"],
      deliveryId: "delivery_evidence_chain",
      workflowMode: "batch_delivery",
      safeContext: {
        taskHandlingPolicy: { kind: "long_task", canvasDeliveryMode: "progressive", allowPlan: false },
        progressiveCanvasDelivery: { enabled: true, runtimeBudgetProfile: "low", evidenceToolLimit: 8, bodyDraftWriteLimit: 2, modelCallLimit: 18, recursionLimit: 80, synthesisReserveSteps: 16, forceSynthesisAfterEvidence: true, evidenceTools: ["web_search"], trigger: "skill_long_task" }
      }
    }
  };
  let evidenceReads = 0;
  (storage as unknown as { listDurableContinuationEvidence: () => ToolEventRecord[] }).listDurableContinuationEvidence = () => {
    evidenceReads += 1;
    return [
      ...(evidenceReads >= 2 ? [{ eventType: "agent_backend_tool_completed", payload: { toolCallId: "safe_1", deliveryId: "delivery_evidence_chain" } }] : []),
      ...(evidenceReads >= 3 ? [{ eventType: "agent_backend_tool_completed", payload: { toolCallId: "safe_2", deliveryId: "delivery_evidence_chain" } }] : [])
    ] as ToolEventRecord[];
  };
  const evidenceByAttempt: unknown[][] = [];
  let runtimeCalls = 0;
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async (input) => {
        runtimeCalls += 1;
        evidenceByAttempt.push((input.contextValues?.durableContinuationEvidence as unknown[] | undefined) ?? []);
        if (runtimeCalls <= 2) {
          input.onToolEvent?.({
            eventType: "agent_backend_tool_completed",
            payload: { toolName: "database_query", toolCallId: `safe_${runtimeCalls}`, deliveryId: "delivery_evidence_chain" }
          });
          return { text: promiseCase.text, finishReason: "agent_backend_completed", events: [] };
        }
        return { text: "The evidence-backed recommendation is complete: choose option A.", finishReason: "stop", events: [] };
      }
    }
  });

  await service.generateAndRecord({ mode: "chat", locale: "en", threadId: "thread_test", chatInstruction: "continue" });
  await service.generateAndRecord({ mode: "chat", locale: "en", threadId: "thread_test", chatInstruction: "continue" });
  await service.generateAndRecord({ mode: "chat", locale: "en", threadId: "thread_test", chatInstruction: "continue" });

  assert.deepEqual(evidenceByAttempt.map((events) => (events as ToolEventRecord[]).map((event) => (event.payload as { toolCallId?: string }).toolCallId)), [
    [],
    ["safe_1"],
    ["safe_1", "safe_2"]
  ]);
  assert.equal(durable.current?.state, "completed");
});

test("claimed partial and failed verdicts remain explicit durable transitions", async () => {
  for (const expected of ["partial", "failed"] as const) {
    const { storage, durable, records } = fakeStorage();
    durable.current = {
      state: "ready",
      attempts: 0,
      sourceRunId: `run_${expected}_source`,
      descriptor: {
        version: 1,
        resolvedInstruction: `Finish the ${expected} task`,
        agentCardId: "blog-post",
        projectId: "project_test",
        deliveryId: `delivery_${expected}`,
        workflowMode: "batch_delivery"
      }
    };
    const service = createGenerationService(storage, fakeAgentRuntime(), {
      modelRuntime: fakeModelRuntime,
      agentBackend: {
        getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
        runAgent: async () => expected === "partial" ? ({
          text: "Budget finalization retry limit reached. Continue finalization from gathered evidence.",
          finishReason: "agent_backend_completed",
          events: [{
            eventType: "agent_backend_synthesis_gate",
            payload: { type: "synthesis_gate", reason: "budget finalization retry exhausted", finalization_retry_exhausted: true }
          }]
        }) : Promise.reject(new Error("runtime failed during claimed continuation"))
      }
    });

    const request = { mode: "chat" as const, locale: "en" as const, threadId: "thread_test", chatInstruction: "continue" };
    if (expected === "failed") {
      await assert.rejects(() => service.generateAndRecord(request), /runtime failed/);
    } else {
      const result = await service.generateAndRecord(request);
      assert.equal(result.completion?.status, expected);
    }
    assert.equal(durable.current?.state, expected === "partial" ? "ready" : "failed");
    if (expected === "partial") {
      assert.ok((records.at(-1) as { durableContinuationDescriptor?: DurableContinuationDescriptor }).durableContinuationDescriptor);
    }
  }
});

test("duplicate continuation clientRequestId returns the persisted run before another claim or Runtime call", async () => {
  const { storage, durable } = fakeStorage();
  durable.current = {
    state: "ready",
    attempts: 0,
    sourceRunId: "run_idempotent_source",
    descriptor: {
      version: 1,
      resolvedInstruction: "Finish the idempotent task",
      agentCardId: "blog-post",
      projectId: "project_test",
      deliveryId: "delivery_idempotent",
      workflowMode: "batch_delivery"
    }
  };
  let runtimeCalls = 0;
  const service = createGenerationService(storage, fakeAgentRuntime(), {
    modelRuntime: fakeModelRuntime,
    agentBackend: {
      getRuntimeConfig: () => ({ enabled: true, baseUrl: "http://AgentBackend", assistantId: "lead_agent" }),
      runAgent: async () => {
        runtimeCalls += 1;
        return { text: "I'll continue working on this now.", finishReason: "agent_backend_incomplete", events: [] };
      }
    }
  });
  const request = { mode: "chat" as const, locale: "en" as const, threadId: "thread_test", chatInstruction: "continue", clientRequestId: "request_same" };

  const first = await service.generateAndRecord(request);
  const second = await service.generateAndRecord(request);
  const streamedReplay = await service.generateAndRecordStream(request);

  assert.equal(runtimeCalls, 1);
  assert.equal(second.runId, first.runId);
  assert.equal(streamedReplay.runId, first.runId);
  assert.equal(second.completion?.status, "continue");
  assert.equal(streamedReplay.completion?.status, "continue");
  assert.equal(durable.current?.state, "ready");
  assert.notEqual(durable.current?.state, "claimed");
});
