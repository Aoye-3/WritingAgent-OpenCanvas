import test from "node:test";
import assert from "node:assert/strict";
import { commitPlanArtifact, commitPlanArtifactLinks, validatePublicImageUrl } from "./planArtifactService.js";
import type { PlanArtifact } from "../storageTypes.js";

test("commits a text artifact once using its stable canvas target", async () => {
  let creates = 0;
  const artifact = { id: "summary", type: "text", status: "staged", title: "Summary", payload: { content: "Useful result", nodeKind: "document" } } as unknown as PlanArtifact;
  const storage = {
    getPlanRun: () => ({ id: "plan_1", projectId: "project_1", approval: "approved", artifacts: [artifact] }),
    listCanvasNodes: () => [],
    listCanvasEdges: () => [],
    createCanvasNode: () => (creates++, { id: "node_1" }),
    updateCanvasNode: () => undefined,
    createCanvasEdge: () => ({ id: "edge_1" }),
    markPlanArtifactCommitted: () => ({ ...artifact, status: "committed", canvasTargetId: "node_1" })
  };
  const first = await commitPlanArtifact(storage as never, "thread_1", "plan_1", "summary");
  const secondStorage = { ...storage, getPlanRun: () => ({ id: "plan_1", projectId: "project_1", approval: "approved", artifacts: [first] }) };
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
    projectId: "project_1",
    artifacts: [
      { id: "source", status: "committed", canvasTargetId: "node_source" },
      { id: "summary", status: "committed", canvasTargetId: "node_summary" }
    ],
    links: [{ id: "link_1", fromArtifactId: "source", toArtifactId: "summary", label: "supports" }]
  };
  const storage = {
    getPlanRun: () => plan,
    listCanvasNodes: () => [{ id: "node_source" }, { id: "node_summary" }],
    listCanvasEdges: () => [],
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
    getPlanRun: () => ({ id: "plan_1", projectId: "project_1", approval: "approved", artifacts: [artifact] }),
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
  assert.equal(createdEdges.length, 2);
  assert.equal(createdNodes[0].id, "node_plan_1_report_section_1_1");
  assert.equal(createdEdges[0].id, "edge_plan_1_report_section_1_1");
});

test("commits text artifact sections as semantic Canvas nodes", async () => {
  const createdNodes: Array<Record<string, unknown>> = [];
  const createdEdges: Array<Record<string, unknown>> = [];
  const artifact = {
    id: "guide", stepId: "decide", type: "text", status: "staged", title: "Buying guide",
    payload: {
      sections: [1, 2, 3, 4, 5].map((index) => ({
        id: `point_${index}`,
        title: `Decision point ${index}`,
        content: `Useful section ${index}`
      }))
    }
  } as unknown as PlanArtifact;
  const storage = {
    getPlanRun: () => ({ id: "plan_1", projectId: "project_1", approval: "approved", canvasNodeId: "node_plan", artifacts: [artifact] }),
    listCanvasNodes: () => createdNodes,
    listCanvasEdges: () => createdEdges,
    createCanvasNode: (_projectId: string, input: Record<string, unknown>) => {
      const node = { ...input, id: input.id };
      createdNodes.push(node);
      return node;
    },
    updateCanvasNode: () => undefined,
    createCanvasEdge: (_projectId: string, input: Record<string, unknown>) => {
      const edge = { ...input, id: input.id };
      createdEdges.push(edge);
      return edge;
    },
    markPlanArtifactCommitted: () => ({ ...artifact, status: "committed", canvasTargetId: createdNodes[0].id })
  };

  await commitPlanArtifact(storage as never, "thread_1", "plan_1", "guide");

  assert.equal(createdNodes.length, 5);
  assert.deepEqual(createdNodes.map((node) => node.title), ["Decision point 1", "Decision point 2", "Decision point 3", "Decision point 4", "Decision point 5"]);
  assert.equal(createdEdges.filter((edge) => edge.sourceNodeId === "node_plan").length, 5);
});

test("deduplicates repeated structured section ids during one artifact commit", async () => {
  const createdNodes: Array<Record<string, unknown>> = [];
  const createdEdges: Array<Record<string, unknown>> = [];
  const artifact = {
    id: "guide", type: "text", status: "staged", title: "Buying guide",
    payload: {
      sections: [
        { id: "same", title: "First", content: "First section" },
        { id: "same", title: "Second", content: "Second section" },
        { id: "same", title: "Third", content: "Third section" }
      ]
    }
  } as unknown as PlanArtifact;
  const storage = {
    getPlanRun: () => ({ id: "plan_1", projectId: "project_1", approval: "approved", canvasNodeId: "node_plan", artifacts: [artifact] }),
    listCanvasNodes: () => createdNodes,
    listCanvasEdges: () => createdEdges,
    createCanvasNode: (_projectId: string, input: Record<string, unknown>) => {
      assert.equal(createdNodes.some((node) => node.id === input.id), false);
      const node = { ...input, id: input.id };
      createdNodes.push(node);
      return node;
    },
    updateCanvasNode: () => undefined,
    createCanvasEdge: (_projectId: string, input: Record<string, unknown>) => {
      const edge = { ...input, id: input.id };
      createdEdges.push(edge);
      return edge;
    },
    markPlanArtifactCommitted: () => ({ ...artifact, status: "committed", canvasTargetId: createdNodes[0].id })
  };

  await commitPlanArtifact(storage as never, "thread_1", "plan_1", "guide");

  assert.deepEqual(createdNodes.map((node) => node.id), [
    "node_plan_1_guide_same_1",
    "node_plan_1_guide_same_2_1",
    "node_plan_1_guide_same_3_1"
  ]);
  assert.equal(createdEdges.filter((edge) => edge.sourceNodeId === "node_plan").length, 3);
});

test("does not mark an artifact link committed when the stable edge id points elsewhere", () => {
  const createdEdges: Array<Record<string, unknown>> = [];
  const plan = {
    approval: "approved",
    projectId: "project_1",
    artifacts: [
      { id: "source", status: "committed", canvasTargetId: "node_source" },
      { id: "summary", status: "committed", canvasTargetId: "node_summary" }
    ],
    links: [{ id: "link_1", fromArtifactId: "source", toArtifactId: "summary", label: "supports" }]
  };
  const storage = {
    getPlanRun: () => plan,
    listCanvasNodes: () => [{ id: "node_source" }, { id: "node_summary" }, { id: "node_other" }],
    listCanvasEdges: () => [{ id: "edge_plan_1_link_1_1", sourceNodeId: "node_other", targetNodeId: "node_summary", label: "supports" }],
    createCanvasEdge: (_projectId: string, input: Record<string, unknown>) => {
      const edge = { ...input, id: input.id };
      createdEdges.push(edge);
      return edge;
    },
    markPlanArtifactLinkCommitted: (_threadId: string, _planId: string, _linkId: string, edgeId: string) => ({ ...plan.links[0], canvasEdgeId: edgeId })
  };

  const [link] = commitPlanArtifactLinks(storage as never, "thread_1", "plan_1");

  assert.equal(link.canvasEdgeId, "edge_plan_1_link_1_repair_1");
  assert.deepEqual(createdEdges.map((edge) => [edge.id, edge.sourceNodeId, edge.targetNodeId]), [
    ["edge_plan_1_link_1_repair_1", "node_source", "node_summary"]
  ]);
});
