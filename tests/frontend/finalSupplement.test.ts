import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addSubmittedFinalSupplementId,
  appendFinalSupplementAddition,
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

test("final supplement additions append locally in order", () => {
  const first = appendFinalSupplementAddition({}, "final_supplement_1", " Focus on enterprise workflows ");
  const second = appendFinalSupplementAddition(first, "final_supplement_1", "Include risks");

  assert.deepEqual(second.final_supplement_1, ["Focus on enterprise workflows", "Include risks"]);
});

test("empty final supplement addition is ignored", () => {
  const current = { final_supplement_1: ["Keep this"] };

  assert.equal(appendFinalSupplementAddition(current, "final_supplement_1", "   "), current);
});

test("adding final supplement does not send a supplement run", () => {
  const source = readFileSync("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");
  const addStart = source.indexOf("const addFinalSupplement = async");
  const executeStart = source.indexOf("const executeFinalSupplement = async");
  const addSource = source.slice(addStart, executeStart);

  assert.match(addSource, /appendFinalSupplementAddition/);
  assert.doesNotMatch(addSource, /onSend/);
  assert.doesNotMatch(addSource, /action:\s*"supplement"/);
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
