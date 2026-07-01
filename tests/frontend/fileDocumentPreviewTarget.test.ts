import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasNode } from "../../src/features/agents/types.js";
import { fileDocumentPreviewTarget } from "../../src/features/workspace/components/canvas/fileDocumentPreview.js";

test("file document preview uses explicit source thread metadata", () => {
  const node = fileDocumentNode({
    fileDocument: {
      path: "/mnt/user-data/outputs/report.md",
      fileName: "report.md",
      threadId: "thread_source"
    }
  });

  assert.deepEqual(fileDocumentPreviewTarget(node, "thread_current"), {
    path: "/mnt/user-data/outputs/report.md",
    threadId: "thread_source"
  });
});

test("file document preview recovers source thread from legacy delivery id", () => {
  const node = fileDocumentNode({
    deliveryId: "delivery_thread_ada0dd2e-95b7-4f58-be46-1ad840ba35d0_1_direct",
    fileDocument: {
      path: "/mnt/user-data/outputs/systematic_literature_review_llm_agents.md",
      fileName: "systematic_literature_review_llm_agents.md"
    }
  });

  assert.deepEqual(fileDocumentPreviewTarget(node, "thread_current"), {
    path: "/mnt/user-data/outputs/systematic_literature_review_llm_agents.md",
    threadId: "thread_ada0dd2e-95b7-4f58-be46-1ad840ba35d0"
  });
});

test("file document preview falls back to current thread for manual nodes", () => {
  const node = fileDocumentNode({
    fileDocument: {
      path: "/mnt/user-data/outputs/manual.md",
      fileName: "manual.md"
    }
  });

  assert.deepEqual(fileDocumentPreviewTarget(node, "thread_current"), {
    path: "/mnt/user-data/outputs/manual.md",
    threadId: "thread_current"
  });
});

function fileDocumentNode(metadata: Record<string, unknown>): CanvasNode {
  return {
    id: "node_delivery_thread_legacy_1_direct_7212",
    projectId: "project_1",
    kind: "file_document",
    title: "Document",
    content: "",
    x: 0,
    y: 0,
    width: 360,
    height: 220,
    metadata,
    includeInProjectContext: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}
