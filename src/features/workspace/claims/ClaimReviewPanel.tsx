import { useMemo, useState } from "react";
import { ChevronRightIcon, SearchIcon } from "../../../shared/icons";
import type { ClaimCandidate } from "../../../../shared/claimReview";
import { claimSummaryTitle } from "../../../../shared/claimReview";

type ClaimReviewPanelProps = {
  claims: ClaimCandidate[];
  activeDocumentFileName?: string;
  error: string;
  extracting: boolean;
  loading: boolean;
  locale: "en" | "zh";
  onCreateNode: (claim: ClaimCandidate) => Promise<unknown>;
  onCreateSelected: (claims: ClaimCandidate[]) => Promise<unknown>;
  onDelete: (claim: ClaimCandidate) => Promise<unknown>;
  onDeleteSelected: (claims: ClaimCandidate[]) => Promise<unknown>;
  onEdit: (claim: ClaimCandidate, claimText: string) => Promise<unknown>;
  onExtract: () => Promise<unknown>;
  onSendToChat: (claims: ClaimCandidate[]) => void;
  onShowSource: (claim: ClaimCandidate) => void;
};

export function ClaimReviewPanel({
  claims,
  activeDocumentFileName,
  error,
  extracting,
  loading,
  locale,
  onCreateNode,
  onCreateSelected,
  onDelete,
  onDeleteSelected,
  onEdit,
  onExtract,
  onSendToChat,
  onShowSource
}: ClaimReviewPanelProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
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

  const toggleExpanded = (claimId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(claimId)) next.delete(claimId);
      else next.add(claimId);
      return next;
    });
  };

  const beginEditing = (claim: ClaimCandidate) => {
    setEditingId(claim.id);
    setEditText(claim.claimText);
    setExpandedIds((current) => new Set(current).add(claim.id));
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
        <span>{copy.selectedCount(selectedClaims.length)}</span>
        <button className="button button-secondary button-small" type="button" disabled={!selectedClaims.length} onClick={() => void onCreateSelected(selectedClaims)}>
          {copy.createSelected}
        </button>
        <button className="button button-secondary button-small" type="button" disabled={!selectedClaims.length} onClick={() => void onDeleteSelected(selectedClaims).then(() => setSelectedIds(new Set()))}>
          {copy.deleteSelected}
        </button>
      </div>

      {error ? <p className="claim-review-error">{error}</p> : null}
      {loading ? <p className="claim-review-empty">{copy.loading}</p> : null}
      {!loading && !claims.length ? <p className="claim-review-empty">{copy.empty}</p> : null}

      <div className="claim-review-list">
        {claims.map((claim, index) => {
          const editing = editingId === claim.id;
          const expanded = expandedIds.has(claim.id) || editing;
          const detailId = `claim-review-detail-${claim.id}`;
          const summaryTitle = claimSummaryTitle(index + 1);
          const sourceLabel = claim.sourceFileName || claim.sourceDocumentPath;
          return (
            <article className="claim-review-item" data-expanded={expanded} data-status={claim.status} key={claim.id}>
              <div className="claim-review-item-summary">
                <label className="claim-review-select">
                  <input aria-label={copy.selectSummary(summaryTitle)} checked={selectedIds.has(claim.id)} onChange={() => toggleSelected(claim.id)} type="checkbox" />
                </label>
                <button
                  aria-controls={detailId}
                  aria-expanded={expanded}
                  className="claim-review-expand"
                  type="button"
                  onClick={() => toggleExpanded(claim.id)}
                >
                  <span className="claim-review-title">{summaryTitle}</span>
                  <span className="claim-review-preview">{claim.claimText}</span>
                  <span className="claim-review-meta">
                    {sourceLabel ? <span>{sourceLabel}</span> : null}
                  </span>
                  <ChevronRightIcon aria-hidden="true" className="claim-review-chevron" size={16} />
                </button>
                <button className="claim-review-source-action" type="button" title={copy.showSource} onClick={() => onShowSource(claim)}>
                  <SearchIcon aria-hidden="true" size={14} />
                  <span>{copy.showSource}</span>
                </button>
              </div>
              {expanded ? (
                <div className="claim-review-item-body" id={detailId}>
                  {editing ? (
                    <textarea className="claim-review-edit" value={editText} onChange={(event) => setEditText(event.target.value)} />
                  ) : (
                    <p className="claim-review-text">{claim.claimText}</p>
                  )}
                  <span className="claim-review-source">{sourceLabel}</span>
                  <div className="claim-review-actions">
                    {editing ? (
                      <>
                        <button className="button button-primary button-small" type="button" onClick={() => void onEdit(claim, editText).then(() => setEditingId(null))}>{copy.save}</button>
                        <button className="button button-secondary button-small" type="button" onClick={() => setEditingId(null)}>{copy.cancel}</button>
                      </>
                    ) : (
                      <>
                        <button className="button button-secondary button-small" type="button" onClick={() => beginEditing(claim)}>{copy.edit}</button>
                        <button className="button button-secondary button-small" type="button" onClick={() => void onCreateNode(claim)}>{copy.createNode}</button>
                        <button className="button button-secondary button-small" type="button" onClick={() => void onDelete(claim).then(() => setSelectedIds((current) => {
                          const next = new Set(current);
                          next.delete(claim.id);
                          return next;
                        }))}>{copy.deleteClaim}</button>
                        <button className="button button-secondary button-small" type="button" onClick={() => onSendToChat([claim])}>{copy.send}</button>
                      </>
                    )}
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function claimCopy(locale: "en" | "zh") {
  if (locale === "zh") {
    return {
      cancel: "取消",
      createNode: "创建节点",
      createSelected: "创建所选",
      deleteClaim: "删除",
      deleteSelected: "删除所选",
      edit: "编辑",
      empty: "打开 Markdown 预览后抽取 Claim，或选择文本创建候选 Claim。",
      extract: "抽取 Claims",
      extracting: "抽取中",
      loading: "正在加载 Claims...",
      noDocument: "未打开 Markdown 预览",
      panelLabel: "Claim 审查队列",
      save: "保存",
      send: "发送到聊天",
      selectSummary: (title: string) => `选择 ${title}`,
      selectedCount: (count: number) => `已选择 ${count} 条`,
      showSource: "定位原文",
      title: "Claims"
    };
  }
  return {
    cancel: "Cancel",
    createNode: "Create node",
    createSelected: "Create selected",
    deleteClaim: "Delete",
    deleteSelected: "Delete selected",
    edit: "Edit",
    empty: "Open a Markdown preview, then extract Claims or select text to create a candidate.",
    extract: "Extract Claims",
    extracting: "Extracting",
    loading: "Loading Claims...",
    noDocument: "No Markdown preview open",
    panelLabel: "Claim review queue",
    save: "Save",
    send: "Send to chat",
    selectSummary: (title: string) => `Select ${title}`,
    selectedCount: (count: number) => `${count} selected`,
    showSource: "Show source",
    title: "Claims"
  };
}
