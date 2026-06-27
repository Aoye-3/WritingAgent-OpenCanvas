import type {
  ClaimCandidate,
  CreateClaimCanvasNodeInput,
  CreateClaimFromSelectionInput,
  ExtractClaimsInput,
  UpdateClaimInput
} from "../../../../shared/claimReview";
import type { CanvasNode } from "../../agents/types";
import { apiGet, apiPatch, apiPost } from "../../../shared/apiClient";

export async function fetchClaims(threadId: string, sourceNodeId?: string): Promise<ClaimCandidate[]> {
  const suffix = sourceNodeId ? `?sourceNodeId=${encodeURIComponent(sourceNodeId)}` : "";
  const payload = await apiGet<{ claims: ClaimCandidate[] }>(`/api/threads/${encodeURIComponent(threadId)}/claims${suffix}`);
  return payload.claims;
}

export async function createClaimFromSelection(threadId: string, input: CreateClaimFromSelectionInput): Promise<ClaimCandidate> {
  const payload = await apiPost<{ claim: ClaimCandidate }>(`/api/threads/${encodeURIComponent(threadId)}/claims/from-selection`, input);
  return payload.claim;
}

export async function extractClaims(threadId: string, input: ExtractClaimsInput): Promise<ClaimCandidate[]> {
  const payload = await apiPost<{ claims: ClaimCandidate[] }>(`/api/threads/${encodeURIComponent(threadId)}/claims/extract`, input);
  return payload.claims;
}

export async function updateClaim(threadId: string, claimId: string, input: UpdateClaimInput): Promise<ClaimCandidate> {
  const payload = await apiPatch<{ claim: ClaimCandidate }>(`/api/threads/${encodeURIComponent(threadId)}/claims/${encodeURIComponent(claimId)}`, input);
  return payload.claim;
}

export async function createClaimCanvasNode(threadId: string, claimId: string, input: CreateClaimCanvasNodeInput = {}): Promise<{ claim: ClaimCandidate; node: CanvasNode }> {
  return apiPost<{ claim: ClaimCandidate; node: CanvasNode }>(`/api/threads/${encodeURIComponent(threadId)}/claims/${encodeURIComponent(claimId)}/create-node`, input);
}
