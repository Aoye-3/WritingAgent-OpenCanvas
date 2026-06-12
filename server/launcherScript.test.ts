import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const launcher = readFileSync(join(process.cwd(), "start-facetwrite.ps1"), "utf8");
const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
const viteConfig = readFileSync(join(process.cwd(), "vite.config.ts"), "utf8");

test("launcher fails fast when Docker is unavailable for Agent Runtime", () => {
  assert.match(
    launcher,
    /if \(-not \(Test-CommandAvailable -Name "docker"\)\) \{\s+throw "Docker was not found\./,
  );
  assert.doesNotMatch(
    launcher,
    /docker was not found\.[\s\S]*?FacetWrite may fall back[\s\S]*?return/,
  );
});

test("launcher fails fast when Docker daemon is unreachable for Agent Runtime", () => {
  assert.match(
    launcher,
    /if \(\$LASTEXITCODE -ne 0\) \{\s+throw "Docker daemon is not reachable\./,
  );
  assert.doesNotMatch(
    launcher,
    /Warning: Docker daemon is not reachable\.[\s\S]*?return/,
  );
});

test("launcher fails when Agent Runtime sidecar never becomes healthy", () => {
  assert.match(
    launcher,
    /throw "Agent Runtime sidecar did not report healthy/,
  );
  assert.doesNotMatch(
    launcher,
    /Agent Runtime sidecar did not report healthy[\s\S]*?generation falls back/,
  );
});

test("launcher requires Agent Runtime instead of allowing skip startup", () => {
  assert.match(
    launcher,
    /throw "Agent Runtime is required for the local launcher\./,
  );
  assert.doesNotMatch(launcher, /SkipAgentRuntime|SkipAgentBackend/);
  assert.doesNotMatch(launcher, /Skipping Agent Runtime sidecar startup/);
  assert.match(launcher, /Start-AgentRuntimeSidecar/);
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
