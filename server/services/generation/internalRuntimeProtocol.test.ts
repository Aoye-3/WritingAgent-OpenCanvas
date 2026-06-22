import test from "node:test";
import assert from "node:assert/strict";
import { containsInternalRuntimeProtocol } from "../../../shared/internalRuntimeProtocol.js";

test("detects DSML webfetch tool_calls protocol leaked by skill runs", () => {
  const leaked = '< | | DSML | | tool_calls> < / | / DSML / / invoke name="webfetch"> < | | DSML | | parameter name="url" string="true">https://arxiv.org/abs/2504.19678< / | / DSML | | parameter> < | | DSML | | parameter name="maxcontentlength" string="false">5000< / | / DSML | | parameter> < / | / DSML | | invoke> < / | / DSML | | tool_calls>';

  assert.equal(containsInternalRuntimeProtocol(leaked), true);
});

test("does not block ordinary prose about web fetch or tool calls", () => {
  assert.equal(containsInternalRuntimeProtocol("The web fetch tool calls should be budgeted carefully in long tasks."), false);
});
