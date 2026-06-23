import type { CanvasWriteRequest } from "../../agents/types";
import { useI18n } from "../../i18n/I18nProvider";
import type { Locale } from "../../i18n/types";

export type MessageAnnotation = {
  id: string;
  messageId: string;
  text: string;
};

type AnnotationChipRowProps = {
  annotations: MessageAnnotation[];
  compact?: boolean;
  onRemoveAnnotation: (id: string) => void;
};

type CanvasWriteProposalPanelProps = {
  annotations: MessageAnnotation[];
  busy: boolean;
  fullText: string;
  request?: CanvasWriteRequest;
  onApplyAll: () => Promise<void>;
  onApplyDefault: () => Promise<void>;
  onCancel: () => Promise<void>;
  onRemoveAnnotation: (id: string) => void;
};

export function AnnotationChipRow({ annotations, compact = false, onRemoveAnnotation }: AnnotationChipRowProps) {
  const { t } = useI18n();
  if (!annotations.length) return null;

  return (
    <div className={compact ? "annotation-chip-row annotation-chip-row-compact" : "annotation-chip-row"} aria-label={t("workspace.annotatedSnippets")}>
      {compact ? (
        <span className="annotation-chip-summary">
          {t("workspace.annotationSummary", { count: annotations.length })}
        </span>
      ) : null}
      {annotations.map((annotation, index) => (
        <button className="annotation-chip" key={annotation.id} type="button" onClick={() => onRemoveAnnotation(annotation.id)} title={t("workspace.removeAnnotation")}>
          {t("workspace.snippetLabel", { index: index + 1, count: annotation.text.length })}
          <span aria-hidden="true">x</span>
        </button>
      ))}
    </div>
  );
}

export function CanvasWriteProposalPanel({
  annotations,
  busy,
  fullText,
  request,
  onApplyAll,
  onApplyDefault,
  onCancel,
  onRemoveAnnotation
}: CanvasWriteProposalPanelProps) {
  const { locale, t } = useI18n();
  const operation = request ? operationLabel(request.operation, locale) : operationLabel("create", locale);
  const kind = request ? kindLabel(request.nodeKind, locale) : kindLabel("document", locale);
  const title = request?.title || t("workspace.aiResponse");
  const defaultLabel = annotations.length ? t("workspace.writeSnippets") : t("workspace.writeAll");
  const previewText = annotations.length ? annotations.map((annotation) => annotation.text).join("\n\n") : fullText;

  return (
    <article className="canvas-write-card canvas-write-proposal">
      <div className="canvas-write-card-header">
        <span>{t("canvasWrite.proposal")}</span>
        <b>{operation} / {kind}</b>
      </div>
      <h3>{title}</h3>
      <p className="canvas-write-rationale">
        {annotations.length
          ? t("workspace.annotatedDefault")
          : (request?.rationale || t("workspace.confirmCanvasWrite"))}
      </p>
      <AnnotationChipRow annotations={annotations} onRemoveAnnotation={onRemoveAnnotation} />
      <pre>{previewText}</pre>
      <div className="canvas-write-actions">
        <button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => void onCancel()}>
          {t("common.cancel")}
        </button>
        {annotations.length ? (
          <button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => void onApplyAll()}>
            {t("workspace.writeAll")}
          </button>
        ) : null}
        <button className="button button-primary button-small" type="button" disabled={busy} onClick={() => void onApplyDefault()}>
          {busy ? t("workspace.writing") : defaultLabel}
        </button>
      </div>
    </article>
  );
}

function operationLabel(operation: CanvasWriteRequest["operation"], locale: Locale) {
  if (operation === "replace_range") return locale === "zh" ? "局部替换" : "replace_range";
  return {
    create: locale === "zh" ? "创建" : "create",
    replace: locale === "zh" ? "替换" : "replace",
    append: locale === "zh" ? "追加" : "append"
  }[operation];
}

function kindLabel(kind: CanvasWriteRequest["nodeKind"], locale: Locale) {
  if (kind === "role") return "Role";
  if (kind === "file_document") return locale === "zh" ? "文档文件" : "document file";
  if (kind === "plan") return locale === "zh" ? "计划" : "plan";
  if (kind === "clarification") return locale === "zh" ? "澄清确认" : "clarification";
  return {
    document: locale === "zh" ? "文档" : "document",
    note: locale === "zh" ? "便签" : "note",
    reference: locale === "zh" ? "引用卡" : "reference"
  }[kind];
}
