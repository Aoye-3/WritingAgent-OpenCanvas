import assert from "node:assert/strict";
import test from "node:test";
import { applyMarkdownFormat, isSingleParagraphRange, replaceTextRange } from "../shared/canvasRangeEdit.js";

test("validates and replaces a single paragraph source range", () => {
  const content = "第一段内容\n\n第二段需要润色";
  const start = content.indexOf("需要");
  const end = start + "需要润色".length;

  assert.equal(isSingleParagraphRange(content, start, end), true);
  assert.equal(replaceTextRange(content, start, end, "已经润色"), "第一段内容\n\n第二段已经润色");
  assert.equal(isSingleParagraphRange(content, 2, content.length), false);
});

test("wraps selected markdown source with supported formatting", () => {
  assert.equal(applyMarkdownFormat("hello world", 6, 11, "bold"), "hello **world**");
  assert.equal(applyMarkdownFormat("hello **world**", 8, 13, "bold"), "hello world");
  assert.equal(applyMarkdownFormat("hello world", 6, 11, "italic"), "hello *world*");
  assert.equal(applyMarkdownFormat("hello world", 6, 11, "link", "https://example.com"), "hello [world](https://example.com)");
  assert.throws(() => applyMarkdownFormat("hello", 0, 5, "link", "javascript:alert(1)"), /HTTP/);
});
