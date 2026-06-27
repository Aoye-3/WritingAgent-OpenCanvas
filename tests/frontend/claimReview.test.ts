import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { ClaimCandidate, ClaimStatus } from "../../shared/claimReview.js";
import { claimNodeDraft, formatClaimForChat, getAcceptedClaims } from "../../src/features/workspace/claims/useClaimReview.js";

test("Claim Review helpers only select accepted Claims for batch node creation", () => {
  const claims = [
    claimFixture("claim-1", "pending_review"),
    claimFixture("claim-2", "accepted"),
    claimFixture("claim-3", "rejected")
  ];

  assert.deepEqual(getAcceptedClaims(claims).map((claim) => claim.id), ["claim-2"]);
});

test("Claim Review accepted Claim draft creates a document node with source metadata", () => {
  const claim = claimFixture("claim-1", "accepted");
  const draft = claimNodeDraft(claim);

  assert.equal(draft.kind, "document");
  assert.match(draft.content, /Claim: AI systems require review\./);
  assert.match(draft.content, /Source: \/mnt\/user-data\/outputs\/research\.md/);
  assert.deepEqual(draft.metadata?.claimReview, {
    claimId: "claim-1",
    sourceNodeId: "node-1",
    sourceDocumentPath: "/mnt/user-data/outputs/research.md",
    sourceAnchor: { startOffset: 11, endOffset: 37 }
  });
});

test("Claim Review chat helper formats a composer draft without sending side effects", () => {
  const claim = claimFixture("claim-1", "needs_more_evidence");

  assert.equal(formatClaimForChat(claim), [
    "Claim: AI systems require review.",
    "Evidence: AI systems require review.",
    "Source: /mnt/user-data/outputs/research.md",
    "Status: needs_more_evidence"
  ].join("\n"));
});

test("Claim Review panel is mounted in Markdown preview instead of the AI drawer", () => {
  const drawerSource = readFileSync("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");
  const panelSource = readFileSync("src/features/workspace/components/AICollaborationPanel.tsx", "utf8");
  const canvasSource = readFileSync("src/features/workspace/components/DocumentCanvas.tsx", "utf8");
  const workspaceSource = readFileSync("src/features/workspace/WorkspaceView.tsx", "utf8");

  assert.doesNotMatch(drawerSource, /claimPanel|claimCount|claimPanelActive|drawer-mode-tabs|drawer-claim-panel-wrap/);
  assert.doesNotMatch(panelSource, /claimPanel|claimCount|claimPanelActive/);
  assert.match(canvasSource, /markdown-document-claims-panel/);
  assert.match(workspaceSource, /<WorkspaceMainCanvas[\s\S]*claimPanel=\{/);
});

function claimFixture(id: string, status: ClaimStatus): ClaimCandidate {
  return {
    id,
    projectId: "project-1",
    threadId: "thread-1",
    sourceNodeId: "node-1",
    sourceDocumentPath: "/mnt/user-data/outputs/research.md",
    sourceFileName: "research.md",
    claimText: "AI systems require review.",
    originalClaimText: "AI systems require review.",
    evidenceText: "AI systems require review.",
    sourceAnchor: { startOffset: 11, endOffset: 37 },
    citationUrls: [],
    status,
    createdBy: "user_selection",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}
