import type { DatabaseSync } from "node:sqlite";
import type {
  ClaimCandidate,
  ClaimCreatedBy,
  ClaimSourceAnchor,
  ClaimStatus,
  CreateClaimFromSelectionInput,
  UpdateClaimInput
} from "../../shared/claimReview.js";
import { isClaimStatus } from "../../shared/claimReview.js";
import { cleanText, nowIso, parseJson, randomId, validateId } from "./storageRepositoryUtils.js";

type ClaimCandidateInput = Omit<CreateClaimFromSelectionInput, "selectedText" | "surroundingContext"> & {
  claimText: string;
  evidenceText: string;
  createdBy: ClaimCreatedBy;
  extractionRunId?: string;
};

type ClaimRow = {
  id: string;
  projectId: string;
  threadId: string;
  sourceNodeId: string;
  sourceDocumentPath: string;
  sourceFileName: string;
  claimText: string;
  originalClaimText: string | null;
  evidenceText: string;
  sourceAnchorJson: string;
  citationUrlsJson: string;
  status: ClaimStatus;
  createdBy: ClaimCreatedBy;
  extractionRunId: string | null;
  canvasNodeId: string | null;
  createdAt: string;
  updatedAt: string;
};

export class ClaimReviewRepository {
  constructor(
    readonly db: DatabaseSync,
    private readonly deps: {
      touchProject: (projectId: string, updatedAt?: string) => void;
    }
  ) {}

  listClaims(threadId: string, sourceNodeId?: string, sourceDocumentPath?: string) {
    validateId(threadId, "threadId");
    if (sourceNodeId) validateId(sourceNodeId, "sourceNodeId");
    const documentPath = cleanText(sourceDocumentPath ?? "");
    const filters = ["thread_id = ?"];
    const params: string[] = [threadId];
    if (sourceNodeId) {
      filters.push("source_node_id = ?");
      params.push(sourceNodeId);
    }
    if (documentPath) {
      filters.push("source_document_path = ?");
      params.push(documentPath);
    }
    const rows = this.db.prepare(
      `SELECT id,
              project_id as projectId,
              thread_id as threadId,
              source_node_id as sourceNodeId,
              source_document_path as sourceDocumentPath,
              source_file_name as sourceFileName,
              claim_text as claimText,
              original_claim_text as originalClaimText,
              evidence_text as evidenceText,
              source_anchor_json as sourceAnchorJson,
              citation_urls_json as citationUrlsJson,
              status,
              created_by as createdBy,
              extraction_run_id as extractionRunId,
              canvas_node_id as canvasNodeId,
              created_at as createdAt,
              updated_at as updatedAt
       FROM claim_candidates
       WHERE ${filters.join(" AND ")}
       ORDER BY created_at DESC`
    ).all(...params) as ClaimRow[];
    return rows.map(toClaimCandidate);
  }

