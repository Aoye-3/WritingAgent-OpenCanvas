export const claimStatuses = ["pending_review", "accepted", "rejected", "needs_more_evidence", "edited"] as const;
export type ClaimStatus = (typeof claimStatuses)[number];

export type ClaimCreatedBy = "ai" | "user_selection";

export type ClaimSourceAnchor = {
  startOffset?: number;
  endOffset?: number;
  headingPath?: string[];
  textFingerprint?: string;
};

export type ClaimCandidate = {
  id: string;
  projectId: string;
  threadId: string;
  sourceNodeId: string;
  sourceDocumentPath: string;
  sourceFileName: string;
  claimText: string;
  originalClaimText?: string;
  evidenceText: string;
  sourceAnchor?: ClaimSourceAnchor;
  citationUrls: string[];
  status: ClaimStatus;
  createdBy: ClaimCreatedBy;
  extractionRunId?: string;
  canvasNodeId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateClaimFromSelectionInput = {
  sourceNodeId: string;
  sourceDocumentPath: string;
  sourceFileName?: string;
  selectedText: string;
  sourceAnchor?: ClaimSourceAnchor;
  surroundingContext?: string;
  citationUrls?: string[];
};

export type ExtractClaimsInput = {
  sourceNodeId: string;
  sourceDocumentPath: string;
  sourceFileName?: string;
  configuredModelApiId?: string | null;
  maxCandidates?: number;
};

export type UpdateClaimInput = {
  claimText?: string;
  evidenceText?: string;
  status?: ClaimStatus;
};

export type CreateClaimCanvasNodeInput = {
  kind?: "document" | "reference" | "note";
};

export type ClaimCanvasNodeContentInput = Pick<
  ClaimCandidate,
  "claimText" | "evidenceText" | "sourceDocumentPath" | "status"
>;

export function isClaimStatus(value: unknown): value is ClaimStatus {
  return typeof value === "string" && (claimStatuses as readonly string[]).includes(value);
}

export function createClaimCanvasNodeContent(claim: ClaimCanvasNodeContentInput) {
  return [
    `Claim: ${claim.claimText}`,
    "",
    `Evidence: ${claim.evidenceText}`,
    "",
    `Source: ${claim.sourceDocumentPath}`,
    `Status: ${claim.status}`
  ].join("\n");
}
