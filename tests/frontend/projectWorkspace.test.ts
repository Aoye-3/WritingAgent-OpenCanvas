import test from "node:test";
import assert from "node:assert/strict";
import { assertProjectFirstContract, selectProjectThread } from "../../src/app/projectWorkspace.js";

test("accepts only the Project-first health contract", () => {
  assert.doesNotThrow(() => assertProjectFirstContract({ ok: true, schemaVersion: 3, apiContract: "facetwrite-project-first-v1" }));
  assert.throws(
    () => assertProjectFirstContract({ ok: true, schemaVersion: 2, apiContract: "legacy" }),
    /backend version is incompatible/i,
  );
});

test("opens the most recently updated Project thread when available", () => {
  const selected = selectProjectThread([
    { id: "older", projectId: "project-1", title: "Older", updatedAt: "2026-06-10T10:00:00.000Z" },
    { id: "newer", projectId: "project-1", title: "Newer", updatedAt: "2026-06-11T10:00:00.000Z" },
  ]);
  assert.equal(selected?.id, "newer");
});

test("returns no thread when a Project has no conversation", () => {
  assert.equal(selectProjectThread([]), undefined);
});
