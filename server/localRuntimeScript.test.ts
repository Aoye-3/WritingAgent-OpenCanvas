import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const script = readFileSync("scripts/agent-runtime-local.ps1", "utf8");
const dockerScript = readFileSync("scripts/agent-runtime.ps1", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

test("local Agent Runtime script manages the Gateway lifecycle", () => {
  assert.match(script, /ValidateSet\("up", "down", "status", "doctor"\)/);
  assert.match(script, /python", "install", "3\.12/);
  assert.match(script, /"sync", "--python", "3\.12", "--locked", "--all-packages"/);
  assert.match(script, /\.venv\\pyvenv\.cfg/);
  assert.match(script, /PYTHONPATH/);
  assert.match(script, /packages\\harness/);
  assert.match(script, /"-m", "uvicorn", "app\.gateway\.app:app"/);
  assert.match(script, /"--host", "127\.0\.0\.1", "--port"/);
  assert.match(script, /agent-runtime-local\.pid/);
});

test("local Agent Runtime preserves runtime paths and executable tools", () => {
  assert.match(script, /DEER_FLOW_PROJECT_ROOT/);
  assert.match(script, /DEER_FLOW_HOME/);
  assert.match(script, /DEER_FLOW_CONFIG_PATH/);
  assert.match(script, /DEER_FLOW_EXTENSIONS_CONFIG_PATH/);
  assert.match(script, /DEER_FLOW_SKILLS_PATH/);
  assert.match(script, /FACETWRITE_INTERNAL_BASE_URL/);
  assert.match(script, /Join-Path \$root "\.env\.local"/);
  assert.match(script, /Assert-Command "node"/);
  assert.match(script, /Assert-Command "npx\.cmd"/);
  assert.match(script, /\$env:Path =/);
  assert.doesNotMatch(script, /\$env:PATH =/);
  assert.match(script, /SetEnvironmentVariable\("PATH", \$null, "Process"\)/);
});

test("package scripts expose local default and explicit Docker lifecycle", () => {
  assert.match(packageJson.scripts["agent-runtime:up"], /agent-runtime-local\.ps1 up/);
  assert.match(packageJson.scripts["agent-runtime:down"], /agent-runtime-local\.ps1 down/);
  assert.match(packageJson.scripts["agent-runtime:status"], /agent-runtime-local\.ps1 status/);
  assert.match(packageJson.scripts["agent-runtime:doctor"], /agent-runtime-local\.ps1 doctor/);
  assert.match(packageJson.scripts["agent-runtime:docker:up"], /agent-runtime\.ps1 up/);
  assert.match(packageJson.scripts["agent-runtime:docker:down"], /agent-runtime\.ps1 down/);
  assert.match(packageJson.scripts["agent-runtime:docker:status"], /agent-runtime\.ps1 status/);
});

test("explicit Docker mode bootstraps ignored runtime configuration files", () => {
  assert.match(dockerScript, /Ensure-AgentRuntimeFiles/);
  assert.match(dockerScript, /config\.example\.yaml/);
  assert.match(dockerScript, /extensions_config\.example\.json/);
  assert.match(dockerScript, /Ensure-AgentRuntimeFiles\s*\n/);
});
