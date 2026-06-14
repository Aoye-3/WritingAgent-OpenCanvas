import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const launcher = readFileSync(join(process.cwd(), "start-facetwrite.ps1"), "utf8");
const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
const viteConfig = readFileSync(join(process.cwd(), "vite.config.ts"), "utf8");

test("launcher defaults to the project-managed local Agent Runtime", () => {
  assert.match(launcher, /Get-ConfigValue -Name "AGENT_RUNTIME_MODE" -DefaultValue "local"/);
  assert.match(launcher, /Get-FreeTcpPort/);
  assert.match(launcher, /AGENT_RUNTIME_PORT/);
  assert.match(launcher, /scripts\\agent-runtime-local\.ps1/);
  assert.doesNotMatch(launcher, /DefaultValue "http:\/\/127\.0\.0\.1:8001"/);
});

test("launcher shares one authenticated Tool Bridge token with managed services", () => {
  assert.match(launcher, /FACETWRITE_INTERNAL_TOOL_TOKEN/);
  assert.match(launcher, /generatedToolToken/);
  assert.match(launcher, /Invoke-RuntimeScript -Script \$localRuntimeScript -Action "down"/);
});

test("launcher keeps Docker behind the explicit docker mode", () => {
  assert.match(launcher, /"docker" \{/);
  assert.match(launcher, /scripts\\agent-runtime\.ps1/);
  assert.doesNotMatch(launcher, /function Start-AgentRuntimeSidecar/);
});

test("launcher supports an unmanaged external Agent Runtime", () => {
  assert.match(launcher, /"external" \{/);
  assert.match(launcher, /does not manage its lifecycle/);
});

test("launcher still requires an enabled Agent Runtime", () => {
  assert.match(
    launcher,
    /throw "Agent Runtime is required for the local launcher\./,
  );
  assert.doesNotMatch(launcher, /SkipAgentRuntime|SkipAgentBackend/);
  assert.doesNotMatch(launcher, /Skipping Agent Runtime sidecar startup/);
  assert.match(launcher, /Start-SelectedAgentRuntime/);
});

test("launcher fails fast when FacetWrite ports are already occupied", () => {
  assert.match(
    launcher,
    /if \(Test-PortInUse -Port \$clientPort\) \{\s+throw "Frontend port \$clientPort is already in use\./,
  );
  assert.match(
    launcher,
    /if \(Test-PortInUse -Port \$apiPort\) \{\s+throw "API port \$apiPort is already in use\./,
  );
});

test("launcher and Vite share the same explicit frontend and API port sources", () => {
  assert.match(launcher, /Get-ConfigValue -Name "VITE_PORT" -DefaultValue "3000"/);
  assert.match(launcher, /Get-ConfigValue -Name "PORT" -DefaultValue "8837"/);
  assert.match(viteConfig, /process\.env\.VITE_PORT \?\? "3000"/);
  assert.match(viteConfig, /process\.env\.PORT \?\? "8837"/);
  assert.doesNotMatch(packageJson, /vite --host 127\.0\.0\.1 --port 3000/);
  assert.doesNotMatch(`${launcher}\n${viteConfig}\n${packageJson}`, /17778/);
});
