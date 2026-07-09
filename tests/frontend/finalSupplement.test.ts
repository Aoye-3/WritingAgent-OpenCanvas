import test from "node:test";
import assert from "node:assert/strict";
import {
  addSubmittedFinalSupplementId,
  finalSupplementInstruction,
  pendingFinalSupplementForDisplay,
  removeSubmittedFinalSupplementId
} from "../../src/features/workspace/components/AICollaborationDrawer";
import type { FinalSupplement } from "../../src/features/agents/types";

test("final supplement instruction appends trimmed supplements", () => {
  assert.equal(
    finalSupplementInstruction("Write the report", [" Focus on enterprise workflows ", "Include risks"], "en"),
    "Write the report\n\nFinal supplements:\n1. Focus on enterprise workflows\n2. Include risks"
  );
});

test("submitted final supplement is hidden from the composer while execution is in flight", () => {
  const supplement = finalSupplement("final_supplement_1");
  const submitted = addSubmittedFinalSupplementId(new Set(), supplement.id);

  assert.equal(pendingFinalSupplementForDisplay(supplement, submitted), undefined);
});

test("failed final supplement execution rollback makes the card visible again", () => {
  const supplement = finalSupplement("final_supplement_1");
  const submitted = addSubmittedFinalSupplementId(new Set(["other"]), supplement.id);
  const rolledBack = removeSubmittedFinalSupplementId(submitted, supplement.id);

  assert.equal(pendingFinalSupplementForDisplay(supplement, rolledBack), supplement);
  assert.deepEqual([...rolledBack], ["other"]);
});

function finalSupplement(id: string): FinalSupplement {
  return {
    id,
    status: "pending",
    question: "Any final additions?",
    instructionText: "Write the report",
    requestContext: {},
    createdAt: "2026-07-09T00:00:00.000Z"
  };
}

test("final supplement instruction leaves empty additions unchanged", () => {
  assert.equal(
    finalSupplementInstruction("执行任务", [" ", ""], "zh"),
    "执行任务"
  );
});