  createClaim(projectId: string, threadId: string, input: ClaimCandidateInput) {
    validateId(projectId, "projectId");
    validateId(threadId, "threadId");
    validateId(input.sourceNodeId, "sourceNodeId");
    const claimText = cleanText(input.claimText);
    const evidenceText = cleanText(input.evidenceText);
    if (!claimText) throw new Error("Claim text is required");
    if (!evidenceText) throw new Error("Claim evidence is required");
    const now = nowIso();
    const claim: ClaimCandidate = {
      id: randomId("claim"),
      projectId,
      threadId,
      sourceNodeId: input.sourceNodeId,
      sourceDocumentPath: cleanText(input.sourceDocumentPath),
      sourceFileName: cleanText(input.sourceFileName) || fileNameFromPath(input.sourceDocumentPath),
      claimText,
      evidenceText,
      sourceAnchor: cleanSourceAnchor(input.sourceAnchor),
      citationUrls: cleanCitationUrls(input.citationUrls),
      status: "pending_review",
      createdBy: input.createdBy,
      extractionRunId: cleanText(input.extractionRunId) || undefined,
      createdAt: now,
      updatedAt: now
    };
    if (!claim.sourceDocumentPath) throw new Error("Source document path is required");

    this.db.prepare(
      `INSERT INTO claim_candidates
        (id, project_id, thread_id, source_node_id, source_document_path, source_file_name,
         claim_text, original_claim_text, evidence_text, source_anchor_json, citation_urls_json,
         status, created_by, extraction_run_id, canvas_node_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    ).run(
      claim.id,
      claim.projectId,
      claim.threadId,
      claim.sourceNodeId,
      claim.sourceDocumentPath,
      claim.sourceFileName,
      claim.claimText,
      claim.evidenceText,
      JSON.stringify(claim.sourceAnchor ?? {}),
      JSON.stringify(claim.citationUrls),
      claim.status,
      claim.createdBy,
      claim.extractionRunId ?? null,
      now,
      now
    );
    this.deps.touchProject(projectId, now);
    return claim;
  }

  updateClaim(threadId: string, claimId: string, input: UpdateClaimInput) {
    validateId(threadId, "threadId");
    validateId(claimId, "claimId");
    const existing = this.getClaim(threadId, claimId);
    if (!existing) return undefined;
    const nextClaimText = input.claimText === undefined ? existing.claimText : cleanText(input.claimText);
    const nextEvidenceText = input.evidenceText === undefined ? existing.evidenceText : cleanText(input.evidenceText);
    if (!nextClaimText) throw new Error("Claim text is required");
    if (!nextEvidenceText) throw new Error("Claim evidence is required");
    const textChanged = nextClaimText !== existing.claimText;
    const status = input.status === undefined
      ? textChanged ? "edited" : existing.status
      : readClaimStatus(input.status);
    const originalClaimText = existing.originalClaimText ?? (textChanged ? existing.claimText : undefined);
    const now = nowIso();
    this.db.prepare(
      `UPDATE claim_candidates
       SET claim_text = ?, original_claim_text = ?, evidence_text = ?, status = ?, updated_at = ?
       WHERE id = ? AND thread_id = ?`
    ).run(nextClaimText, originalClaimText ?? null, nextEvidenceText, status, now, claimId, threadId);
    this.deps.touchProject(existing.projectId, now);
    return this.getClaim(threadId, claimId);
  }

  setClaimCanvasNode(threadId: string, claimId: string, canvasNodeId: string) {
    validateId(threadId, "threadId");
    validateId(claimId, "claimId");
    validateId(canvasNodeId, "canvasNodeId");
    const existing = this.getClaim(threadId, claimId);
    if (!existing) return undefined;
    const now = nowIso();
    this.db.prepare(
      `UPDATE claim_candidates SET canvas_node_id = ?, updated_at = ? WHERE id = ? AND thread_id = ?`
    ).run(canvasNodeId, now, claimId, threadId);
    this.deps.touchProject(existing.projectId, now);
    return this.getClaim(threadId, claimId);
  }

  deleteClaim(threadId: string, claimId: string) {
    validateId(threadId, "threadId");
    validateId(claimId, "claimId");
    const existing = this.getClaim(threadId, claimId);
    if (!existing) return false;
    const result = this.db.prepare(`DELETE FROM claim_candidates WHERE id = ? AND thread_id = ?`).run(claimId, threadId);
    if (result.changes > 0) this.deps.touchProject(existing.projectId);
    return result.changes > 0;
  }

  getClaim(threadId: string, claimId: string) {
    return this.listClaims(threadId).find((claim) => claim.id === claimId);
  }
}

function toClaimCandidate(row: ClaimRow): ClaimCandidate {
  const sourceAnchor = cleanSourceAnchor(parseJson(row.sourceAnchorJson));
  return {
    id: row.id,
    projectId: row.projectId,
    threadId: row.threadId,
    sourceNodeId: row.sourceNodeId,
    sourceDocumentPath: row.sourceDocumentPath,
    sourceFileName: row.sourceFileName,
    claimText: row.claimText,
    originalClaimText: row.originalClaimText ?? undefined,
    evidenceText: row.evidenceText,
    sourceAnchor,
    citationUrls: cleanCitationUrls(parseJson(row.citationUrlsJson)),
    status: readClaimStatus(row.status),
    createdBy: row.createdBy === "user_selection" ? "user_selection" : "ai",
    extractionRunId: row.extractionRunId ?? undefined,
    canvasNodeId: row.canvasNodeId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function cleanSourceAnchor(value: unknown): ClaimSourceAnchor | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const anchor: ClaimSourceAnchor = {};
  if (typeof record.startOffset === "number" && Number.isInteger(record.startOffset) && record.startOffset >= 0) anchor.startOffset = record.startOffset;
  if (typeof record.endOffset === "number" && Number.isInteger(record.endOffset) && record.endOffset >= 0) anchor.endOffset = record.endOffset;
  if (Array.isArray(record.headingPath)) anchor.headingPath = record.headingPath.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  if (typeof record.textFingerprint === "string" && record.textFingerprint.trim()) anchor.textFingerprint = record.textFingerprint.trim().slice(0, 120);
  return Object.keys(anchor).length ? anchor : undefined;
}

function cleanCitationUrls(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && /^https?:\/\//i.test(item.trim())).map((item) => item.trim()).slice(0, 8))]
    : [];
}

function readClaimStatus(value: unknown): ClaimStatus {
  if (isClaimStatus(value)) return value;
  throw new Error("Invalid Claim status");
}

function fileNameFromPath(path: string) {
  return cleanText(path).split("/").filter(Boolean).at(-1) ?? "document.md";
}
