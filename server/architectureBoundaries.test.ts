import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const sourceExtensions = new Set([".ts", ".tsx"]);
const ignoredDirectories = new Set([".git", "dist", "node_modules"]);

test("frontend source does not import server modules", () => {
  const violations = readSourceFiles("src").flatMap((filePath) => {
    const content = readFileSync(filePath, "utf8");
    return content.match(/from\s+["'][^"']*server(?:\/|["'])/g)
      ? [filePath]
      : [];
  });

  assert.deepEqual(violations, []);
});

test("Agent Runtime adapter does not import Canvas persistence directly", () => {
  const runtimeFiles = [
    ...readSourceFiles("server/runtime"),
    ...readSourceFiles("server/agentBackend")
  ];
  const violations = runtimeFiles.flatMap((filePath) => {
    const content = readFileSync(filePath, "utf8");
    return /canvasRepository|repositories\/canvasRepository|storage\.js/.test(content)
      ? [filePath]
      : [];
  });

  assert.deepEqual(violations, []);
});

test("Canvas route is wired through the Canvas domain service", () => {
  const routePath = path.join("server", "routes", "canvasRoutes.ts");
  const content = readFileSync(routePath, "utf8");

  assert.match(content, /CanvasDomainService/);
  assert.doesNotMatch(content, /SQLiteStorageRepository/);
  assert.doesNotMatch(content, /storage\./);
});

test("generated QA and Playwright artifacts stay out of source commits", () => {
  const gitignore = readFileSync(".gitignore", "utf8");

  assert.match(gitignore, /(?:^|\r?\n)test-results\/(?:\r?\n|$)/);
  assert.match(gitignore, /(?:^|\r?\n)\*-qa\.png(?:\r?\n|$)/);
});

function readSourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : readSourceFiles(fullPath);
    }
    return sourceExtensions.has(path.extname(entry.name)) ? [fullPath] : [];
  });
}
