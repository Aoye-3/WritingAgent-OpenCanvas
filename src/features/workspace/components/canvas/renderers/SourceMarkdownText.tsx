import type { ReactNode } from "react";

export function SourceMarkdownText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let offset = 0;
  return (
    <div className="canvas-source-markdown">
      {lines.map((line, index) => {
        const lineOffset = offset;
        offset += line.length + 1;
        return <p data-source-paragraph={index} key={`${lineOffset}-${index}`}>{line ? renderInline(line, lineOffset, index) : <br />}</p>;
      })}
    </div>
  );
}

function renderInline(line: string, lineOffset: number, paragraph: number) {
  const nodes: ReactNode[] = [];
  const pattern = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;
  let cursor = 0;
  let tokenIndex = 0;
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(sourceSpan(line.slice(cursor, index), lineOffset + cursor, paragraph, tokenIndex++));
    const token = match[0];
    if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        const start = lineOffset + index + 1;
        nodes.push(<a href={safeHref(link[2])} key={`${start}-link`} rel="noreferrer" target="_blank">
          {sourceSpan(link[1], start, paragraph, tokenIndex++)}
        </a>);
      }
    } else {
      const markerLength = token.startsWith("**") || token.startsWith("__") ? 2 : 1;
      const content = token.slice(markerLength, -markerLength);
      const start = lineOffset + index + markerLength;
      const child = sourceSpan(content, start, paragraph, tokenIndex++);
      nodes.push(markerLength === 2
        ? <strong key={`${start}-strong`}>{child}</strong>
        : <em key={`${start}-em`}>{child}</em>);
    }
    cursor = index + token.length;
  }
  if (cursor < line.length) nodes.push(sourceSpan(line.slice(cursor), lineOffset + cursor, paragraph, tokenIndex));
  return nodes;
}

function sourceSpan(text: string, start: number, paragraph: number, token: number) {
  return <span data-source-start={start} data-source-paragraph={paragraph} data-source-token={`${paragraph}:${token}`} key={`${start}-${token}`}>{text}</span>;
}

function safeHref(href: string) {
  return /^https?:\/\//i.test(href.trim()) ? href.trim() : "#";
}
