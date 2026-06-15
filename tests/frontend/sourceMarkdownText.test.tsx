import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CanvasNode } from "../../src/features/agents/types.js";
import { ReferenceNodeRenderer } from "../../src/features/workspace/components/canvas/renderers/ReferenceNodeRenderer.js";
import { SourceMarkdownText } from "../../src/features/workspace/components/canvas/renderers/SourceMarkdownText.js";
import { MarkdownText } from "../../src/shared/MarkdownText.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("renders source-aware markdown spans for selectable document text", () => {
  const html = renderToStaticMarkup(<SourceMarkdownText text={"Hello **bold** and *italic*"} />);
  assert.match(html, /data-source-start="0"/);
  assert.match(html, /<strong>.*bold.*<\/strong>/);
  assert.match(html, /<em>.*italic.*<\/em>/);
});

test("renders source markdown links without exposing raw markdown syntax", () => {
  const html = renderToStaticMarkup(<SourceMarkdownText text={"# 来源\n- [Apple Compare](https://www.apple.com/mac/compare/)"} />);
  assert.match(html, /<a [^>]*class="nodrag nopan"[^>]*href="https:\/\/www\.apple\.com\/mac\/compare\/"[^>]*>.*Apple Compare.*<\/a>/);
  assert.doesNotMatch(html, /\[Apple Compare\]/);
  assert.doesNotMatch(html, /\]\(https:\/\/www\.apple\.com/);
});

test("renders source markdown links inert before content interaction", () => {
  const html = renderToStaticMarkup(<SourceMarkdownText linksEnabled={false} text={"[Apple Compare](https://www.apple.com/mac/compare/)"} />);
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /<a aria-disabled="true" class="nodrag nopan" href="#"[^>]*>.*Apple Compare.*<\/a>/);
});

test("renders source markdown tables as compact tables", () => {
  const markdown = [
    "| 特性 | M4 MacBook Air | M3 MacBook Air |",
    "| --- | --- | --- |",
    "| 芯片 | M4 | M3 |",
    "| 来源 | [Apple](https://www.apple.com/mac/compare/) | [Support](https://support.apple.com/) |"
  ].join("\n");
  const html = renderToStaticMarkup(<SourceMarkdownText text={markdown} />);
  assert.match(html, /<table>/);
  assert.match(html, /<th>.*特性.*<\/th>/);
  assert.match(html, /<td>.*M4.*<\/td>/);
  assert.match(html, /<a [^>]*class="nodrag nopan"[^>]*href="https:\/\/www\.apple\.com\/mac\/compare\/"[^>]*>.*Apple.*<\/a>/);
  assert.doesNotMatch(html, /\| --- \|/);
});

test("renders reference node content as markdown in readonly mode", () => {
  const now = new Date(0).toISOString();
  const node: CanvasNode = {
    id: "node-1",
    projectId: "project-1",
    kind: "reference",
    title: "来源",
    content: "# 来源\n- [Apple Compare](https://www.apple.com/mac/compare/)",
    x: 0,
    y: 0,
    width: 240,
    height: 160,
    metadata: {},
    includeInProjectContext: true,
    createdAt: now,
    updatedAt: now
  };
  const html = renderToStaticMarkup(
    <ReferenceNodeRenderer isSelected={true} isResizing={false} locale="zh" node={node} onUpdateNode={async () => undefined} />
  );
  assert.match(html, /<a aria-disabled="false" class="nodrag nopan" href="https:\/\/www\.apple\.com\/mac\/compare\/"[^>]*>.*Apple Compare.*<\/a>/);
  assert.doesNotMatch(html, /\[Apple Compare\]/);
});

test("shared markdown renderer supports italic text", () => {
  const html = renderToStaticMarkup(<MarkdownText text={"One *emphasis* word"} />);
  assert.match(html, /<em>emphasis<\/em>/);
});
