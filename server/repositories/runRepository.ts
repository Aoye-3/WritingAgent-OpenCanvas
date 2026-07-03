import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { sanitizeVisibleText } from "../services/generation/outputNormalizer.js";
import type { AgentClarificationOption, JsonValue, RunRecordInput, StoredAgentClarification, StoredMessage, StoredOutputVersion, StoredToolEvent } from "../storageTypes.js";
import { nowIso, parseJson, randomId } from "./storageRepositoryUtils.js";
import { sanitizeToolEventPayload } from "../services/generation/toolEventSanitizer.js";

export class RunRepository {
  constructor(
    readonly db: DatabaseSync,
    private readonly deps: {
      withTransaction: <T>(work: () => T) => T;
      touchThread: (threadId: string, updatedAt?: string) => void;
    }
  ) {}

  recordRun(input: RunRecordInput) {
    const existing = this.findRunByClientRequest(input.threadId, input.clientRequestId);
    if (existing) return existing;

    const runId = randomId("run");
    const promptVersionId = randomId("prompt");
    const outputVersionId = randomId("output");
    const now = nowIso();
    const status = input.finishReason === "clarification_required" ? "waiting" : input.errorMessage ? "failed" : "completed";
    const lifecycleEventType = status === "waiting" ? "run_waiting" : status === "failed" ? "run_failed" : "run_completed";
    const events = dedupeToolEvents(input.events ?? []);

    this.deps.withTransaction(() => {
      this.db
        .prepare(
          `INSERT INTO runs (id, thread_id, client_request_id, agent_card_id, configured_model_api_id, model_id, mode, provider, used_mock, status, error_message, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(runId, input.threadId, input.clientRequestId ?? null, input.agentCardId, input.configuredModelApiId ?? null, input.modelId ?? null, input.mode, input.provider, input.usedMock ? 1 : 0, status, input.errorMessage ?? null, now);

      if (input.userMessage) {
        this.addMessage(input.threadId, "user", input.userMessage, false, now);
      }
      this.addMessage(input.threadId, "assistant", input.output, input.usedMock, now);

      this.db
        .prepare(`INSERT INTO prompt_versions (id, thread_id, run_id, prompt, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(promptVersionId, input.threadId, runId, input.prompt, now);
      this.db
        .prepare(`INSERT INTO output_versions (id, thread_id, run_id, content, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(outputVersionId, input.threadId, runId, input.output, now);

      this.recordToolEvent(input.threadId, runId, lifecycleEventType, {
        mode: input.mode,
        provider: input.provider,
        configuredModelApiId: input.configuredModelApiId,
        modelId: input.modelId,
        usedMock: input.usedMock,
        finishReason: input.finishReason,
        runtimeRunId: input.runtimeRunId,
        runtimeThreadId: input.runtimeThreadId,
        usage: input.usage
      }, now);
      this.recordToolEvent(input.threadId, runId, "prompt_built", { promptVersionId }, now);
      this.recordToolEvent(input.threadId, runId, "output_version_created", { outputVersionId }, now);

      if (input.toolState && Object.keys(input.toolState).length > 0) {
        this.recordToolEvent(input.threadId, runId, "tool_state_applied", input.toolState, now);
      }
      if (input.runtimeRunId || input.runtimeThreadId) {
        this.recordToolEvent(input.threadId, runId, "agent_runtime_metadata", {
          runtimeRunId: input.runtimeRunId,
          runtimeThreadId: input.runtimeThreadId
        }, now);
      }

      for (const event of events) {
        this.recordToolEvent(input.threadId, runId, event.eventType, event.payload as JsonValue, now);
        this.recordAgentClarificationFromEvent(input.threadId, runId, event, now);
      }

      this.deps.touchThread(input.threadId, now);
    });

    return { runId, promptVersionId, outputVersionId };
  }

  listMessages(threadId: string) {
    type StoredMessageRow = Omit<StoredMessage, "usedMock"> & { usedMock: number };
    const rows = this.db
      .prepare(`SELECT id, thread_id as threadId, role, text, used_mock as usedMock, created_at as createdAt FROM messages WHERE thread_id = ? ORDER BY created_at ASC`)
      .all(threadId) as StoredMessageRow[];

    return rows.map((row) => ({
      ...row,
      text: row.role === "assistant" ? sanitizeVisibleText(row.text) : row.text,
      usedMock: Boolean(row.usedMock)
    }));
  }

  listOutputVersions(threadId: string) {
    type StoredOutputVersionRow = Omit<StoredOutputVersion, "usedMock" | "includeInProjectContext"> & { usedMock: number; includeInProjectContext: number };
    const rows = this.db
      .prepare(
        `SELECT output_versions.id,
                output_versions.thread_id as threadId,
                output_versions.run_id as runId,
                output_versions.content,
                output_versions.created_at as createdAt,
                runs.mode,
                runs.provider,
                runs.used_mock as usedMock,
                output_versions.include_in_project_context as includeInProjectContext
         FROM output_versions
         JOIN runs ON runs.id = output_versions.run_id
         WHERE output_versions.thread_id = ?
         ORDER BY output_versions.created_at DESC`
      )
      .all(threadId) as StoredOutputVersionRow[];

    return rows.map((row) => ({
      ...row,
      content: sanitizeVisibleText(row.content),
      usedMock: Boolean(row.usedMock),
      includeInProjectContext: Boolean(row.includeInProjectContext)
    }));
  }

  setOutputVersionProjectContext(threadId: string, outputVersionId: string, included: boolean) {
    const result = this.db.prepare(
      `UPDATE output_versions SET include_in_project_context = ?
       WHERE id = ? AND thread_id = ?`
    ).run(included ? 1 : 0, outputVersionId, threadId);
    return result.changes > 0;
  }

  listToolEvents(threadId: string) {
    type StoredToolEventRow = Omit<StoredToolEvent, "payload"> & { payloadJson: string };
    const rows = this.db
      .prepare(
        `SELECT id,
                thread_id as threadId,
                run_id as runId,
                event_type as eventType,
                payload_json as payloadJson,
                created_at as createdAt
         FROM tool_events
         WHERE thread_id = ?
         ORDER BY created_at DESC`
      )
      .all(threadId) as StoredToolEventRow[];

    return rows.map((row) => ({
      id: row.id,
      threadId: row.threadId,
      runId: row.runId,
      eventType: row.eventType,
      payload: parseJson(row.payloadJson),
      createdAt: row.createdAt
    }));
  }

  recordToolEvent(threadId: string, runId: string, eventType: string, payload: JsonValue, createdAt = nowIso()) {
    this.db
      .prepare(`INSERT INTO tool_events (id, thread_id, run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(randomId("tool"), threadId, runId, eventType, JSON.stringify(sanitizeToolEventPayload(payload)), createdAt);
  }

  findRuntimeRunMetadata(threadId: string, runId: string) {
    const row = this.db
      .prepare(
        `SELECT payload_json as payloadJson
         FROM tool_events
         WHERE thread_id = ? AND run_id = ? AND event_type = 'agent_runtime_metadata'
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(threadId, runId) as { payloadJson: string } | undefined;
    return readRuntimeRunMetadata(row ? parseJson(row.payloadJson) : undefined);
  }

  listAgentClarifications(threadId: string) {
    type Row = Omit<StoredAgentClarification, "options" | "resumeContext"> & { optionsJson: string; resumeContextJson: string };
    const rows = this.db
      .prepare(
        `SELECT id,
                thread_id as threadId,
                run_id as runId,
                status,
                question,
                options_json as optionsJson,
                resume_context_json as resumeContextJson,
                selected_option_id as selectedOptionId,
                selected_option_label as selectedOptionLabel,
                answer,
                created_at as createdAt,
                updated_at as updatedAt
         FROM agent_clarifications
         WHERE thread_id = ?
         ORDER BY updated_at DESC`
      )
      .all(threadId) as Row[];

    return rows.map((row) => ({
      id: row.id,
      threadId: row.threadId,
      runId: row.runId,
      status: row.status,
      question: row.question,
      options: readAgentClarificationOptions(parseJson(row.optionsJson)),
      resumeContext: parseJson(row.resumeContextJson),
      ...(row.selectedOptionId ? { selectedOptionId: row.selectedOptionId } : {}),
      ...(row.selectedOptionLabel ? { selectedOptionLabel: row.selectedOptionLabel } : {}),
      ...(row.answer ? { answer: row.answer } : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  answerAgentClarification(threadId: string, clarificationId: string, input: { selectedOptionId?: string; selectedOptionLabel?: string; answer?: string }) {
    const now = nowIso();
    const result = this.db
      .prepare(
        `UPDATE agent_clarifications
         SET status = 'answered',
             selected_option_id = ?,
             selected_option_label = ?,
             answer = ?,
             updated_at = ?
         WHERE thread_id = ? AND id = ?`
      )
      .run(input.selectedOptionId ?? null, input.selectedOptionLabel ?? null, input.answer ?? input.selectedOptionLabel ?? null, now, threadId, clarificationId);
    if (result.changes > 0) this.deps.touchThread(threadId, now);
    return result.changes > 0;
  }

  private addMessage(threadId: string, role: "user" | "assistant", text: string, usedMock: boolean, createdAt = nowIso()) {
    this.db
      .prepare(`INSERT INTO messages (id, thread_id, role, text, used_mock, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(randomId("msg"), threadId, role, text, usedMock ? 1 : 0, createdAt);
  }

  private findRunByClientRequest(threadId: string, clientRequestId?: string) {
    if (!clientRequestId) return undefined;
    const run = this.db
      .prepare(`SELECT id FROM runs WHERE thread_id = ? AND client_request_id = ?`)
      .get(threadId, clientRequestId) as { id: string } | undefined;
    if (!run?.id) return undefined;
    const prompt = this.db
      .prepare(`SELECT id FROM prompt_versions WHERE thread_id = ? AND run_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(threadId, run.id) as { id: string } | undefined;
    const output = this.db
      .prepare(`SELECT id FROM output_versions WHERE thread_id = ? AND run_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(threadId, run.id) as { id: string } | undefined;
    return {
      runId: run.id,
      promptVersionId: prompt?.id ?? "",
      outputVersionId: output?.id ?? ""
    };
  }

  private recordAgentClarificationFromEvent(threadId: string, runId: string, event: { eventType: string; payload: unknown }, createdAt: string) {
    const payload = readRecord(event.payload);
    const type = readString(payload.type) || readString(payload.eventType);
    if (!/agent_clarification_requested$/.test(event.eventType) && type !== "agent_clarification_requested") return;
    const question = readString(payload.question);
    const options = readAgentClarificationOptions(payload.options);
    if (!question || options.length < 2) return;
    const id = stableAgentClarificationId(threadId, payload, question);
    const existing = this.db.prepare(`SELECT status FROM agent_clarifications WHERE id = ?`).get(id) as { status?: string } | undefined;
    if (existing?.status === "answered") return;
    const resumeContext = readRecord(payload.resumeContext);
    const existingCreatedAt = this.db.prepare(`SELECT created_at as createdAt FROM agent_clarifications WHERE id = ?`).get(id) as { createdAt?: string } | undefined;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO agent_clarifications (
           id, thread_id, run_id, status, question, options_json, resume_context_json,
           selected_option_id, selected_option_label, answer, created_at, updated_at
         ) VALUES (?, ?, ?, 'pending', ?, ?, ?, NULL, NULL, NULL, ?, ?)`
      )
      .run(id, threadId, runId, question, JSON.stringify(options), JSON.stringify(resumeContext), existingCreatedAt?.createdAt ?? createdAt, createdAt);
  }
}

function dedupeToolEvents(events: Array<{ eventType: string; payload: unknown }>) {
  const byKey = new Map<string, { eventType: string; payload: unknown }>();
  const order: string[] = [];
  for (const event of events) {
    const key = toolEventDedupeKey(event);
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, mergePreferredToolEvent(existing, event));
      continue;
    }
    byKey.set(key, event);
    order.push(key);
  }
  return order.map((key) => byKey.get(key)!);
}

function toolEventDedupeKey(event: { eventType: string; payload: unknown }) {
  const payload = readRecord(event.payload);
  const question = readString(payload.question);
  const toolCallId = readString(payload.toolCallId);
  const clarificationId = readString(payload.clarificationId);
  if (/agent_clarification/.test(event.eventType) || question) {
    return [event.eventType, clarificationId || question || toolCallId, agentClarificationOptionsKey(payload.options)].join("|");
  }
  return `${event.eventType}|${JSON.stringify(sanitizeToolEventPayload(event.payload as JsonValue))}`;
}

function mergePreferredToolEvent(
  existing: { eventType: string; payload: unknown },
  incoming: { eventType: string; payload: unknown }
) {
  if (!isAgentClarificationEvent(existing) || !isAgentClarificationEvent(incoming)) return existing;
  const existingHasResume = hasCompleteRuntimeResume(existing);
  const incomingHasResume = hasCompleteRuntimeResume(incoming);
  if (!incomingHasResume && existingHasResume) return existing;
  if (!incomingHasResume && !existingHasResume) return existing;
  const existingPayload = readRecord(existing.payload);
  const incomingPayload = readRecord(incoming.payload);
  const existingResumeContext = readRecord(existingPayload.resumeContext);
  const incomingResumeContext = readRecord(incomingPayload.resumeContext);
  const runtimeResume = readRuntimeResume(incomingResumeContext.runtimeResume)
    ?? readRuntimeResume(existingResumeContext.runtimeResume);
  return {
    ...existing,
    ...incoming,
    payload: {
      ...existingPayload,
      ...incomingPayload,
      resumeContext: {
        ...existingResumeContext,
        ...incomingResumeContext,
        ...(runtimeResume ? { runtimeResume } : {})
      }
    }
  };
}

function isAgentClarificationEvent(event: { eventType: string; payload: unknown }) {
  const payload = readRecord(event.payload);
  const type = readString(payload.type) || readString(payload.eventType);
  return /agent_clarification_requested$/.test(event.eventType) || type === "agent_clarification_requested";
}

function hasCompleteRuntimeResume(event: { eventType: string; payload: unknown }) {
  const payload = readRecord(event.payload);
  const resumeContext = readRecord(payload.resumeContext);
  return Boolean(readRuntimeResume(resumeContext.runtimeResume));
}

function readRuntimeResume(value: unknown) {
  const resume = readRecord(value);
  const runtimeThreadId = readString(resume.runtimeThreadId);
  const runtimeRunId = readString(resume.runtimeRunId);
  const interruptId = readString(resume.interruptId);
  if (!runtimeThreadId || !runtimeRunId || !interruptId) return undefined;
  const checkpointId = readString(resume.checkpointId);
  return {
    runtimeThreadId,
    runtimeRunId,
    interruptId,
    ...(checkpointId ? { checkpointId } : {})
  };
}

function agentClarificationOptionsKey(value: unknown) {
  if (!Array.isArray(value)) return "";
  return JSON.stringify(value.map((option) => {
    if (typeof option === "string") return option.trim();
    const item = readRecord(option);
    return {
      id: readString(item.id),
      label: readString(item.label) || readString(item.title)
    };
  }));
}

function stableAgentClarificationId(threadId: string, payload: Record<string, unknown>, question: string) {
  const explicit = readString(payload.clarificationId);
  const toolCallId = readString(payload.toolCallId);
  const basis = `${threadId}:${explicit || toolCallId}:${question}`;
  return `agent_clarification_${createHash("sha1").update(basis).digest("hex").slice(0, 16)}`;
}

function readAgentClarificationOptions(value: unknown): AgentClarificationOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (typeof item === "string") {
      const label = readString(item);
      return label ? [{ id: `option_${index + 1}`, label, detail: "", recommended: index === 0 }] : [];
    }
    const record = readRecord(item);
    const label = readString(record.label) || readString(record.title);
    if (!label) return [];
    return [{
      id: readString(record.id) || `option_${index + 1}`,
      label,
      detail: readString(record.detail) || readString(record.description),
      recommended: record.recommended === true || index === 0 && !value.some((candidate) => readRecord(candidate).recommended === true)
    }];
  }).slice(0, 3);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readRuntimeRunMetadata(value: unknown) {
  const record = readRecord(value);
  const runtimeRunId = readString(record.runtimeRunId);
  const runtimeThreadId = readString(record.runtimeThreadId);
  return runtimeRunId || runtimeThreadId
    ? { runtimeRunId, runtimeThreadId }
    : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
