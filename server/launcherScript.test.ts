import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const launcher = readFileSync(join(process.cwd(), "start-facetwrite.ps1"), "utf8");

test("launcher fails fast when Docker is unavailable for AgentBackend", () => {
  assert.match(
    launcher,
    /if \(-not \(Test-CommandAvailable -Name "docker"\)\) \{\s+throw "Docker was not found\./,
  );
  assert.doesNotMatch(
    launcher,
    /docker was not found\.[\s\S]*?FacetWrite may fall back[\s\S]*?return/,
  );
});

test("launcher fails fast when Docker daemon is unreachable for AgentBackend", () => {
  assert.match(
    launcher,
    /if \(\$LASTEXITCODE -ne 0\) \{\s+throw "Docker daemon is not reachable\./,
  );
  assert.doesNotMatch(
    launcher,
    /Warning: Docker daemon is not reachable\.[\s\S]*?return/,
  );
});

test("launcher fails when AgentBackend sidecar never becomes healthy", () => {
  assert.match(
    launcher,
    /throw "AgentBackend sidecar did not report healthy/,
  );
  assert.doesNotMatch(
    launcher,
    /AgentBackend sidecar did not report healthy[\s\S]*?generation falls back/,
  );
});
