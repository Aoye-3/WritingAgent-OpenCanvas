import type { DatabaseSync } from "node:sqlite";
import type {
  CanvasEdge,
  CanvasEdgeInput,
  CanvasNode,
  CanvasNodeInput,
  CanvasNodePatch,
  CanvasSettings,
  CanvasWriteRequest,
  CanvasWriteRequestInput,
  CanvasWriteRequestStatus
} from "../storage.js";
import { sanitizeVisibleText } from "../services/generation/outputNormalizer.js";
import {
  cleanText,
  defaultCanvasTitle,
  nowIso,
  parseJson,
  randomId,
  readFiniteNumber,
  validateId,
  validateNodeKind,
  validateWriteOperation
} from "./storageRepositoryUtils.js";

const canvasSettingsKey = "canvas";
const defaultCanvasSettings: CanvasSettings = { undoDepth: 20 };

export class CanvasRepository {
  constructor(
    readonly db: DatabaseSync,
    private readonly deps: {
      withTransaction: <T>(work: () => T) => T;
      touchThread: (threadId: string, updatedAt?: string) => void;
    }
  ) {}

  listCanvasNodes(threadId: string) {
    validateId(threadId, "threadId");
    type CanvasNodeRow = Omit<CanvasNode, "metadata"> & { metadataJson: string };
    const rows = this.db
      .prepare(
        `SELECT id,
                thread_id as threadId,
                kind,
                title,
                content,
                x,
                y,
                width,
                height,
                metadata_json as metadataJson,
                created_at as createdAt,
                updated_at as updatedAt
         FROM canvas_nodes
         WHERE thread_id = ?
         ORDER BY created_at ASC`
      )
      .all(threadId) as CanvasNodeRow[];

    return rows.map((row) => ({
      ...row,
      content: sanitizeVisibleText(row.content),
      x: Number(row.x),
      y: Number(row.y),
      width: Number(row.width),
      height: Number(row.height),
      metadata: parseJson(row.metadataJson)
    }));
  }

  listCanvasEdges(threadId: string) {
    validateId(threadId, "threadId");
    return this.db
      .prepare(
        `SELECT id,
                thread_id as threadId,
                source_node_id as sourceNodeId,
                target_node_id as targetNodeId,
                label,
                created_at as createdAt,
                updated_at as updatedAt
         FROM canvas_edges
         WHERE thread_id = ?
         ORDER BY created_at ASC`
      )
      .all(threadId) as CanvasEdge[];
  }

