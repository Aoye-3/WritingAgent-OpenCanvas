import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrateStorageSchema } from "../db/schema.js";
import { runSqliteTransaction } from "../db/sqlite.js";
import { DurableContinuationRepository } from "./durableContinuationRepository.js";
import { RunRepository } from "./runRepository.js";
import type { DurableContinuationDescriptor } from "../storageTypes.js";
import type { ToolEventRecord } from "../toolRuntime.js";

function descriptor(instruction = "Complete the original long task"): DurableContinuationDescriptor {
  return {
    version: 1,
    resolvedInstruction: instruction,
    agentCardId: "blog-post",
    projectId: "project_test",
    transientSkillRefs: ["research"],
    disabledSkillRefs: ["unsafe-skill"],
    runtimeBudgetProfile: "high",
    modelOverrides: { thinkingMode: "enabled", reasoningEffort: "high" },
    plan: { phase: "execution", planId: "plan_1", stepId: "step_2", phaseAttemptId: "attempt_1", executionVersion: 3 },
    deliveryId: "delivery_original",
    workflowMode: "batch_delivery",
    selectedCanvasNodeId: "canvas_target",
    safeContext: { agentIntake: { executionPhase: "execute" } }
  };
}

function setup() {
  const db = new DatabaseSync(":memory:");
  migrateStorageSchema(db);
  const repository = new DurableContinuationRepository(db);
  return { db, repository };
}

