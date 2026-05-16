import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { agentCards } from "../agentCards.js";
import { createAgentRuntimeAdapter } from "../agentRuntimeAdapter.js";
import { createStorage } from "../storage.js";
import { registerThreadRoutes } from "./threadRoutes.js";

async function withThreadRoutes() {
  const storage = await createStorage();
  const agentRuntime = createAgentRuntimeAdapter(storage);
  storage.upsertAgentCards(agentCards);
  const app = express();
  app.use(express.json());
  registerThreadRoutes(app, { storage, agentRuntime });
  return { app, storage };
}

async function request(app: express.Express, path: string, body: unknown) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return {
      status: response.status,
      body: await response.json() as Record<string, unknown>
    };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function post(app: express.Express, path: string, body: unknown) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return {
      status: response.status,
      body: await response.json() as Record<string, unknown>
    };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
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
  assert.ok(storage.listProjects(agentCards, true).some((project) => project.id === firstThreadId));
  assert.ok(storage.listProjects(agentCards, true).some((project) => project.id === secondThreadId));

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
