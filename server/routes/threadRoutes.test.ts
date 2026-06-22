import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { agentCards } from "../agentCards.js";
import { createAgentRuntimeAdapter } from "../agentRuntimeAdapter.js";
import { createStorage } from "../storage.js";
import { registerThreadRoutes } from "./threadRoutes.js";
import { registerProjectRoutes } from "./projectRoutes.js";

async function withThreadRoutes(resolveModelId?: (preferredIds?: Array<string | null | undefined>) => Promise<string | undefined>) {
  const storage = await createStorage();
  const agentRuntime = createAgentRuntimeAdapter(storage);
  storage.upsertAgentCards(agentCards);
  const app = express();
  app.use(express.json());
  registerThreadRoutes(app, { storage, agentRuntime, resolveModelId });
  registerProjectRoutes(app, { storage, agentRuntime });
  return { app, storage };
}

async function localJsonRequest(app: express.Express, path: string, options: RequestInit = {}) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      assert.equal(typeof address, "object");
      assert.ok(address);
      const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}${path}`, options);
      return {
        status: response.status,
        body: await response.json() as Record<string, unknown>
      };
    } catch (error) {
      lastError = error;
      if (!isBadPortFetchError(error)) {
        throw error;
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
  throw lastError;
}

function isBadPortFetchError(error: unknown) {
  return error instanceof TypeError
    && error.message === "fetch failed"
    && error.cause instanceof Error
    && error.cause.message === "bad port";
}

async function request(app: express.Express, path: string, body: unknown) {
  return localJsonRequest(app, path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function post(app: express.Express, path: string, body: unknown) {
  return localJsonRequest(app, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function put(app: express.Express, path: string, body: unknown) {
  return localJsonRequest(app, path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function get(app: express.Express, path: string) {
  return localJsonRequest(app, path);
}

test("renames an active thread title", async () => {
  const { app, storage } = await withThreadRoutes();
  const threadId = `thread_rename_route_${Date.now()}`;
  await storage.ensureThread(threadId, "blog-post");

  const result = await request(app, `/api/threads/${threadId}`, { title: "Renamed from route" });

  assert.equal(result.status, 200);
  assert.equal((result.body.thread as { title: string }).title, "Renamed from route");
  assert.equal(storage.getThread(threadId)?.title, "Renamed from route");

  storage.moveThreadToTrash(threadId);
  await storage.hardDeleteThread(threadId);
});

test("project runtime settings are isolated per project", async () => {
  const { app, storage } = await withThreadRoutes();
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const firstProjectId = `runtime_a_${suffix}`;
  const secondProjectId = `runtime_b_${suffix}`;
  storage.createProject(firstProjectId, "Runtime A");
  storage.createProject(secondProjectId, "Runtime B");

  const saved = await put(app, `/api/projects/${firstProjectId}/runtime-settings`, {
    runtimeBudgetProfile: "high",
    evidenceToolLimit: 12,
    bodyDraftWriteLimit: 4,
    modelCallLimit: 30,
    recursionLimit: 120,
    synthesisReserveSteps: 20
  });
  const first = await get(app, `/api/projects/${firstProjectId}/runtime-settings`);
  const second = await get(app, `/api/projects/${secondProjectId}/runtime-settings`);

  assert.equal(saved.status, 200);
  assert.equal((first.body.settings as { runtimeBudgetProfile: string }).runtimeBudgetProfile, "high");
  assert.equal((first.body.settings as { evidenceToolLimit: number }).evidenceToolLimit, 12);
  assert.equal((first.body.settings as { bodyDraftWriteLimit: number }).bodyDraftWriteLimit, 4);
  assert.equal((second.body.settings as { runtimeBudgetProfile: string }).runtimeBudgetProfile, "medium");
  assert.equal((second.body.settings as { bodyDraftWriteLimit: number }).bodyDraftWriteLimit, 3);
});

test("rejects blank thread titles", async () => {
  const { app, storage } = await withThreadRoutes();
  const threadId = `thread_blank_route_${Date.now()}`;
  await storage.ensureThread(threadId, "blog-post");

  const result = await request(app, `/api/threads/${threadId}`, { title: "   " });

  assert.equal(result.status, 400);
  assert.equal((result.body.error as { code: string }).code, "bad_request");

  storage.moveThreadToTrash(threadId);
  await storage.hardDeleteThread(threadId);
});

test("persists independent Project and current Task Briefs in thread state", async () => {
  const { app, storage } = await withThreadRoutes();
  const projectId = `project_brief_route_${Date.now()}`;
  const threadId = `thread_brief_route_${Date.now()}`;
  storage.createProject(projectId, "Brief project");
  await storage.ensureThread(threadId, projectId);

  const projectSaved = await request(app, `/api/projects/${projectId}/brief`, {
    revision: 1,
    brief: { goal: "Shared project goal", ignored: "drop me" }
  });
  const taskSaved = await request(app, `/api/threads/${threadId}/task-brief`, {
    revision: 1,
    brief: { objective: "Current task", deliverableType: "outline", ignored: "drop me" }
  });
  const state = await get(app, `/api/threads/${threadId}/state`);

  assert.equal(projectSaved.status, 200);
  assert.deepEqual(projectSaved.body.brief, { goal: "Shared project goal" });
  assert.equal(taskSaved.status, 200);
  assert.deepEqual(taskSaved.body.brief, { objective: "Current task", deliverableType: "outline" });
  assert.deepEqual(state.body.projectBrief, { brief: { goal: "Shared project goal" }, revision: 1 });
  assert.deepEqual(state.body.taskBrief, { brief: { objective: "Current task", deliverableType: "outline" }, revision: 1 });
  assert.equal("projectInputs" in state.body, false);

  storage.moveThreadToTrash(threadId);
  await storage.hardDeleteThread(threadId);
});

test("returns 404 for missing or trashed threads", async () => {
  const { app, storage } = await withThreadRoutes();
  const threadId = `thread_trash_route_${Date.now()}`;
  await storage.ensureThread(threadId, "blog-post");
  storage.moveThreadToTrash(threadId);

  const trashed = await request(app, `/api/threads/${threadId}`, { title: "Nope" });
  const missing = await request(app, "/api/threads/thread_missing_rename", { title: "Nope" });

  assert.equal(trashed.status, 404);
  assert.equal(missing.status, 404);

  await storage.hardDeleteThread(threadId);
});

test("batch moves active threads to trash and batch deletes trashed threads", async () => {
  const { app, storage } = await withThreadRoutes();
  const firstThreadId = `thread_batch_first_${Date.now()}`;
  const secondThreadId = `thread_batch_second_${Date.now()}`;
  await storage.ensureThread(firstThreadId, "blog-post");
  await storage.ensureThread(secondThreadId, "summary");

  const trashResult = await post(app, "/api/threads/batch-trash", { threadIds: [firstThreadId, secondThreadId] });

  assert.equal(trashResult.status, 200);
  assert.equal(trashResult.body.movedCount, 2);
  assert.equal(storage.getThread(firstThreadId), undefined);
  assert.equal(storage.getThread(secondThreadId), undefined);

  const deleteResult = await post(app, "/api/threads/batch-delete", { threadIds: [firstThreadId, secondThreadId] });

  assert.equal(deleteResult.status, 200);
  assert.equal(deleteResult.body.deletedCount, 2);
  assert.equal(storage.getThread(firstThreadId), undefined);
  assert.equal(storage.getThread(secondThreadId), undefined);
});

test("batch routes reject empty or invalid thread id lists", async () => {
  const { app } = await withThreadRoutes();

  const empty = await post(app, "/api/threads/batch-trash", { threadIds: [] });
  const invalid = await post(app, "/api/threads/batch-delete", { threadIds: ["ok_id", "../bad"] });

  assert.equal(empty.status, 400);
  assert.equal(invalid.status, 400);
});

test("creates a named Project thread and returns the complete thread", async () => {
  const { app, storage } = await withThreadRoutes();
  const projectId = `project_thread_create_${Date.now()}`;
  storage.createProject(projectId, "Thread project");

  const result = await post(app, "/api/threads", { projectId, title: "Research conversation" });

  assert.equal(result.status, 200);
  assert.equal((result.body.thread as { projectId: string }).projectId, projectId);
  assert.equal((result.body.thread as { title: string }).title, "Research conversation");
  assert.equal(typeof (result.body.thread as { id: string }).id, "string");
});

test("new conversations inherit the project's most recently used valid model", async () => {
  const observed: Array<Array<string | null | undefined>> = [];
  const { app, storage } = await withThreadRoutes(async (preferredIds = []) => {
    observed.push(preferredIds);
    return preferredIds.find(Boolean) ?? "configured-default";
  });
  const projectId = `project_thread_model_${Date.now()}`;
  storage.createProject(projectId, "Thread model project");
  await storage.ensureThread(`${projectId}_existing`, projectId, "Existing");
  storage.setThreadModelConfig(`${projectId}_existing`, "configured-recent");

  const result = await post(app, "/api/threads", { projectId, title: "Inherited model" });

  assert.equal(result.status, 200);
  assert.equal((result.body.thread as { configuredModelApiId: string }).configuredModelApiId, "configured-recent");
  assert.equal(observed[0]?.includes("configured-recent"), true);
});

test("resets conversation context without deleting visible message history", async () => {
  const { app, storage } = await withThreadRoutes();
  const projectId = `project_context_reset_${Date.now()}`;
  const threadId = `${projectId}_thread`;
  storage.createProject(projectId, "Context reset project");
  await storage.ensureThread(threadId, projectId);
  storage.recordRun({
    threadId,
    agentCardId: "blog-post",
    mode: "chat",
    prompt: "old prompt",
    output: "old output",
    provider: "mock",
    usedMock: true,
    userMessage: "old message"
  });

  const result = await post(app, `/api/threads/${threadId}/context-reset`, {});

  assert.equal(result.status, 200);
  assert.equal(typeof result.body.contextResetAt, "string");
  assert.equal(storage.listMessages(threadId).length, 2);
  assert.equal(storage.getThread(threadId)?.contextResetAt, result.body.contextResetAt);
});

test("lists only active threads for the requested Project in update order", async () => {
  const { app, storage } = await withThreadRoutes();
  const projectId = `project_thread_list_${Date.now()}`;
  const otherProjectId = `${projectId}_other`;
  storage.createProject(projectId, "Thread list project");
  storage.createProject(otherProjectId, "Other project");
  await storage.ensureThread(`${projectId}_older`, projectId, "Older");
  await storage.ensureThread(`${projectId}_newer`, projectId, "Newer");
  await storage.ensureThread(`${projectId}_trashed`, projectId, "Trashed");
  await storage.ensureThread(`${projectId}_other`, otherProjectId, "Other");
  storage.moveThreadToTrash(`${projectId}_trashed`);
  storage.renameThread(`${projectId}_newer`, "Newest");

  const result = await get(app, `/api/projects/${projectId}/threads`);
  const threads = result.body.threads as Array<{ id: string; projectId: string; title: string }>;

  assert.equal(result.status, 200);
  assert.deepEqual(threads.map((thread) => thread.id), [`${projectId}_newer`, `${projectId}_older`]);
  assert.ok(threads.every((thread) => thread.projectId === projectId));
});
