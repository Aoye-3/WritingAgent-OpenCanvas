import type { CanvasNode } from "../../../agents/types";

export type FileDocumentPreviewTarget = {
  path: string;
  threadId: string;
};

export function fileDocumentPreviewTarget(node: CanvasNode, currentThreadId: string): FileDocumentPreviewTarget | undefined {
  const metadata = record(node.metadata);
  const fileDocument = record(metadata.fileDocument);
  const path = string(fileDocument.path);
  if (!path) return undefined;
  return {
    path,
    threadId: string(fileDocument.threadId) || string(fileDocument.sourceThreadId) || sourceThreadIdFromDelivery(metadata, node.id) || currentThreadId
  };
}

function sourceThreadIdFromDelivery(metadata: Record<string, unknown>, nodeId: string) {
  const deliveryId = string(metadata.deliveryId) || (metadata.canvasDelivery === true ? deliveryIdFromNodeId(nodeId) : "");
  const match = deliveryId.match(/^delivery_(thread_[A-Za-z0-9_-]+)_\d+_/);
  return match?.[1] ?? "";
}

function deliveryIdFromNodeId(nodeId: string) {
  const match = nodeId.match(/^node_(delivery_.+)_\d+$/);
  return match?.[1] ?? "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function string(value: unknown) {
  return typeof value === "string" ? value : "";
}
