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
