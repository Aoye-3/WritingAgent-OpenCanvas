import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { registerCanvasRoutes } from "./canvasRoutes.js";

test("Canvas node position route updates many nodes and reports missing nodes", async () => {
  const app = express();
  app.use(express.json());
  registerCanvasRoutes(app, {
    canvasService: {
      projectIdForThread: () => "project_1",
      updateNodePositions: (_projectId: string, updates: Array<{ nodeId: string; x: number; y: number }>) => {
        if (updates.some((update) => update.nodeId === "node_missing")) return undefined;
        return updates.map((update) => node(update.nodeId, update.x, update.y));
      }
    } as never
  });

  const updated = await request(app, "/api/threads/thread_1/canvas/node-positions", {
    method: "PATCH",
    body: { updates: [{ nodeId: "node_1", x: 12, y: 34 }, { nodeId: "node_2", x: 56, y: 78 }] }
  });
  const missing = await request(app, "/api/threads/thread_1/canvas/node-positions", {
    method: "PATCH",
    body: { updates: [{ nodeId: "node_missing", x: 0, y: 0 }] }
  });

  assert.equal(updated.status, 200);
  assert.deepEqual((updated.body.nodes as Array<{ id: string; x: number; y: number }>).map(({ id, x, y }) => ({ id, x, y })), [
    { id: "node_1", x: 12, y: 34 },
    { id: "node_2", x: 56, y: 78 }
  ]);
  assert.equal(missing.status, 404);
});

async function request(app: express.Express, path: string, options: { method?: string; body?: unknown } = {}) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: options.method ?? "GET",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) as Record<string, unknown> : {};
    return { status: response.status, body };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function node(id: string, x: number, y: number) {
  return {
    id,
    projectId: "project_1",
    kind: "document",
    title: id,
    content: "",
    x,
    y,
    width: 320,
    height: 220,
    metadata: {},
    includeInProjectContext: true,
    createdAt: "",
    updatedAt: ""
  };
}
