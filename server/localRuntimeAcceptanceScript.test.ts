import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
const orchestrator = read("scripts/local-runtime-acceptance.ps1");
const browserAcceptance = read("scripts/local-runtime-acceptance.mjs");

test("local runtime acceptance starts through the user VBS entry and checks Docker isolation", () => {
  assert.equal(packageJson.scripts?.["acceptance:local-runtime"], "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-runtime-acceptance.ps1");
  assert.match(orchestrator, /start-opencanvas-shell\.vbs/);
  assert.match(orchestrator, /cscript\.exe/);
  assert.match(orchestrator, /curl\.exe/);
  assert.match(orchestrator, /app-shell\/main\\\.mjs|app-shell\\\/main\\\.mjs/);
  assert.match(orchestrator, /Docker/i);
  assert.match(orchestrator, /2026/);
  assert.match(orchestrator, /8001/);
  assert.match(orchestrator, /17777/);
  assert.match(orchestrator, /17776/);
});

test("local runtime acceptance exercises real Agent capabilities without request interception", () => {
  assert.match(browserAcceptance, /generationCount\s*=\s*5/);
  assert.match(browserAcceptance, /usedMock/);
  assert.match(browserAcceptance, /agent-backend/);
  assert.match(browserAcceptance, /deep-research/);
  assert.match(browserAcceptance, /web_search/);
  assert.match(browserAcceptance, /read_file/);
  assert.match(browserAcceptance, /canvas_write/);
  assert.match(browserAcceptance, /pending/);
  assert.match(browserAcceptance, /memory\.json/);
  assert.match(browserAcceptance, /waitUntil:\s*"domcontentloaded"/);
  assert.match(browserAcceptance, /timeout:\s*120_000/);
  assert.doesNotMatch(browserAcceptance, /waitUntil:\s*"networkidle"/);
  assert.doesNotMatch(browserAcceptance, /page\.route|context\.route/);
});

function read(file: string) {
  return readFileSync(path.join(root, file), "utf8");
}
