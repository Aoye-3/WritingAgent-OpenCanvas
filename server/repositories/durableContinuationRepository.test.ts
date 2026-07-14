import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrateStorageSchema } from "../db/schema.js";
import { runSqliteTransaction } from "../db/sqlite.js";
import { DurableContinuationRepository } from "./durableContinuationRepository.js";
import { RunRepository } from "./runRepository.js";
import type { DurableContinuationDescriptor } from "../storageTypes.js";

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
  assert.deepEqual(JSON.parse(row.descriptorJson), descriptor());
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
    ["canvas_delivery_file_document_committed", { deliveryId: "other_delivery", nodeId: "node_2" }]
  ] as const) {
    repository.recordToolEvent("thread_1", "run_1", eventType, payload, now);
  }

  const evidence = repository.listDurableContinuationEvidence("thread_1", "run_1", "delivery_1");
  assert.deepEqual(evidence.map((event) => event.eventType), [
    "tool_call_completed",
    "canvas_delivery_file_document_committed"
  ]);
});
