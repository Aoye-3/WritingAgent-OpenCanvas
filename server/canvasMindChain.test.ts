import test from "node:test";
import assert from "node:assert/strict";
import type { MindChainEdge, MindChainNode } from "../shared/canvasMindChain.js";
import { findChainStart, followDirectedChain, formatMindChain } from "../shared/canvasMindChain.js";

const baseNode = {
  threadId: "thread_a",
  kind: "note" as const,
  content: "",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  metadata: {},
  createdAt: "now",
  updatedAt: "now"
};

function node(id: string, title: string, content = title): MindChainNode {
  return { ...baseNode, id, title, content };
}

function edge(_id: string, sourceNodeId: string, targetNodeId: string): MindChainEdge {
  return {
    sourceNodeId,
    targetNodeId
  };
}

test("mind chain walks back to the directed start and follows outgoing order", () => {
  const edges = [edge("e1", "a", "b"), edge("e2", "b", "c")];

  assert.equal(findChainStart("b", edges), "a");
  assert.deepEqual(followDirectedChain("a", edges), ["a", "b", "c"]);
});

test("mind chain stops on cycles instead of looping forever", () => {
  const edges = [edge("e1", "a", "b"), edge("e2", "b", "a")];

  assert.deepEqual(followDirectedChain("a", edges), ["a", "b"]);
});

test("mind chain formats selected nodes as explicit chat draft context", () => {
  const nodes = [node("a", "Source", "First"), node("b", "Note", "")];
  const text = formatMindChain("b", nodes, [edge("e1", "a", "b")], "en");

  assert.match(text, /Please collaborate using this Canvas mind chain/);
  assert.match(text, /1\. \[note\] Source\nFirst/);
  assert.match(text, /2\. \[note\] Note\n\(empty node\)/);
});
