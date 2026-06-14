import type { ReactNode } from "react";

export function SourceMarkdownText({ text }: { text: string }) {
  const blocks = toBlocks(text);
  return (
    <div className="canvas-source-markdown">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4";
          return <Tag key={index}>{renderInline(block.text, block.offset, block.paragraph)}</Tag>;
        }

        if (block.kind === "ul") {
          return <ul key={index}>{block.items.map((item) => <li key={`${item.offset}-${item.paragraph}`}>{renderInline(item.text, item.offset, item.paragraph)}</li>)}</ul>;
        }

        if (block.kind === "ol") {
          return <ol key={index}>{block.items.map((item) => <li key={`${item.offset}-${item.paragraph}`}>{renderInline(item.text, item.offset, item.paragraph)}</li>)}</ol>;
        }

        if (block.kind === "table") {
          return <div className="canvas-source-table-wrap" key={index}>
            <table>
              <thead>
                <tr>{block.header.map((cell, cellIndex) => <th key={`${cell.offset}-${cellIndex}`}>{renderInline(cell.text, cell.offset, cell.paragraph)}</th>)}</tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={`${cell.offset}-${cellIndex}`}>{renderInline(cell.text, cell.offset, cell.paragraph)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>;
        }

        return <p data-source-paragraph={block.paragraph} key={`${block.offset}-${index}`}>
          {block.parts.length ? block.parts.flatMap((part, partIndex) => [
            ...renderInline(part.text, part.offset, part.paragraph),
            partIndex < block.parts.length - 1 ? " " : null
          ]) : <br />}
        </p>;
      })}
    </div>
  );
}

type SourceLine = { text: string; offset: number; paragraph: number };
type SourceCell = SourceLine;
type SourceBlock =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; text: string; offset: number; paragraph: number }
  | { kind: "p"; parts: SourceLine[]; offset: number; paragraph: number }
  | { kind: "ul"; items: SourceLine[] }
  | { kind: "ol"; items: SourceLine[] }
  | { kind: "table"; header: SourceCell[]; rows: SourceCell[][] };

function toBlocks(text: string): SourceBlock[] {
  const lines = toSourceLines(text);
  const blocks: SourceBlock[] = [];
  let paragraph: SourceLine[] = [];
  let list: { kind: "ul" | "ol"; items: SourceLine[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "p", parts: paragraph, offset: paragraph[0].offset, paragraph: paragraph[0].paragraph });
      paragraph = [];
    }
  };

  const flushList = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.text.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const nextLine = lines[index + 1];
    if (isTableRow(line.text) && nextLine && isTableSeparator(nextLine.text)) {
      flushParagraph();
      flushList();
      const header = parseTableRow(line);
      const rows: SourceCell[][] = [];
      index += 2;
      while (index < lines.length && isTableRow(lines[index].text)) {
        rows.push(parseTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    const heading = line.text.match(/^(\s*#{1,4}\s+)(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        kind: "heading",
        level: Math.min(heading[1].trim().length, 4) as 1 | 2 | 3 | 4,
        text: heading[2].trimEnd(),
        offset: line.offset + heading[1].length,
        paragraph: line.paragraph
      });
      continue;
    }

    const bullet = line.text.match(/^(\s*[-*]\s+)(.+)$/);
    if (bullet) {
      flushParagraph();
      if (!list || list.kind !== "ul") {
        flushList();
        list = { kind: "ul", items: [] };
      }
      list.items.push({ text: bullet[2].trimEnd(), offset: line.offset + bullet[1].length, paragraph: line.paragraph });
      continue;
    }

    const numbered = line.text.match(/^(\s*\d+[.)]\s+)(.+)$/);
    if (numbered) {
      flushParagraph();
      if (!list || list.kind !== "ol") {
        flushList();
        list = { kind: "ol", items: [] };
      }
      list.items.push({ text: numbered[2].trimEnd(), offset: line.offset + numbered[1].length, paragraph: line.paragraph });
      continue;
    }

    flushList();
    const leading = line.text.match(/^\s*/)?.[0].length ?? 0;
    paragraph.push({ text: line.text.trim(), offset: line.offset + leading, paragraph: line.paragraph });
  }

  flushParagraph();
  flushList();
  return blocks.length ? blocks : [{ kind: "p", parts: [], offset: 0, paragraph: 0 }];
}

function toSourceLines(text: string): SourceLine[] {
  let offset = 0;
  return text.replace(/\r\n/g, "\n").split("\n").map((line, paragraph) => {
    const sourceLine = { text: line, offset, paragraph };
    offset += line.length + 1;
    return sourceLine;
  });
}

function isTableRow(line: string) {
  const trimmed = line.trim();
  return trimmed.includes("|") && !isTableSeparator(trimmed);
}

function isTableSeparator(line: string) {
  const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseTableRow(line: SourceLine): SourceCell[] {
  const cells: SourceCell[] = [];
  const boundaries: number[] = [-1];
  for (let index = 0; index < line.text.length; index += 1) {
    if (line.text[index] === "|") boundaries.push(index);
  }
  boundaries.push(line.text.length);

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index] + 1;
    const end = boundaries[index + 1];
    if ((index === 0 && start === 0 && end === 0) || (index === boundaries.length - 2 && start === line.text.length)) continue;
    const raw = line.text.slice(start, end);
    if (!raw.trim() && (index === 0 || index === boundaries.length - 2)) continue;
    const leading = raw.match(/^\s*/)?.[0].length ?? 0;
    cells.push({ text: raw.trim(), offset: line.offset + start + leading, paragraph: line.paragraph });
  }

  return cells;
}

function renderInline(line: string, lineOffset: number, paragraph: number) {
  const nodes: ReactNode[] = [];
  const pattern = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`)/g;
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
    } else if (token.startsWith("`")) {
      const start = lineOffset + index + 1;
      nodes.push(<code key={`${start}-code`}>{sourceSpan(token.slice(1, -1), start, paragraph, tokenIndex++)}</code>);
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
