import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const main = read("app-shell/main.mjs");
const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string>; devDependencies?: Record<string, string> };

test("Electron shell keeps renderer privileges disabled", () => {
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
});

test("Electron shell owns fixed non-reserved development ports and shutdown", () => {
  assert.match(main, /const frontendPort = 17776/);
  assert.match(main, /const apiPort = 17777/);
  assert.match(main, /startProcess\("node\.exe", \[tsxCli/);
  assert.match(main, /startProcess\("node\.exe", \[viteCli/);
  assert.doesNotMatch(main, /startProcess\("npm\.cmd"/);
  assert.match(main, /await lifecycle\?\.stop\(\)/);
  assert.match(main, /resolveRuntimeMode/);
  assert.match(main, /agent-runtime-local\.ps1/);
  assert.match(main, /runDetachedCommand/);
  assert.match(main, /FACETWRITE_INTERNAL_TOOL_TOKEN:\s*internalToolToken/);
  assert.match(main, /toolTokenFingerprint/);
  assert.doesNotMatch(main, /Docker Desktop\.exe/);
});

test("shell commands and hidden shortcut are present", () => {
  assert.equal(packageJson.scripts?.["shell:dev"], "electron app-shell/main.mjs");
  assert.equal(packageJson.scripts?.["shell:test"], "node --test app-shell/*.test.mjs");
  assert.equal(packageJson.devDependencies?.electron, "41.2.1");
  const shortcut = read("start-opencanvas-shell.vbs");
  assert.match(shortcut, /AGENT_RUNTIME_MODE/);
  assert.match(shortcut, /AGENT_BACKEND_BASE_URL/);
  assert.match(shortcut, /npm\.cmd run shell:dev/);
});

test("Electron shell records lifecycle and child service logs", () => {
  assert.match(main, /app-shell\.log/);
  assert.match(main, /api\.out\.log/);
  assert.match(main, /api\.err\.log/);
  assert.match(main, /frontend\.out\.log/);
  assert.match(main, /frontend\.err\.log/);
});

test("Agent Runtime compose profiles accept the shell callback URL", () => {
  for (const file of [
    "modules/agent-runtime/docker/docker-compose-dev.yaml",
    "modules/agent-runtime/docker/docker-compose-local-images.yaml",
  ]) {
    assert.match(read(file), /FACETWRITE_INTERNAL_BASE_URL=\$\{FACETWRITE_INTERNAL_BASE_URL:-http:\/\/host\.docker\.internal:8837\}/);
    assert.match(read(file), /FACETWRITE_INTERNAL_TOOL_TOKEN=\$\{FACETWRITE_INTERNAL_TOOL_TOKEN:\?FACETWRITE_INTERNAL_TOOL_TOKEN is required\}/);
  }
});

function read(file: string) {
  return readFileSync(path.join(root, file), "utf8");
}
