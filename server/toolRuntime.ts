import type { ChatCompletionTool, ChatToolCall } from "./providerRuntime.js";
import type { CanvasWriteRequestInput } from "./storage.js";
import type { JsonValue, PlanArtifactLink, PlanClarification, PlanRun, PlanStepStatus } from "./storageTypes.js";
import type { KnowledgeService } from "./knowledge/service.js";
import { allowedToolDefinitions, toChatCompletionTool, toolCatalog, type ToolState } from "./tools/catalog.js";
import { evaluateToolExecutionPolicy, isToolRef } from "./tools/toolPolicyGuard.js";

export type ToolExecutionContext = {
  threadId?: string;
  allowedToolRefs?: string[];
  toolState?: ToolState;
  selectedCanvasNodeId?: string | null;
  contextValues?: Record<string, unknown>;
  chatInstruction?: string;
  canvasAction?: {
    operation?: string;
    targetNodeId?: string;
  };
  knowledgeService?: KnowledgeService;
  resetContext?: () => unknown;
  createCanvasWriteRequest?: (input: CanvasWriteRequestInput) => {
    id: string;
    projectId?: string;
    operation: string;
    targetNodeId?: string;
    nodeKind: string;
    title: string;
    status: string;
  };
  commitCanvasWrite?: (input: CanvasWriteRequestInput) => {
    id: string;
    projectId: string;
    kind: string;
    title: string;
  };
  createPlanRun?: (input: { title: unknown; goal: unknown; steps: Array<{ id?: string; title: unknown; detail?: unknown }>; clarification?: PlanClarification }) => Pick<PlanRun, "id" | "status">;
  submitPlanClarification?: (planId: string, clarification: PlanClarification) => Pick<PlanRun, "id" | "status">;
  revisePlanRun?: (planId: string, input: { title: unknown; goal: unknown; steps: Array<{ id?: string; title: unknown; detail?: unknown }> }) => Pick<PlanRun, "id" | "status"> | undefined;
  getPlanRun?: (planId: string) => PlanRun | undefined;
  updatePlanStep?: (planId: string, stepId: string, patch: { status: PlanStepStatus; detail?: unknown; error?: unknown }) => unknown;
  setPlanStatus?: (planId: string, status: PlanRun["status"], message?: string) => unknown;
  stagePlanArtifact?: (planId: string, input: { artifactId: string; stepId: string; type: "text" | "image"; title: unknown; payload: JsonValue; source?: JsonValue; layout?: JsonValue }) => Promise<{ id: string; status: string } | undefined> | { id: string; status: string } | undefined;
  stagePlanArtifactLinks?: (planId: string, links: Array<{ id: string; fromArtifactId: string; toArtifactId: string; label?: unknown }>) => PlanArtifactLink[];
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
    | "knowledge_search_completed"
    | "knowledge_search_failed"
    | `canvas_${string}`
    | `agent_backend_${string}`;
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
    if (context.knowledgeService) {
      const results = await context.knowledgeService.search({
        query: readString(args.query) || context.chatInstruction || "",
        baseIds: readStringArray(args.baseIds),
        limit: readNumber(args.limit, 6)
      });
      if (results.length > 0) {
        return {
          ok: true,
          content: results.map((result) => `[${result.id}] ${result.title}\n${result.content}`).join("\n\n"),
          payload: { tool: name, entries: results.length, sources: results.map((result) => result.source) }
        };
      }
    }

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
    if (!context.resetContext) {
      return {
        ok: false,
        content: "Conversation context reset is not available in this workspace.",
        payload: { tool: name, cleared: false }
      };
    }
    context.resetContext();
    return {
      ok: true,
      content: "Previous conversation context has been cleared.",
      payload: { tool: name, cleared: true }
    };
  }

  if (name === "plan_clarification_submit") {
    if (!context.submitPlanClarification) return unavailable(name);
    const planId = readPlanGenerationId(context.contextValues);
    const clarification = readPlanClarification({ question: args.question, options: args.options });
    if (!clarification) return { ok: false, content: "A structured clarification question with 2-3 options and exactly one recommendation is required.", payload: { tool: name, reason: "invalid_clarification", planId } };
    if (!planId) return { ok: false, content: "A server-created Plan intake is required.", payload: { tool: name, reason: "plan_intake_missing" } };
    const plan = context.submitPlanClarification(planId, clarification);
    return { ok: true, content: clarification.question, payload: { tool: name, eventType: "plan_waiting_for_user", planId: plan.id, status: "awaiting_user" } };
  }

  if (name === "plan_revision_submit") {
    const planId = readString(args.planId);
    const plan = planId && context.getPlanRun?.(planId);
    if (!plan || plan.approval !== "pending" || !context.revisePlanRun || !Array.isArray(args.steps)) {
      return { ok: false, content: "Only the specified pending Plan can be revised.", payload: { tool: name, reason: "plan_not_pending", planId } };
    }
    const revised = context.revisePlanRun(planId, { title: args.title, goal: args.goal, steps: args.steps as Array<{ id?: string; title: unknown; detail?: unknown }> });
    return revised
      ? { ok: true, content: `Plan ${planId} is ready for approval.`, payload: { tool: name, eventType: "plan_updated", planId, status: revised.status } }
      : unavailable(name);
  }

  if (name === "artifact_stage") {
    const planId = readString(args.planId); const plan = planId && context.getPlanRun?.(planId);
    if (!plan || plan.approval !== "approved") return { ok: false, content: "Artifacts require an approved plan.", payload: { tool: name, reason: "plan_not_approved", planId } };
    const executionStepId = readExecutionStepId(context.contextValues);
    if (!context.stagePlanArtifact || !Array.isArray(args.artifacts)) return unavailable(name);
    const committed: Array<{ id?: string; status: string; error?: string } | undefined> = [];
    for (const value of args.artifacts) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return unavailable(name);
      const artifact = value as Record<string, unknown>;
      if ((artifact.type !== "text" && artifact.type !== "image") || !artifact.payload || typeof artifact.payload !== "object" || Array.isArray(artifact.payload)) return unavailable(name);
      if (executionStepId && readString(artifact.stepId) !== executionStepId) return { ok: false, content: `Artifacts in this run must belong to step ${executionStepId}.`, payload: { tool: name, reason: "wrong_execution_step", planId, executionStepId } };
      try {
        committed.push(await context.stagePlanArtifact(planId, { artifactId: readString(artifact.artifactId), stepId: readString(artifact.stepId), type: artifact.type, title: artifact.title, payload: artifact.payload as JsonValue, source: (artifact.source ?? {}) as JsonValue, layout: (artifact.layout ?? {}) as JsonValue }));
      } catch (error) {
        committed.push({ id: readString(artifact.artifactId), status: "failed", error: error instanceof Error ? error.message : "Artifact commit failed" });
      }
    }
    const links = Array.isArray(args.links) && context.stagePlanArtifactLinks ? context.stagePlanArtifactLinks(planId, args.links as Array<{ id: string; fromArtifactId: string; toArtifactId: string; label?: unknown }>) : [];
    return { ok: true, content: `${committed.length} artifacts were staged for Canvas.`, payload: { tool: name, eventType: "artifact_staged", planId, artifactCount: committed.length, failedCount: committed.filter((artifact) => artifact?.status === "failed").length, linkCount: links.length, artifacts: committed } };
  }

  if (name === "canvas_write") {
    if (!context.createCanvasWriteRequest && !context.commitCanvasWrite) {
      return {
        ok: false,
        content: "Canvas write requests are not available in this workspace.",
        payload: { tool: name, configured: false }
      };
    }

    const content = readString(args.content);
    const targetNodeId = readString(context.canvasAction?.targetNodeId) || readString(args.targetNodeId) || context.selectedCanvasNodeId || undefined;
    const actionOperation = readCanvasOperation(context.canvasAction?.operation);
    const operation = actionOperation ?? normalizeCanvasOperation(readCanvasOperation(args.operation), targetNodeId, context.chatInstruction);
    if (!operation) {
      return {
        ok: false,
        content: "Canvas write request failed: operation must be create, replace, or append.",
        payload: { tool: name, reason: "invalid_operation" }
      };
    }
    if (!content && operation !== "delete") {
      return {
        ok: false,
        content: "Canvas write request failed: content is required.",
        payload: { tool: name, reason: "missing_content" }
      };
    }

    try {
      const writeInput: CanvasWriteRequestInput = {
        operation,
        targetNodeId,
        nodeKind: readCanvasNodeKind(args.nodeKind),
        title: readString(args.title),
        content,
        rationale: readString(args.rationale)
      };
      if (operation === "create" || operation === "append") {
        if (!context.commitCanvasWrite) {
          return {
            ok: false,
            content: `Canvas ${operation} is unavailable because this runtime cannot commit low-risk writes directly.`,
            payload: { tool: name, eventType: "canvas_mutation_failed", operation, reason: "direct_commit_unavailable" }
          };
        }
        const node = context.commitCanvasWrite(writeInput);
        return {
          ok: true,
          content: `Canvas ${operation} committed successfully. Node id: ${node.id}.`,
          payload: {
            tool: name,
            eventType: "canvas_mutation_committed",
            nodeId: node.id,
            projectId: node.projectId,
            operation,
            status: "committed",
            title: node.title
          }
        };
      }
      if (!context.createCanvasWriteRequest) return unavailable(name);
      const request = context.createCanvasWriteRequest({
        ...writeInput,
        operation
      });
      return {
        ok: true,
        content: `A Canvas write proposal (${request.operation}) is ready for user confirmation. Request id: ${request.id}. Do not say it has been applied yet.`,
        payload: {
          tool: name,
          eventType: "canvas_write_pending_approval",
          requestId: request.id,
          projectId: request.projectId,
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
        payload: { tool: name, eventType: "canvas_mutation_failed", reason: "request_failed" }
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

function readStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function readCanvasOperation(value: unknown) {
  return value === "create" || value === "replace" || value === "append" || value === "delete" ? value : undefined;
}

function normalizeCanvasOperation(operation: "create" | "replace" | "append" | "delete" | undefined, targetNodeId: string | undefined, instruction = "") {
  if (operation !== "replace") return operation;
  if (hasCanvasReplaceIntent(instruction)) return operation;
  return targetNodeId ? "append" : "create";
}

function hasCanvasReplaceIntent(instruction: string) {
  return /\u66ff\u6362|\u8986\u76d6|replace|overwrite/i.test(instruction);
}

function readCanvasNodeKind(value: unknown) {
  return value === "document" || value === "note" || value === "reference" ? value : undefined;
}

function readExecutionStepId(contextValues: Record<string, unknown> | undefined) {
  const value = contextValues?.planExecution;
  return value && typeof value === "object" && !Array.isArray(value) ? readString((value as Record<string, unknown>).stepId) : "";
}

function readPlanGenerationId(contextValues: Record<string, unknown> | undefined) {
  const value = contextValues?.planGeneration;
  return value && typeof value === "object" && !Array.isArray(value) ? readString((value as Record<string, unknown>).planId) : "";
}

function readPlanClarification(value: unknown): PlanClarification | undefined {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const question = readString(input?.question);
  const options = Array.isArray(input?.options) ? input.options.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const option = entry as Record<string, unknown>;
    const id = readString(option.id); const label = readString(option.label); const description = readString(option.description);
    return id && label && description ? [{ id, label, description, recommended: option.recommended === true }] : [];
  }) : [];
  if (!question || options.length < 2 || options.length > 3 || options.filter((option) => option.recommended).length !== 1) return undefined;
  return { question, options, status: "pending" };
}

function unavailable(tool: string): ToolExecutionResult { return { ok: false, content: `${tool} is not available in this workspace.`, payload: { tool, reason: "not_configured" } }; }

function formatValue(value: unknown) {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
