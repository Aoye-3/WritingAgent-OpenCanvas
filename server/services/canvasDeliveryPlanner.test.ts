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
