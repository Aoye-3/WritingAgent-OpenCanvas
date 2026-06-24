import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrateStorageSchema } from "./db/schema.js";
import { createStorage } from "./storage.js";

test("schema v13 uses independent Project and Thread Brief tables plus Agent clarifications", () => {
  const db = new DatabaseSync(":memory:");
  migrateStorageSchema(db);

  const version = db.prepare(`SELECT MAX(version) as version FROM schema_version`).get() as { version: number };
  assert.equal(version.version, 13);
  assert.equal(tableExists(db, "plan_runs"), true);
  assert.equal(tableExists(db, "plan_executions"), true);
  assert.equal(tableExists(db, "run_activities"), true);
  assert.equal(tableExists(db, "canvas_write_suggestions"), true);
  assert.equal(tableExists(db, "plan_artifact_links"), true);
  assert.equal(columnNames(db, "plan_runs").includes("clarification_json"), true);
  assert.equal(columnNames(db, "plan_runs").includes("canvas_node_id"), true);
  assert.equal(columnNames(db, "plan_runs").includes("current_step_id"), true);
  assert.equal(columnNames(db, "plan_runs").includes("execution_version"), true);
  assert.equal(columnNames(db, "plan_executions").includes("lease_expires_at"), true);
  assert.equal(columnNames(db, "plan_executions").includes("last_heartbeat_at"), true);
  assert.equal(tableExists(db, "thread_inputs"), false);
  assert.equal(tableExists(db, "project_agent_inputs"), false);
  assert.equal(tableExists(db, "project_briefs"), true);
  assert.equal(tableExists(db, "thread_task_briefs"), true);
  assert.equal(tableExists(db, "agent_clarifications"), true);
  assert.equal(columnNames(db, "agent_clarifications").includes("resume_context_json"), true);
  assert.equal(columnNames(db, "agent_clarifications").includes("status"), true);
  assert.equal(columnNames(db, "threads").includes("agent_card_id"), false);
  assert.equal(columnNames(db, "threads").includes("context_reset_at"), true);
  for (const table of ["canvas_nodes", "canvas_edges", "canvas_objects", "canvas_workflows", "canvas_workflow_suggestions", "canvas_write_requests"]) {
    const columns = columnNames(db, table);
    assert.equal(columns.includes("project_id"), true, `${table} should have project_id`);
    assert.equal(columns.includes("thread_id"), false, `${table} should not have thread_id`);
  }
});

test("schema v3 migrates a legacy thread table without retaining Agent ownership", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_version (version, applied_at) VALUES (1, datetime('now')), (2, datetime('now'));
    CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      agent_card_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
  `);

  migrateStorageSchema(db);

  assert.equal(columnNames(db, "threads").includes("agent_card_id"), false);
  assert.equal(columnNames(db, "threads").includes("project_id"), true);
  assert.equal(columnNames(db, "threads").includes("configured_model_api_id"), true);
});

test("schema v8 repairs Thread-owned Canvas requests and makes old low-risk proposals stale", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_version (version, applied_at) VALUES
      (1, datetime('now')), (2, datetime('now')), (3, datetime('now')), (4, datetime('now')),
      (5, datetime('now')), (6, datetime('now')), (7, datetime('now'));
    CREATE TABLE threads (id TEXT PRIMARY KEY, project_id TEXT NOT NULL);
    CREATE TABLE canvas_write_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO threads (id, project_id) VALUES ('thread_orphan', 'project_real');
    INSERT INTO canvas_write_requests (id, project_id, operation, status, updated_at)
    VALUES ('write_orphan', 'thread_orphan', 'create', 'pending', datetime('now'));
  `);

  migrateStorageSchema(db);

  const request = db.prepare(`SELECT project_id as projectId, status FROM canvas_write_requests WHERE id = 'write_orphan'`).get() as {
    projectId: string;
    status: string;
  };
  assert.equal(request.projectId, "project_real");
  assert.equal(request.status, "stale");
});

test("projects own Project Briefs while threads own independent Task Briefs", async () => {
  const storage = await createStorage();
  const suffix = Date.now().toString(36);
  const firstProjectId = `project_first_${suffix}`;
  const secondProjectId = `project_second_${suffix}`;
  const firstThreadId = `thread_first_${suffix}`;
  const secondThreadId = `thread_second_${suffix}`;

  storage.createProject(firstProjectId, "First project");
  storage.createProject(secondProjectId, "Second project");
  await storage.ensureThread(firstThreadId, firstProjectId);
  await storage.ensureThread(secondThreadId, secondProjectId);

  storage.setProjectModelBindings(firstProjectId, ["model_config_a", "model_config_b"]);
  storage.setThreadModelConfig(firstThreadId, "model_config_b");
  storage.saveProjectBrief(firstProjectId, { goal: "First only" }, 1);
  storage.saveProjectBrief(secondProjectId, { goal: "Second only" }, 1);
  storage.saveTaskBrief(firstThreadId, { objective: "First task" }, 1);
  storage.saveTaskBrief(secondThreadId, { objective: "Second task" }, 1);

  assert.equal(storage.getThread(firstThreadId)?.projectId, firstProjectId);
  assert.equal("agentCardId" in (storage.getThread(firstThreadId) ?? {}), false);
  assert.equal(storage.getThread(firstThreadId)?.configuredModelApiId, "model_config_b");
  assert.deepEqual(storage.getProjectModelBindings(firstProjectId), ["model_config_a", "model_config_b"]);
  assert.deepEqual(storage.getProjectBrief(firstProjectId), { brief: { goal: "First only" }, revision: 1 });
  assert.deepEqual(storage.getProjectBrief(secondProjectId), { brief: { goal: "Second only" }, revision: 1 });
  assert.deepEqual(storage.getTaskBrief(firstThreadId), { brief: { objective: "First task" }, revision: 1 });
  assert.deepEqual(storage.getTaskBrief(secondThreadId), { brief: { objective: "Second task" }, revision: 1 });
});

