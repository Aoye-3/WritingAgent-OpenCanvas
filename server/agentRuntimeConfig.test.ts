import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";

type RuntimeToolConfig = {
  name?: string;
  use?: string;
};

type RuntimeConfig = {
  tools?: RuntimeToolConfig[];
};

const runtimeRoot = path.resolve("modules", "agent-runtime");
const harnessRoot = path.join(runtimeRoot, "backend", "packages", "harness");
const configFiles = ["config.yaml", "config.example.yaml"] as const;
const requiredBridgeTools = [
  "knowledge_base",
  "clear_context",
  "plan_clarification_submit",
  "plan_revision_submit",
  "artifact_stage",
  "canvas_write"
] as const;

for (const fileName of configFiles) {
  test(`${fileName} only references loadable Agent Runtime tools`, () => {
    const config = readRuntimeConfig(fileName);
    const tools = config.tools ?? [];
    const toolNames = tools.map((tool) => tool.name);

    assert.equal(toolNames.includes("quick_messages"), false);
    for (const name of requiredBridgeTools) {
      assert.ok(toolNames.includes(name), `${fileName} should include ${name}`);
    }

    for (const tool of tools) {
      assert.ok(tool.name, `${fileName} has a tool entry without a name`);
      assert.ok(tool.use, `${fileName} tool ${tool.name} has no use target`);
      assertToolTargetExists(fileName, tool as Required<RuntimeToolConfig>);
    }
  });
}

test("FacetWrite bridge config matches the TypeScript tool catalog", () => {
  const catalog = readFileSync("server/tools/catalog.ts", "utf8");
  assert.doesNotMatch(catalog, /quick_messages/);
  for (const name of requiredBridgeTools) {
    assert.match(catalog, new RegExp(`\\b${escapeRegex(name)}\\b`));
  }
});

function readRuntimeConfig(fileName: string): RuntimeConfig {
  return parse(readFileSync(path.join(runtimeRoot, fileName), "utf8")) as RuntimeConfig;
}

function assertToolTargetExists(fileName: string, tool: Required<RuntimeToolConfig>) {
  const [moduleName, exportName] = tool.use.split(":");
  assert.ok(moduleName && exportName, `${fileName} tool ${tool.name} has invalid use target ${tool.use}`);
  assert.match(moduleName, /^deerflow\./, `${fileName} tool ${tool.name} should resolve inside deerflow`);

  const modulePath = path.join(harnessRoot, ...moduleName.split(".")) + ".py";
  assert.ok(existsSync(modulePath), `${fileName} tool ${tool.name} module does not exist: ${moduleName}`);

  const source = readFileSync(modulePath, "utf8");
  const toolPattern = new RegExp(`@tool\\("${escapeRegex(tool.name)}"[\\s\\S]*?def\\s+${escapeRegex(exportName)}\\s*\\(`);
  assert.match(source, toolPattern, `${fileName} tool ${tool.name} does not export ${exportName}`);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
