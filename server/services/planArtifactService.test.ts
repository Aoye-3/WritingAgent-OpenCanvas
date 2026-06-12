import test from "node:test";
import assert from "node:assert/strict";
import { commitPlanArtifact, commitPlanArtifactLinks, validatePublicImageUrl } from "./planArtifactService.js";
import type { PlanArtifact } from "../storageTypes.js";

test("commits a text artifact once using its stable canvas target", async () => {
  let creates = 0;
  const artifact = { id: "summary", type: "text", status: "staged", title: "Summary", payload: { content: "Useful result", nodeKind: "document" } } as unknown as PlanArtifact;
  const storage = {
    getPlanRun: () => ({ approval: "approved", artifacts: [artifact] }),
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
