import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceMarkdownText } from "../../src/features/workspace/components/canvas/renderers/SourceMarkdownText.js";
import { MarkdownText } from "../../src/shared/MarkdownText.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("renders source-aware markdown spans for selectable document text", () => {
  const html = renderToStaticMarkup(<SourceMarkdownText text={"Hello **bold** and *italic*"} />);
  assert.match(html, /data-source-start="0"/);
  assert.match(html, /<strong>.*bold.*<\/strong>/);
  assert.match(html, /<em>.*italic.*<\/em>/);
});

test("shared markdown renderer supports italic text", () => {
  const html = renderToStaticMarkup(<MarkdownText text={"One *emphasis* word"} />);
  assert.match(html, /<em>emphasis<\/em>/);
});
