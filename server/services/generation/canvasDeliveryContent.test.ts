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