function setupRunRepository(threadId: string) {
  const db = new DatabaseSync(":memory:");
  migrateStorageSchema(db);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO projects (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run("project_test", "Project", now, now);
  db.prepare("INSERT INTO threads (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(threadId, "project_test", "Thread", now, now);
  const repository = new RunRepository(db, {
    withTransaction: (work) => runSqliteTransaction(db, work),
    touchThread: () => undefined
  });
  return { db, repository, now };
}

test("durable continuation repository supports guarded lifecycle transitions", () => {
  const { repository } = setup();
  const saved = repository.upsertReady("thread_1", "run_1", descriptor());
  assert.equal(saved.state, "ready");
  assert.equal(saved.attempts, 0);
  assert.deepEqual(saved.descriptor, descriptor());

  const claim = repository.claim("thread_1");
  assert.equal(claim.state, "claimed");
  assert.equal(claim.attempts, 1);
  assert.ok(claim.claimToken);
  assert.throws(() => repository.claim("thread_1"), (error: unknown) => {
    return error instanceof Error && "code" in error && error.code === "durable_continuation_in_progress";
  });

  assert.equal(repository.fail("thread_1", claim.claimToken!, "runtime failed"), true);
  const failed = repository.read("thread_1")!;
  assert.equal(failed.state, "failed");
  assert.equal(failed.lastError, "runtime failed");
  assert.deepEqual(failed.descriptor, descriptor());

  const retry = repository.claim("thread_1");
  assert.equal(retry.attempts, 2);
  assert.equal(repository.requeue("thread_1", retry.claimToken!, "run_2", descriptor("Keep going")), true);
  assert.equal(repository.read("thread_1")!.state, "ready");

  const completion = repository.claim("thread_1");
  assert.equal(repository.complete("thread_1", completion.claimToken!), true);
  assert.equal(repository.complete("thread_1", completion.claimToken!), false);
  assert.equal(repository.read("thread_1")!.state, "completed");

  repository.upsertReady("thread_1", "run_3", descriptor("A newer incomplete run"));
  assert.equal(repository.read("thread_1")!.attempts, 0);
  assert.equal(repository.supersede("thread_1"), true);
  assert.equal(repository.read("thread_1")!.state, "superseded");
});

test("claimed continuation ownership survives a generic incomplete upsert", () => {
  const { repository } = setup();
  repository.upsertReady("thread_claimed", "run_source", descriptor("Original task"));
  const claim = repository.claim("thread_claimed");

  assert.throws(
    () => repository.upsertReady("thread_claimed", "run_concurrent", descriptor("Concurrent task")),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "durable_continuation_in_progress"
  );

  const stillClaimed = repository.read("thread_claimed")!;
  assert.equal(stillClaimed.state, "claimed");
  assert.equal(stillClaimed.claimToken, claim.claimToken);
  assert.equal(stillClaimed.sourceRunId, "run_source");
  assert.equal(repository.complete("thread_claimed", claim.claimToken!), true);
  assert.equal(repository.read("thread_claimed")!.state, "completed");
});

test("restart recovery makes abandoned claimed continuations retryable once", () => {
  const { repository } = setup();
  repository.upsertReady("thread_restart", "run_restart", descriptor());
  const claim = repository.claim("thread_restart");

  assert.equal(repository.recoverClaimedAfterRestart(), 1);
  const recovered = repository.read("thread_restart")!;
  assert.equal(recovered.state, "failed");
  assert.equal(recovered.claimToken, undefined);
  assert.match(recovered.lastError ?? "", /restart/i);
  assert.equal(repository.recoverClaimedAfterRestart(), 0);

  const retry = repository.claim("thread_restart");
  assert.equal(retry.attempts, claim.attempts + 1);
});

test("recordRun atomically persists an incomplete run and its continuation descriptor", () => {
  const db = new DatabaseSync(":memory:");
  migrateStorageSchema(db);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO projects (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run("project_test", "Project", now, now);
  db.prepare("INSERT INTO threads (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("thread_atomic", "project_test", "Thread", now, now);
  const repository = new RunRepository(db, {
    withTransaction: (work) => runSqliteTransaction(db, work),
    touchThread: () => undefined
  });

  const saved = repository.recordRun({
    threadId: "thread_atomic",
    agentCardId: "blog-post",
    mode: "chat",
    prompt: "Original prompt",
    output: "Still working",
    provider: "agent-backend",
    usedMock: false,
    completion: { status: "continue", reasons: ["more work"], missingRequirements: ["finish"], evaluatedAt: now },
    durableContinuationDescriptor: descriptor()
  });

  const row = db.prepare("SELECT source_run_id AS sourceRunId, state, descriptor_json AS descriptorJson FROM durable_task_continuations WHERE thread_id = ?")
    .get("thread_atomic") as { sourceRunId: string; state: string; descriptorJson: string };
  assert.equal(row.sourceRunId, saved.runId);
  assert.equal(row.state, "ready");
  assert.deepEqual(JSON.parse(row.descriptorJson), { ...descriptor(), evidenceRunIds: [saved.runId] });
});

test("recordRun cannot replace a claim and requeues incomplete owned work by token", () => {
  const db = new DatabaseSync(":memory:");
  migrateStorageSchema(db);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO projects (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run("project_test", "Project", now, now);
  db.prepare("INSERT INTO threads (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("thread_owned", "project_test", "Thread", now, now);
  const repository = new RunRepository(db, {
    withTransaction: (work) => runSqliteTransaction(db, work),
    touchThread: () => undefined
  });
  const run = (input: { claimToken?: string; instruction: string }) => repository.recordRun({
    threadId: "thread_owned",
    agentCardId: "blog-post",
    mode: "chat",
    prompt: input.instruction,
    output: "Still working",
    provider: "agent-backend",
    usedMock: false,
    completion: { status: "continue", reasons: ["more work"], missingRequirements: ["finish"], evaluatedAt: now },
    durableContinuationDescriptor: descriptor(input.instruction),
    ...(input.claimToken ? { durableContinuationClaimToken: input.claimToken } : {})
  });

  const source = run({ instruction: "Original task" });
  const claim = repository.claimDurableContinuation("thread_owned");

  assert.throws(
    () => run({ instruction: "Concurrent generic task" }),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "durable_continuation_in_progress"
  );
  assert.equal(repository.readDurableContinuation("thread_owned")?.claimToken, claim.claimToken);
  assert.equal(repository.readDurableContinuation("thread_owned")?.sourceRunId, source.runId);

  const requeued = run({ claimToken: claim.claimToken, instruction: "Original task, still incomplete" });
  const ready = repository.readDurableContinuation("thread_owned")!;
  assert.equal(ready.state, "ready");
  assert.equal(ready.sourceRunId, requeued.runId);
  assert.equal(ready.claimToken, undefined);
  assert.equal(ready.attempts, 1);
});

test("continuation evidence includes safe source-run delivery events and excludes lifecycle events", () => {
  const db = new DatabaseSync(":memory:");
  migrateStorageSchema(db);
  const repository = new RunRepository(db, {
    withTransaction: (work) => runSqliteTransaction(db, work),
    touchThread: () => undefined
  });
  const now = new Date().toISOString();
  for (const [eventType, payload] of [
    ["tool_call_completed", { tool: "web_search", deliveryId: "delivery_1" }],
    ["canvas_delivery_file_document_committed", { deliveryId: "delivery_1", nodeId: "node_1" }],
    ["run_completed", { deliveryId: "delivery_1" }],
    ["completion_evaluated", { deliveryId: "delivery_1" }],
    ["agent_backend_error", { deliveryId: "delivery_1" }],
    ["canvas_delivery_file_document_committed", { deliveryId: "other_delivery", nodeId: "node_2" }],
    ["tool_call_completed", { tool: "write_file", deliveryId: "other_delivery" }],
    ["file_written", { path: "/outputs/other.md", deliveryId: "other_delivery" }],
    ["output_committed", { outputId: "other_output", deliveryId: "other_delivery" }]
  ] as const) {
    repository.recordToolEvent("thread_1", "run_1", eventType, payload, now);
  }

  const evidence = repository.listDurableContinuationEvidence("thread_1", "run_1", "delivery_1");
  assert.deepEqual(evidence.map((event) => event.eventType), [
    "tool_call_completed",
    "canvas_delivery_file_document_committed"
  ]);
});

test("three continuation attempts retain the safe delivery-scoped evidence union", () => {
  const { repository, now } = setupRunRepository("thread_evidence_chain");
  const recordIncomplete = (claimToken: string | undefined, events: ToolEventRecord[]) => repository.recordRun({
    threadId: "thread_evidence_chain",
    agentCardId: "blog-post",
    mode: "chat",
    prompt: "Original task",
    output: "Still working",
    provider: "agent-backend",
    usedMock: false,
    completion: { status: "continue", reasons: ["more work"], missingRequirements: ["finish"], evaluatedAt: now },
    durableContinuationDescriptor: descriptor(),
    ...(claimToken ? { durableContinuationClaimToken: claimToken } : {}),
    events
  });

  recordIncomplete(undefined, [
    { eventType: "tool_call_completed", payload: { tool: "web_search", toolCallId: "safe_1", deliveryId: "delivery_original" } },
    { eventType: "run_timeline_run_completed", payload: { deliveryId: "delivery_original" } },
    { eventType: "agent_backend_error", payload: { deliveryId: "delivery_original", error: "unsafe" } },
    { eventType: "tool_call_completed", payload: { tool: "web_search", toolCallId: "other_delivery", deliveryId: "delivery_other" } }
  ]);
  const attempt2 = repository.claimDurableContinuation("thread_evidence_chain");
  recordIncomplete(attempt2.claimToken, [
    { eventType: "canvas_delivery_file_document_committed", payload: { nodeId: "safe_2", deliveryId: "delivery_original" } },
    { eventType: "completion_evaluated", payload: { deliveryId: "delivery_original" } }
  ]);
  const attempt3 = repository.claimDurableContinuation("thread_evidence_chain");

  const evidence = repository.listDurableContinuationEvidence(
    "thread_evidence_chain",
    attempt3.sourceRunId,
    attempt3.descriptor.deliveryId
  );
  assert.deepEqual(evidence.map((event) => [event.eventType, (event.payload as Record<string, unknown>).toolCallId ?? (event.payload as Record<string, unknown>).nodeId]), [
    ["tool_call_completed", "safe_1"],
    ["canvas_delivery_file_document_committed", "safe_2"]
  ]);
});

test("claimed partial verdict requeues with its durable descriptor", () => {
  const { repository, now } = setupRunRepository("thread_claimed_partial");
  repository.recordRun({
    threadId: "thread_claimed_partial", agentCardId: "blog-post", mode: "chat", prompt: "Task", output: "Continue",
    provider: "agent-backend", usedMock: false,
    completion: { status: "continue", reasons: [], missingRequirements: ["finish"], evaluatedAt: now },
    durableContinuationDescriptor: descriptor()
  });
  const claim = repository.claimDurableContinuation("thread_claimed_partial");

  repository.recordRun({
    threadId: "thread_claimed_partial", agentCardId: "blog-post", mode: "chat", prompt: "Task", output: "Partial result",
    provider: "agent-backend", usedMock: false,
    completion: { status: "partial", reasons: ["budget"], missingRequirements: ["finalize"], evaluatedAt: now },
    durableContinuationDescriptor: descriptor(),
    durableContinuationClaimToken: claim.claimToken
  });

  const continuation = repository.readDurableContinuation("thread_claimed_partial")!;
  assert.equal(continuation.state, "ready");
  assert.deepEqual(continuation.descriptor.resolvedInstruction, descriptor().resolvedInstruction);
});

test("claimed failed verdict transitions to failed instead of completed", () => {
  const { repository, now } = setupRunRepository("thread_claimed_failed");
  repository.recordRun({
    threadId: "thread_claimed_failed", agentCardId: "blog-post", mode: "chat", prompt: "Task", output: "Continue",
    provider: "agent-backend", usedMock: false,
    completion: { status: "continue", reasons: [], missingRequirements: ["finish"], evaluatedAt: now },
    durableContinuationDescriptor: descriptor()
  });
  const claim = repository.claimDurableContinuation("thread_claimed_failed");

  repository.recordRun({
    threadId: "thread_claimed_failed", agentCardId: "blog-post", mode: "chat", prompt: "Task", output: "",
    provider: "agent-backend", usedMock: false, errorMessage: "runtime_failed",
    completion: { status: "failed", reasons: ["runtime failed"], missingRequirements: ["retry"], evaluatedAt: now },
    durableContinuationClaimToken: claim.claimToken
  });

  assert.equal(repository.readDurableContinuation("thread_claimed_failed")?.state, "failed");
});

test("claimed waiting completes only after resumable clarification ownership is persisted", () => {
  for (const resumable of [false, true]) {
    const threadId = `thread_claimed_waiting_${resumable}`;
    const { repository, now } = setupRunRepository(threadId);
    repository.recordRun({
      threadId, agentCardId: "blog-post", mode: "chat", prompt: "Task", output: "Continue",
      provider: "agent-backend", usedMock: false,
      completion: { status: "continue", reasons: [], missingRequirements: ["finish"], evaluatedAt: now },
      durableContinuationDescriptor: descriptor()
    });
    const claim = repository.claimDurableContinuation(threadId);
    repository.recordRun({
      threadId, agentCardId: "blog-post", mode: "chat", prompt: "Task", output: "",
      provider: "agent-backend", usedMock: false,
      completion: { status: "waiting", reasons: ["clarification"], missingRequirements: ["answer"], evaluatedAt: now },
      durableContinuationDescriptor: descriptor(),
      durableContinuationClaimToken: claim.claimToken,
      events: [{
        eventType: "agent_backend_agent_clarification_requested",
        payload: {
          type: "agent_clarification_requested",
          clarificationId: "clarification_owned",
          question: "Which format?",
          options: [{ id: "report", label: "Report" }, { id: "brief", label: "Brief" }],
          ...(resumable ? {
            resumeContext: {
              runtimeResume: {
                runtimeThreadId: "runtime_thread_waiting",
                runtimeRunId: "runtime_run_waiting",
                interruptId: "interrupt_waiting",
                checkpointId: "checkpoint_waiting"
              }
            }
          } : {})
        }
      }]
    });

    assert.equal(repository.listAgentClarifications(threadId)[0]?.resumeState, resumable ? "awaiting_answer" : "not_resumable");
    assert.equal(repository.readDurableContinuation(threadId)?.state, resumable ? "completed" : "ready");
  }
});
