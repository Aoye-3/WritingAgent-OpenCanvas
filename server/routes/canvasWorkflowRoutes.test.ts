import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { createCanvasDomainService } from "../domains/canvas/index.js";
import { registerCanvasRoutes } from "./canvasRoutes.js";

async function request(app: express.Express, path: string, options: { method?: string; body?: unknown } = {}) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}${path}`, {
      method: options.method ?? "GET",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("canvas response includes workflow and node suggestions", async () => {
  const threadId = "thread_route_canvas_workflow";
  const app = express();
  app.use(express.json());
  const storage = fakeCanvasStorage();
  registerCanvasRoutes(app, { canvasService: createCanvasDomainService(storage as never) });

  const response = await request(app, `/api/threads/${threadId}/canvas`);

  assert.equal(response.status, 200);
  assert.equal((response.body.workflow as { stage: string }).stage, "inspiration");
  assert.equal((response.body.suggestions as unknown[]).length, 1);
});

test("canvas workflow route updates stage and node workflow metadata", async () => {
  const threadId = "thread_route_canvas_workflow";
  const app = express();
  app.use(express.json());
  const storage = fakeCanvasStorage();
  registerCanvasRoutes(app, { canvasService: createCanvasDomainService(storage as never) });

  const workflow = await request(app, `/api/threads/${threadId}/canvas/workflow`, { method: "PUT", body: { stage: "research" } });
  const nodeWorkflow = await request(app, `/api/threads/${threadId}/canvas/nodes/node_1/workflow`, {
    method: "PATCH",
    body: { stage: "research" }
  });

  assert.equal(workflow.status, 200);
  assert.equal((workflow.body.workflow as { stage: string }).stage, "research");
  assert.equal(nodeWorkflow.status, 200);
  assert.deepEqual(((nodeWorkflow.body.node as { metadata: { workflow: unknown } }).metadata.workflow), { stage: "research" });
});

test("canvas workflow suggestion routes create, accept, ignore, and convert suggestions", async () => {
  const threadId = "thread_route_canvas_workflow";
  const app = express();
  app.use(express.json());
  const storage = fakeCanvasStorage();
  registerCanvasRoutes(app, { canvasService: createCanvasDomainService(storage as never) });

  const created = await request(app, `/api/threads/${threadId}/canvas/suggestions`, {
    method: "POST",
    body: { roleNodeId: "role_1", targetNodeId: "node_1", roleId: "style", content: "Tighten the ending." }
  });
  const accepted = await request(app, `/api/threads/${threadId}/canvas/suggestions/suggestion_1/accept`, { method: "POST" });
  const ignored = await request(app, `/api/threads/${threadId}/canvas/suggestions/suggestion_1/ignore`, { method: "POST" });
  const converted = await request(app, `/api/threads/${threadId}/canvas/suggestions/suggestion_1/convert-to-node`, {
    method: "POST",
    body: { kind: "note" }
  });

  assert.equal(created.status, 200);
  assert.equal((created.body.suggestion as { content: string }).content, "Tighten the ending.");
  assert.equal(accepted.status, 200);
  assert.equal((accepted.body.suggestion as { status: string }).status, "accepted");
  assert.equal(ignored.status, 200);
  assert.equal((ignored.body.suggestion as { status: string }).status, "ignored");
  assert.equal(converted.status, 200);
  assert.equal((converted.body.node as { kind: string }).kind, "note");
});

function fakeCanvasStorage() {
  const node = {
    id: "node_1",
    threadId: "thread_route_canvas_workflow",
    kind: "document",
    title: "Draft",
    content: "Text",
    x: 0,
    y: 0,
    width: 320,
    height: 220,
    metadata: { workflow: { stage: "inspiration", roles: [] } },
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z"
  };
  const roleNode = {
    id: "role_1",
    threadId: "thread_route_canvas_workflow",
    kind: "role",
    title: "Style",
    content: "",
    x: -240,
    y: 0,
    width: 260,
    height: 180,
    metadata: { workflowRole: { roleId: "style", label: "Style", prompt: "Tighten prose." } },
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z"
  };
  const workflow = {
    threadId: "thread_route_canvas_workflow",
    stage: "inspiration",
    stages: ["inspiration", "research", "structure", "writing", "polish", "publish"],
    roles: [{ id: "evidence", label: "Evidence", prompt: "Check sources." }],
    updatedAt: ""
  };
  return {
    getThread: () => ({ id: "thread_route_canvas_workflow", projectId: "project_route_canvas_workflow" }),
    getProject: () => ({ id: "project_route_canvas_workflow" }),
    migrateCanvasWorkflowRoleNodes: () => ({ createdRoleNodes: 0, createdEdges: 0, updatedNodes: 0 }),
    listCanvasNodes: () => [node, roleNode],
    listCanvasEdges: () => [{ id: "edge_1", threadId: "thread_route_canvas_workflow", sourceNodeId: "role_1", targetNodeId: "node_1", label: "", createdAt: "2026-05-28T00:00:00.000Z", updatedAt: "2026-05-28T00:00:00.000Z" }],
    listCanvasWriteRequests: () => [],
    getCanvasWorkflow: () => workflow,
    listCanvasWorkflowSuggestions: () => [{
      id: "suggestion_1",
      threadId: "thread_route_canvas_workflow",
      nodeId: "role_1",
      roleNodeId: "role_1",
      targetNodeId: "node_1",
      roleId: "style",
      content: "Tighten the opener.",
      rationale: "",
      status: "pending",
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z"
    }],
    createCanvasWorkflowSuggestion: (_threadId: string, input: { roleNodeId: string; targetNodeId: string; roleId: string; content: string }) => ({
      id: "suggestion_created",
      threadId: "thread_route_canvas_workflow",
      nodeId: input.roleNodeId,
      roleNodeId: input.roleNodeId,
      targetNodeId: input.targetNodeId,
      roleId: input.roleId,
      content: input.content,
      rationale: "",
      status: "pending",
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z"
    }),
    acceptCanvasWorkflowSuggestion: () => ({
      id: "suggestion_1",
      threadId: "thread_route_canvas_workflow",
      nodeId: "role_1",
      roleNodeId: "role_1",
      targetNodeId: "node_1",
      roleId: "style",
      content: "Tighten the opener.",
      rationale: "",
      status: "accepted",
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z"
    }),
    ignoreCanvasWorkflowSuggestion: () => ({
      id: "suggestion_1",
      threadId: "thread_route_canvas_workflow",
      nodeId: "role_1",
      roleNodeId: "role_1",
      targetNodeId: "node_1",
      roleId: "style",
      content: "Tighten the opener.",
      rationale: "",
      status: "ignored",
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z"
    }),
    convertCanvasWorkflowSuggestionToNode: () => ({
      suggestion: {
        id: "suggestion_1",
        threadId: "thread_route_canvas_workflow",
        nodeId: "role_1",
        roleNodeId: "role_1",
        targetNodeId: "node_1",
        roleId: "style",
        content: "Tighten the opener.",
        rationale: "",
        status: "accepted",
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z"
      },
      node: { ...node, id: "node_from_suggestion", kind: "note" }
    }),
    updateCanvasWorkflow: (_threadId: string, input: { stage: string }) => ({ ...workflow, stage: input.stage }),
    updateCanvasNodeWorkflow: (_threadId: string, _nodeId: string, input: { stage: string }) => ({
      ...node,
      metadata: { workflow: { stage: input.stage } }
    })
  };
}
