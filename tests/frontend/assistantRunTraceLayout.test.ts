import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("pending assistant messages with run trace use a normal bubble layout", () => {
  const source = readFileSync("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");

  assert.match(source, /hasRunTrace/);
  assert.match(source, /usesThinkingStatus/);
  assert.doesNotMatch(source, /className=\{isPendingAssistant \? "message-thinking-status" : "message-bubble"\}/);
});
