import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  DurableContinuationDescriptor,
  DurableContinuationState,
  StoredDurableContinuation
} from "../storageTypes.js";
import { nowIso } from "./storageRepositoryUtils.js";

export class DurableContinuationError extends Error {
  constructor(readonly code: "durable_continuation_in_progress" | "durable_continuation_unavailable") {
    super(code);
    this.name = "DurableContinuationError";
  }
}

export class DurableContinuationRepository {
  constructor(readonly db: DatabaseSync) {}

  read(threadId: string): StoredDurableContinuation | undefined {
    const row = this.db.prepare(
      `SELECT thread_id AS threadId, source_run_id AS sourceRunId, state,
              descriptor_json AS descriptorJson, attempts, claim_token AS claimToken,
              claimed_at AS claimedAt, last_error AS lastError,
              created_at AS createdAt, updated_at AS updatedAt
       FROM durable_task_continuations WHERE thread_id = ?`
    ).get(threadId) as DurableContinuationRow | undefined;
    return row ? storedContinuation(row) : undefined;
  }

  upsertReady(threadId: string, sourceRunId: string, descriptor: DurableContinuationDescriptor) {
    const now = nowIso();
    const result = this.db.prepare(
      `INSERT INTO durable_task_continuations (
         thread_id, source_run_id, state, descriptor_json, attempts,
         claim_token, claimed_at, last_error, created_at, updated_at
       ) VALUES (?, ?, 'ready', ?, 0, NULL, NULL, NULL, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET
         source_run_id = excluded.source_run_id,
         state = 'ready',
         descriptor_json = excluded.descriptor_json,
         attempts = 0,
         claim_token = NULL,
         claimed_at = NULL,
         last_error = NULL,
         updated_at = excluded.updated_at
       WHERE durable_task_continuations.state <> 'claimed'`
    ).run(threadId, sourceRunId, JSON.stringify(descriptor), now, now);
    if (result.changes === 0 && this.read(threadId)?.state === "claimed") {
      throw new DurableContinuationError("durable_continuation_in_progress");
    }
    return this.read(threadId)!;
  }

  claim(threadId: string) {
    const token = `durable_claim_${randomUUID()}`;
    const now = nowIso();
    const result = this.db.prepare(
      `UPDATE durable_task_continuations
       SET state = 'claimed', attempts = attempts + 1, claim_token = ?, claimed_at = ?,
           last_error = NULL, updated_at = ?
       WHERE thread_id = ? AND state IN ('ready', 'failed')`
    ).run(token, now, now, threadId);
    if (result.changes === 0) {
      const current = this.read(threadId);
      if (current?.state === "claimed") throw new DurableContinuationError("durable_continuation_in_progress");
      throw new DurableContinuationError("durable_continuation_unavailable");
    }
    return this.read(threadId)!;
  }

  complete(threadId: string, claimToken: string) {
    return this.transitionClaimed(threadId, claimToken, "completed");
  }

  requeue(threadId: string, claimToken: string, sourceRunId: string, descriptor: DurableContinuationDescriptor) {
    const now = nowIso();
    const result = this.db.prepare(
      `UPDATE durable_task_continuations
       SET source_run_id = ?, state = 'ready', descriptor_json = ?, claim_token = NULL,
           claimed_at = NULL, last_error = NULL, updated_at = ?
       WHERE thread_id = ? AND state = 'claimed' AND claim_token = ?`
    ).run(sourceRunId, JSON.stringify(descriptor), now, threadId, claimToken);
    return result.changes > 0;
  }

  fail(threadId: string, claimToken: string, error: string) {
    const now = nowIso();
    const result = this.db.prepare(
      `UPDATE durable_task_continuations
       SET state = 'failed', claim_token = NULL, claimed_at = NULL, last_error = ?, updated_at = ?
       WHERE thread_id = ? AND state = 'claimed' AND claim_token = ?`
    ).run(error.slice(0, 500), now, threadId, claimToken);
    return result.changes > 0;
  }

  supersede(threadId: string) {
    const now = nowIso();
    const result = this.db.prepare(
      `UPDATE durable_task_continuations
       SET state = 'superseded', claim_token = NULL, claimed_at = NULL, updated_at = ?
       WHERE thread_id = ? AND state IN ('ready', 'failed')`
    ).run(now, threadId);
    return result.changes > 0;
  }

  recoverClaimedAfterRestart() {
    const now = nowIso();
    const result = this.db.prepare(
      `UPDATE durable_task_continuations
       SET state = 'failed', claim_token = NULL, claimed_at = NULL,
           last_error = 'durable_continuation_recovered_after_restart', updated_at = ?
       WHERE state = 'claimed'`
    ).run(now);
    return Number(result.changes);
  }

  private transitionClaimed(threadId: string, claimToken: string, state: Extract<DurableContinuationState, "completed">) {
    const now = nowIso();
    const result = this.db.prepare(
      `UPDATE durable_task_continuations
       SET state = ?, claim_token = NULL, claimed_at = NULL, last_error = NULL, updated_at = ?
       WHERE thread_id = ? AND state = 'claimed' AND claim_token = ?`
    ).run(state, now, threadId, claimToken);
    return result.changes > 0;
  }
}

type DurableContinuationRow = {
  threadId: string;
  sourceRunId: string | null;
  state: DurableContinuationState;
  descriptorJson: string;
  attempts: number;
  claimToken: string | null;
  claimedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

function storedContinuation(row: DurableContinuationRow): StoredDurableContinuation {
  return {
    threadId: row.threadId,
    ...(row.sourceRunId ? { sourceRunId: row.sourceRunId } : {}),
    state: row.state,
    descriptor: JSON.parse(row.descriptorJson) as DurableContinuationDescriptor,
    attempts: row.attempts,
    ...(row.claimToken ? { claimToken: row.claimToken } : {}),
    ...(row.claimedAt ? { claimedAt: row.claimedAt } : {}),
    ...(row.lastError ? { lastError: row.lastError } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
