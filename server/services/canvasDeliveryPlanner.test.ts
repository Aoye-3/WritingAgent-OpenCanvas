import test from "node:test";
import assert from "node:assert/strict";
import { isDirectCanvasDeliveryIntent, planCanvasDelivery } from "./canvasDeliveryPlanner.js";

test("canvas delivery planner creates stable two-phase delivery for explicit Chinese canvas requests", () => {
  const delivery = planCanvasDelivery({
    deliveryId: "run_1",
    projectId: "project_1",
    instruction: "帮我查最近新闻，然后总结到画板里",
    locale: "zh",
    content: {
      assistantText: "已整理到画板。",
      outlineMarkdown: "# 近期新闻摘要\n- 国际新闻\n- 科技财经\n- 文化社会",
      bodyMarkdown: "## 国际新闻\n内容 A\n\n## 科技财经\n内容 B\n\n## 文化社会\n内容 C",
      sources: [{ title: "News A", url: "https://news.example/a" }],
      usedStructuredBlock: true
    }
  });

  assert.equal(delivery.required, true);
  assert.deepEqual(delivery.nodes.map((node) => node.id), ["node_run_1_1", "node_run_1_2", "node_run_1_3"]);
  assert.deepEqual(delivery.nodes.map((node) => node.title), ["近期新闻摘要", "正文", "来源"]);
  assert.deepEqual(delivery.nodes.map((node) => node.kind), ["document", "document", "reference"]);
  assert.deepEqual(delivery.nodes.map((node) => node.width), [520, 640, 520]);
  assert.deepEqual(delivery.nodes.map((node) => node.height), [260, 520, 320]);
  assert.deepEqual(delivery.nodes.map((node) => node.metadata?.phase), ["outline", "body", "sources"]);
  assert.equal(delivery.edges.length, 2);
  assert.equal(delivery.edges[0]?.sourceNodeId, "node_run_1_1");
  assert.equal(delivery.edges[0]?.targetNodeId, "node_run_1_2");
  assert.match(delivery.nodes[2]?.content ?? "", /\[News A\]\(https:\/\/news\.example\/a\)/);
});

test("canvas delivery planner supports English and mixed canvas delivery intent", () => {
  for (const instruction of [
    "summarize this to canvas",
    "turn this into nodes",
    "make canvas cards",
    "总结成 canvas nodes",
    "整理成 cards",
    "放进 Canvas"
  ]) {
    const delivery = planCanvasDelivery({
      deliveryId: "run_english",
      projectId: "project_1",
      instruction,
      locale: "en",
      content: {
        assistantText: "Done.",
        outlineMarkdown: "# Summary\n- A\n- B",
        bodyMarkdown: "## A\nAlpha\n\n## B\nBeta",
        sources: [],
        usedStructuredBlock: false
      }
    });

    assert.equal(delivery.required, true, instruction);
    assert.equal(delivery.nodes.length, 2, instruction);
    assert.deepEqual(delivery.nodes.map((node) => node.title), ["Summary", "Body"]);
  }
});

test("direct canvas delivery intent is broad but does not match ordinary summary chat", () => {
  assert.equal(isDirectCanvasDeliveryIntent("整理成节点"), true);
  assert.equal(isDirectCanvasDeliveryIntent("create nodes for this"), true);
  assert.equal(isDirectCanvasDeliveryIntent("send this to board"), true);
  assert.equal(isDirectCanvasDeliveryIntent("请生成思维导图"), true);
  assert.equal(isDirectCanvasDeliveryIntent("make a user flow diagram"), true);
  assert.equal(isDirectCanvasDeliveryIntent("总结一下最近新闻"), false);
});

test("canvas delivery planner ignores ordinary chat without explicit canvas intent", () => {
  const delivery = planCanvasDelivery({
    deliveryId: "run_2",
    projectId: "project_1",
    instruction: "总结一下最近新闻",
    locale: "zh",
    content: {
      assistantText: "普通回答",
      outlineMarkdown: "# 摘要\n普通回答",
      bodyMarkdown: "普通回答",
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
    instruction: "请输出用户流程图到画布",
    locale: "zh",
    content: {
      assistantText: "已整理为流程图。",
      outlineMarkdown: "",
      bodyMarkdown: "",
      sources: [],
      usedStructuredBlock: true,
      diagram: {
        assistantText: "已整理为流程图。",
        kind: "userflow",
        title: "注册流程",
        layout: "left-right",
        nodes: [
          { id: "start", label: "开始", shape: "rounded", tone: "primary" },
          { id: "choice", label: "是否登录", shape: "diamond", tone: "warning", parentId: "start" },
          { id: "success", label: "进入首页", shape: "parallelogram", tone: "success" }
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
    instruction: "做成思维导图",
    locale: "zh",
    content: {
      assistantText: "无法生成图。",
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
    instruction: "把相关信息整理到 Canvas 里",
    locale: "zh",
    workflowMode: "mind_map",
    content: {
      assistantText: "已整理。",
      outlineMarkdown: "# 摘要",
      bodyMarkdown: "普通正文",
      sources: [],
      usedStructuredBlock: false
    }
  });

  assert.equal(delivery.required, false);
  assert.equal(delivery.nodes.length, 0);
});
