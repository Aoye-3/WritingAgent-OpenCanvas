import test from "node:test";
import assert from "node:assert/strict";
import { commitPlanArtifact, commitPlanArtifactLinks, validatePublicImageUrl } from "./planArtifactService.js";
import type { PlanArtifact } from "../storageTypes.js";

test("commits a text artifact once using its stable canvas target", async () => {
  let creates = 0;
  const artifact = { id: "summary", type: "text", status: "staged", title: "Summary", payload: { content: "Useful result", nodeKind: "document" } } as unknown as PlanArtifact;
  const storage = {
    getPlanRun: () => ({ approval: "approved", artifacts: [artifact] }),
    listCanvasNodes: () => [],
    listCanvasEdges: () => [],
    createCanvasNode: () => (creates++, { id: "node_1" }),
    markPlanArtifactCommitted: () => ({ ...artifact, status: "committed", canvasTargetId: "node_1" })
  };
  const first = await commitPlanArtifact(storage as never, "thread_1", "plan_1", "summary");
  const secondStorage = { ...storage, getPlanRun: () => ({ approval: "approved", artifacts: [first] }) };
  const second = await commitPlanArtifact(secondStorage as never, "thread_1", "plan_1", "summary");
  assert.equal(first.canvasTargetId, "node_1");
  assert.equal(second.canvasTargetId, "node_1");
  assert.equal(creates, 1);
});

test("rejects local and private image URLs", async () => {
  await assert.rejects(() => validatePublicImageUrl("http://127.0.0.1/image.png"), /public/);
  await assert.rejects(() => validatePublicImageUrl("file:///tmp/image.png"), /http/);
});

test("commits artifact links once after both text nodes exist", () => {
  let creates = 0;
  const plan = {
    approval: "approved",
    artifacts: [
      { id: "source", status: "committed", canvasTargetId: "node_source" },
      { id: "summary", status: "committed", canvasTargetId: "node_summary" }
    ],
    links: [{ id: "link_1", fromArtifactId: "source", toArtifactId: "summary", label: "supports" }]
  };
  const storage = {
    getPlanRun: () => plan,
    listCanvasNodes: () => [{ id: "node_source" }, { id: "node_summary" }],
    createCanvasEdge: () => (creates++, { id: "edge_1" }),
    markPlanArtifactLinkCommitted: () => ({ ...plan.links[0], canvasEdgeId: "edge_1" })
  };
  const first = commitPlanArtifactLinks(storage as never, "thread_1", "plan_1");
  plan.links[0] = first[0];
  const second = commitPlanArtifactLinks(storage as never, "thread_1", "plan_1");
  assert.equal(first[0].canvasEdgeId, "edge_1");
  assert.equal(second[0].canvasEdgeId, "edge_1");
  assert.equal(creates, 1);
});

test("splits a long structured text artifact into stable linked Canvas nodes", async () => {
  const createdNodes: Array<Record<string, unknown>> = [];
  const createdEdges: Array<Record<string, unknown>> = [];
  const artifact = {
    id: "report", type: "text", status: "staged", title: "Report",
    payload: { content: `# First\n${"甲".repeat(1300)}\n\n# Second\n${"乙".repeat(1300)}`, nodeKind: "document" }
  } as unknown as PlanArtifact;
  const storage = {
    getPlanRun: () => ({ approval: "approved", artifacts: [artifact] }),
    listCanvasNodes: () => createdNodes,
    listCanvasEdges: () => createdEdges,
    createCanvasNode: (_projectId: string, input: Record<string, unknown>) => {
      const node = { ...input, id: input.id };
      createdNodes.push(node);
      return node;
    },
    createCanvasEdge: (_projectId: string, input: Record<string, unknown>) => {
      const edge = { ...input, id: input.id };
      createdEdges.push(edge);
      return edge;
    },
    markPlanArtifactCommitted: () => ({ ...artifact, status: "committed", canvasTargetId: createdNodes[0].id })
  };
  await commitPlanArtifact(storage as never, "thread_1", "plan_1", "report");
  assert.equal(createdNodes.length, 4);
  assert.equal(createdEdges.length, 3);
  assert.equal(createdNodes[0].id, "node_plan_1_report_1");
  assert.equal(createdEdges[0].id, "edge_plan_1_report_1");
});
