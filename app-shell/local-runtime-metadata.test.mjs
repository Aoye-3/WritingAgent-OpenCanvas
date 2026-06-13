import assert from "node:assert/strict";
import test from "node:test";
import { isLocalRuntimeStale, parseLocalRuntimeMetadata } from "./local-runtime-metadata.mjs";

test("parses PowerShell UTF-8 JSON files with a BOM", () => {
  assert.deepEqual(parseLocalRuntimeMetadata('\uFEFF{"projectRoot":"F:\\\\.FinalProject","port":8001}'), {
    projectRoot: "F:\\.FinalProject",
    port: 8001,
  });
});

test("treats missing or changed source fingerprints as stale", () => {
  assert.equal(isLocalRuntimeStale({}, "200"), true);
  assert.equal(isLocalRuntimeStale({ sourceFingerprint: "100" }, "200"), true);
  assert.equal(isLocalRuntimeStale({ sourceFingerprint: "200" }, "200"), false);
});
