import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const sourceRoots = ["src", "server", "shared", "docs", "tests/e2e"];
const textExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".md", ".json", ".css"]);
const skippedDirectories = new Set([".git", "dist", "node_modules", "__pycache__"]);

const mojibakeMarkers = [
  "\uFFFD",
  "\u95B8",
  "\u5A23",
  "\u9225",
  "\u93CD",
  "\u942D",
  "\u7EF1",
  "\u9286",
  "\u951B",
  "\u9366",
  "\u6D63",
  "\u9357",
  "\u6FE9",
  "\u9365",
  "\u7039"
];

test("user-facing source files do not contain common mojibake markers", () => {
  const matches: string[] = [];

  for (const filePath of sourceRoots.flatMap(walkTextFiles)) {
    const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (mojibakeMarkers.some((marker) => line.includes(marker))) {
        matches.push(`${filePath}:${index + 1}`);
      }
    });
  }

  assert.deepEqual(matches, []);
});

function walkTextFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return skippedDirectories.has(entry.name) ? [] : walkTextFiles(fullPath);
    }
    return textExtensions.has(path.extname(entry.name)) ? [fullPath] : [];
  });
}
