import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { registerInternalAgentBackendRoutes } from "./internalAgentBackendRoutes.js";
import { registerInternalAgentRuntimeRoutes } from "./internalAgentRuntimeRoutes.js";
import type { SQLiteStorageRepository } from "../storage.js";

function createTestApp(storage: SQLiteStorageRepository, mode: "agent-backend" | "agent-runtime" = "agent-backend") {
  const app = express();
  app.use(express.json());
  if (mode === "agent-runtime") {
    registerInternalAgentRuntimeRoutes(app, { storage });
  } else {
    registerInternalAgentBackendRoutes(app, { storage });
  }
  return app;
}

async function request(app: express.Express, body: unknown, headers: Record<string, string> = {}, path = "/api/internal/agent-backend/tool-call") {
  process.env.FACETWRITE_INTERNAL_TOOL_TOKEN = "test-bridge-token";
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text.startsWith("{") ? JSON.parse(text) as Record<string, unknown> : { text }
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

test("rejects spoofed internal source headers without the bridge token", async () => {
  const app = createTestApp(fakeStorage());
  const result = await request(app, {
    threadId: "thread_bridge",
    toolName: "knowledge_base",
    arguments: { query: "draft" },
    allowedToolRefs: ["knowledge_base"],
    toolState: { knowledge_base: true }
  }, { "x-facetwrite-internal": "agent-backend" });
  assert.equal(result.status, 403);
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
  }, bridgeHeaders("agent-backend"));

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.match(String(result.body.content), /Bridge context/);
  assert.equal((result.body.payload as { tool: string }).tool, "knowledge_base");
});

test("executes allowed Agent Runtime bridge calls on the preferred endpoint", async () => {
  const app = createTestApp(fakeStorage(), "agent-runtime");

  const result = await request(app, {
    threadId: "thread_bridge",
    toolName: "knowledge_base",
    arguments: { query: "draft", limit: 2 },
    allowedToolRefs: ["knowledge_base"],
    toolState: { knowledge_base: true },
    contextValues: { draft: "Runtime context" }
  }, bridgeHeaders("agent-runtime"), "/api/internal/agent-runtime/tool-call");

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.match(String(result.body.content), /Runtime context/);
});

test("deprecated DeerFlow bridge route is not registered", async () => {
  const app = createTestApp(fakeStorage(), "agent-runtime");

  const result = await request(app, {
    threadId: "thread_bridge",
    toolName: "knowledge_base",
    arguments: { query: "draft", limit: 2 },
    allowedToolRefs: ["knowledge_base"],
    toolState: { knowledge_base: true },
    contextValues: { draft: "Legacy runtime context" }
  }, bridgeHeaders("deerflow"), "/api/internal/deerflow/tool-call");

  assert.equal(result.status, 404);
});

test("returns policy denial for disabled bridge tools", async () => {
  const app = createTestApp(fakeStorage());

  const result = await request(app, {
    threadId: "thread_bridge",
    toolName: "knowledge_base",
    arguments: { query: "draft", limit: 2 },
    allowedToolRefs: ["knowledge_base"],
    toolState: { knowledge_base: false }
  }, bridgeHeaders("agent-backend"));

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, false);
  assert.equal((result.body.payload as { reason: string }).reason, "policy_denied");
});

test("canvas_write bridge resolves the Thread project and commits low-risk creates", async () => {
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
  }, bridgeHeaders("agent-backend"));

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal((result.body.payload as { status: string }).status, "committed");
  assert.equal((result.body.payload as { projectId: string }).projectId, "project_bridge");
  assert.equal((result.body.payload as { nodeId: string }).nodeId, "node_bridge");
  assert.deepEqual(storage.createdNodes, [{ projectId: "project_bridge", id: undefined, kind: "document", title: "Draft", content: "Pending via AgentBackend" }]);
  assert.deepEqual(storage.createdRequests, []);
});

test("canvas_write bridge keeps replacements pending in the real Thread project", async () => {
  const storage = fakeStorage();
  const app = createTestApp(storage, "agent-runtime");
  const result = await request(app, {
    threadId: "thread_bridge",
    projectId: "project_bridge",
    toolName: "canvas_write",
    arguments: { operation: "replace", targetNodeId: "node_existing", content: "Replacement" },
    allowedToolRefs: ["canvas_write"],
    toolState: { canvas_write: true },
    canvasAction: { operation: "replace", targetNodeId: "node_existing" }
  }, bridgeHeaders("agent-runtime"), "/api/internal/agent-runtime/tool-call");

  assert.equal((result.body.payload as { status: string }).status, "pending");
  assert.equal(storage.createdRequests[0]?.projectId, "project_bridge");
});

test("canvas_write bridge rejects a Runtime project that does not own the Thread", async () => {
  const storage = fakeStorage();
  const app = createTestApp(storage, "agent-runtime");
  const result = await request(app, {
    threadId: "thread_bridge",
    projectId: "project_other",
    toolName: "canvas_write",
    arguments: { operation: "create", content: "Wrong project" },
    allowedToolRefs: ["canvas_write"],
    toolState: { canvas_write: true },
    canvasAction: { id: "canvas_action_wrong_project", operation: "create" }
  }, bridgeHeaders("agent-runtime"), "/api/internal/agent-runtime/tool-call");

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, false);
  assert.match(String(result.body.content), /does not match/i);
  assert.deepEqual(storage.createdNodes, []);
});

function fakeStorage() {
  const createdRequests: unknown[] = [];
  const createdNodes: unknown[] = [];
  const existing = { id: "node_existing", projectId: "project_bridge", kind: "document", title: "Existing", content: "Before" };
  return {
    createdRequests,
    createdNodes,
    getThread: () => ({ id: "thread_bridge", projectId: "project_bridge" }),
    listCanvasNodes: () => [existing],
    createCanvasNode(projectId: string, input: Record<string, unknown>) {
      createdNodes.push({ projectId, ...input });
      return { id: "node_bridge", projectId, kind: input.kind, title: input.title, content: input.content };
    },
    updateCanvasNode: () => existing,
    createCanvasWriteRequest(projectId: string, input: Record<string, unknown>) {
      createdRequests.push({ projectId, ...input });
      return {
        id: "write_bridge",
        operation: input.operation,
        targetNodeId: input.targetNodeId,
        nodeKind: input.nodeKind ?? "document",
        title: input.title ?? "Draft",
        status: "pending"
      };
    }
  } as unknown as SQLiteStorageRepository & { createdRequests: Array<Record<string, unknown>>; createdNodes: unknown[] };
}

function bridgeHeaders(source: string) {
  return { "x-facetwrite-internal": source, "x-facetwrite-tool-token": "test-bridge-token" };
}
