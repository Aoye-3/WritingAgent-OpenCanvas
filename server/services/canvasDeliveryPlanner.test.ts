import test from "node:test";
import assert from "node:assert/strict";
import { isDirectCanvasDeliveryIntent, planCanvasDelivery } from "./canvasDeliveryPlanner.js";

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
