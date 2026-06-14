import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const script = readFileSync("scripts/agent-runtime-local.ps1", "utf8");
const dockerScript = readFileSync("scripts/agent-runtime.ps1", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

test("local Agent Runtime script manages the Gateway lifecycle", () => {
  assert.match(script, /ValidateSet\("up", "down", "status", "doctor"\)/);
  assert.match(script, /\[int\] \$Port = 0/);
  assert.match(script, /Get-FreeTcpPort/);
  assert.match(script, /python", "install", "3\.12/);
  assert.match(script, /python find --managed-python 3\.12/);
  assert.match(script, /"sync", "--python", \$managedPython, "--locked", "--all-packages"/);
  assert.match(script, /\$venvConfigPath = Join-Path \$venvRoot "pyvenv\.cfg"/);
  assert.match(script, /\.venv\\Scripts\\python\.exe/);
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
  assert.match(script, /FACETWRITE_INTERNAL_TOOL_TOKEN/);
  assert.match(script, /toolTokenFingerprint/);
  assert.match(script, /SHA256\]::Create/);
  assert.match(script, /BitConverter\]::ToString/);
  assert.doesNotMatch(script, /SHA256\]::HashData/);
  assert.doesNotMatch(script, /Convert\]::ToHexString/);
  assert.match(script, /Join-Path \$root "\.env\.local"/);
  assert.match(script, /AGENT_RUNTIME_PORT/);
  assert.match(script, /Assert-Command "node"/);
  assert.match(script, /Assert-Command "npx\.cmd"/);
  assert.match(script, /\$env:Path =/);
  assert.doesNotMatch(script, /\$env:PATH =/);
  assert.match(script, /SetEnvironmentVariable\("PATH", \$null, "Process"\)/);
});

test("local Agent Runtime status and shutdown resolve the actual port from metadata", () => {
  assert.match(script, /\$Action -in @\("status", "down"\)/);
  assert.match(script, /\$statusMetadata\.port/);
  assert.match(script, /\$metadata\.port -ne \$Port/);
});

test("automatic local Agent Runtime startup ignores stale metadata without an owned process", () => {
  assert.match(
    script,
    /elseif \(\$Action -eq "up" -and \$Port -eq 0 -and \(Test-Path -LiteralPath \$metadataPath\)\)/,
  );
  assert.match(script, /if \(\$statusMetadata -and \(Get-OwnedProcess\)\) \{/);
  assert.match(script, /Remove-OwnershipFiles\s+\$script:Port = Get-FreeTcpPort/);
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