test("conversation model selection no longer requires a project model binding", async () => {
  const storage = await createStorage();
  const suffix = Date.now().toString(36);
  const projectId = `project_direct_model_${suffix}`;
  const threadId = `thread_direct_model_${suffix}`;
  storage.createProject(projectId, "Direct model project");
  await storage.ensureThread(threadId, projectId);

  const thread = storage.setThreadModelConfig(threadId, "configured_chat_model");

  assert.equal(thread?.configuredModelApiId, "configured_chat_model");
  assert.deepEqual(storage.getProjectModelBindings(projectId), []);
});

test("project canvas is shared by project threads and isolated from other projects", async () => {
  const storage = await createStorage();
  const suffix = Date.now().toString(36);
  const projectId = `project_canvas_${suffix}`;
  const otherProjectId = `project_canvas_other_${suffix}`;

  storage.createProject(projectId, "Canvas project");
  storage.createProject(otherProjectId, "Other canvas project");
  const node = storage.createCanvasNode(projectId, {
    kind: "document",
    title: "Shared project draft",
    content: "Visible to every thread in this project."
  });

  assert.equal(node.projectId, projectId);
  assert.equal("threadId" in node, false);
  assert.equal(storage.listCanvasNodes(projectId).length, 1);
  assert.equal(storage.listCanvasNodes(otherProjectId).length, 0);
});

test("Project and Task Briefs reject stale revisions", async () => {
  const storage = await createStorage();
  const suffix = Date.now().toString(36);
  const projectId = `project_revision_${suffix}`;
  storage.createProject(projectId, "Revision project");

  const threadId = `thread_revision_${suffix}`;
  await storage.ensureThread(threadId, projectId);

  assert.deepEqual(storage.saveProjectBrief(projectId, { goal: "newer" }, 2), {
    brief: { goal: "newer" },
    revision: 2
  });
  assert.throws(
    () => storage.saveProjectBrief(projectId, { goal: "older" }, 1),
    /stale/i
  );
  assert.deepEqual(storage.saveTaskBrief(threadId, { objective: "newer task", deliverableType: "outline" }, 2), {
    brief: { objective: "newer task", deliverableType: "outline" },
    revision: 2
  });
  assert.throws(() => storage.saveTaskBrief(threadId, { objective: "older task" }, 1), /stale/i);
  assert.deepEqual(storage.getProjectBrief(projectId), { brief: { goal: "newer" }, revision: 2 });
  assert.deepEqual(storage.getTaskBrief(threadId), { brief: { objective: "newer task", deliverableType: "outline" }, revision: 2 });
});

test("project shared context includes only explicit Canvas and outputs within stable budgets", async () => {
  const storage = await createStorage();
  const suffix = Date.now().toString(36);
  const projectId = `project_context_${suffix}`;
  const threadId = `thread_context_${suffix}`;
  storage.createProject(projectId, "Context project");
  await storage.ensureThread(threadId, projectId);
  storage.saveProjectBrief(projectId, { goal: "Project input" }, 1);
  storage.createCanvasNode(projectId, { kind: "note", title: "Private", content: "DO_NOT_SHARE" });
  storage.createCanvasNode(projectId, { kind: "reference", title: "Included", content: "SHARE_ME", includeInProjectContext: true });
  const run = storage.recordRun({
    threadId,
    agentCardId: "blog-post",
    mode: "chat",
    prompt: "Prompt",
    output: "OUTPUT_SHARE_ME",
    provider: "mock",
    usedMock: true
  });

  let context = storage.getProjectSharedContext(projectId);
  assert.equal(JSON.stringify(context).includes("DO_NOT_SHARE"), false);
  assert.equal(JSON.stringify(context).includes("SHARE_ME"), true);
  assert.equal(JSON.stringify(context).includes("OUTPUT_SHARE_ME"), false);

  assert.equal(storage.setOutputVersionProjectContext(threadId, run.outputVersionId, true), true);
  context = storage.getProjectSharedContext(projectId);
  assert.equal(JSON.stringify(context).includes("OUTPUT_SHARE_ME"), true);
  assert.ok(JSON.stringify(context).length <= 24_500);
});

function columnNames(db: DatabaseSync, table: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name);
}

function tableExists(db: DatabaseSync, table: string) {
  return Boolean(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table));
}
