import test from "node:test";
import assert from "node:assert/strict";
import { createProgressiveTextGate, looksUnsafeForStream } from "./progressiveTextGate.js";

test("progressive text gate suppresses Canvas delivery blocks from streamed assistant text", () => {
  const chunks: string[] = [];
  const gate = createProgressiveTextGate("zh", (chunk) => chunks.push(chunk));

  gate.push("已整理到画板。\n\n```facetwrite_canvas_delivery\n");
  gate.push(JSON.stringify({
    assistant_reply: "已整理到画板。",
    outline_markdown: "# 摘要",
    body_markdown: "正式正文"
  }));
  gate.push("\n```");
  gate.flush();

  const visible = chunks.join("");
  assert.match(visible, /已整理到画板/);
  assert.equal(visible.includes("facetwrite_canvas_delivery"), false);
  assert.equal(visible.includes("正式正文"), false);
});

test("Canvas delivery marker is treated as unsafe for ordinary streaming release", () => {
  assert.equal(looksUnsafeForStream("```facetwrite_canvas_delivery"), true);
});

test("Agent Runtime DSML tool call marker is treated as unsafe for streaming release", () => {
  assert.equal(looksUnsafeForStream('< | | DSML | | toolcalls> < / | / DSML | / invoke name="readfile">'), true);
});
