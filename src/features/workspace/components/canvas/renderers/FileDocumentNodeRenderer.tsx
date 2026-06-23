import type { CanvasNode } from "../../../../agents/types";
import type { CanvasLocale } from "../types";
import { SourceMarkdownText } from "./SourceMarkdownText";

type FileDocumentNodeRendererProps = {
  locale: CanvasLocale;
  node: CanvasNode;
  onOpenDocumentPreview: (node: CanvasNode) => void;
};

export function FileDocumentNodeRenderer({ locale, node, onOpenDocumentPreview }: FileDocumentNodeRendererProps) {
  const fileDocument = readFileDocumentMetadata(node);
  return (
    <div className="canvas-text-node-body canvas-file-document-node">
      <div className="canvas-node-title canvas-node-readonly">{node.title}</div>
      <div className="canvas-node-content canvas-node-readonly">
        <SourceMarkdownText linksEnabled={false} text={node.content} />
      </div>
      <button
        className="button button-secondary button-small nodrag canvas-file-document-open"
        type="button"
        disabled={!fileDocument}
        onClick={() => fileDocument ? onOpenDocumentPreview(node) : undefined}
      >
        {locale === "zh" ? "预览 Markdown" : "Preview Markdown"}
      </button>
      {fileDocument ? <span className="canvas-file-document-path" title={fileDocument.path}>{fileDocument.fileName}</span> : null}
    </div>
  );
}

function readFileDocumentMetadata(node: CanvasNode) {
  const metadata = node.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const fileDocument = (metadata as Record<string, unknown>).fileDocument;
  if (!fileDocument || typeof fileDocument !== "object" || Array.isArray(fileDocument)) return undefined;
  const record = fileDocument as Record<string, unknown>;
  const path = typeof record.path === "string" ? record.path : "";
  const fileName = typeof record.fileName === "string" ? record.fileName : path.split("/").at(-1) ?? "";
  return path && fileName ? { path, fileName } : undefined;
}