  createCanvasEdge(threadId: string, input: CanvasEdgeInput) {
    validateId(threadId, "threadId");
    validateId(input.sourceNodeId, "sourceNodeId");
    validateId(input.targetNodeId, "targetNodeId");
    if (input.sourceNodeId === input.targetNodeId) {
      throw new Error("Canvas edge must connect two different nodes");
    }
    if (!this.getCanvasNode(threadId, input.sourceNodeId) || !this.getCanvasNode(threadId, input.targetNodeId)) {
      throw new Error("Canvas edge nodes must exist");
    }
    const now = nowIso();
    const edge: CanvasEdge = {
      id: randomId("edge"),
      threadId,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      label: cleanText(input.label),
      createdAt: now,
      updatedAt: now
    };
    this.db
      .prepare(
        `INSERT INTO canvas_edges (id, thread_id, source_node_id, target_node_id, label, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(edge.id, threadId, edge.sourceNodeId, edge.targetNodeId, edge.label, now, now);
    this.deps.touchThread(threadId, now);
    return edge;
  }

  deleteCanvasEdge(threadId: string, edgeId: string) {
    validateId(threadId, "threadId");
    validateId(edgeId, "edgeId");
    const result = this.db.prepare(`DELETE FROM canvas_edges WHERE id = ? AND thread_id = ?`).run(edgeId, threadId);
    if (result.changes > 0) this.deps.touchThread(threadId);
    return result.changes > 0;
  }

  createCanvasNode(threadId: string, input: CanvasNodeInput) {
    validateId(threadId, "threadId");
    const kind = validateNodeKind(input.kind);
    const now = nowIso();
    const node: CanvasNode = {
      id: input.id ? cleanCanvasRecordId(input.id, "nodeId") : randomId("node"),
      threadId,
      kind,
      title: cleanText(input.title) || defaultCanvasTitle(kind),
      content: cleanText(input.content),
      x: readFiniteNumber(input.x, 120),
      y: readFiniteNumber(input.y, 120),
      width: readFiniteNumber(input.width, 320),
      height: readFiniteNumber(input.height, 220),
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now
    };

    this.db
      .prepare(
        `INSERT INTO canvas_nodes (id, thread_id, kind, title, content, x, y, width, height, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(node.id, threadId, node.kind, node.title, node.content, node.x, node.y, node.width, node.height, JSON.stringify(node.metadata), now, now);
    this.deps.touchThread(threadId, now);
    return node;
  }

  updateCanvasNode(threadId: string, nodeId: string, patch: CanvasNodePatch) {
    validateId(threadId, "threadId");
    validateId(nodeId, "nodeId");
    const existing = this.getCanvasNode(threadId, nodeId);
    if (!existing) return undefined;
    const now = nowIso();
    const next: CanvasNode = {
      ...existing,
      kind: patch.kind ? validateNodeKind(patch.kind) : existing.kind,
      title: patch.title === undefined ? existing.title : cleanText(patch.title) || existing.title,
      content: patch.content === undefined ? existing.content : cleanText(patch.content),
      x: patch.x === undefined ? existing.x : readFiniteNumber(patch.x, existing.x),
      y: patch.y === undefined ? existing.y : readFiniteNumber(patch.y, existing.y),
      width: patch.width === undefined ? existing.width : readFiniteNumber(patch.width, existing.width),
      height: patch.height === undefined ? existing.height : readFiniteNumber(patch.height, existing.height),
      metadata: patch.metadata === undefined ? existing.metadata : patch.metadata,
      updatedAt: now
    };

    this.db
      .prepare(
        `UPDATE canvas_nodes
         SET kind = ?, title = ?, content = ?, x = ?, y = ?, width = ?, height = ?, metadata_json = ?, updated_at = ?
         WHERE id = ? AND thread_id = ?`
      )
      .run(next.kind, next.title, next.content, next.x, next.y, next.width, next.height, JSON.stringify(next.metadata), now, nodeId, threadId);
    this.deps.touchThread(threadId, now);
    return next;
  }

  deleteCanvasNode(threadId: string, nodeId: string) {
    validateId(threadId, "threadId");
    validateId(nodeId, "nodeId");
    const result = this.deps.withTransaction(() => {
      this.db.prepare(`DELETE FROM canvas_edges WHERE thread_id = ? AND (source_node_id = ? OR target_node_id = ?)`).run(threadId, nodeId, nodeId);
      return this.db.prepare(`DELETE FROM canvas_nodes WHERE id = ? AND thread_id = ?`).run(nodeId, threadId);
    });
    if (result.changes > 0) this.deps.touchThread(threadId);
    return result.changes > 0;
  }

  createCanvasWriteRequest(threadId: string, input: CanvasWriteRequestInput) {
    validateId(threadId, "threadId");
    const operation = validateWriteOperation(input.operation);
    const targetNode = input.targetNodeId ? this.getCanvasNode(threadId, input.targetNodeId) : undefined;
    if ((operation === "replace" || operation === "append") && !targetNode) {
      throw new Error("A valid target node is required for replace and append operations");
    }
    const nodeKind = validateNodeKind(input.nodeKind ?? targetNode?.kind ?? "document");
    const now = nowIso();
    const request: CanvasWriteRequest = {
      id: randomId("write"),
      threadId,
      operation,
      targetNodeId: targetNode?.id,
      nodeKind,
      title: cleanText(input.title) || targetNode?.title || defaultCanvasTitle(nodeKind),
      content: cleanText(input.content),
      rationale: cleanText(input.rationale),
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    if (!request.content) {
      throw new Error("Canvas write content is required");
    }

    this.db
      .prepare(
        `INSERT INTO canvas_write_requests
          (id, thread_id, operation, target_node_id, node_kind, title, content, rationale, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(request.id, threadId, request.operation, request.targetNodeId ?? null, request.nodeKind, request.title, request.content, request.rationale, request.status, now, now);
    this.deps.touchThread(threadId, now);
    return request;
  }

  listCanvasWriteRequests(threadId: string, status?: CanvasWriteRequestStatus) {
    validateId(threadId, "threadId");
    const where = status ? `WHERE thread_id = ? AND status = ?` : `WHERE thread_id = ?`;
    const params = status ? [threadId, status] : [threadId];
    type CanvasWriteRequestRow = Omit<CanvasWriteRequest, "targetNodeId"> & { targetNodeId: string | null };
    const rows = this.db
      .prepare(
        `SELECT id,
                thread_id as threadId,
                operation,
                target_node_id as targetNodeId,
                node_kind as nodeKind,
                title,
                content,
                rationale,
                status,
                created_at as createdAt,
                updated_at as updatedAt
         FROM canvas_write_requests
         ${where}
         ORDER BY created_at DESC`
      )
      .all(...params) as CanvasWriteRequestRow[];

    return rows.map((row) => ({
      ...row,
      content: sanitizeVisibleText(row.content),
      targetNodeId: row.targetNodeId ?? undefined
    }));
  }

  approveCanvasWriteRequest(threadId: string, requestId: string) {
    validateId(threadId, "threadId");
    validateId(requestId, "requestId");
    const request = this.getCanvasWriteRequest(threadId, requestId);
    if (!request || request.status !== "pending") return undefined;
    const now = nowIso();
    let node: CanvasNode | undefined;
    this.deps.withTransaction(() => {
      if (request.operation === "create") {
        const nextIndex = this.listCanvasNodes(threadId).length;
        node = this.createCanvasNode(threadId, {
          kind: request.nodeKind,
          title: request.title,
          content: request.content,
          x: 120 + (nextIndex % 4) * 36,
          y: 120 + (nextIndex % 4) * 36
        });
      } else {
        const existing = request.targetNodeId ? this.getCanvasNode(threadId, request.targetNodeId) : undefined;
        if (!existing) throw new Error("Target node was not found");
        const content = request.operation === "append"
          ? [existing.content.trim(), request.content.trim()].filter(Boolean).join("\n\n")
          : request.content;
        node = this.updateCanvasNode(threadId, existing.id, {
          title: request.title || existing.title,
          content
        });
      }
      this.updateCanvasWriteRequestStatus(threadId, requestId, "approved", now);
    });
    return { request: { ...request, status: "approved" as const, updatedAt: now }, node };
  }

  rejectCanvasWriteRequest(threadId: string, requestId: string) {
    validateId(threadId, "threadId");
    validateId(requestId, "requestId");
    const request = this.getCanvasWriteRequest(threadId, requestId);
    if (!request || request.status !== "pending") return undefined;
    const now = nowIso();
    this.updateCanvasWriteRequestStatus(threadId, requestId, "rejected", now);
    return { ...request, status: "rejected" as const, updatedAt: now };
  }

  getCanvasSettings(): CanvasSettings {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(canvasSettingsKey) as { value: string } | undefined;
    if (!row) return defaultCanvasSettings;
    const parsed = parseJson(row.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultCanvasSettings;
    const undoDepth = (parsed as Record<string, unknown>).undoDepth;
    return { undoDepth: readCanvasUndoDepth(undoDepth, defaultCanvasSettings.undoDepth) };
  }

  saveCanvasSettings(input: Partial<CanvasSettings>): CanvasSettings {
    const undoDepth = readCanvasUndoDepth(input.undoDepth, defaultCanvasSettings.undoDepth);
    const settings = { undoDepth };
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(canvasSettingsKey, JSON.stringify(settings), now);
    return settings;
  }

  private getCanvasNode(threadId: string, nodeId: string) {
    validateId(nodeId, "nodeId");
    return this.listCanvasNodes(threadId).find((node) => node.id === nodeId);
  }

  private getCanvasWriteRequest(threadId: string, requestId: string) {
    validateId(requestId, "requestId");
    return this.listCanvasWriteRequests(threadId).find((request) => request.id === requestId);
  }

  private updateCanvasWriteRequestStatus(threadId: string, requestId: string, status: CanvasWriteRequestStatus, updatedAt = nowIso()) {
    this.db
      .prepare(`UPDATE canvas_write_requests SET status = ?, updated_at = ? WHERE id = ? AND thread_id = ?`)
      .run(status, updatedAt, requestId, threadId);
    this.deps.touchThread(threadId, updatedAt);
  }
}

function readCanvasUndoDepth(value: unknown, fallback: number) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 200) {
    throw new Error("Canvas undo depth must be an integer from 1 to 200");
  }
  return value;
}

function cleanCanvasRecordId(value: string, label: string) {
  validateId(value, label);
  return value;
}
