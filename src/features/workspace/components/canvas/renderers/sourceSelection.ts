export type SourceTextSelection = {
  rangeStart: number;
  rangeEnd: number;
  text: string;
  rect: DOMRect;
  sameParagraph: boolean;
  sameToken: boolean;
};

export function readSourceTextSelection(root: HTMLElement | null, content: string): SourceTextSelection | null {
  if (!root) return null;
  const active = window.getSelection();
  if (!active || active.isCollapsed || active.rangeCount === 0) return null;
  const range = active.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const start = sourcePoint(range.startContainer, range.startOffset);
  const end = sourcePoint(range.endContainer, range.endOffset);
  if (!start || !end) return null;
  const rangeStart = Math.min(start.offset, end.offset);
  const rangeEnd = Math.max(start.offset, end.offset);
  if (rangeEnd <= rangeStart) return null;
  const text = content.slice(rangeStart, rangeEnd);
  if (!text.trim()) return null;
  return {
    rangeStart,
    rangeEnd,
    text,
    rect: range.getBoundingClientRect(),
    sameParagraph: start.paragraph === end.paragraph,
    sameToken: start.token === end.token,
  };
}

export function readTextareaTextSelection(textarea: HTMLTextAreaElement | null, content: string): SourceTextSelection | null {
  if (!textarea) return null;
  const rangeStart = textarea.selectionStart;
  const rangeEnd = textarea.selectionEnd;
  if (!Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd) || rangeEnd <= rangeStart) return null;
  const text = content.slice(rangeStart, rangeEnd);
  if (!text.trim()) return null;
  return {
    rangeStart,
    rangeEnd,
    text,
    rect: textarea.getBoundingClientRect(),
    sameParagraph: !text.includes("\n"),
    sameToken: false,
  };
}

function sourcePoint(node: Node, localOffset: number) {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement;
  const span = element?.closest<HTMLElement>("[data-source-start][data-source-token]");
  if (!span) return null;
  const sourceStart = Number(span.dataset.sourceStart);
  const offset = node.nodeType === Node.TEXT_NODE ? localOffset : Math.min(localOffset, span.textContent?.length ?? 0);
  return { offset: sourceStart + offset, paragraph: span.dataset.sourceParagraph, token: span.dataset.sourceToken };
}
