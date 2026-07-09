import test from "node:test";
import assert from "node:assert/strict";
import { resolveCanvasAction } from "./canvasActionPolicy.js";

test("recognizes explicit Chinese Canvas node creation as a forced low-risk action", () => {
  const action = resolveCanvasAction({
    threadId: "thread_1",
    instruction: "\u5e2e\u6211\u5728\u753b\u5e03\u91cc\u521b\u5efa\u4e00\u4e2a\u8282\u70b9\uff1a\u91cc\u9762\u5199\u7740\u4f60\u7684\u8eab\u4efd",
    sequence: 2
  });

  assert.equal(action?.operation, "create");
  assert.equal(action?.risk, "low");
  assert.equal(action?.requiresTool, true);
});

test("classifies append as low risk and destructive operations as approval-gated", () => {
  assert.equal(resolveCanvasAction({
    threadId: "t",
    instruction: "\u8ffd\u52a0\u5230\u753b\u677f",
    selectedCanvasNodeId: "node_1"
  })?.risk, "low");
  assert.equal(resolveCanvasAction({
    threadId: "t",
    instruction: "\u8986\u76d6\u753b\u5e03\u91cc\u7684\u8282\u70b9",
    selectedCanvasNodeId: "node_1"
  })?.risk, "high");
  const deletion = resolveCanvasAction({
    threadId: "t",
    instruction: "\u5220\u9664\u753b\u5e03\u91cc\u7684\u8282\u70b9",
    selectedCanvasNodeId: "node_1"
  });
  assert.equal(deletion?.risk, "high");
  assert.equal(deletion?.requiresTool, true);
});

test("does not treat literature coverage wording as Canvas replacement", () => {
  for (const instruction of [
    "\u6587\u732e\u5168\u8986\u76d6\uff0c\u517c\u987e\u7ecf\u5178\u4e0e\u524d\u6cbf",
    "\u8986\u76d6 2026 \u5e74\u8bba\u6587"
  ]) {
    assert.notEqual(resolveCanvasAction({
      threadId: "t",
      instruction
    })?.operation, "replace", instruction);
  }
});

test("requires explicit Canvas or node targets for replacement intent", () => {
  assert.equal(resolveCanvasAction({
    threadId: "t",
    instruction: "\u8986\u76d6\u5f53\u524d\u8282\u70b9\u5185\u5bb9",
    selectedCanvasNodeId: "node_1"
  })?.operation, "replace");
  assert.equal(resolveCanvasAction({
    threadId: "t",
    instruction: "\u66ff\u6362\u753b\u5e03\u5185\u5bb9"
  })?.operation, "replace");
  const selectedCard = resolveCanvasAction({
    threadId: "t",
    instruction: "\u91cd\u5199\u9009\u4e2d\u7684\u5361\u7247",
    selectedCanvasNodeId: "node_1"
  });
  assert.equal(selectedCard?.operation, "replace");
  assert.equal(selectedCard?.targetNodeId, "node_1");
});

test("recognizes English and mixed Canvas delivery wording as create actions", () => {
  for (const instruction of [
    "turn this into nodes",
    "make canvas cards",
    "总结成 canvas nodes"
  ]) {
    const action = resolveCanvasAction({
      threadId: "thread_2",
      instruction,
      sequence: 3
    });

    assert.equal(action?.operation, "create", instruction);
    assert.equal(action?.risk, "low", instruction);
    assert.equal(action?.requiresTool, false, instruction);
  }
});
