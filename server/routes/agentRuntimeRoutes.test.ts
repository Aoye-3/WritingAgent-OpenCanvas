import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { registerAgentRuntimeRoutes } from "./agentRuntimeRoutes.js";
import type { AgentRuntimeAdapter } from "../agentRuntimeAdapter.js";
import type { AgentRuntimePort } from "../runtime/agentRuntimePort.js";
import type { AgentRuntimeMemoryService } from "../services/agentRuntimeMemoryService.js";

async function request(app: express.Express, method: string, path: string, body?: unknown) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return {
      status: response.status,
      body: await response.json() as Record<string, unknown>
    };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function createTestApp(memoryService?: AgentRuntimeMemoryService) {
  const app = express();
  app.use(express.json());
  registerAgentRuntimeRoutes(app, {
    agentRuntime: fakeAgentRuntime(),
    executionRuntime: fakeExecutionRuntime(),
    memoryService
  });
  return app;
}

test("reads FacetWrite-managed memory with Agent memory state", async () => {
  const app = createTestApp(fakeMemoryService({ content: "Project memory", updatedAt: "2026-05-25T00:00:00.000Z" }));

  const result = await request(app, "GET", "/api/agent-runtime/memory");

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.memory, { content: "Project memory", updatedAt: "2026-05-25T00:00:00.000Z" });
  assert.deepEqual(result.body.agentMemory, {
    enabledAgents: 1,
    totalAgents: 2,
    agents: [
      { agentCardId: "summary", title: "Summary", enabled: true },
      { agentCardId: "writer", title: "Writer", enabled: false }
    ]
  });
});

test("returns empty memory when the memory service is not configured", async () => {
  const app = createTestApp();

  const result = await request(app, "GET", "/api/agent-runtime/memory");

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.memory, { content: "" });
});

test("saves and clears FacetWrite-managed memory", async () => {
  const service = fakeMemoryService({ content: "" });
  const app = createTestApp(service);

  const saved = await request(app, "PUT", "/api/agent-runtime/memory", { content: "New memory" });
  const cleared = await request(app, "DELETE", "/api/agent-runtime/memory");

  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.memory, { content: "New memory", updatedAt: "saved" });
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.body.memory, { content: "" });
});

test("rejects non-string memory content", async () => {
  const app = createTestApp(fakeMemoryService({ content: "" }));

  const result = await request(app, "PUT", "/api/agent-runtime/memory", { content: { stale: true } });

  assert.equal(result.status, 400);
  assert.equal((result.body.error as { code: string }).code, "bad_request");
  assert.match((result.body.error as { message: string }).message, /must be a string/);
});

function fakeAgentRuntime() {
  return {
    listAgentCards() {
      return [
        { id: "summary", title: "Summary", settings: { memory: { enabled: true } } },
        { id: "writer", title: "Writer", settings: { memory: { enabled: false } } }
      ];
    }
  } as unknown as AgentRuntimeAdapter;
}

function fakeExecutionRuntime() {
  return {
    getStatus: async () => ({}),
    getConfigOverview: async () => ({}),
    getDashboard: async () => ({})
  } as unknown as AgentRuntimePort;
}

function fakeMemoryService(initial: { content: string; updatedAt?: string }) {
  let memory = initial;
  return {
    async readMemory() {
      return memory;
    },
    async saveMemory(content: unknown) {
      if (typeof content !== "string") throw new Error("Memory content must be a string");
      memory = { content, updatedAt: "saved" };
      return memory;
    },
    async clearMemory() {
      memory = { content: "" };
      return memory;
    }
  } as unknown as AgentRuntimeMemoryService;
}
