import type { GenerateRequest, RunCompletionVerdict } from "../../contracts/generation.js";
import type { ToolEventRecord } from "../../toolRuntime.js";
import { containsInternalRuntimeProtocol } from "../../../shared/internalRuntimeProtocol.js";
import { isProcessClarificationText, resolveTaskHandlingPolicy } from "./taskHandlingPolicy.js";

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

  if (input.finishReason === "clarification_required") {
    if (hasClarificationRequest(events)) {
      reasons.push("The run is waiting for user clarification.");
      missingRequirements.push("Answer the pending clarification before completion.");
      return verdict("waiting", reasons, missingRequirements);
    }
    reasons.push("Runtime requested clarification without a valid structured clarification event.");
    missingRequirements.push("Emit a valid structured clarification before completion.");
    return verdict("failed", reasons, missingRequirements);
  }

  if (hasPendingClarification(events)) {
    reasons.push("The run is waiting for user clarification.");
    missingRequirements.push("Answer the pending clarification before completion.");
    return verdict("waiting", reasons, missingRequirements);
  }

  if (input.finishReason === "agent_backend_incomplete") {
    reasons.push("AgentBackend reported that durable work is incomplete.");
    missingRequirements.push("Continue the run with the next concrete action or completed deliverable.");
    return verdict("continue", reasons, missingRequirements);
  }

  if (hasBudgetFinalizationRetryExhausted(events)) {
    reasons.push("The runtime reached a budget gate and could not complete finalization after repeated prompts.");
    missingRequirements.push("Continue finalization from gathered evidence.");
    return verdict("partial", reasons, missingRequirements);
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

  if (isDurableTask(input.payload) && isNonTerminalProcessReply(text)) {
    reasons.push("The durable run ended on a process reply instead of a completed deliverable.");
    missingRequirements.push("Continue the run with substantive work or a structured clarification request.");
    return verdict("partial", reasons, missingRequirements);
  }

  if (isDurableTask(input.payload) && isPureActionPromise(text)) {
    reasons.push("The durable run ended on an action promise instead of a completed deliverable.");
    missingRequirements.push("Continue the promised action or provide the substantive completed deliverable.");
    return verdict("continue", reasons, missingRequirements);
  }

  const durableDelivery = hasTerminalDelivery(events);

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

function hasClarificationRequest(events: ToolEventRecord[]) {
  return events.some(isExplicitClarificationRequest);
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
    || payload.orchestrationPolicy?.deliveryPolicy === "canvas_required"
    || (record(payload.contextValues?.progressiveCanvasDelivery).enabled === true
      && /^(?:progressive|explicit)$/.test(string(record(payload.contextValues?.taskHandlingPolicy).canvasDeliveryMode)));
}

function hasTerminalDelivery(events: ToolEventRecord[]) {
  return events.some((event) => {
    const payload = record(event.payload);
    const payloadEventType = string(payload.eventType) || string(payload.type);
    if (isExplicitTerminalDeliveryEvent(event.eventType) || isExplicitTerminalDeliveryEvent(payloadEventType)) return true;
    if (!isGenericCanvasCommit(event.eventType) && !isGenericCanvasCommit(payloadEventType)) return false;
    return hasFinalTerminalCanvasMetadata(payload);
  });
}

function isExplicitTerminalDeliveryEvent(eventType: string) {
  return eventType === "canvas_delivery_body_final_committed"
    || eventType === "canvas_delivery_file_document_committed"
    || /(?:^|_)artifact_committed$/.test(eventType);
}

function isGenericCanvasCommit(eventType: string) {
  return /(?:^|_)canvas_(?:mutation|node)_committed$/.test(eventType);
}

function hasFinalTerminalCanvasMetadata(payload: Record<string, unknown>) {
  const timelinePayload = record(payload.payload);
  const node = record(payload.node);
  const timelineNode = record(timelinePayload.node);
  return [
    payload,
    record(payload.metadata),
    node,
    record(node.metadata),
    timelinePayload,
    record(timelinePayload.metadata),
    timelineNode,
    record(timelineNode.metadata)
  ].some((candidate) => {
    const status = string(candidate.deliveryStatus) || string(candidate.status);
    const phase = string(candidate.deliveryPhase) || string(candidate.phase);
    return status === "final" && /^(?:body|body_final|final_body|file_document|artifact|explicit_canvas_delivery)$/.test(phase);
  });
}

function isNonTerminalProcessReply(value: string) {
  return isProcessClarificationText(value)
    || /clarification prompt instead of a final body|Agent 返回了需要补充信息的过程话术/i.test(value);
}

function isDurableTask(payload: GenerateRequest) {
  if (payload.canvasAction?.requiresTool === true) return true;
  if (payload.planPhase === "execution" || payload.planGeneration?.phase === "execution") return true;
  if (payload.orchestrationPolicy?.deliveryPolicy === "canvas_required") return true;
  const policy = resolveTaskHandlingPolicy({
    payload,
    transientSkillCount: payload.transientSkillRefs?.length ?? 0,
    thinkingMode: payload.modelOverrides?.thinkingMode
  });
  return policy.kind === "long_task" || policy.kind === "plan_execution" || policy.kind === "explicit_canvas";
}

export function isPureActionPromise(value: string) {
  const sentences = visibleSentences(value);
  while (sentences.length && isAcknowledgementOnly(sentences[0]!)) sentences.shift();
  return sentences.length > 0 && sentences.every(isPureActionClause);
}

function visibleSentences(value: string) {
  return value
    .split(/\r?\n/)
    .flatMap((line) => line.match(/[^.!?。！？]+(?:[.!?。！？]+|$)/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isAcknowledgementOnly(value: string) {
  const text = value.replace(/[\s,.!?，。！？]+$/g, "").trim();
  return Boolean(text) && /^(?:(?:okay|ok|understood|got it|sure|all right|好的?|明白了?|收到|可以)\s*(?:[,，、]\s*)?)+$/i.test(text);
}

function isPureActionClause(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  const actionPrefix = /^(?:(?:let me|i(?:['’]ll| will)|we(?:['’]ll| will)|next|then)\b|(?:让我|我将|我会|我来|接下来|下一步))/i;
  const actionVerb = /(?:\b(?:start|begin|load|search|check|fetch|query|research|retrieve|inspect|read|write|create|generate|run|analy[sz]e|synthesize|compile|proceed|continue|implement|do)\b|(?:开始|加载|检索|搜索|查询|查找|读取|分析|生成|编写|创建|执行|整理|汇总|综合|继续|推进|实施|实现|处理|做))/i;
  const resultStructure = /[:：]|(?:^|\s)(?:[-*•]|\d+[.)、])\s+/;
  const conclusion = /(?:\b(?:because|therefore|thus|hence|consequently)\b|\bas a result\b|(?:^|[,;])\s*so\b|\b(?:i|we)\s+recommend\b|\b(?:the|my|our)\s+(?:answer|result|conclusion|recommendation|correct fix)\s+is\b|因为|因此|所以|因而|结论|结果是|答案是|我建议)/i;
  return actionPrefix.test(text) && actionVerb.test(text) && !resultStructure.test(text) && !conclusion.test(text);
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

function hasBudgetFinalizationRetryExhausted(events: ToolEventRecord[]) {
  return events.some((event) => {
    const payload = record(event.payload);
    const reason = string(payload.reason);
    return payload.finalization_retry_exhausted === true
      || /budget finalization retry exhausted/i.test(reason);
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
