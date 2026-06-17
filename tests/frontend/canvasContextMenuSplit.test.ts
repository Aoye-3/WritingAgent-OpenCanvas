import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasContextMenu, type CanvasMenuState } from "../../src/features/workspace/components/canvas/CanvasChrome.js";

Object.assign(globalThis, { React });

const createItems = [{ kind: "document" as const, label: "Document" }];

test("shows split selection action only for node menus with a text selection", () => {
  const withSelection = renderMenu({
    screenX: 10,
    screenY: 20,
    canvasX: 100,
    canvasY: 200,
    nodeId: "node_1",
    textSelection: {
      nodeId: "node_1",
      rangeStart: 0,
      rangeEnd: 12,
      text: "Selected text",
    },
  });

  assert.match(withSelection, /canvas-menu-split-selection/);
  assert.match(withSelection, /Split selection to node/);

  const withoutSelection = renderMenu({
    screenX: 10,
    screenY: 20,
    canvasX: 100,
    canvasY: 200,
    nodeId: "node_1",
  });

  assert.doesNotMatch(withoutSelection, /canvas-menu-split-selection/);
  assert.match(withoutSelection, /Send mind chain/);
});

function renderMenu(menu: CanvasMenuState) {
  return renderToStaticMarkup(React.createElement(CanvasContextMenu, {
    createItems,
    menu,
    sendMindChainLabel: "Send mind chain",
    splitSelectionLabel: "Split selection to node",
    onCreateNode: () => {},
    onSendMindChain: () => {},
    onSplitSelection: () => {},
  }));
}
