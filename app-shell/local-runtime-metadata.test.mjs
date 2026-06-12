import assert from "node:assert/strict";
import test from "node:test";
import { parseLocalRuntimeMetadata } from "./local-runtime-metadata.mjs";

test("parses PowerShell UTF-8 JSON files with a BOM", () => {
  assert.deepEqual(parseLocalRuntimeMetadata('\uFEFF{"projectRoot":"F:\\\\.FinalProject","port":8001}'), {
    projectRoot: "F:\\.FinalProject",
    port: 8001,
  });
});
