import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { registerInternalAgentBackendRoutes } from "./internalAgentBackendRoutes.js";
import type { SQLiteStorageRepository } from "../storage.js";

function createTestApp(storage: SQLiteStorageRepository) {
  const app = express();
  app.use(express.json());
  registerInternalAgentBackendRoutes(app, { storage });
  return app;
}

async function request(app: express.Express, body: unknown, headers: Record<string, string> = {}) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}/api/internal/agent-backend/tool-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
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

test("rejects AgentBackend tool bridge calls without an allowed internal source", async () => {
  const app = createTestApp(fakeStorage());

  const result = await request(app, {
    threadId: "thread_bridge",
    toolName: "knowledge_base",
    arguments: { query: "draft", limit: 2 },
    allowedToolRefs: ["knowledge_base"],
    toolState: { knowledge_base: true }
  });

  assert.equal(result.status, 403);
  assert.equal((result.body.error as { code: string }).code, "validation_failed");
});

test("executes allowed knowledge_base bridge calls with workspace context", async () => {
  const app = createTestApp(fakeStorage());

  const result = await request(app, {
    threadId: "thread_bridge",
    toolName: "knowledge_base",
    arguments: { query: "draft", limit: 2 },
    allowedToolRefs: ["knowledge_base"],
    toolState: { knowledge_base: true },
    contextValues: { draft: "Bridge context" }
  }, { "x-facetwrite-internal": "agent-backend" });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.match(String(result.body.content), /Bridge context/);
  assert.equal((result.body.payload as { tool: string }).tool, "knowledge_base");
});

test("returns policy denial for disabled bridge tools", async () => {
  const app = createTestApp(fakeStorage());

  const result = await request(app, {
    threadId: "thread_bridge",
    toolName: "knowledge_base",
    arguments: { query: "draft", limit: 2 },
    allowedToolRefs: ["knowledge_base"],
    toolState: { knowledge_base: false }
  }, { "x-facetwrite-internal": "agent-backend" });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, false);
  assert.equal((result.body.payload as { reason: string }).reason, "policy_denied");
});

test("canvas_write bridge calls create pending requests only", async () => {
  const storage = fakeStorage();
  const app = createTestApp(storage);

  const result = await request(app, {
    threadId: "thread_bridge",
    toolName: "canvas_write",
    arguments: {
      operation: "create",
      nodeKind: "document",
      title: "Draft",
      content: "Pending via AgentBackend",
      rationale: "Requested by AgentBackend"
    },
    allowedToolRefs: ["canvas_write"],
    toolState: { canvas_write: true }
  }, { "x-facetwrite-internal": "agent-backend" });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal((result.body.payload as { status: string }).status, "pending");
  assert.deepEqual(storage.createdRequests, [{
    threadId: "thread_bridge",
    operation: "create",
    targetNodeId: undefined,
    nodeKind: "document",
    title: "Draft",
    content: "Pending via AgentBackend",
    rationale: "Requested by AgentBackend"
  }]);
});

function fakeStorage() {
  const createdRequests: unknown[] = [];
  return {
    createdRequests,
    createCanvasWriteRequest(threadId: string, input: Record<string, unknown>) {
      createdRequests.push({ threadId, ...input });
      return {
        id: "write_bridge",
        operation: input.operation,
        targetNodeId: input.targetNodeId,
        nodeKind: input.nodeKind ?? "document",
        title: input.title ?? "Draft",
        status: "pending"
      };
    }
  } as unknown as SQLiteStorageRepository & { createdRequests: unknown[] };
}
