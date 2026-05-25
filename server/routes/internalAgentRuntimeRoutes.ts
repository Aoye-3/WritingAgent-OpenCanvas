import type { Express, Request } from "express";
import type { ChatToolCall } from "../providerRuntime.js";
import type { SQLiteStorageRepository } from "../storage.js";
import type { KnowledgeService } from "../knowledge/service.js";
import { executeToolCall } from "../toolRuntime.js";
import type { ToolState } from "../tools/catalog.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";

type InternalAgentRuntimeRouteDeps = {
  storage: SQLiteStorageRepository;
  knowledgeService?: KnowledgeService;
};

export function registerInternalAgentRuntimeRoutes(app: Express, deps: InternalAgentRuntimeRouteDeps) {
  registerInternalToolBridgeRoute(app, "/api/internal/agent-runtime/tool-call", deps, "Agent Runtime");
  registerInternalToolBridgeRoute(app, "/api/internal/deerflow/tool-call", deps, "Deprecated DeerFlow");
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
        knowledgeService,
        createCanvasWriteRequest: (input) => storage.createCanvasWriteRequest(body.threadId, input)
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
  if (token && providedToken && token === providedToken) return true;

  const source = request.header("x-facetwrite-internal");
  return source === "agent-runtime" || source === "agent-backend" || source === "deerflow";
}

type BridgeRequest = {
  threadId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  allowedToolRefs?: string[];
  toolState?: ToolState;
  selectedCanvasNodeId?: string;
  contextValues?: Record<string, unknown>;
  chatInstruction?: string;
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
    toolName,
    arguments: readRecord(body.arguments) ?? {},
    allowedToolRefs: readStringArray(body.allowedToolRefs),
    toolState: readBooleanRecord(body.toolState),
    selectedCanvasNodeId: readString(body.selectedCanvasNodeId),
    contextValues: readRecord(body.contextValues),
    chatInstruction: readString(body.chatInstruction)
  };
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
