import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClaimReviewDomainService } from "./domains/claim-review/index.js";
import { createStorage } from "./storage.js";

test("creates a Claim candidate from selection without creating Canvas nodes", async () => {
  const { service, storage, threadId, sourceNode } = await claimFixture();
  const before = storage.listCanvasNodes(sourceNode.projectId).length;

  const claim = await service.createFromSelection(threadId, {
    sourceNodeId: sourceNode.id,
    sourceDocumentPath: "/mnt/user-data/outputs/research.md",
    selectedText: "AI systems require review.",
    sourceAnchor: { startOffset: 0, endOffset: 26 }
  });

  assert.equal(claim.status, "pending_review");
  assert.equal(claim.createdBy, "user_selection");
  assert.equal(storage.listCanvasNodes(sourceNode.projectId).length, before);
});

test("updates Claim text and keeps the original candidate text", async () => {
  const { service, threadId, sourceNode } = await claimFixture();
  const claim = await service.createFromSelection(threadId, {
    sourceNodeId: sourceNode.id,
    sourceDocumentPath: "/mnt/user-data/outputs/research.md",
    selectedText: "Original claim."
  });

  const edited = service.update(threadId, claim.id, { claimText: "Edited claim." });

  assert.equal(edited?.status, "edited");
  assert.equal(edited?.claimText, "Edited claim.");
  assert.equal(edited?.originalClaimText, "Original claim.");
});

test("creates Canvas nodes only from accepted Claims", async () => {
  const { service, storage, threadId, sourceNode } = await claimFixture();
  const claim = await service.createFromSelection(threadId, {
    sourceNodeId: sourceNode.id,
    sourceDocumentPath: "/mnt/user-data/outputs/research.md",
    selectedText: "Accepted claim."
  });

  assert.throws(() => service.createNode(threadId, claim.id), /Only accepted Claims/);
  const accepted = service.update(threadId, claim.id, { status: "accepted" });
  const result = service.createNode(threadId, accepted!.id);

  assert.equal(result?.node.kind, "document");
  assert.equal(result?.node.title, "摘要 1");
  assert.equal(result?.node.content, "Accepted claim.");
  assert.doesNotMatch(result?.node.content ?? "", /Evidence:/);
  assert.doesNotMatch(result?.node.content ?? "", /Source:/);
  assert.doesNotMatch(result?.node.content ?? "", /Status:/);
  assert.equal(storage.listClaims(threadId)[0].canvasNodeId, result?.node.id);
});

test("failed extraction does not delete existing reviewed Claims", async () => {
  const fixture = await claimFixture({ extractFails: true });
  const claim = await fixture.service.createFromSelection(fixture.threadId, {
    sourceNodeId: fixture.sourceNode.id,
    sourceDocumentPath: "/mnt/user-data/outputs/research.md",
    selectedText: "Reviewed claim."
  });
  fixture.service.update(fixture.threadId, claim.id, { status: "accepted" });

  await assert.rejects(() => fixture.service.extract(fixture.threadId, {
    sourceNodeId: fixture.sourceNode.id,
    sourceDocumentPath: "/mnt/user-data/outputs/research.md"
  }), /extract failed/);

  assert.equal(fixture.storage.listClaims(fixture.threadId)[0].status, "accepted");
});

test("deletes Claim candidates persistently", async () => {
  const { service, storage, threadId, sourceNode } = await claimFixture();
  const claim = await service.createFromSelection(threadId, {
    sourceNodeId: sourceNode.id,
    sourceDocumentPath: "/mnt/user-data/outputs/research.md",
    selectedText: "Delete this claim."
  });

  assert.equal(service.delete(threadId, claim.id), true);
  assert.deepEqual(storage.listClaims(threadId).map((item) => item.id), []);
  assert.equal(service.delete(threadId, claim.id), false);
});

test("rejects Claim creation when the source path does not match the file_document node", async () => {
  const { service, threadId, sourceNode } = await claimFixture();

  await assert.rejects(() => service.createFromSelection(threadId, {
    sourceNodeId: sourceNode.id,
    sourceDocumentPath: "/mnt/user-data/outputs/other.md",
    selectedText: "Mismatch."
  }), /does not match/);
});

async function claimFixture(options: { extractFails?: boolean } = {}) {
  const storage = await createStorage();
  const threadId = `thread_${randomUUID().replace(/-/g, "_")}`;
  const projectId = `project_${randomUUID().replace(/-/g, "_")}`;
  await storage.ensureThread(threadId, projectId, "Claim review");
  const sourceNode = storage.createCanvasNode(projectId, {
    kind: "file_document",
    title: "research.md",
    content: "# Research\nAI systems require review.",
    metadata: { fileDocument: { path: "/mnt/user-data/outputs/research.md", fileName: "research.md" } }
  });
  const service = createClaimReviewDomainService(storage, {
    readMarkdownOutputPreview: async () => ({
      path: "/mnt/user-data/outputs/research.md",
      fileName: "research.md",
      size: 38,
      content: "# Research\nAI systems require review."
    }),
    extractClaims: async () => {
      if (options.extractFails) throw new Error("extract failed");
      return [{ claimText: "AI systems require review.", evidenceText: "AI systems require review." }];
    }
  });
  return { service, storage, threadId, sourceNode };
}
