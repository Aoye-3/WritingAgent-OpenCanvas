import test from "node:test";
import assert from "node:assert/strict";
import { buildPlanTimeline } from "../../src/features/workspace/planTimeline.js";

test("places a plan after the first assistant message completed after plan creation", () => {
  const entries = buildPlanTimeline([
    { id: "user_1", role: "user", createdAt: "2026-06-12T10:00:00.000Z" },
    { id: "assistant_1", role: "assistant", createdAt: "2026-06-12T10:00:03.000Z" },
    { id: "user_2", role: "user", createdAt: "2026-06-12T10:01:00.000Z" }
  ], [
    { id: "plan_1", createdAt: "2026-06-12T10:00:01.000Z" }
  ]);

  assert.deepEqual(entries.map((entry) => `${entry.kind}:${entry.value.id}`), [
    "message:user_1",
    "message:assistant_1",
    "plan:plan_1",
    "message:user_2"
  ]);
});

test("renders every plan once even when no assistant message is available", () => {
  const entries = buildPlanTimeline([], [{ id: "plan_1", createdAt: "2026-06-12T10:00:01.000Z" }]);
  assert.deepEqual(entries.map((entry) => `${entry.kind}:${entry.value.id}`), ["plan:plan_1"]);
});
