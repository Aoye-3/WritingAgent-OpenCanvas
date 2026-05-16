import type { ReactNode } from "react";

type MarkdownTextProps = {
  highlights?: string[];
  text: string;
};

export function MarkdownText({ highlights = [], text }: MarkdownTextProps) {
  const blocks = toBlocks(text);

  return (
    <div className="markdown-text">
      {blocks.map((block, index) => {
        if (block.kind === "ul") {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, highlights)}</li>)}
            </ul>
          );
        }

        if (block.kind === "ol") {
          return (
            <ol key={index}>
              {block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, highlights)}</li>)}
            </ol>
          );
        }

        if (block.kind === "heading") {
          const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4";
          return <Tag key={index}>{renderInline(block.text, highlights)}</Tag>;
        }

        if (block.kind === "hr") {
          return <hr key={index} />;
        }

        return <p key={index}>{renderInline(block.text, highlights)}</p>;
      })}
    </div>
  );
}

type Block =
  | { kind: "p"; text: string }
  | { kind: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { kind: "hr" }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

function toBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "p", text: paragraph.join(" ") });
      paragraph = [];
    }
  };

  const flushList = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3 | 4, text: heading[2] });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "hr" });
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (!list || list.kind !== "ul") {
        flushList();
        list = { kind: "ul", items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }

    const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      if (!list || list.kind !== "ol") {
        flushList();
        list = { kind: "ol", items: [] };
      }
      list.items.push(numbered[1]);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return blocks.length > 0 ? blocks : [{ kind: "p", text }];
}

function renderInline(text: string, highlights: string[]) {
  const nodes: ReactNode[] = [];
  const pattern = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|__[^_]+__|`[^`]+`)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    if (match.index > lastIndex) {
      nodes.push(...renderHighlightedText(text.slice(lastIndex, match.index), highlights, nodes.length));
    }

    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<code key={nodes.length}>{renderHighlightedText(token.slice(1, -1), highlights, 0)}</code>);
    } else if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      nodes.push(link ? (
        <a key={nodes.length} href={safeHref(link[2])} target="_blank" rel="noreferrer">
          {renderHighlightedText(link[1], highlights, 0)}
        </a>
      ) : token);
    } else {
      nodes.push(<strong key={nodes.length}>{renderHighlightedText(token.slice(2, -2), highlights, 0)}</strong>);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(...renderHighlightedText(text.slice(lastIndex), highlights, nodes.length));
  }

  return nodes;
}

function renderHighlightedText(text: string, highlights: string[], keyOffset: number) {
  const activeHighlights = highlights.map((highlight) => highlight.trim()).filter(Boolean);
  if (!activeHighlights.length || !text) return [text];

  const ranges: Array<{ start: number; end: number }> = [];
  for (const highlight of activeHighlights) {
    const start = text.indexOf(highlight);
    if (start < 0) continue;
    const end = start + highlight.length;
    if (ranges.some((range) => start < range.end && end > range.start)) continue;
    ranges.push({ start, end });
  }

  if (!ranges.length) return [text];
  ranges.sort((left, right) => left.start - right.start);

  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      nodes.push(text.slice(cursor, range.start));
    }
    nodes.push(<mark className="message-annotation-highlight" key={`${keyOffset}-${range.start}`}>{text.slice(range.start, range.end)}</mark>);
    cursor = range.end;
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return nodes;
}

function safeHref(href: string) {
  const trimmed = href.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : "#";
}
