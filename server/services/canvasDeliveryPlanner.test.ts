import test from "node:test";
import assert from "node:assert/strict";
import type { CanvasEdge, CanvasEdgeInput, CanvasNode, CanvasNodeInput, CanvasNodePatch } from "../storageTypes.js";
import { canvasRectsOverlap } from "./canvasNodePlacement.js";
import { commitCanvasDelivery, isDirectCanvasDeliveryIntent, planCanvasDelivery } from "./canvasDeliveryPlanner.js";

test("canvas delivery planner creates one body node per top-level Markdown heading", () => {
  const delivery = planCanvasDelivery({
    deliveryId: "run_1",
    projectId: "project_1",
    instruction: "summarize this to canvas",
    locale: "en",
    content: {
      assistantText: "Done.",
      outlineMarkdown: "# Recent news summary\n- International\n- Technology\n- Culture",
      bodyMarkdown: "# International\nContent A\n\n# Technology\nContent B\n\n# Culture\nContent C",
      sources: [{ title: "News A", url: "https://news.example/a" }],
      usedStructuredBlock: true
    }
  });

  assert.equal(delivery.required, true);
  assert.deepEqual(delivery.nodes.map((node) => node.id), ["node_run_1_1", "node_run_1_2", "node_run_1_3", "node_run_1_4", "node_run_1_5"]);
  assert.deepEqual(delivery.nodes.map((node) => node.title), ["Recent news summary", "International", "Technology", "Culture", "Sources"]);
  assert.deepEqual(delivery.nodes.map((node) => node.kind), ["document", "document", "document", "document", "reference"]);
  assert.deepEqual(delivery.nodes.map((node) => node.width), [520, 640, 640, 640, 520]);
  assert.deepEqual(delivery.nodes.map((node) => node.height), [260, 520, 520, 520, 320]);
  assert.deepEqual(delivery.nodes.map((node) => node.metadata?.phase), ["outline", "body", "body", "body", "sources"]);
  assert.equal(delivery.nodes[1]?.metadata?.pageCount, 3);
  assert.equal(delivery.edges.length, 4);
  assert.equal(delivery.edges[0]?.sourceNodeId, "node_run_1_1");
  assert.equal(delivery.edges[0]?.targetNodeId, "node_run_1_2");
  assert.match(delivery.nodes[4]?.content ?? "", /\[News A\]\(https:\/\/news\.example\/a\)/);
});

test("canvas delivery commits a later batch without overlapping the earlier batch", () => {
  const storage = createCanvasDeliveryStorage();
  const first = deliveryPlan("round_one");
  const second = deliveryPlan("round_two");

  commitCanvasDelivery(storage, "project_1", first);
  const firstNodes = storage.listCanvasNodes("project_1").map((node) => ({ ...node }));
  commitCanvasDelivery(storage, "project_1", second);
  const secondNodes = storage.listCanvasNodes("project_1").filter((node) => node.id.startsWith("node_round_two_"));

  assert.deepEqual(firstNodes.map(({ x, y }) => ({ x, y })), first.nodes.map(({ x, y }) => ({ x, y })));
  assert.equal(secondNodes.length, second.nodes.length);
  assert.equal(secondNodes.some((node) => firstNodes.some((existing) => canvasRectsOverlap(node, existing))), false);

  const offset = {
    x: secondNodes[0]!.x - second.nodes[0]!.x,
    y: secondNodes[0]!.y - second.nodes[0]!.y
  };
  assert.deepEqual(
    secondNodes.map((node, index) => ({ x: node.x - second.nodes[index]!.x, y: node.y - second.nodes[index]!.y })),
    secondNodes.map(() => offset)
  );
});

test("canvas delivery keeps a progressive batch in place when its final nodes are committed", () => {
  const storage = createCanvasDeliveryStorage();
  const fullDelivery = deliveryPlan("progressive_round");
  const progressiveDelivery = {
    ...fullDelivery,
    nodes: fullDelivery.nodes.slice(0, 2).map((node) => ({ ...node, content: "Loading..." })),
    edges: fullDelivery.edges.slice(0, 1)
  };
  const manualNode = storage.createCanvasNode("project_1", {
    id: "manual_node",
    kind: "note",
    title: "Manual note",
    content: "",
    x: 560,
    y: 120,
    width: 640,
    height: 520
  });

  commitCanvasDelivery(storage, "project_1", progressiveDelivery);
  const placeholderPositions = storage.listCanvasNodes("project_1")
    .filter((node) => node.id.startsWith("node_progressive_round_"))
    .map((node) => ({ id: node.id, x: node.x, y: node.y, width: node.width, height: node.height }));
  assert.equal(placeholderPositions.some((node) => canvasRectsOverlap(node, manualNode)), false);

  commitCanvasDelivery(storage, "project_1", fullDelivery);
  const finalNodes = storage.listCanvasNodes("project_1").filter((node) => node.id.startsWith("node_progressive_round_"));
  assert.deepEqual(
    finalNodes.slice(0, 2).map((node) => ({ id: node.id, x: node.x, y: node.y, width: node.width, height: node.height })),
    placeholderPositions
  );
  assert.equal(finalNodes.some((node) => canvasRectsOverlap(node, manualNode)), false);

  commitCanvasDelivery(storage, "project_1", fullDelivery);
  assert.equal(storage.listCanvasNodes("project_1").filter((node) => node.id.startsWith("node_progressive_round_")).length, fullDelivery.nodes.length);
  assert.equal(storage.listCanvasEdges("project_1").length, fullDelivery.edges.length);
});

