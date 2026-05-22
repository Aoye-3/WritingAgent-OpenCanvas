import test from "node:test";
import assert from "node:assert/strict";
import { validateKnowledgeItemInput } from "./service.js";

test("rejects local file path imports unless explicitly enabled", () => {
  const previous = process.env.KNOWLEDGE_ALLOW_LOCAL_FILE_PATHS;
  delete process.env.KNOWLEDGE_ALLOW_LOCAL_FILE_PATHS;

  assert.throws(
    () => validateKnowledgeItemInput({ type: "file", source: "F:\\private\\notes.pdf" }),
    /Local file path imports are disabled/
  );

  if (previous === undefined) {
    delete process.env.KNOWLEDGE_ALLOW_LOCAL_FILE_PATHS;
  } else {
    process.env.KNOWLEDGE_ALLOW_LOCAL_FILE_PATHS = previous;
  }
});

test("accepts uploaded knowledge files with supported extensions", () => {
  assert.doesNotThrow(() => validateKnowledgeItemInput({
    type: "file",
    fileName: "story-notes.md",
    fileBase64: Buffer.from("# Notes").toString("base64")
  }));
});

test("rejects unsafe knowledge import sources", () => {
  assert.throws(
    () => validateKnowledgeItemInput({ type: "file", fileName: "../secret.exe", fileBase64: Buffer.from("x").toString("base64") }),
    /not supported/
  );
  assert.throws(
    () => validateKnowledgeItemInput({ type: "url", source: "file:///etc/passwd" }),
    /http or https/
  );
  assert.throws(
    () => validateKnowledgeItemInput({ type: "sitemap", source: "ftp://example.com/sitemap.xml" }),
    /http or https/
  );
});
