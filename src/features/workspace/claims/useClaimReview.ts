import { useCallback, useMemo, useState } from "react";
import type { ClaimCandidate, ClaimStatus, CreateClaimFromSelectionInput } from "../../../../shared/claimReview";
import { claimSummaryTitle, createClaimCanvasNodeContent } from "../../../../shared/claimReview";
import type { CanvasNodeDraft } from "../../canvas/canvasClient";
import { createClaimFromSelection, deleteClaim, extractClaims, fetchClaims, updateClaim } from "./claimReviewClient";

export type ClaimReviewDocument = {
  sourceNodeId: string;
  threadId: string;
  path: string;
  fileName: string;
  content: string;
};

type UseClaimReviewOptions = {
  threadId: string;
  selectedModelConfigId?: string | null;
  onCreateCanvasNode: (draft: CanvasNodeDraft) => Promise<unknown>;
  onSendToChat: (text: string) => void;
};

export function useClaimReview({
  threadId,
  selectedModelConfigId,
  onCreateCanvasNode,
  onSendToChat
}: UseClaimReviewOptions) {
  const [activeDocument, setActiveDocument] = useState<ClaimReviewDocument | null>(null);
  const [claims, setClaims] = useState<ClaimCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState("");
  const [sourceFocusClaim, setSourceFocusClaim] = useState<ClaimCandidate | null>(null);

  const acceptedClaims = useMemo(() => getAcceptedClaims(claims), [claims]);

  const loadClaims = useCallback(async (sourceNodeId?: string, sourceDocumentPath?: string, documentThreadId = threadId) => {
    setLoading(true);
    setError("");
    try {
      const nextClaims = await fetchClaims(documentThreadId, sourceNodeId, sourceDocumentPath);
      setClaims(nextClaims);
      return nextClaims;
    } catch (err) {
      setError(errorMessage(err, "Unable to load Claims"));
      return [];
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  const activateDocument = useCallback((document: ClaimReviewDocument | null) => {
    setActiveDocument(document);
    setSourceFocusClaim(null);
    setClaims([]);
    if (document) void loadClaims(document.sourceNodeId, document.path, document.threadId);
  }, [loadClaims]);

  const createFromSelection = useCallback(async (input: Omit<CreateClaimFromSelectionInput, "sourceNodeId" | "sourceDocumentPath" | "sourceFileName">) => {
    if (!activeDocument) return undefined;
    setError("");
    try {
      const claim = await createClaimFromSelection(activeDocument.threadId, {
        ...input,
        sourceNodeId: activeDocument.sourceNodeId,
        sourceDocumentPath: activeDocument.path,
        sourceFileName: activeDocument.fileName
      });
      setClaims((current) => [claim, ...current.filter((item) => item.id !== claim.id)]);
      return claim;
    } catch (err) {
      setError(errorMessage(err, "Unable to create Claim"));
      return undefined;
    }
  }, [activeDocument]);

  const extractActiveDocumentClaims = useCallback(async () => {
    if (!activeDocument) return [];
    setExtracting(true);
    setError("");
    try {
      const nextClaims = await extractClaims(activeDocument.threadId, {
        sourceNodeId: activeDocument.sourceNodeId,
        sourceDocumentPath: activeDocument.path,
        sourceFileName: activeDocument.fileName,
        configuredModelApiId: selectedModelConfigId,
        maxCandidates: 12
      });
      setClaims((current) => mergeClaims(current, nextClaims));
      return nextClaims;
    } catch (err) {
      setError(errorMessage(err, "Unable to extract Claims"));
      return [];
    } finally {
      setExtracting(false);
    }
  }, [activeDocument, selectedModelConfigId]);

  const setClaimStatus = useCallback(async (claim: ClaimCandidate, status: ClaimStatus) => {
    const updated = await updateClaim(claim.threadId, claim.id, { status });
    setClaims((current) => current.map((item) => item.id === updated.id ? updated : item));
    return updated;
  }, []);

  const editClaim = useCallback(async (claim: ClaimCandidate, claimText: string) => {
    const updated = await updateClaim(claim.threadId, claim.id, { claimText });
    setClaims((current) => current.map((item) => item.id === updated.id ? updated : item));
    return updated;
  }, []);

  const createNodeFromClaim = useCallback(async (claim: ClaimCandidate) => {
    await onCreateCanvasNode(claimNodeDraft(claim, titleForClaim(claim, claims)));
  }, [claims, onCreateCanvasNode]);

  const createNodesFromClaims = useCallback(async (selectedClaims: ClaimCandidate[]) => {
    for (const claim of selectedClaims) {
      await onCreateCanvasNode(claimNodeDraft(claim, titleForClaim(claim, claims)));
    }
  }, [claims, onCreateCanvasNode]);

  const createNodesFromAccepted = useCallback(async () => {
    for (const claim of acceptedClaims) {
      await onCreateCanvasNode(claimNodeDraft(claim, titleForClaim(claim, claims)));
    }
  }, [acceptedClaims, claims, onCreateCanvasNode]);

  const deleteClaimCandidate = useCallback(async (claim: ClaimCandidate) => {
    await deleteClaim(claim.threadId, claim.id);
    setClaims((current) => current.filter((item) => item.id !== claim.id));
  }, []);

  const deleteClaimCandidates = useCallback(async (selectedClaims: ClaimCandidate[]) => {
    for (const claim of selectedClaims) {
      await deleteClaim(claim.threadId, claim.id);
    }
    const deletedIds = new Set(selectedClaims.map((claim) => claim.id));
    setClaims((current) => current.filter((claim) => !deletedIds.has(claim.id)));
  }, []);

  const sendClaimsToChat = useCallback((selected: ClaimCandidate[]) => {
    if (!selected.length) return;
    onSendToChat(selected.map(formatClaimForChat).join("\n\n---\n\n"));
  }, [onSendToChat]);

  return {
    acceptedClaims,
    activeDocument,
    claims,
    error,
    extracting,
    loading,
    sourceFocusClaim,
    activateDocument,
    createFromSelection,
    createNodeFromClaim,
    createNodesFromClaims,
    createNodesFromAccepted,
    deleteClaimCandidate,
    deleteClaimCandidates,
    editClaim,
    extractActiveDocumentClaims,
    loadClaims,
    sendClaimsToChat,
    setClaimStatus,
    setSourceFocusClaim
  };
}

function mergeClaims(current: ClaimCandidate[], incoming: ClaimCandidate[]) {
  const seen = new Set(incoming.map((claim) => claim.id));
  return [...incoming, ...current.filter((claim) => !seen.has(claim.id))];
}

export function getAcceptedClaims(claims: ClaimCandidate[]) {
  return claims.filter((claim) => claim.status === "accepted");
}

export function claimNodeDraft(claim: ClaimCandidate, title = claimSummaryTitle(1)): CanvasNodeDraft {
  return {
    kind: "document",
    title,
    content: createClaimCanvasNodeContent(claim),
    width: 360,
    height: 240,
    metadata: {
      claimReview: {
        claimId: claim.id,
        sourceNodeId: claim.sourceNodeId,
        sourceDocumentPath: claim.sourceDocumentPath,
        sourceAnchor: claim.sourceAnchor
      }
    },
    includeInProjectContext: true
  };
}

function titleForClaim(claim: ClaimCandidate, claims: ClaimCandidate[]) {
  const index = claims.findIndex((item) => item.id === claim.id);
  return claimSummaryTitle(index + 1);
}

export function formatClaimForChat(claim: ClaimCandidate) {
  return [
    `Claim: ${claim.claimText}`,
    `Evidence: ${claim.evidenceText}`,
    `Source: ${claim.sourceDocumentPath}`,
    `Status: ${claim.status}`
  ].join("\n");
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
