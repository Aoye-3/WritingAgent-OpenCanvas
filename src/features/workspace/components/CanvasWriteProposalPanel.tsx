import type { CanvasWriteRequest } from "../../agents/types";
import { useI18n } from "../../i18n/I18nProvider";

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
  const { locale } = useI18n();
  if (!annotations.length) return null;

  return (
    <div className={compact ? "annotation-chip-row annotation-chip-row-compact" : "annotation-chip-row"} aria-label={locale === "zh" ? "批注片段" : "Annotated snippets"}>
      {compact ? (
        <span className="annotation-chip-summary">
          {locale === "zh" ? `已批注 ${annotations.length} 个片段` : `${annotations.length} annotated snippet${annotations.length > 1 ? "s" : ""}`}
        </span>
      ) : null}
      {annotations.map((annotation, index) => (
        <button className="annotation-chip" key={annotation.id} type="button" onClick={() => onRemoveAnnotation(annotation.id)} title={locale === "zh" ? "点击移除批注" : "Remove annotation"}>
          {locale === "zh" ? `片段 ${index + 1} · ${annotation.text.length} 字` : `Snippet ${index + 1} · ${annotation.text.length} chars`}
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
  const { locale } = useI18n();
  const operation = request ? operationLabel(request.operation, locale) : operationLabel("create", locale);
  const kind = request ? kindLabel(request.nodeKind, locale) : kindLabel("document", locale);
  const title = request?.title || (locale === "zh" ? "AI 回复" : "AI response");
  const defaultLabel = annotations.length ? (locale === "zh" ? "仅写入批注片段" : "Write snippets") : (locale === "zh" ? "写入全部" : "Write all");
  const previewText = annotations.length ? annotations.map((annotation) => annotation.text).join("\n\n") : fullText;

  return (
    <article className="canvas-write-card canvas-write-proposal">
      <div className="canvas-write-card-header">
        <span>{locale === "zh" ? "Canvas 写入建议" : "Canvas write proposal"}</span>
        <b>{operation} / {kind}</b>
      </div>
      <h3>{title}</h3>
      <p className="canvas-write-rationale">
        {annotations.length
          ? (locale === "zh" ? "默认写入已批注片段，可改为写入完整回复。" : "Annotated snippets are selected by default; full response is still available.")
          : (request?.rationale || (locale === "zh" ? "确认后会直接写入 Canvas。" : "Confirm to write directly to Canvas."))}
      </p>
      <AnnotationChipRow annotations={annotations} onRemoveAnnotation={onRemoveAnnotation} />
      <pre>{previewText}</pre>
      <div className="canvas-write-actions">
        <button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => void onCancel()}>
          {locale === "zh" ? "取消" : "Cancel"}
        </button>
        {annotations.length ? (
          <button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => void onApplyAll()}>
            {locale === "zh" ? "写入全部" : "Write all"}
          </button>
        ) : null}
        <button className="button button-primary button-small" type="button" disabled={busy} onClick={() => void onApplyDefault()}>
          {busy ? (locale === "zh" ? "写入中" : "Writing") : defaultLabel}
        </button>
      </div>
    </article>
  );
}

function operationLabel(operation: CanvasWriteRequest["operation"], locale: "en" | "zh") {
  if (locale !== "zh") return operation;
  if (operation === "replace_range") return "局部替换";
  return { create: "创建", replace: "替换", append: "追加" }[operation];
}

function kindLabel(kind: CanvasWriteRequest["nodeKind"], locale: "en" | "zh") {
  if (locale !== "zh") return kind;
  if (kind === "role") return "Role";
  if (kind === "plan") return "计划";
  return { document: "文档", note: "便签", reference: "引用卡" }[kind];
}
