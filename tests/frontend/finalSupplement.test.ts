import test from "node:test";
import assert from "node:assert/strict";
import { finalSupplementInstruction } from "../../src/features/workspace/components/AICollaborationDrawer";

test("final supplement instruction appends trimmed supplements", () => {
  assert.equal(
    finalSupplementInstruction("Write the report", [" Focus on enterprise workflows ", "Include risks"], "en"),
    "Write the report\n\nFinal supplements:\n1. Focus on enterprise workflows\n2. Include risks"
  );
});

test("final supplement instruction leaves empty additions unchanged", () => {
  assert.equal(
    finalSupplementInstruction("执行任务", [" ", ""], "zh"),
    "执行任务"
  );
});
