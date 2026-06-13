import type { Express, Request } from "express";
import type { ChatToolCall } from "../providerRuntime.js";
import type { SQLiteStorageRepository } from "../storage.js";
import type { KnowledgeService } from "../knowledge/service.js";
import { executeToolCall } from "../toolRuntime.js";
import type { ToolState } from "../tools/catalog.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";
import { commitPlanArtifact, commitPlanArtifactLinks } from "../services/planArtifactService.js";

type InternalAgentRuntimeRouteDeps = {
  storage: SQLiteStorageRepository;
  knowledgeService?: KnowledgeService;
};

export function registerInternalAgentRuntimeRoutes(app: Express, deps: InternalAgentRuntimeRouteDeps) {
  registerInternalToolBridgeRoute(app, "/api/internal/agent-runtime/tool-call", deps, "Agent Runtime");
}

export function registerInternalToolBridgeRoute(
  app: Express,
  path: string,
  { storage, knowledgeService }: InternalAgentRuntimeRouteDeps,
  runtimeLabel: string
) {
  app.post(path, async (request, response) => {
    if (!isAllowedInternalRequest(request)) {
      sendError(response, 403, "validation_failed", `${runtimeLabel} tool bridge calls require an internal source.`);
      return;
    }

    try {
      const body = parseBridgeRequest(request.body);
      const result = await executeToolCall(toToolCall(body), {
        threadId: body.threadId,
        allowedToolRefs: body.allowedToolRefs,
        toolState: body.toolState,
        selectedCanvasNodeId: body.selectedCanvasNodeId,
        contextValues: body.contextValues,
        chatInstruction: body.chatInstruction,
        canvasAction: body.canvasAction,
        knowledgeService,
        resetContext: () => {
          if (!storage.resetThreadContext(body.threadId)) throw new Error("Thread not found");
        },
        createCanvasWriteRequest: (input) => storage.createCanvasWriteRequest(projectIdForBridge(storage, body), input),
        commitCanvasWrite: (input) => commitLowRiskCanvasWrite(storage, projectIdForBridge(storage, body), input, body.canvasAction),
        createPlanRun: (input) => storage.createPlanRun(body.threadId, input),
        submitPlanClarification: (planId, clarification) => storage.submitPlanClarification(body.threadId, planId, clarification),
        revisePlanRun: (planId, input) => storage.revisePlanRun(body.threadId, planId, input),
        getPlanRun: (planId) => storage.getPlanRun(body.threadId, planId),
        updatePlanStep: (planId, stepId, patch) => storage.updatePlanStep(body.threadId, planId, stepId, patch),
        setPlanStatus: (planId, status, message) => status === "awaiting_user" ? storage.setPlanWaitingForUser(body.threadId, planId, message ?? "") : storage.setPlanRunStatus(body.threadId, planId, status, message),
        stagePlanArtifact: async (planId, input) => {
          const staged = storage.stagePlanArtifact(body.threadId, planId, input);
          if (!staged) return undefined;
          return commitPlanArtifact(storage, body.threadId, planId, staged.id);
        },
        stagePlanArtifactLinks: (planId, links) => {
          storage.stagePlanArtifactLinks(body.threadId, planId, links);
          return commitPlanArtifactLinks(storage, body.threadId, planId);
        }
      });
      sendOk(response, result);
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, `Unable to execute ${runtimeLabel} tool bridge call`));
    }
  });
}

function isAllowedInternalRequest(request: Request) {
  const token = process.env.FACETWRITE_INTERNAL_TOOL_TOKEN?.trim();
  const providedToken = request.header("x-facetwrite-tool-token")?.trim();
  return Boolean(token && providedToken && token === providedToken);
}

type BridgeRequest = {
  threadId: string;
  projectId?: string;
  toolName: string;
  arguments: Record<string, unknown>;
  allowedToolRefs?: string[];
  toolState?: ToolState;
  selectedCanvasNodeId?: string;
  contextValues?: Record<string, unknown>;
  chatInstruction?: string;
  canvasAction?: Record<string, unknown>;
};

function parseBridgeRequest(value: unknown): BridgeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be an object");
  }
  const body = value as Record<string, unknown>;
  const threadId = readRequiredString(body.threadId, "threadId");
  const toolName = readRequiredString(body.toolName, "toolName");
  return {
    threadId,
    projectId: readString(body.projectId),
    toolName,
    arguments: readRecord(body.arguments) ?? {},
    allowedToolRefs: readStringArray(body.allowedToolRefs),
    toolState: readBooleanRecord(body.toolState),
    selectedCanvasNodeId: readString(body.selectedCanvasNodeId),
    contextValues: readRecord(body.contextValues),
    chatInstruction: readString(body.chatInstruction),
    canvasAction: readRecord(body.canvasAction)
  };
}

function projectIdForBridge(storage: SQLiteStorageRepository, body: BridgeRequest) {
  const projectId = storage.getThread(body.threadId)?.projectId;
  if (!projectId) throw new Error("Thread not found");
  if (body.projectId && body.projectId !== projectId) throw new Error("Runtime project does not match the Thread project");
  return projectId;
}

function commitLowRiskCanvasWrite(storage: SQLiteStorageRepository, projectId: string, input: import("../storage.js").CanvasWriteRequestInput, action?: Record<string, unknown>) {
  if (input.operation === "create") {
    const stableId = typeof action?.id === "string" ? `node_${action.id.replace(/[^A-Za-z0-9_-]/g, "_")}` : undefined;
    const existing = stableId ? storage.listCanvasNodes(projectId).find((node) => node.id === stableId) : undefined;
    if (existing) return existing;
    return storage.createCanvasNode(projectId, {
      id: stableId,
      kind: input.nodeKind ?? "document",
      title: input.title,
      content: input.content
    });
  }
  if (input.operation === "append" && input.targetNodeId) {
    const existing = storage.listCanvasNodes(projectId).find((node) => node.id === input.targetNodeId);
    if (!existing) throw new Error("Target node was not found");
    const updated = storage.updateCanvasNode(projectId, existing.id, {
      content: existing.content ? `${existing.content}\n\n${input.content}` : input.content
    });
    if (updated) return updated;
  }
  throw new Error("Only create and append Canvas operations can be committed without approval");
}

function toToolCall(input: BridgeRequest): ChatToolCall {
  return {
    id: `agent_runtime_${input.toolName}`,
    type: "function",
    function: {
      name: input.toolName,
      arguments: JSON.stringify(input.arguments)
    }
  };
}

function readRequiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function readBooleanRecord(value: unknown) {
  const record = readRecord(value);
  if (!record) return undefined;
  return Object.fromEntries(Object.entries(record).filter(([, entry]) => typeof entry === "boolean")) as ToolState;
}
