import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { registerCanvasRoutes } from "./canvasRoutes.js";

test("Canvas object routes return success, validation errors, and not found responses", async () => {
  const app = express();
  app.use(express.json());
  registerCanvasRoutes(app, {
    canvasService: {
      projectIdForThread: () => "project_1",
      createObject: (_threadId: string, input: { kind?: string }) => {
        if (input.kind !== "shape") throw new Error("Invalid Canvas object kind");
        return object();
      },
      updateObject: () => undefined,
      deleteObject: () => false,
    } as never,
  });

  const created = await request(app, "/api/threads/thread_1/canvas/objects", { method: "POST", body: { kind: "shape" } });
  const invalid = await request(app, "/api/threads/thread_1/canvas/objects", { method: "POST", body: { kind: "invalid" } });
  const missingPatch = await request(app, "/api/threads/thread_1/canvas/objects/missing", { method: "PATCH", body: {} });
  const missingDelete = await request(app, "/api/threads/thread_1/canvas/objects/missing", { method: "DELETE" });

  assert.equal(created.status, 200);
  assert.equal((created.body.object as { kind: string }).kind, "shape");
  assert.equal(invalid.status, 400);
  assert.equal((invalid.body.error as { code: string }).code, "bad_request");
  assert.equal(missingPatch.status, 404);
  assert.equal(missingDelete.status, 404);
});

async function request(app: express.Express, path: string, options: { method?: string; body?: unknown } = {}) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: options.method ?? "GET",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function object() {
  return {
    id: "object_1",
    projectId: "project_1",
    kind: "shape",
    geometry: { x: 0, y: 0, width: 220, height: 140 },
    data: { shapeId: "rectangle" },
    createdAt: "",
    updatedAt: "",
  };
}
