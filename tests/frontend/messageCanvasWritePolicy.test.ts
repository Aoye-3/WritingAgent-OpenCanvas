import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("assistant messages do not expose a message-level Canvas write button", async () => {
  const source = await readFile("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");
  assert.doesNotMatch(source, /WriteMessageButton|message-write-button|startMessageWrite/);
  assert.match(source, /captureSelection/);
  assert.match(source, /CanvasWriteProposalPanel/);
});
