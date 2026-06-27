import { useMemo, useState } from "react";
import type { ClaimCandidate, ClaimStatus } from "../../../../shared/claimReview";

type ClaimReviewPanelProps = {
  claims: ClaimCandidate[];
  activeDocumentFileName?: string;
  error: string;
  extracting: boolean;
  loading: boolean;
  locale: "en" | "zh";
  onAccept: (claim: ClaimCandidate) => Promise<unknown>;
  onCreateNode: (claim: ClaimCandidate) => Promise<unknown>;
  onCreateNodesFromAccepted: () => Promise<unknown>;
  onEdit: (claim: ClaimCandidate, claimText: string) => Promise<unknown>;
  onExtract: () => Promise<unknown>;
  onReject: (claim: ClaimCandidate) => Promise<unknown>;
  onSendToChat: (claims: ClaimCandidate[]) => void;
  onSetStatus: (claim: ClaimCandidate, status: ClaimStatus) => Promise<unknown>;
  onShowSource: (claim: ClaimCandidate) => void;
};

export function ClaimReviewPanel({
  claims,
  activeDocumentFileName,
  error,
  extracting,
  loading,
  locale,
  onAccept,
  onCreateNode,
  onCreateNodesFromAccepted,
  onEdit,
  onExtract,
  onReject,
  onSendToChat,
  onSetStatus,
  onShowSource
}: ClaimReviewPanelProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const acceptedCount = claims.filter((claim) => claim.status === "accepted").length;
  const selectedClaims = useMemo(() => claims.filter((claim) => selectedIds.has(claim.id)), [claims, selectedIds]);
  const copy = claimCopy(locale);

  const toggleSelected = (claimId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(claimId)) next.delete(claimId);
      else next.add(claimId);
      return next;
    });
  };

  return (
    <section className="claim-review-panel" aria-label={copy.panelLabel}>
      <header className="claim-review-header">
        <div>
          <strong>{copy.title}</strong>
          <span>{activeDocumentFileName ? `${activeDocumentFileName} · ${claims.length}` : copy.noDocument}</span>
        </div>
        <button className="button button-secondary button-small" type="button" disabled={!activeDocumentFileName || extracting} onClick={() => void onExtract()}>
          {extracting ? copy.extracting : copy.extract}
        </button>
      </header>

      <div className="claim-review-batch">
        <button className="button button-secondary button-small" type="button" disabled={!selectedClaims.length} onClick={() => void Promise.all(selectedClaims.map((claim) => onAccept(claim)))}>
          {copy.acceptSelected}
        </button>
        <button className="button button-secondary button-small" type="button" disabled={!selectedClaims.length} onClick={() => void Promise.all(selectedClaims.map((claim) => onReject(claim)))}>
          {copy.rejectSelected}
        </button>
        <button className="button button-secondary button-small" type="button" disabled={!acceptedCount} onClick={() => void onCreateNodesFromAccepted()}>
          {copy.createAccepted}
        </button>
        <button className="button button-secondary button-small" type="button" disabled={!selectedClaims.length} onClick={() => onSendToChat(selectedClaims)}>
          {copy.sendSelected}
        </button>
      </div>

      {error ? <p className="claim-review-error">{error}</p> : null}
      {loading ? <p className="claim-review-empty">{copy.loading}</p> : null}
      {!loading && !claims.length ? <p className="claim-review-empty">{copy.empty}</p> : null}

      <div className="claim-review-list">
        {claims.map((claim) => {
          const editing = editingId === claim.id;
          return (
            <article className="claim-review-item" data-status={claim.status} key={claim.id}>
              <label className="claim-review-select">
                <input checked={selectedIds.has(claim.id)} onChange={() => toggleSelected(claim.id)} type="checkbox" />
                <span>{statusLabel(claim.status, locale)}</span>
              </label>
              {editing ? (
                <textarea className="claim-review-edit" value={editText} onChange={(event) => setEditText(event.target.value)} />
              ) : (
                <p className="claim-review-text">{claim.claimText}</p>
              )}
              <blockquote>{claim.evidenceText}</blockquote>
              <span className="claim-review-source">{claim.sourceFileName || claim.sourceDocumentPath}</span>
              <div className="claim-review-actions">
                {editing ? (
                  <>
                    <button className="button button-primary button-small" type="button" onClick={() => void onEdit(claim, editText).then(() => setEditingId(null))}>{copy.save}</button>
                    <button className="button button-secondary button-small" type="button" onClick={() => setEditingId(null)}>{copy.cancel}</button>
                  </>
                ) : (
                  <>
                    <button className="button button-secondary button-small" type="button" onClick={() => void onAccept(claim)}>{copy.accept}</button>
                    <button className="button button-secondary button-small" type="button" onClick={() => void onReject(claim)}>{copy.reject}</button>
                    <button className="button button-secondary button-small" type="button" onClick={() => void onSetStatus(claim, "needs_more_evidence")}>{copy.needsEvidence}</button>
                    <button className="button button-secondary button-small" type="button" onClick={() => {
                      setEditingId(claim.id);
                      setEditText(claim.claimText);
                    }}>{copy.edit}</button>
                    <button className="button button-secondary button-small" type="button" onClick={() => onShowSource(claim)}>{copy.showSource}</button>
                    <button className="button button-secondary button-small" type="button" disabled={claim.status !== "accepted"} onClick={() => void onCreateNode(claim)}>{copy.createNode}</button>
                    <button className="button button-secondary button-small" type="button" onClick={() => onSendToChat([claim])}>{copy.send}</button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function statusLabel(status: ClaimStatus, locale: "en" | "zh") {
  const labels = {
    pending_review: { en: "Pending", zh: "待审查" },
    accepted: { en: "Accepted", zh: "已接受" },
    rejected: { en: "Rejected", zh: "已拒绝" },
    needs_more_evidence: { en: "Needs evidence", zh: "需要证据" },
    edited: { en: "Edited", zh: "已编辑" }
  } as const;
  return labels[status][locale];
}

function claimCopy(locale: "en" | "zh") {
  if (locale === "zh") {
    return {
      accept: "接受",
      acceptSelected: "接受所选",
      cancel: "取消",
      createAccepted: "从已接受创建节点",
      createNode: "创建节点",
      edit: "编辑",
      empty: "打开 Markdown 预览后抽取 Claim，或选择文本创建候选 Claim。",
      extract: "抽取 Claims",
      extracting: "抽取中",
      loading: "正在加载 Claims...",
      needsEvidence: "需要证据",
      noDocument: "未打开 Markdown 预览",
      panelLabel: "Claim 审查队列",
      reject: "拒绝",
      rejectSelected: "拒绝所选",
      save: "保存",
      send: "发送到聊天",
      sendSelected: "发送所选",
      showSource: "定位原文",
      title: "Claims"
    };
  }
  return {
    accept: "Accept",
    acceptSelected: "Accept selected",
    cancel: "Cancel",
    createAccepted: "Create nodes from accepted",
    createNode: "Create node",
    edit: "Edit",
    empty: "Open a Markdown preview, then extract Claims or select text to create a candidate.",
    extract: "Extract Claims",
    extracting: "Extracting",
    loading: "Loading Claims...",
    needsEvidence: "Needs evidence",
    noDocument: "No Markdown preview open",
    panelLabel: "Claim review queue",
    reject: "Reject",
    rejectSelected: "Reject selected",
    save: "Save",
    send: "Send to chat",
    sendSelected: "Send selected",
    showSource: "Show source",
    title: "Claims"
  };
}
