import type { GenerateRequest, RunCompletionVerdict } from "../../contracts/generation.js";
import type { ToolEventRecord } from "../../toolRuntime.js";
import { containsInternalRuntimeProtocol } from "../../../shared/internalRuntimeProtocol.js";

export function evaluateRunCompletion(input: {
  payload: GenerateRequest;
  text: string;
  events?: ToolEventRecord[];
  finishReason?: string;
  errorMessage?: string;
}): RunCompletionVerdict {
  const events = input.events ?? [];
  const text = stripAppendedSources(input.text).trim();
  const reasons: string[] = [];
  const missingRequirements: string[] = [];

  if (input.errorMessage) {
    return verdict("failed", [`Runtime failed: ${input.errorMessage}`], ["Recover or retry the failed run."]);
  }

  if (hasPendingClarification(events)) {
    reasons.push("The run is waiting for user clarification.");
    missingRequirements.push("Answer the pending clarification before completion.");
    return verdict("waiting", reasons, missingRequirements);
  }

  if (hasUnfinishedToolCall(events)) {
    reasons.push("A tool action started without a matching completion event.");
    missingRequirements.push("Wait for the outstanding tool action to finish or fail.");
    return verdict("continue", reasons, missingRequirements);
  }

  if (containsInternalRuntimeProtocol(text)) {
    reasons.push("The final text contains internal runtime protocol.");
    missingRequirements.push("Regenerate a clean user-facing answer.");
    return verdict("failed", reasons, missingRequirements);
  }

  const durableDelivery = hasDurableDelivery(events);

  if (!text && !durableDelivery) {
    reasons.push("No final user-facing answer was produced.");
    missingRequirements.push("Produce a final answer or an explicit clarification request.");
    return verdict("partial", reasons, missingRequirements);
  }

  if (requiresDurableCanvasCommit(input.payload) && !durableDelivery) {
    reasons.push("The request requires a durable Canvas or artifact update.");
    missingRequirements.push("Commit the required Canvas node, artifact, or file delivery.");
    return verdict("partial", reasons, missingRequirements);
  }

  if (hasTodoCompletionReminderCap(events)) {
    reasons.push("The runtime allowed exit after repeated incomplete-todo reminders.");
    missingRequirements.push("Complete remaining todo items or mark the run partial.");
    return verdict("partial", reasons, missingRequirements);
  }

  if (hasBudgetSynthesisSignal(events)) {
    reasons.push("The runtime reached a budget gate and synthesized from available evidence.");
    if (text || durableDelivery) {
      reasons.push("Final answer or durable delivery exists and no rule-first blockers remain.");
      return verdict("completed", reasons, []);
    }
    return verdict("partial", reasons, []);
  }

  reasons.push("Final answer exists and no rule-first blockers remain.");
  return verdict("completed", reasons, []);
}

export function completionEvaluatedEvent(completion: RunCompletionVerdict): ToolEventRecord {
  return {
    eventType: "completion_evaluated",
    payload: {
      completionStatus: completion.status,
      completionReasons: completion.reasons,
      missingRequirements: completion.missingRequirements,
      evaluatedAt: completion.evaluatedAt
    }
  };
}

function verdict(status: RunCompletionVerdict["status"], reasons: string[], missingRequirements: string[]): RunCompletionVerdict {
  return {
    status,
    reasons,
    missingRequirements,
    evaluatedAt: new Date().toISOString()
  };
}

function hasPendingClarification(events: ToolEventRecord[]) {
  let pending = false;
  for (const event of events) {
    if (pending && isPostClarificationProgress(event)) {
      pending = false;
      continue;
    }
    if (isExplicitClarificationRequest(event)) {
      pending = true;
    }
  }
  return pending;
}

function isExplicitClarificationRequest(event: ToolEventRecord) {
  const payload = record(event.payload);
  const type = string(payload.type) || string(payload.eventType);
  if (!/agent_clarification_requested$/.test(event.eventType) && type !== "agent_clarification_requested") {
    return false;
  }
  return Boolean(string(payload.question) && clarificationOptionCount(payload.options) >= 2);
}

function clarificationOptionCount(value: unknown) {
  if (!Array.isArray(value)) return 0;
  return value.filter((item) => {
    if (typeof item === "string") return Boolean(item.trim());
    const option = record(item);
    return Boolean(string(option.label) || string(option.title));
  }).length;
}

function isPostClarificationProgress(event: ToolEventRecord) {
  if (isExplicitClarificationRequest(event)) return false;
  const payload = record(event.payload);
  const toolName = string(payload.toolName) || string(payload.tool);
  const payloadEventType = string(payload.eventType) || string(payload.type);
  return event.eventType === "run_timeline_run_completed"
    || payloadEventType === "run_completed"
    || /(?:^|_)tool_(?:started|completed)$/.test(event.eventType)
    || /^(?:write_file|present_files|web_search|web_fetch|knowledge_base|canvas_write)$/.test(toolName)
    || /^canvas_delivery_(?:research|body_checkpoint|body_final|file_document)_committed$/.test(event.eventType)
    || /^canvas_delivery_(?:research|body_checkpoint|body_final|file_document)_committed$/.test(payloadEventType)
    || /(?:^|_)canvas_mutation_committed$/.test(event.eventType)
    || /(?:^|_)artifact_(?:staged|committed)$/.test(event.eventType);
}

function hasUnfinishedToolCall(events: ToolEventRecord[]) {
  const started = new Set<string>();
  const completed = new Set<string>();
  for (const event of events) {
    const payload = record(event.payload);
    const key = string(payload.toolCallId) || string(payload.actionId) || string(payload.toolName) || string(payload.tool);
    if (!key) continue;
    if (/(?:^|_)tool_started$/.test(event.eventType)) started.add(key);
    if (/(?:^|_)tool_(?:completed|failed)$/.test(event.eventType)) completed.add(key);
  }
  return [...started].some((key) => !completed.has(key));
}

function requiresDurableCanvasCommit(payload: GenerateRequest) {
  return payload.canvasAction?.requiresTool === true
    || payload.orchestrationPolicy?.deliveryPolicy === "canvas_required";
}

function hasDurableDelivery(events: ToolEventRecord[]) {
  return events.some((event) => (
    /(?:^|_)canvas_.*(?:committed|approved)$/.test(event.eventType)
    || /(?:^|_)artifact_(?:committed|staged)$/.test(event.eventType)
    || event.eventType === "canvas_delivery_body_final_committed"
    || event.eventType === "canvas_delivery_outline_committed"
    || event.eventType === "canvas_delivery_body_checkpoint_committed"
  ));
}

function hasTodoCompletionReminderCap(events: ToolEventRecord[]) {
  return events.some((event) => {
    const payload = record(event.payload);
    return event.eventType === "todo_completion_incomplete"
      || string(payload.type) === "todo_completion_incomplete"
      || string(payload.reason).includes("incomplete todo");
  });
}

function hasBudgetSynthesisSignal(events: ToolEventRecord[]) {
  return events.some((event) => {
    const payload = record(event.payload);
    const type = string(payload.type) || string(payload.eventType);
    const reason = string(payload.reason);
    return type === "synthesis_gate"
      || /budget|recursion|GRAPH_RECURSION_LIMIT/i.test(reason)
      || /budget_exhausted|recursion/i.test(event.eventType);
  });
}

function stripAppendedSources(text: string) {
  return text.replace(/\n+##\s*(?:Sources|来源|鏉ユ簮)\s*\n[\s\S]*$/i, "").trim();
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function string(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
