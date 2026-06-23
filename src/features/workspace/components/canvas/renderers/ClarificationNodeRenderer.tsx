import type { CanvasNode } from "../../../../agents/types";
import type { CanvasNodePatch } from "../../../../canvas/canvasClient";
import type { CanvasLocale } from "../types";

type ClarificationNodeRendererProps = {
  locale: CanvasLocale;
  node: CanvasNode;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => Promise<unknown>;
};

type ClarificationOption = {
  id: string;
  label: string;
  detail: string;
  recommended: boolean;
};

type ClarificationMetadata = {
  question: string;
  options: ClarificationOption[];
  status: "pending" | "answered";
  selectedOptionId?: string;
  customAnswer?: string;
  source: string;
};

export function ClarificationNodeRenderer({ locale, node, onUpdateNode }: ClarificationNodeRendererProps) {
  const clarification = readClarificationMetadata(node);
  const selected = clarification.options.find((option) => option.id === clarification.selectedOptionId);
  const answered = clarification.status === "answered";
  const answerLabel = clarification.customAnswer || selected?.label || "";
  const answerDetail = selected?.detail || "";

  const choose = async (option: ClarificationOption) => {
    const nextClarification: ClarificationMetadata = {
      ...clarification,
      status: "answered",
      selectedOptionId: option.id,
      customAnswer: undefined
    };
    await onUpdateNode(node.id, {
      content: answeredContent(locale, nextClarification),
      metadata: mergeMetadata(node.metadata, { clarification: nextClarification }),
      includeInProjectContext: true
    });
  };

  return (
    <div className="canvas-text-node-body canvas-clarification-node">
      <div className="canvas-node-title canvas-node-readonly">{node.title}</div>
      <div className="canvas-clarification-status" data-status={clarification.status}>
        {answered ? (locale === "zh" ? "已选择" : "Answered") : (locale === "zh" ? "等待选择" : "Waiting for choice")}
      </div>
      <section className="canvas-clarification-question">
        <strong>{clarification.question || (locale === "zh" ? "需要补充信息" : "Clarification needed")}</strong>
      </section>
      {answered ? (
        <section className="canvas-clarification-answer">
          <span>{locale === "zh" ? "选择" : "Choice"}</span>
          <strong>{answerLabel || (locale === "zh" ? "已回答" : "Answered")}</strong>
          {answerDetail ? <p>{answerDetail}</p> : null}
        </section>
      ) : (
        <div className="canvas-clarification-options" role="group" aria-label={clarification.question}>
          {clarification.options.length ? clarification.options.map((option) => (
            <button className="canvas-clarification-option nodrag" key={option.id} type="button" onClick={() => void choose(option)}>
              <span>
                <strong>{option.label}</strong>
                {option.recommended ? <em>{locale === "zh" ? "推荐" : "Recommended"}</em> : null}
              </span>
              {option.detail ? <small>{option.detail}</small> : null}
            </button>
          )) : <p className="canvas-clarification-empty">{locale === "zh" ? "尚未配置选项。" : "No options configured yet."}</p>}
        </div>
      )}
    </div>
  );
}

export function readClarificationMetadata(node: CanvasNode): ClarificationMetadata {
  const metadata = node.metadata && typeof node.metadata === "object" && !Array.isArray(node.metadata) ? node.metadata as Record<string, unknown> : {};
  const raw = metadata.clarification && typeof metadata.clarification === "object" && !Array.isArray(metadata.clarification)
    ? metadata.clarification as Record<string, unknown>
    : {};
  const options = Array.isArray(raw.options) ? raw.options.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const option = item as Record<string, unknown>;
    const id = readString(option.id) || `option_${index + 1}`;
    const label = readString(option.label);
    if (!label) return [];
    const detail = readString(option.detail) || readString(option.description);
    return [{ id, label, detail, recommended: option.recommended === true }];
  }).slice(0, 3) : [];
  const selectedOptionId = readString(raw.selectedOptionId);
  const customAnswer = readString(raw.customAnswer);
  const status = raw.status === "answered" ? "answered" : "pending";
  return {
    question: readString(raw.question) || titlelessContent(node.content),
    options,
    status,
    ...(selectedOptionId ? { selectedOptionId } : {}),
    ...(customAnswer ? { customAnswer } : {}),
    source: readString(raw.source) || "agent"
  };
}

function answeredContent(locale: CanvasLocale, clarification: ClarificationMetadata) {
  const selected = clarification.options.find((option) => option.id === clarification.selectedOptionId);
  const answer = clarification.customAnswer || selected?.label || "";
  const detail = selected?.detail || "";
  return [
    `# ${locale === "zh" ? "澄清确认" : "Clarification"}`,
    "",
    `- ${locale === "zh" ? "问题" : "Question"}: ${clarification.question}`,
    `- ${locale === "zh" ? "选择" : "Choice"}: ${answer}`,
    detail ? `- ${locale === "zh" ? "详情" : "Detail"}: ${detail}` : ""
  ].filter(Boolean).join("\n");
}

function mergeMetadata(metadata: unknown, patch: Record<string, unknown>) {
  const current = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
  return { ...current, ...patch };
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function titlelessContent(content: string) {
  return content.replace(/^#\s+.+$/m, "").trim().split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
}