test("canvas delivery places a diagram batch away from existing document batches", () => {
  const storage = createCanvasDeliveryStorage();
  const documents = deliveryPlan("document_round");
  const diagram = diagramDeliveryPlan("diagram_round");

  commitCanvasDelivery(storage, "project_1", documents);
  const documentNodes = storage.listCanvasNodes("project_1").map((node) => ({ ...node }));
  commitCanvasDelivery(storage, "project_1", diagram);
  const diagramNodes = storage.listCanvasNodes("project_1").filter((node) => node.id.startsWith("node_diagram_round_"));

  assert.equal(diagramNodes.some((node) => documentNodes.some((existing) => canvasRectsOverlap(node, existing))), false);
  assert.deepEqual(
    diagramNodes.map((node, index) => ({ x: node.x - diagram.nodes[index]!.x, y: node.y - diagram.nodes[index]!.y })),
    diagramNodes.map(() => ({ x: diagramNodes[0]!.x - diagram.nodes[0]!.x, y: diagramNodes[0]!.y - diagram.nodes[0]!.y }))
  );
});

test("canvas delivery planner supports English and mixed canvas delivery intent", () => {
  for (const instruction of [
    "summarize this to canvas",
    "turn this into nodes",
    "make canvas cards",
    "send this to board"
  ]) {
    const delivery = planCanvasDelivery({
      deliveryId: "run_english",
      projectId: "project_1",
      instruction,
      locale: "en",
      content: {
        assistantText: "Done.",
        outlineMarkdown: "# Summary\n- A\n- B",
        bodyMarkdown: "# A\nAlpha\n\n# B\nBeta",
        sources: [],
        usedStructuredBlock: false
      }
    });

    assert.equal(delivery.required, true, instruction);
    assert.equal(delivery.nodes.length, 3, instruction);
    assert.deepEqual(delivery.nodes.map((node) => node.title), ["Summary", "A", "B"]);
  }
});

test("canvas delivery planner supports Chinese overview body references node intent", () => {
  const delivery = planCanvasDelivery({
    deliveryId: "run_chinese_nodes",
    projectId: "project_1",
    instruction: "\u8bf7\u6574\u7406\u5230\u753b\u5e03\uff0c\u521b\u5efa\u6982\u8ff0\u3001\u6b63\u6587\u3001\u53c2\u8003\u94fe\u63a5\u8282\u70b9",
    locale: "zh",
    content: {
      assistantText: "\u5df2\u5b8c\u6210\u3002",
      outlineMarkdown: "# \u6982\u8ff0\n- A\n- B",
      bodyMarkdown: "# A\nAlpha\n\n# B\nBeta",
      sources: [{ title: "Source", url: "https://example.com/source" }],
      usedStructuredBlock: false
    }
  });

  assert.equal(delivery.required, true);
  assert.deepEqual(delivery.nodes.map((node) => node.title), ["\u6982\u8ff0", "A", "B", "\u6765\u6e90"]);
});

test("direct document delivery keeps each Markdown section as one node without paginating long sections", () => {
  const longSection = `# Research\n${"Long paragraph. ".repeat(140).trim()}`;
  const delivery = planCanvasDelivery({
    deliveryId: "long_section",
    projectId: "project_1",
    instruction: "summarize this to canvas",
    locale: "en",
    content: {
      assistantText: "Done.",
      outlineMarkdown: "# Summary\n- Research",
      bodyMarkdown: longSection,
      sources: [],
      usedStructuredBlock: true
    }
  });

  assert.equal(delivery.required, true);
  assert.equal(delivery.nodes.length, 2);
  assert.equal(delivery.nodes[1]?.title, "Research");
  assert.equal(delivery.nodes[1]?.content, longSection);
  assert.ok((delivery.nodes[1]?.content.length ?? 0) > 1200);
  assert.equal(delivery.nodes[1]?.metadata?.pageCount, 1);
});

