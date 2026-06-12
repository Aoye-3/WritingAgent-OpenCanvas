import type { DatabaseSync } from "node:sqlite";
import { sanitizeVisibleText } from "../services/generation/outputNormalizer.js";
import type { JsonValue, RunRecordInput, StoredMessage, StoredOutputVersion, StoredToolEvent } from "../storageTypes.js";
import { nowIso, parseJson, randomId } from "./storageRepositoryUtils.js";

export class RunRepository {
  constructor(
    readonly db: DatabaseSync,
    private readonly deps: {
      withTransaction: <T>(work: () => T) => T;
      touchThread: (threadId: string, updatedAt?: string) => void;
    }
  ) {}

  recordRun(input: RunRecordInput) {
    const runId = randomId("run");
    const promptVersionId = randomId("prompt");
    const outputVersionId = randomId("output");
    const now = nowIso();

    this.deps.withTransaction(() => {
      this.db
        .prepare(
          `INSERT INTO runs (id, thread_id, agent_card_id, configured_model_api_id, model_id, mode, provider, used_mock, status, error_message, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(runId, input.threadId, input.agentCardId, input.configuredModelApiId ?? null, input.modelId ?? null, input.mode, input.provider, input.usedMock ? 1 : 0, "completed", input.errorMessage ?? null, now);

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

      this.recordToolEvent(input.threadId, runId, "run_completed", {
        mode: input.mode,
        provider: input.provider,
        configuredModelApiId: input.configuredModelApiId,
        modelId: input.modelId,
        usedMock: input.usedMock,
        finishReason: input.finishReason,
        usage: input.usage
      }, now);
      this.recordToolEvent(input.threadId, runId, "prompt_built", { promptVersionId }, now);
      this.recordToolEvent(input.threadId, runId, "output_version_created", { outputVersionId }, now);

      if (input.toolState && Object.keys(input.toolState).length > 0) {
        this.recordToolEvent(input.threadId, runId, "tool_state_applied", input.toolState, now);
      }

      for (const event of input.events ?? []) {
        this.recordToolEvent(input.threadId, runId, event.eventType, event.payload, now);
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
      .run(randomId("tool"), threadId, runId, eventType, JSON.stringify(payload), createdAt);
  }

  private addMessage(threadId: string, role: "user" | "assistant", text: string, usedMock: boolean, createdAt = nowIso()) {
    this.db
      .prepare(`INSERT INTO messages (id, thread_id, role, text, used_mock, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(randomId("msg"), threadId, role, text, usedMock ? 1 : 0, createdAt);
  }
}
