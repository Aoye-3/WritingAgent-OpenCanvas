import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { sanitizeVisibleText } from "../services/generation/outputNormalizer.js";
import type { AgentClarificationOption, JsonValue, RunRecordInput, StoredAgentClarification, StoredMessage, StoredOutputVersion, StoredToolEvent } from "../storageTypes.js";
import { nowIso, parseJson, randomId } from "./storageRepositoryUtils.js";
import { sanitizeToolEventPayload } from "../services/generation/toolEventSanitizer.js";
import { DurableContinuationRepository } from "./durableContinuationRepository.js";

export class RunRepository {
  private readonly continuations: DurableContinuationRepository;

  constructor(
    readonly db: DatabaseSync,
    private readonly deps: {
      withTransaction: <T>(work: () => T) => T;
      touchThread: (threadId: string, updatedAt?: string) => void;
    }
  ) {
    this.continuations = new DurableContinuationRepository(db);
  }

  recordRun(input: RunRecordInput) {
    const existing = this.findRunByClientRequest(input.threadId, input.clientRequestId);
    if (existing) return existing;

    const runId = randomId("run");
    const promptVersionId = randomId("prompt");
    const outputVersionId = randomId("output");
    const now = nowIso();
    const status = persistedRunStatus(input);
    const lifecycleEventType = status === "waiting"
      ? "run_waiting"
      : status === "failed"
        ? "run_failed"
        : status === "completed"
          ? "run_completed"
          : "run_incomplete";
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
        usage: input.usage,
        completion: input.completion
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

      if (input.resumedClarificationId) {
        this.db.prepare(
          `UPDATE agent_clarifications
           SET resume_state = ?,
               last_resume_error = ?,
               resumed_runtime_run_id = ?,
               updated_at = ?
           WHERE thread_id = ? AND id = ? AND resume_state = 'resuming'`
        ).run(
          input.errorMessage ? "failed" : "succeeded",
          input.errorMessage ?? null,
          input.errorMessage ? null : input.runtimeRunId ?? null,
          now,
          input.threadId,
          input.resumedClarificationId
        );
      }

      const durableDescriptor = input.durableContinuationDescriptor
        ? this.withDurableEvidenceChain(input.threadId, runId, input.durableContinuationDescriptor)
        : undefined;
      if (input.durableContinuationClaimToken) {
        this.transitionClaimedContinuation({
          threadId: input.threadId,
          runId,
          claimToken: input.durableContinuationClaimToken,
          completionStatus: input.completion?.status,
          descriptor: durableDescriptor,
          clarificationOwnershipTransferred: status === "waiting" && this.hasResumableClarificationOwnership(input.threadId, runId)
        });
      } else if (status === "incomplete" && durableDescriptor) {
        this.continuations.upsertReady(input.threadId, runId, durableDescriptor);
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
                resume_state as resumeState,
                resume_attempts as resumeAttempts,
                last_resume_error as resumeError,
                resumed_runtime_run_id as resumedRuntimeRunId,
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
      resumeState: row.resumeState,
      resumeAttempts: row.resumeAttempts,
      ...(row.resumeError ? { resumeError: row.resumeError } : {}),
      ...(row.resumedRuntimeRunId ? { resumedRuntimeRunId: row.resumedRuntimeRunId } : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  answerAgentClarification(threadId: string, clarificationId: string, input: { selectedOptionId?: string; selectedOptionLabel?: string; answer?: string }) {
    return this.queueAgentClarificationAnswer(threadId, clarificationId, input).outcome !== "not_found";
  }

  listDurableContinuationEvidence(threadId: string, sourceRunId: string | undefined, deliveryId: string) {
    if (!sourceRunId) return [];
    type Row = { eventType: string; payloadJson: string };
    const continuation = this.continuations.read(threadId);
    const runIds = Array.from(new Set([
      ...(continuation?.descriptor.deliveryId === deliveryId ? continuation.descriptor.evidenceRunIds ?? [] : []),
      sourceRunId
    ]));
    const placeholders = runIds.map(() => "?").join(", ");
    const rows = this.db.prepare(
      `SELECT event_type AS eventType, payload_json AS payloadJson
       FROM tool_events
       WHERE thread_id = ? AND run_id IN (${placeholders})
       ORDER BY created_at ASC, rowid ASC`
    ).all(threadId, ...runIds) as Row[];
    const evidence = rows.flatMap((row) => {
      if (!isSafeDurableEvidenceEvent(row.eventType)) return [];
      const payload = parseJson(row.payloadJson);
      const eventDeliveryId = readDeliveryId(payload);
      if (eventDeliveryId && eventDeliveryId !== deliveryId) return [];
      if (row.eventType.startsWith("canvas_delivery_") && eventDeliveryId !== deliveryId) return [];
      return [{ eventType: row.eventType, payload }];
    });
    return dedupeToolEvents(evidence);
  }

  readDurableContinuation(threadId: string) { return this.continuations.read(threadId); }
  claimDurableContinuation(threadId: string) { return this.continuations.claim(threadId); }
  completeDurableContinuation(threadId: string, claimToken: string) { return this.continuations.complete(threadId, claimToken); }
  requeueDurableContinuation(threadId: string, claimToken: string, sourceRunId: string, descriptor: import("../storageTypes.js").DurableContinuationDescriptor) { return this.continuations.requeue(threadId, claimToken, sourceRunId, descriptor); }
  failDurableContinuation(threadId: string, claimToken: string, error: string) { return this.continuations.fail(threadId, claimToken, error); }
  supersedeDurableContinuation(threadId: string) { return this.continuations.supersede(threadId); }
  recoverDurableContinuationsAfterRestart() { return this.continuations.recoverClaimedAfterRestart(); }

  queueAgentClarificationAnswer(threadId: string, clarificationId: string, input: { selectedOptionId?: string; selectedOptionLabel?: string; answer?: string }) {
    const existing = this.listAgentClarifications(threadId).find((item) => item.id === clarificationId);
    if (!existing) return { outcome: "not_found" as const };
    const selectedOptionId = input.selectedOptionId ?? undefined;
    const selectedOptionLabel = input.selectedOptionLabel ?? undefined;
    const answer = input.answer ?? selectedOptionLabel;
    if (existing.status === "answered") {
      const sameAnswer = (existing.selectedOptionId ?? undefined) === selectedOptionId
        && (existing.selectedOptionLabel ?? undefined) === selectedOptionLabel
        && (existing.answer ?? undefined) === answer;
      if (!sameAnswer) return { outcome: "conflict" as const, clarification: existing };
      if (existing.resumeState !== "failed") return { outcome: "idempotent" as const, clarification: existing };
    }

    const resumable = Boolean(readRuntimeResume(readRecord(existing.resumeContext).runtimeResume));
    const now = nowIso();
    this.deps.withTransaction(() => {
      this.db.prepare(
        `UPDATE agent_clarifications
         SET status = 'answered',
             selected_option_id = ?,
             selected_option_label = ?,
             answer = ?,
             resume_state = ?,
             last_resume_error = NULL,
             updated_at = ?
         WHERE thread_id = ? AND id = ?`
      ).run(selectedOptionId ?? null, selectedOptionLabel ?? null, answer ?? null, resumable ? "queued" : "not_resumable", now, threadId, clarificationId);
      this.deps.touchThread(threadId, now);
    });
    const clarification = this.listAgentClarifications(threadId).find((item) => item.id === clarificationId);
    return { outcome: resumable ? "queued" as const : "not_resumable" as const, clarification };
  }

  claimAgentClarificationResume(threadId: string, clarificationId: string) {
    const now = nowIso();
    const result = this.db.prepare(
      `UPDATE agent_clarifications
       SET resume_state = 'resuming', resume_attempts = resume_attempts + 1, last_resume_error = NULL, updated_at = ?
       WHERE thread_id = ? AND id = ? AND status = 'answered' AND resume_state = 'queued'`
    ).run(now, threadId, clarificationId);
    if (result.changes > 0) this.deps.touchThread(threadId, now);
    return result.changes > 0;
  }

  failAgentClarificationResume(threadId: string, clarificationId: string, error: string) {
    const now = nowIso();
    const result = this.db.prepare(
      `UPDATE agent_clarifications
       SET resume_state = 'failed', last_resume_error = ?, updated_at = ?
       WHERE thread_id = ? AND id = ? AND resume_state = 'resuming'`
    ).run(error, now, threadId, clarificationId);
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

  readGenerationByClientRequest(threadId: string, clientRequestId?: string) {
    if (!clientRequestId) return undefined;
    const run = this.db
      .prepare(
        `SELECT runs.id,
                runs.thread_id AS threadId,
                runs.provider,
                runs.used_mock AS usedMock,
                runs.error_message AS errorMessage,
                prompt_versions.id AS promptVersionId,
                prompt_versions.prompt,
                output_versions.id AS outputVersionId,
                output_versions.content AS text
         FROM runs
         LEFT JOIN prompt_versions ON prompt_versions.run_id = runs.id
         LEFT JOIN output_versions ON output_versions.run_id = runs.id
         WHERE runs.thread_id = ? AND runs.client_request_id = ?
         ORDER BY prompt_versions.created_at DESC, output_versions.created_at DESC
         LIMIT 1`
      )
      .get(threadId, clientRequestId) as {
        id: string;
        threadId: string;
        provider: RunRecordInput["provider"];
        usedMock: number;
        errorMessage: string | null;
        promptVersionId: string | null;
        prompt: string | null;
        outputVersionId: string | null;
        text: string | null;
      } | undefined;
    if (!run) return undefined;
    type EventRow = { eventType: string; payloadJson: string };
    const storedEvents = this.db.prepare(
      `SELECT event_type AS eventType, payload_json AS payloadJson
       FROM tool_events WHERE thread_id = ? AND run_id = ?
       ORDER BY created_at ASC, rowid ASC`
    ).all(threadId, run.id) as EventRow[];
    const events = storedEvents.map((event) => ({ eventType: event.eventType, payload: parseJson(event.payloadJson) }));
    const lifecycle = events.find((event) => /^(?:run_completed|run_incomplete|run_waiting|run_failed)$/.test(event.eventType));
    const lifecyclePayload = readRecord(lifecycle?.payload);
    return {
      runId: run.id,
      promptVersionId: run.promptVersionId ?? "",
      outputVersionId: run.outputVersionId ?? "",
      threadId: run.threadId,
      text: sanitizeVisibleText(run.text ?? ""),
      prompt: run.prompt ?? "",
      provider: run.provider,
      usedMock: Boolean(run.usedMock),
      ...(run.errorMessage ? { errorMessage: run.errorMessage } : {}),
      ...(readString(lifecyclePayload.finishReason) ? { finishReason: readString(lifecyclePayload.finishReason) } : {}),
      ...(readString(lifecyclePayload.runtimeRunId) ? { runtimeRunId: readString(lifecyclePayload.runtimeRunId) } : {}),
      ...(readString(lifecyclePayload.runtimeThreadId) ? { runtimeThreadId: readString(lifecyclePayload.runtimeThreadId) } : {}),
      ...(lifecyclePayload.completion ? { completion: lifecyclePayload.completion as RunRecordInput["completion"] } : {}),
      ...(lifecyclePayload.usage !== undefined ? { usage: lifecyclePayload.usage } : {}),
      events: events.filter((event) => !isRepositoryLifecycleEvent(event.eventType))
    };
  }

  private withDurableEvidenceChain(threadId: string, runId: string, descriptor: import("../storageTypes.js").DurableContinuationDescriptor) {
    const current = this.continuations.read(threadId);
    const priorRunIds = current?.descriptor.deliveryId === descriptor.deliveryId
      ? [...(current.descriptor.evidenceRunIds ?? []), ...(current.sourceRunId ? [current.sourceRunId] : [])]
      : [];
    return { ...descriptor, evidenceRunIds: Array.from(new Set([...priorRunIds, runId])) };
  }

  private hasResumableClarificationOwnership(threadId: string, runId: string) {
    const row = this.db.prepare(
      `SELECT resume_context_json AS resumeContextJson
       FROM agent_clarifications
       WHERE thread_id = ? AND run_id = ? AND status = 'pending' AND resume_state = 'awaiting_answer'
       ORDER BY updated_at DESC
       LIMIT 1`
    ).get(threadId, runId) as { resumeContextJson: string } | undefined;
    const resumeContext = readRecord(row ? parseJson(row.resumeContextJson) : undefined);
    return Boolean(readRuntimeResume(resumeContext.runtimeResume));
  }

  private transitionClaimedContinuation(input: {
    threadId: string;
    runId: string;
    claimToken: string;
    completionStatus: NonNullable<RunRecordInput["completion"]>["status"] | undefined;
    descriptor?: import("../storageTypes.js").DurableContinuationDescriptor;
    clarificationOwnershipTransferred: boolean;
  }) {
    const status = input.completionStatus ?? "completed";
    if (status === "completed" || status === "waiting" && input.clarificationOwnershipTransferred) {
      if (!this.continuations.complete(input.threadId, input.claimToken)) throw new Error("durable_continuation_claim_lost");
      return;
    }
    if (status === "failed") {
      if (!this.continuations.fail(input.threadId, input.claimToken, "durable_continuation_run_failed")) throw new Error("durable_continuation_claim_lost");
      return;
    }
    if (!input.descriptor) throw new Error("durable_continuation_descriptor_missing");
    if (!this.continuations.requeue(input.threadId, input.claimToken, input.runId, input.descriptor)) {
      throw new Error("durable_continuation_claim_lost");
    }
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
    const resumeState = readRuntimeResume(resumeContext.runtimeResume) ? "awaiting_answer" : "not_resumable";
    const existingCreatedAt = this.db.prepare(`SELECT created_at as createdAt FROM agent_clarifications WHERE id = ?`).get(id) as { createdAt?: string } | undefined;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO agent_clarifications (
           id, thread_id, run_id, status, question, options_json, resume_context_json,
           selected_option_id, selected_option_label, answer, resume_state, resume_attempts,
           last_resume_error, resumed_runtime_run_id, created_at, updated_at
         ) VALUES (?, ?, ?, 'pending', ?, ?, ?, NULL, NULL, NULL, ?, 0, NULL, NULL, ?, ?)`
      )
      .run(id, threadId, runId, question, JSON.stringify(options), JSON.stringify(resumeContext), resumeState, existingCreatedAt?.createdAt ?? createdAt, createdAt);
  }
}

function persistedRunStatus(input: RunRecordInput) {
  if (!input.completion) {
    return input.finishReason === "clarification_required" ? "waiting" : input.errorMessage ? "failed" : "completed";
  }
  if (input.completion.status === "completed") return "completed";
  if (input.completion.status === "waiting") return "waiting";
  if (input.completion.status === "partial") return "partial";
  if (input.completion.status === "failed") return "failed";
  return "incomplete";
}

function isSafeDurableEvidenceEvent(eventType: string) {
  return /(?:^|_)tool(?:_call)?_completed$/.test(eventType)
    || /^(?:file_written|output_(?:created|archived|committed))$/.test(eventType)
    || /(?:^|_)file_(?:created|written|archived|committed)$/.test(eventType)
    || /^canvas_delivery_.*_committed$/.test(eventType);
}

function isRepositoryLifecycleEvent(eventType: string) {
  return /^(?:run_completed|run_incomplete|run_waiting|run_failed|prompt_built|output_version_created|tool_state_applied|agent_runtime_metadata)$/.test(eventType);
}

function readDeliveryId(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return typeof (value as Record<string, unknown>).deliveryId === "string"
    ? (value as Record<string, unknown>).deliveryId
    : undefined;
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