test("direct document delivery keeps nested Markdown headings inside the same body node", () => {
  const body = "# Market Overview\nIntro\n\n## Pricing\nDetails\n\n### Risks\nMore detail\n\n# Recommendation\nBuy now";
  const delivery = planCanvasDelivery({
    deliveryId: "top_level_only",
    projectId: "project_1",
    instruction: "summarize this to canvas",
    locale: "en",
    content: {
      assistantText: "Done.",
      outlineMarkdown: "# Summary\n- Market Overview\n- Recommendation",
      bodyMarkdown: body,
      sources: [],
      usedStructuredBlock: true
    }
  });

  assert.equal(delivery.required, true);
  assert.equal(delivery.nodes.length, 3);
  assert.deepEqual(delivery.nodes.map((node) => node.title), ["Summary", "Market Overview", "Recommendation"]);
  assert.match(delivery.nodes[1]?.content ?? "", /## Pricing/);
  assert.match(delivery.nodes[1]?.content ?? "", /### Risks/);
  assert.equal(delivery.nodes[1]?.metadata?.pageCount, 2);
});

test("direct document delivery without top-level headings keeps nested sections in one body node", () => {
  const body = "## A\nAlpha\n\n## B\nBeta";
  const delivery = planCanvasDelivery({
    deliveryId: "nested_only",
    projectId: "project_1",
    instruction: "make canvas cards",
    locale: "en",
    content: {
      assistantText: "Done.",
      outlineMarkdown: "# Summary\n- A\n- B",
      bodyMarkdown: body,
      sources: [],
      usedStructuredBlock: true
    }
  });

  assert.equal(delivery.required, true);
  assert.equal(delivery.nodes.length, 2);
  assert.equal(delivery.nodes[1]?.title, "A");
  assert.equal(delivery.nodes[1]?.content, body);
  assert.equal(delivery.nodes[1]?.metadata?.pageCount, 1);
});

test("direct document delivery without headings keeps the whole body as one node", () => {
  const body = "Plain delivery paragraph. ".repeat(80).trim();
  const delivery = planCanvasDelivery({
    deliveryId: "plain_body",
    projectId: "project_1",
    instruction: "make canvas cards",
    locale: "en",
    content: {
      assistantText: "Done.",
      outlineMarkdown: "",
      bodyMarkdown: body,
      sources: [],
      usedStructuredBlock: true
    }
  });

  assert.equal(delivery.required, true);
  assert.equal(delivery.nodes.length, 1);
  assert.equal(delivery.nodes[0]?.title, "Body");
  assert.equal(delivery.nodes[0]?.content, body);
  assert.ok((delivery.nodes[0]?.content.length ?? 0) > 1200);
});

test("direct canvas delivery intent is broad but does not match ordinary summary chat", () => {
  assert.equal(isDirectCanvasDeliveryIntent("create nodes for this"), true);
  assert.equal(isDirectCanvasDeliveryIntent("send this to board"), true);
  assert.equal(isDirectCanvasDeliveryIntent("make a user flow diagram"), true);
  assert.equal(isDirectCanvasDeliveryIntent("summarize recent news"), false);
});

test("canvas delivery planner ignores ordinary chat without explicit canvas intent", () => {
  const delivery = planCanvasDelivery({
    deliveryId: "run_2",
    projectId: "project_1",
    instruction: "summarize recent news",
    locale: "en",
    content: {
      assistantText: "Regular reply.",
      outlineMarkdown: "# Summary\nRegular reply.",
      bodyMarkdown: "Regular reply.",
      sources: [],
      usedStructuredBlock: false
    }
  });

  assert.equal(delivery.required, false);
  assert.equal(delivery.nodes.length, 0);
});

test("canvas delivery planner creates editable diagram nodes for diagram delivery", () => {
  const delivery = planCanvasDelivery({
    deliveryId: "diagram_1",
    projectId: "project_1",
    instruction: "make a user flow diagram",
    locale: "en",
    content: {
      assistantText: "Done.",
      outlineMarkdown: "",
      bodyMarkdown: "",
      sources: [],
      usedStructuredBlock: true,
      diagram: {
        assistantText: "Done.",
        kind: "userflow",
        title: "Registration flow",
        layout: "left-right",
        nodes: [
          { id: "start", label: "Start", shape: "rounded", tone: "primary" },
          { id: "choice", label: "Logged in?", shape: "diamond", tone: "warning", parentId: "start" },
          { id: "success", label: "Home", shape: "parallelogram", tone: "success" }
        ],
        edges: [
          { from: "choice", to: "success", label: "Yes", kind: "yes" }
        ],
        sources: []
      }
    }
  });

  assert.equal(delivery.required, true);
  assert.equal(delivery.moduleId, "diagram_delivery");
  assert.deepEqual(delivery.nodes.map((node) => node.id), ["node_diagram_1_1", "node_diagram_1_2", "node_diagram_1_3"]);
  assert.deepEqual(delivery.nodes.map((node) => node.kind), ["document", "document", "document"]);
  assert.equal((delivery.nodes[1]?.metadata?.diagram as { shape?: string } | undefined)?.shape, "diamond");
  assert.equal((delivery.nodes[1]?.metadata?.diagram as { diagramKind?: string } | undefined)?.diagramKind, "userflow");
  assert.deepEqual(delivery.edges.map((edge) => edge.label), ["contains", "Yes"]);
});

test("canvas delivery planner rejects invalid diagram blocks instead of creating document nodes", () => {
  const delivery = planCanvasDelivery({
    deliveryId: "diagram_invalid",
    projectId: "project_1",
    instruction: "make a mind map",
    locale: "en",
    content: {
      assistantText: "Unable to create diagram.",
      outlineMarkdown: "# Should not write",
      bodyMarkdown: "Should not write",
      sources: [],
      usedStructuredBlock: false,
      invalidDiagramBlock: true
    }
  });

  assert.equal(delivery.required, false);
  assert.equal(delivery.nodes.length, 0);
});

test("canvas delivery planner does not fall back to document batch in mind map mode", () => {
  const delivery = planCanvasDelivery({
    deliveryId: "diagram_mode_missing_block",
    projectId: "project_1",
    instruction: "organize this into Canvas",
    locale: "en",
    workflowMode: "mind_map",
    content: {
      assistantText: "Done.",
      outlineMarkdown: "# Summary",
      bodyMarkdown: "Regular body.",
      sources: [],
      usedStructuredBlock: false
    }
  });

  assert.equal(delivery.required, false);
  assert.equal(delivery.nodes.length, 0);
});

type TestCanvasStorage = {
  listCanvasNodes: (projectId: string) => CanvasNode[];
  listCanvasEdges: (projectId: string) => CanvasEdge[];
  createCanvasNode: (projectId: string, input: CanvasNodeInput) => CanvasNode;
  updateCanvasNode: (projectId: string, nodeId: string, patch: CanvasNodePatch) => CanvasNode;
  createCanvasEdge: (projectId: string, input: CanvasEdgeInput) => CanvasEdge;
};

function deliveryPlan(deliveryId: string) {
  return planCanvasDelivery({
    deliveryId,
    projectId: "project_1",
    instruction: "summarize this to canvas",
    locale: "en",
    content: {
      assistantText: "Done.",
      outlineMarkdown: "# Summary\n- A\n- B",
      bodyMarkdown: "# A\nAlpha\n\n# B\nBeta",
      sources: [],
      usedStructuredBlock: true
    }
  });
}

function diagramDeliveryPlan(deliveryId: string) {
  return planCanvasDelivery({
    deliveryId,
    projectId: "project_1",
    instruction: "make a user flow diagram",
    locale: "en",
    content: {
      assistantText: "Done.",
      outlineMarkdown: "",
      bodyMarkdown: "",
      sources: [],
      usedStructuredBlock: true,
      diagram: {
        assistantText: "Done.",
        kind: "userflow",
        title: "Flow",
        layout: "left-right",
        nodes: [
          { id: "start", label: "Start", shape: "rounded", tone: "primary" },
          { id: "decision", label: "Ready?", shape: "diamond", tone: "warning" },
          { id: "finish", label: "Finish", shape: "rounded", tone: "success" }
        ],
        edges: [
          { from: "start", to: "decision", kind: "next" },
          { from: "decision", to: "finish", kind: "yes" }
        ],
        sources: []
      }
    }
  });
}

function createCanvasDeliveryStorage(): TestCanvasStorage {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  return {
    listCanvasNodes: () => nodes,
    listCanvasEdges: () => edges,
    createCanvasNode: (projectId, input) => {
      const node: CanvasNode = {
        id: input.id ?? `node_${nodes.length + 1}`,
        projectId,
        kind: input.kind,
        title: input.title ?? "",
        content: input.content ?? "",
        x: input.x ?? 120,
        y: input.y ?? 120,
        width: input.width ?? 320,
        height: input.height ?? 220,
        metadata: input.metadata ?? {},
        includeInProjectContext: input.includeInProjectContext === true,
        createdAt: "",
        updatedAt: ""
      };
      nodes.push(node);
      return node;
    },
    updateCanvasNode: (_projectId, nodeId, patch) => {
      const node = nodes.find((item) => item.id === nodeId)!;
      Object.assign(node, patch);
      return node;
    },
    createCanvasEdge: (_projectId, input) => {
      const edge: CanvasEdge = {
        id: input.id ?? `edge_${edges.length + 1}`,
        projectId: _projectId,
        sourceNodeId: input.sourceNodeId,
        targetNodeId: input.targetNodeId,
        label: input.label ?? "",
        createdAt: "",
        updatedAt: ""
      };
      edges.push(edge);
      return edge;
    }
  };
}
