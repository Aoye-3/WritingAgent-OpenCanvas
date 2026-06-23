import test from "node:test";
import assert from "node:assert/strict";
import { resolveCanvasDeliveryContent } from "./canvasDeliveryContent.js";

test("canvas delivery content separates assistant reply from structured Canvas body", () => {
  const result = resolveCanvasDeliveryContent({
    instruction: "帮我查最近新闻，然后总结到画板里",
    locale: "zh",
    text: [
      "已整理到画板。",
      "",
      "```facetwrite_canvas_delivery",
      JSON.stringify({
        assistant_reply: "已整理到画板。",
        outline_markdown: "# 近期新闻摘要\n- 科技领域\n- 财经市场",
        body_markdown: "## 科技领域\nDeepSeek 和 AI 投资继续升温。",
        sources: [{ title: "News A", url: "https://news.example/a" }]
      }),
      "```"
    ].join("\n"),
    events: []
  });

  assert.equal(result.usedStructuredBlock, true);
  assert.equal(result.bodyMarkdown.includes("已整理到画板"), false);
  assert.match(result.outlineMarkdown, /近期新闻摘要/);
  assert.match(result.bodyMarkdown, /DeepSeek/);
  assert.deepEqual(result.sources, [{ title: "News A", url: "https://news.example/a" }]);
  assert.match(result.assistantText, /已整理到画板/);
  assert.match(result.assistantText, /\[News A\]\(https:\/\/news\.example\/a\)/);
});

test("canvas delivery content fallback removes completion chatter from Canvas body", () => {
  const result = resolveCanvasDeliveryContent({
    instruction: "帮我查最近新闻，然后总结到画板里",
    locale: "zh",
    text: [
      "新闻搜索和总结已经完成！",
      "我已经通过网络搜索获取了最新新闻，并将详细总结更新到了画板。",
      "",
      "画板内容现在包含：",
      "1. **科技领域** - AI 投资与模型竞争继续升温。",
      "2. **财经市场** - 股市与跨境基金出现波动。",
      "",
      "## 来源",
      "- [News A](https://news.example/a)",
      "- [News A duplicate](https://news.example/a)"
    ].join("\n"),
    events: [{
      eventType: "agent_backend_tool_completed",
      payload: {
        toolName: "web_search",
        sources: [{ title: "News B", url: "https://news.example/b" }]
      }
    }]
  });

  assert.equal(result.usedStructuredBlock, false);
  assert.equal(result.bodyMarkdown.includes("新闻搜索和总结已经完成"), false);
  assert.equal(result.bodyMarkdown.includes("我已经通过网络搜索"), false);
  assert.match(result.bodyMarkdown, /科技领域/);
  assert.match(result.outlineMarkdown, /科技领域/);
  assert.deepEqual(result.sources.map((source) => source.url), [
    "https://news.example/b",
    "https://news.example/a"
  ]);
});

test("canvas delivery content prioritizes canvas_write reference sources over search results", () => {
  const searchSources = Array.from({ length: 12 }, (_, index) => ({
    title: `Search result ${index + 1}`,
    url: `https://search.example/${index + 1}`
  }));
  const paperSources = Array.from({ length: 12 }, (_, index) => {
    const paperId = `2503.${String(21460 + index).padStart(5, "0")}`;
    return {
      title: paperId,
      url: `https://arxiv.org/abs/${paperId}`
    };
  });

  const result = resolveCanvasDeliveryContent({
    instruction: "Review recent agent literature",
    locale: "en",
    text: "# Final literature review\n\nThe references are complete.",
    events: [
      {
        eventType: "agent_backend_tool_completed",
        payload: { toolName: "web_search", sources: searchSources }
      },
      {
        eventType: "agent_backend_canvas_mutation_committed",
        payload: { tool: "canvas_write", eventType: "canvas_mutation_committed", sources: paperSources }
      }
    ]
  });

  assert.equal(result.sources.length, 24);
  assert.deepEqual(result.sources.slice(0, 12).map((source) => source.url), paperSources.map((source) => source.url));
  assert.deepEqual(result.sources.slice(12).map((source) => source.url), searchSources.map((source) => source.url));
});

test("canvas delivery content parses structured diagram blocks", () => {
  const result = resolveCanvasDeliveryContent({
    instruction: "做成用户流程图",
    locale: "zh",
    text: [
      "已整理为流程图。",
      "",
      "```facetwrite_diagram_delivery",
      JSON.stringify({
        facetwrite_diagram_delivery: {
          assistant_reply: "已整理为流程图。",
          kind: "userflow",
          title: "注册流程",
          layout: "left-right",
          nodes: [
            { id: "start", label: "开始", shape: "rounded", tone: "primary" },
            { id: "decision", label: "是否注册", shape: "diamond", tone: "warning", parentId: "start" }
          ],
          edges: [{ from: "start", to: "decision", label: "next", kind: "next" }],
          sources: [{ title: "Spec", url: "https://example.com/spec" }]
        }
      }),
      "```"
    ].join("\n"),
    events: []
  });

  assert.equal(result.usedStructuredBlock, true);
  assert.equal(result.diagram?.kind, "userflow");
  assert.equal(result.diagram?.nodes.length, 2);
  assert.equal(result.diagram?.nodes[1]?.shape, "diamond");
  assert.equal(result.diagram?.edges[0]?.label, "next");
  assert.equal(result.assistantText.includes("facetwrite_diagram_delivery"), false);
});

test("canvas delivery content marks invalid diagram blocks without falling back to document content", () => {
  const result = resolveCanvasDeliveryContent({
    instruction: "做成思维导图",
    locale: "zh",
    text: "```facetwrite_diagram_delivery\n{\"nodes\":[]}\n```",
    events: []
  });

  assert.equal(result.invalidDiagramBlock, true);
  assert.equal(result.diagram, undefined);
  assert.equal(result.bodyMarkdown, "");
});
