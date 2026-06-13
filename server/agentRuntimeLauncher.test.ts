import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const script = readFileSync(new URL("../scripts/agent-runtime-local.ps1", import.meta.url), "utf8");

test("local Agent Runtime launches the workspace virtualenv Python", () => {
  assert.match(script, /\.venv\\Scripts\\python\.exe/);
  assert.doesNotMatch(script, /Join-Path \$pythonHome "python\.exe"/);
  assert.match(script, /--managed-python/);
});

test("local Agent Runtime validates source freshness before reusing a process", () => {
  assert.match(script, /Get-SourceFingerprint/);
  assert.match(script, /sourceFingerprint/);
  assert.match(script, /Source files changed/);
  assert.match(script, /if \(\$env:FACETWRITE_INTERNAL_TOOL_TOKEN\)/);
  assert.match(script, /running Agent Runtime Python/);
  assert.match(script, /\$restartable/);
});
