import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrateStorageSchema } from "./db/schema.js";
import { createStorage } from "./storage.js";

test("schema v4 uses project-owned Canvas tables and adds the conversation context reset boundary", () => {
  const db = new DatabaseSync(":memory:");
  migrateStorageSchema(db);

  const version = db.prepare(`SELECT MAX(version) as version FROM schema_version`).get() as { version: number };
  assert.equal(version.version, 4);
  assert.equal(tableExists(db, "thread_inputs"), false);
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

test("projects own threads, models, and agent inputs without cross-project leakage", async () => {
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
  storage.saveProjectAgentInputValues(firstProjectId, "blog-post", { topic: "First only" }, 1);
  storage.saveProjectAgentInputValues(secondProjectId, "blog-post", { topic: "Second only" }, 1);

  assert.equal(storage.getThread(firstThreadId)?.projectId, firstProjectId);
  assert.equal("agentCardId" in (storage.getThread(firstThreadId) ?? {}), false);
  assert.equal(storage.getThread(firstThreadId)?.configuredModelApiId, "model_config_b");
  assert.deepEqual(storage.getProjectModelBindings(firstProjectId), ["model_config_a", "model_config_b"]);
  assert.deepEqual(storage.getProjectAgentInputValues(firstProjectId, "blog-post"), { topic: "First only" });
  assert.deepEqual(storage.getProjectAgentInputValues(secondProjectId, "blog-post"), { topic: "Second only" });
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

test("project Agent inputs reject stale revisions", async () => {
  const storage = await createStorage();
  const suffix = Date.now().toString(36);
  const projectId = `project_revision_${suffix}`;
  storage.createProject(projectId, "Revision project");

  assert.deepEqual(storage.saveProjectAgentInputValues(projectId, "blog-post", { topic: "newer" }, 2), {
    structuredValues: { topic: "newer" },
    revision: 2
  });
  assert.throws(
    () => storage.saveProjectAgentInputValues(projectId, "blog-post", { topic: "older" }, 1),
    /stale/i
  );
  assert.deepEqual(storage.getProjectAgentInputValues(projectId, "blog-post"), { topic: "newer" });
});

test("project shared context includes only explicit Canvas and outputs within stable budgets", async () => {
  const storage = await createStorage();
  const suffix = Date.now().toString(36);
  const projectId = `project_context_${suffix}`;
  const threadId = `thread_context_${suffix}`;
  storage.createProject(projectId, "Context project");
  await storage.ensureThread(threadId, projectId);
  storage.saveProjectAgentInputValues(projectId, "blog-post", { topic: "Project input" }, 1);
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
