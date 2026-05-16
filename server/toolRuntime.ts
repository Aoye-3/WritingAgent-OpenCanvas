import type { ChatCompletionTool, ChatToolCall } from "./providerRuntime.js";
import type { CanvasWriteRequestInput } from "./storage.js";
import { allowedToolDefinitions, toChatCompletionTool, toolCatalog, type ToolState } from "./tools/catalog.js";
import { evaluateToolExecutionPolicy, isToolRef } from "./tools/toolPolicyGuard.js";

export type ToolExecutionContext = {
  threadId?: string;
  allowedToolRefs?: string[];
  toolState?: ToolState;
  selectedCanvasNodeId?: string | null;
  contextValues?: Record<string, unknown>;
  chatInstruction?: string;
  createCanvasWriteRequest?: (input: CanvasWriteRequestInput) => {
    id: string;
    operation: string;
    targetNodeId?: string;
    nodeKind: string;
    title: string;
    status: string;
  };
};

export type ToolExecutionResult = {
  ok: boolean;
  content: string;
  payload: Record<string, unknown>;
};

export type ToolEventRecord = {
  eventType:
    | "tool_call_requested"
    | "tool_call_completed"
    | "tool_call_failed"
    | "tool_loop_stopped"
    | "internal_output_blocked"
    | `deerflow_${string}`;
  payload: Record<string, unknown>;
};

export const runtimeToolDefinitions = toolCatalog;

export function getEnabledToolDefinitions(toolRefs: string[], toolState: ToolState | undefined): ChatCompletionTool[] {
  return allowedToolDefinitions(toolRefs)
    .filter((tool) => Boolean(toolState?.[tool.name]))
    .map(toChatCompletionTool);
}

export async function executeToolCall(call: ChatToolCall, context: ToolExecutionContext): Promise<ToolExecutionResult> {
  const name = call.function.name;
  const args = parseToolArguments(call.function.arguments);
  const decision = evaluateToolExecutionPolicy({
    toolName: name,
    allowedToolRefs: context.allowedToolRefs,
    toolState: context.toolState
  });
  if (!decision.allowed) {
    return {
      ok: false,
      content: decision.reason ?? `Tool is not allowed: ${name}`,
      payload: { tool: name, reason: "policy_denied" }
    };
  }
  if (!isToolRef(name)) {
    return {
      ok: false,
      content: `Unknown tool: ${call.function.name}`,
      payload: { tool: call.function.name }
    };
  }

  if (name === "knowledge_base") {
    const entries = Object.entries(context.contextValues ?? {})
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim().length > 0)
      .slice(0, readNumber(args.limit, 6))
      .map(([key, value]) => `${key}: ${formatValue(value)}`);
    const content = entries.length ? entries.join("\n") : "No local context was available for this request.";
    return { ok: true, content, payload: { tool: name, entries: entries.length } };
  }

  if (name === "quick_messages") {
    const instruction = readString(args.instruction) || context.chatInstruction || "";
    return {
      ok: true,
      content: `Quick edit instruction: ${instruction}`,
      payload: { tool: name, instruction }
    };
  }

  if (name === "clear_context") {
    return {
      ok: true,
      content: "Previous conversation context has been cleared for this run.",
      payload: { tool: name, cleared: true }
    };
  }

  if (name === "canvas_write") {
    if (!context.createCanvasWriteRequest) {
      return {
        ok: false,
        content: "Canvas write requests are not available in this workspace.",
        payload: { tool: name, configured: false }
      };
    }

    const operation = readCanvasOperation(args.operation);
    const content = readString(args.content);
    const targetNodeId = readString(args.targetNodeId) || context.selectedCanvasNodeId || undefined;
    if (!operation) {
      return {
        ok: false,
        content: "Canvas write request failed: operation must be create, replace, or append.",
        payload: { tool: name, reason: "invalid_operation" }
      };
    }
    if (!content) {
      return {
        ok: false,
        content: "Canvas write request failed: content is required.",
        payload: { tool: name, reason: "missing_content" }
      };
    }

    try {
      const request = context.createCanvasWriteRequest({
        operation,
        targetNodeId,
        nodeKind: readCanvasNodeKind(args.nodeKind),
        title: readString(args.title),
        content,
        rationale: readString(args.rationale)
      });
      return {
        ok: true,
        content: `A Canvas write request (${request.operation}) is pending user approval. Request id: ${request.id}. Do not say it has been applied yet.`,
        payload: {
          tool: name,
          requestId: request.id,
          operation: request.operation,
          targetNodeId: request.targetNodeId,
          nodeKind: request.nodeKind,
          title: request.title,
          status: request.status
        }
      };
    } catch (error) {
      return {
        ok: false,
        content: `Canvas write request failed: ${error instanceof Error ? error.message : "unknown error"}`,
        payload: { tool: name, reason: "request_failed" }
      };
    }
  }

  if (name === "web_search") {
    return {
      ok: false,
      content: "Web search is not configured in this local build. No live web lookup was performed.",
      payload: { tool: name, configured: false }
    };
  }

  return {
    ok: false,
    content: `Unknown tool: ${call.function.name}`,
    payload: { tool: call.function.name }
  };
}

function parseToolArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readCanvasOperation(value: unknown) {
  return value === "create" || value === "replace" || value === "append" ? value : undefined;
}

function readCanvasNodeKind(value: unknown) {
  return value === "document" || value === "note" || value === "reference" ? value : undefined;
}

function formatValue(value: unknown) {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
