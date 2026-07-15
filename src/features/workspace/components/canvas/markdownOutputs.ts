import type { CanvasNode, StoredToolEvent } from "../../../agents/types";
import type { CanvasNodeDraft } from "../../../canvas/canvasClient";
import { fileDocumentPreviewTarget } from "./fileDocumentPreview";

export type MarkdownOutputItem = {
  nodeId?: string;
  title: string;
  path: string;
  fileName: string;
  threadId: string;
  status: "written" | "presented";
  sourceTool: "write_file" | "present_files";
  createdAt: string;
};

export function deriveMarkdownOutputItems(toolEvents: StoredToolEvent[], nodes: CanvasNode[], threadId: string): MarkdownOutputItem[] {
  const byPath = new Map<string, MarkdownOutputItem>();

  for (const event of toolEvents) {
    if (event.threadId !== threadId || event.eventType !== "agent_backend_tool_completed") continue;
    const payload = record(event.payload);
    const sourceTool = string(payload.toolName);
    if (sourceTool !== "write_file" && sourceTool !== "present_files") continue;
    const paths = sourceTool === "present_files"
      ? stringArray(payload.filepaths ?? payload.file_paths ?? payload.paths ?? payload.files)
      : [string(payload.path ?? payload.file_path ?? payload.filePath ?? payload.filepath)];
    for (const rawPath of paths) {
      const path = normalizeOutputMarkdownPath(rawPath);
      if (!path) continue;
      upsert(byPath, {
        path,
        fileName: fileNameFromPath(path),
        title: fileDocumentTitle(fileNameFromPath(path), "en"),
        threadId,
        status: sourceTool === "present_files" ? "presented" : "written",
        sourceTool,
        createdAt: event.createdAt
      });
    }
  }

  for (const node of nodes) {
    if (node.kind !== "file_document") continue;
    const target = fileDocumentPreviewTarget(node, threadId);
    const path = target ? normalizeOutputMarkdownPath(target.path) : undefined;
    if (!target || target.threadId !== threadId || !path) continue;
    const metadata = record(record(node.metadata).fileDocument);
    const status = string(metadata.status) === "written" ? "written" : "presented";
    const sourceTool = string(metadata.sourceTool) === "write_file" ? "write_file" : "present_files";
    const fileName = string(metadata.fileName) || fileNameFromPath(path);
    const current = byPath.get(path);
    upsert(byPath, {
      ...current,
      nodeId: node.id,
      path,
      fileName,
      title: node.title || string(metadata.title) || fileDocumentTitle(fileName, "en"),
      threadId,
      status: current?.status === "presented" ? "presented" : status,
      sourceTool: current?.sourceTool === "present_files" ? "present_files" : sourceTool,
      createdAt: current?.createdAt && current.createdAt > node.createdAt ? current.createdAt : node.createdAt
    });
  }

  return [...byPath.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function createMarkdownOutputNodeDraft(
  item: MarkdownOutputItem,
  origin: { x: number; y: number },
  locale: "en" | "zh"
): CanvasNodeDraft {
  const title = fileDocumentTitle(item.fileName, locale);
  const status = item.status === "presented"
    ? locale === "zh" ? "已呈现，可预览" : "Presented, ready to preview"
    : locale === "zh" ? "已写入，等待呈现" : "Written, waiting to be presented";
  return {
    kind: "file_document",
    title,
    content: [
      `# ${title}`,
      "",
      `- ${locale === "zh" ? "文件" : "File"}: ${item.fileName}`,
      `- ${locale === "zh" ? "路径" : "Path"}: \`${item.path}\``,
      `- ${locale === "zh" ? "状态" : "Status"}: ${status}`
    ].join("\n"),
    x: Math.round(origin.x),
    y: Math.round(origin.y),
    width: 360,
    height: 220,
    metadata: {
      fileDocument: {
        path: item.path,
        fileName: item.fileName,
        title,
        status: item.status,
        sourceTool: item.sourceTool,
        threadId: item.threadId
      }
    },
    includeInProjectContext: false
  };
}

function upsert(items: Map<string, MarkdownOutputItem>, incoming: MarkdownOutputItem) {
  const existing = items.get(incoming.path);
  if (!existing) {
    items.set(incoming.path, incoming);
    return;
  }
  const preferIncoming = statusPriority(incoming.status) > statusPriority(existing.status)
    || (incoming.status === existing.status && incoming.createdAt > existing.createdAt);
  items.set(incoming.path, preferIncoming
    ? { ...existing, ...incoming, nodeId: incoming.nodeId ?? existing.nodeId }
    : { ...incoming, ...existing, nodeId: incoming.nodeId ?? existing.nodeId });
}

function statusPriority(status: MarkdownOutputItem["status"]) {
  return status === "presented" ? 2 : 1;
}

function normalizeOutputMarkdownPath(value: string) {
  const path = value.trim().replace(/\\/g, "/");
  const match = path.match(/(?:^|\/)mnt\/user-data\/outputs\/(.+\.md)$/i);
  if (!match) return undefined;
  const relative = match[1].split("/").filter((part) => part && part !== "." && part !== "..").join("/");
  return relative && /\.md$/i.test(relative) ? `/mnt/user-data/outputs/${relative}` : undefined;
}

function fileDocumentTitle(fileName: string, locale: "en" | "zh") {
  return locale === "zh" ? `文档：${fileName}` : `Document: ${fileName}`;
}

function fileNameFromPath(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? "document.md";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function string(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(string).filter(Boolean) : [];
}
