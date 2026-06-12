export type CanvasMarkdownFormat = "bold" | "italic" | "link";

export function isSingleParagraphRange(content: string, start: number, end: number) {
  if (!isValidRange(content, start, end) || start === end) return false;
  return !content.slice(start, end).includes("\n");
}

export function replaceTextRange(content: string, start: number, end: number, replacement: string) {
  if (!isValidRange(content, start, end)) throw new Error("Invalid text range");
  return `${content.slice(0, start)}${replacement}${content.slice(end)}`;
}

export function applyMarkdownFormat(
  content: string,
  start: number,
  end: number,
  format: CanvasMarkdownFormat,
  href?: string
) {
  if (!isSingleParagraphRange(content, start, end)) throw new Error("Formatting requires a single paragraph selection");
  const selected = content.slice(start, end);
  if (format === "link") {
    const normalizedHref = href?.trim() ?? "";
    if (!/^https?:\/\/\S+$/i.test(normalizedHref)) throw new Error("Link must use HTTP or HTTPS");
    return replaceTextRange(content, start, end, `[${selected}](${normalizedHref})`);
  }

  const marker = format === "bold" ? "**" : "*";
  const before = content.slice(Math.max(0, start - marker.length), start);
  const after = content.slice(end, end + marker.length);
  if (before === marker && after === marker) {
    return replaceTextRange(content, start - marker.length, end + marker.length, selected);
  }
  return replaceTextRange(content, start, end, `${marker}${selected}${marker}`);
}

function isValidRange(content: string, start: number, end: number) {
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start && end <= content.length;
}
