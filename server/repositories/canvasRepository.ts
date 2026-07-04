import type { DatabaseSync } from "node:sqlite";
import type {
  CanvasEdge,
  CanvasEdgeInput,
  CanvasNode,
  CanvasNodeInput,
  CanvasNodePatch,
  CanvasNodePositionUpdate,
  CanvasObject,
  CanvasObjectInput,
  CanvasObjectPatch,
  CanvasNodeWorkflowPatch,
  CanvasSettings,
  CanvasSuggestionToNodeInput,
  CanvasWorkflow,
  CanvasWorkflowInput,
  CanvasWorkflowSuggestion,
  CanvasWorkflowSuggestionInput,
  CanvasWriteRequest,
  CanvasWriteRequestInput,
  CanvasWriteRequestStatus
} from "../storageTypes.js";
import {
  canvasWorkflowStages,
  defaultCanvasWorkflow,
  isCanvasWorkflowMode,
  isCanvasWorkflowStage,
  mergeCanvasWorkflowRoles,
  nextCanvasWorkflowNodeMetadata,
  readWorkflowMetadata,
  readWorkflowRoleMetadata
} from "../../shared/canvasWorkflow.js";
import { createStoredCanvasAsset, normalizeStoredCanvasObject, validateCanvasObjectWrite, type CanvasAssetObject } from "../../shared/canvasObjects.js";
import { sanitizeVisibleText } from "../services/generation/outputNormalizer.js";
import { isSingleParagraphRange, replaceTextRange } from "../../shared/canvasRangeEdit.js";
import { splitCanvasText, stableDeliveryId } from "../services/canvasDelivery.js";
import { findAvailableCanvasNodePosition } from "../services/canvasNodePlacement.js";
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
      touchProject: (projectId: string, updatedAt?: string) => void;
    }
  ) {}

  listCanvasNodes(projectId: string) {
    validateId(projectId, "projectId");
    type CanvasNodeRow = Omit<CanvasNode, "metadata" | "includeInProjectContext"> & { metadataJson: string; includeInProjectContext: number };
    const rows = this.db
      .prepare(
        `SELECT id,
                project_id as projectId,
                kind,
                title,
                content,
                x,
                y,
                width,
                height,
                metadata_json as metadataJson,
                include_in_project_context as includeInProjectContext,
                created_at as createdAt,
                updated_at as updatedAt
         FROM canvas_nodes
         WHERE project_id = ?
         ORDER BY created_at ASC`
      )
      .all(projectId) as CanvasNodeRow[];

    return rows.map((row) => ({
      ...row,
      content: sanitizeVisibleText(row.content),
      x: Number(row.x),
      y: Number(row.y),
      width: Number(row.width),
      height: Number(row.height),
      metadata: parseJson(row.metadataJson),
      includeInProjectContext: Boolean(row.includeInProjectContext)
    }));
  }

  listCanvasEdges(projectId: string) {
    validateId(projectId, "projectId");
    return this.db
      .prepare(
        `SELECT id,
                project_id as projectId,
                source_node_id as sourceNodeId,
                target_node_id as targetNodeId,
                label,
                created_at as createdAt,
                updated_at as updatedAt
         FROM canvas_edges
         WHERE project_id = ?
         ORDER BY created_at ASC`
      )
      .all(projectId) as CanvasEdge[];
  }

  createCanvasEdge(projectId: string, input: CanvasEdgeInput) {
    validateId(projectId, "projectId");
    validateId(input.sourceNodeId, "sourceNodeId");
    validateId(input.targetNodeId, "targetNodeId");
    if (input.sourceNodeId === input.targetNodeId) {
      throw new Error("Canvas edge must connect two different nodes");
    }
    if (!this.getCanvasNode(projectId, input.sourceNodeId) || !this.getCanvasNode(projectId, input.targetNodeId)) {
      throw new Error("Canvas edge nodes must exist");
    }
    const now = nowIso();
    const edge: CanvasEdge = {
      id: input.id ? cleanCanvasRecordId(input.id, "edgeId") : randomId("edge"),
      projectId,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      label: cleanText(input.label),
      createdAt: now,
      updatedAt: now
    };
    this.db
      .prepare(
        `INSERT INTO canvas_edges (id, project_id, source_node_id, target_node_id, label, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(edge.id, projectId, edge.sourceNodeId, edge.targetNodeId, edge.label, now, now);
    this.deps.touchProject(projectId, now);
    return edge;
  }

  deleteCanvasEdge(projectId: string, edgeId: string) {
    validateId(projectId, "projectId");
    validateId(edgeId, "edgeId");
    const result = this.db.prepare(`DELETE FROM canvas_edges WHERE id = ? AND project_id = ?`).run(edgeId, projectId);
    if (result.changes > 0) this.deps.touchProject(projectId);
    return result.changes > 0;
  }

  createCanvasNode(projectId: string, input: CanvasNodeInput) {
    validateId(projectId, "projectId");
    const kind = validateNodeKind(input.kind);
    const now = nowIso();
    const workflow = this.getCanvasWorkflow(projectId);
    const rawMetadata = (input.metadata ?? {}) as Record<string, unknown>;
    const node: CanvasNode = {
      id: input.id ? cleanCanvasRecordId(input.id, "nodeId") : randomId("node"),
      projectId,
      kind,
      title: cleanText(input.title) || defaultCanvasTitle(kind),
      content: cleanText(input.content),
      x: readFiniteNumber(input.x, 120),
      y: readFiniteNumber(input.y, 120),
      width: readFiniteNumber(input.width, 320),
      height: readFiniteNumber(input.height, 220),
      metadata: kind === "role" ? cleanWorkflowRoleNodeMetadata(rawMetadata) : nextCanvasWorkflowNodeMetadata(workflow, rawMetadata),
      includeInProjectContext: input.includeInProjectContext === true,
      createdAt: now,
      updatedAt: now
    };

    this.db
      .prepare(
        `INSERT INTO canvas_nodes (id, project_id, kind, title, content, x, y, width, height, metadata_json, include_in_project_context, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(node.id, projectId, node.kind, node.title, node.content, node.x, node.y, node.width, node.height, JSON.stringify(node.metadata), node.includeInProjectContext ? 1 : 0, now, now);
    this.deps.touchProject(projectId, now);
    return node;
  }

  updateCanvasNode(projectId: string, nodeId: string, patch: CanvasNodePatch) {
    validateId(projectId, "projectId");
    validateId(nodeId, "nodeId");
    const existing = this.getCanvasNode(projectId, nodeId);
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
      includeInProjectContext: patch.includeInProjectContext === undefined ? existing.includeInProjectContext : patch.includeInProjectContext === true,
      updatedAt: now
    };

    this.db
      .prepare(
        `UPDATE canvas_nodes
         SET kind = ?, title = ?, content = ?, x = ?, y = ?, width = ?, height = ?, metadata_json = ?, include_in_project_context = ?, updated_at = ?
         WHERE id = ? AND project_id = ?`
      )
      .run(next.kind, next.title, next.content, next.x, next.y, next.width, next.height, JSON.stringify(next.metadata), next.includeInProjectContext ? 1 : 0, now, nodeId, projectId);
    this.deps.touchProject(projectId, now);
    return next;
  }

  updateCanvasNodePositions(projectId: string, updates: CanvasNodePositionUpdate[]) {
    validateId(projectId, "projectId");
    const existingById = new Map(this.listCanvasNodes(projectId).map((node) => [node.id, node]));
    const nextNodes = updates.map((update) => {
      validateId(update.nodeId, "nodeId");
      const existing = existingById.get(update.nodeId);
      if (!existing) throw new Error("Canvas node not found");
      return {
        ...existing,
        x: readFiniteNumber(update.x, existing.x),
        y: readFiniteNumber(update.y, existing.y),
        updatedAt: nowIso()
      };
    });
    if (nextNodes.length === 0) return [];
    const updatedAt = nowIso();
    const statement = this.db.prepare(`UPDATE canvas_nodes SET x = ?, y = ?, updated_at = ? WHERE id = ? AND project_id = ?`);
    this.deps.withTransaction(() => {
      for (const node of nextNodes) {
        statement.run(node.x, node.y, updatedAt, node.id, projectId);
      }
    });
    this.deps.touchProject(projectId, updatedAt);
    return nextNodes.map((node) => ({ ...node, updatedAt }));
  }

  deleteCanvasNode(projectId: string, nodeId: string) {
    validateId(projectId, "projectId");
    validateId(nodeId, "nodeId");
    const result = this.deps.withTransaction(() => {
      this.db.prepare(`DELETE FROM canvas_edges WHERE project_id = ? AND (source_node_id = ? OR target_node_id = ?)`).run(projectId, nodeId, nodeId);
      return this.db.prepare(`DELETE FROM canvas_nodes WHERE id = ? AND project_id = ?`).run(nodeId, projectId);
    });
    if (result.changes > 0) this.deps.touchProject(projectId);
    return result.changes > 0;
  }

  createCanvasWriteRequest(projectId: string, input: CanvasWriteRequestInput) {
    validateId(projectId, "projectId");
    const operation = validateWriteOperation(input.operation);
    const targetNode = input.targetNodeId ? this.getCanvasNode(projectId, input.targetNodeId) : undefined;
    if ((operation === "replace" || operation === "append" || operation === "replace_range" || operation === "delete") && !targetNode) {
      throw new Error("A valid target node is required for canvas update operations");
    }
    const nodeKind = validateNodeKind(input.nodeKind ?? targetNode?.kind ?? "document");
    const now = nowIso();
    const request: CanvasWriteRequest = {
      id: randomId("write"),
      projectId,
      operation,
      targetNodeId: targetNode?.id,
      nodeKind,
      title: cleanText(input.title) || targetNode?.title || defaultCanvasTitle(nodeKind),
      content: cleanText(input.content),
      rationale: cleanText(input.rationale),
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      originalText: typeof input.originalText === "string" ? input.originalText : undefined,
      baseNodeUpdatedAt: cleanText(input.baseNodeUpdatedAt) || undefined,
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    if (!request.content && operation !== "delete") {
      throw new Error("Canvas write content is required");
    }
    if (operation === "replace_range") {
      if (!targetNode || targetNode.kind !== "document") throw new Error("Range replacement requires a document node");
      const existingPending = this.listCanvasWriteRequests(projectId, "pending")
        .some((item) => item.operation === "replace_range" && item.targetNodeId === targetNode.id);
      if (existingPending) throw new Error("A pending range replacement already exists for this node");
      if (request.rangeStart === undefined || request.rangeEnd === undefined || request.originalText === undefined || !request.baseNodeUpdatedAt) {
        throw new Error("Range replacement metadata is required");
      }
      if (!isSingleParagraphRange(targetNode.content, request.rangeStart, request.rangeEnd)
        || targetNode.content.slice(request.rangeStart, request.rangeEnd) !== request.originalText) {
        throw new Error("Range replacement source is invalid");
      }
    }

    this.db
      .prepare(
        `INSERT INTO canvas_write_requests
          (id, project_id, operation, target_node_id, node_kind, title, content, rationale, range_start, range_end, original_text, base_node_updated_at, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(request.id, projectId, request.operation, request.targetNodeId ?? null, request.nodeKind, request.title, request.content, request.rationale,
        request.rangeStart ?? null, request.rangeEnd ?? null, request.originalText ?? null, request.baseNodeUpdatedAt ?? null, request.status, now, now);
    this.deps.touchProject(projectId, now);
    return request;
  }

  listCanvasWriteRequests(projectId: string, status?: CanvasWriteRequestStatus) {
    validateId(projectId, "projectId");
    const where = status ? `WHERE project_id = ? AND status = ?` : `WHERE project_id = ?`;
    const params = status ? [projectId, status] : [projectId];
    type CanvasWriteRequestRow = Omit<CanvasWriteRequest, "targetNodeId"> & { targetNodeId: string | null };
    const rows = this.db
      .prepare(
        `SELECT id,
                project_id as projectId,
                operation,
                target_node_id as targetNodeId,
                node_kind as nodeKind,
                title,
                content,
                rationale,
                range_start as rangeStart,
                range_end as rangeEnd,
                original_text as originalText,
                base_node_updated_at as baseNodeUpdatedAt,
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

  approveCanvasWriteRequest(projectId: string, requestId: string) {
    validateId(projectId, "projectId");
    validateId(requestId, "requestId");
    const request = this.getCanvasWriteRequest(projectId, requestId);
    if (!request || request.status !== "pending") return undefined;
    const now = nowIso();
    let node: CanvasNode | undefined;
    let resolvedStatus: CanvasWriteRequestStatus = "approved";
    this.deps.withTransaction(() => {
      if (request.operation === "create") {
        const existingNodes = this.listCanvasNodes(projectId);
        const position = findAvailableCanvasNodePosition({
          existingNodes,
          anchorNodeId: request.targetNodeId
        });
        node = this.createCanvasNode(projectId, {
          kind: request.nodeKind,
          title: request.title,
          content: request.content,
          x: position.x,
          y: position.y
        });
      } else {
        const existing = request.targetNodeId ? this.getCanvasNode(projectId, request.targetNodeId) : undefined;
        if (!existing) throw new Error("Target node was not found");
        if (request.operation === "delete") {
          node = existing;
          this.db.prepare(`DELETE FROM canvas_edges WHERE project_id = ? AND (source_node_id = ? OR target_node_id = ?)`).run(projectId, existing.id, existing.id);
          this.db.prepare(`DELETE FROM canvas_nodes WHERE id = ? AND project_id = ?`).run(existing.id, projectId);
          this.deps.touchProject(projectId);
          this.updateCanvasWriteRequestStatus(projectId, requestId, "approved", now);
          return;
        }
        if (request.operation === "replace_range") {
          const start = request.rangeStart;
          const end = request.rangeEnd;
          const unchanged = existing.updatedAt === request.baseNodeUpdatedAt
            && start !== undefined
            && end !== undefined
            && existing.content.slice(start, end) === request.originalText;
          if (!unchanged) {
            resolvedStatus = "stale";
            this.updateCanvasWriteRequestStatus(projectId, requestId, "stale", now);
            node = existing;
            return;
          }
          node = this.updateCanvasNode(projectId, existing.id, {
            content: replaceTextRange(existing.content, start!, end!, request.content)
          });
          this.updateCanvasWriteRequestStatus(projectId, requestId, "approved", now);
          return;
        }
        const content = request.operation === "append"
          ? [existing.content.trim(), request.content.trim()].filter(Boolean).join("\n\n")
          : request.content;
        node = this.updateCanvasNode(projectId, existing.id, {
          title: request.title || existing.title,
          content
        });
      }
      this.updateCanvasWriteRequestStatus(projectId, requestId, "approved", now);
    });
    return { request: { ...request, status: resolvedStatus, updatedAt: now }, node };
  }

  rejectCanvasWriteRequest(projectId: string, requestId: string) {
    validateId(projectId, "projectId");
    validateId(requestId, "requestId");
    const request = this.getCanvasWriteRequest(projectId, requestId);
    if (!request || request.status !== "pending") return undefined;
    const now = nowIso();
    this.updateCanvasWriteRequestStatus(projectId, requestId, "rejected", now);
    return { ...request, status: "rejected" as const, updatedAt: now };
  }

  createWriteSuggestion(threadId: string, projectId: string, runId: string, items: Array<{ title: string; content: string }>) {
    if (items.length < 3) throw new Error("Canvas write suggestions require at least three items");
    const id = `suggestion_${runId}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
    const now = nowIso();
    this.db.prepare(`INSERT INTO canvas_write_suggestions (id, thread_id, project_id, run_id, status, items_json, node_ids_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, '[]', ?, ?) ON CONFLICT(id) DO NOTHING`)
      .run(id, threadId, projectId, runId, JSON.stringify(items), now, now);
    return this.listWriteSuggestions(threadId).find((suggestion) => suggestion.id === id);
  }

  listWriteSuggestions(threadId: string) {
    type Row = { id: string; threadId: string; projectId: string; runId: string; status: "pending" | "accepted" | "dismissed" | "stale"; itemsJson: string; nodeIdsJson: string; createdAt: string; updatedAt: string };
    return (this.db.prepare(`SELECT id, thread_id as threadId, project_id as projectId, run_id as runId, status, items_json as itemsJson, node_ids_json as nodeIdsJson, created_at as createdAt, updated_at as updatedAt
      FROM canvas_write_suggestions WHERE thread_id = ? ORDER BY created_at DESC`).all(threadId) as Row[])
      .map(({ itemsJson, nodeIdsJson, ...row }) => ({ ...row, items: parseJson(itemsJson) as Array<{ title: string; content: string }>, nodeIds: parseJson(nodeIdsJson) as string[] }));
  }

  acceptWriteSuggestion(threadId: string, suggestionId: string) {
    const suggestion = this.listWriteSuggestions(threadId).find((item) => item.id === suggestionId);
    if (!suggestion || suggestion.status !== "pending") return suggestion;
    const existingNodes = new Set(this.listCanvasNodes(suggestion.projectId).map((node) => node.id));
    const existingEdges = new Set(this.listCanvasEdges(suggestion.projectId).map((edge) => edge.id));
    const nodeIds: string[] = [];
    for (const item of suggestion.items) {
      for (const chunk of splitCanvasText(item.content)) {
        const index = nodeIds.length + 1;
        const nodeId = stableDeliveryId("node", suggestion.id, index);
        if (!existingNodes.has(nodeId)) this.createCanvasNode(suggestion.projectId, { id: nodeId, kind: "document", title: item.title, content: chunk, x: 120 + ((index - 1) % 3) * 360, y: 120 + Math.floor((index - 1) / 3) * 280 });
        nodeIds.push(nodeId);
        if (nodeIds.length > 1) {
          const edgeId = stableDeliveryId("edge", suggestion.id, nodeIds.length - 1);
          if (!existingEdges.has(edgeId)) this.createCanvasEdge(suggestion.projectId, { id: edgeId, sourceNodeId: nodeIds[nodeIds.length - 2], targetNodeId: nodeId, label: "continues" });
        }
      }
    }
    const now = nowIso();
    this.db.prepare(`UPDATE canvas_write_suggestions SET status = 'accepted', node_ids_json = ?, updated_at = ? WHERE id = ? AND thread_id = ?`).run(JSON.stringify(nodeIds), now, suggestionId, threadId);
    return this.listWriteSuggestions(threadId).find((item) => item.id === suggestionId);
  }

  dismissWriteSuggestion(threadId: string, suggestionId: string) {
    const now = nowIso();
    this.db.prepare(`UPDATE canvas_write_suggestions SET status = 'dismissed', updated_at = ? WHERE id = ? AND thread_id = ? AND status = 'pending'`).run(now, suggestionId, threadId);
    return this.listWriteSuggestions(threadId).find((item) => item.id === suggestionId);
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

  listCanvasObjects(projectId: string) {
    validateId(projectId, "projectId");
    type Row = Omit<CanvasObject, "geometry" | "data"> & { geometryJson: string; dataJson: string };
    const rows = this.db.prepare(
      `SELECT id, project_id as projectId, kind, geometry_json as geometryJson, data_json as dataJson,
              created_at as createdAt, updated_at as updatedAt
       FROM canvas_objects WHERE project_id = ? ORDER BY created_at ASC`
    ).all(projectId) as Row[];
    return rows.map(({ geometryJson, dataJson, ...row }) => normalizeStoredCanvasObject({
      ...row,
      geometry: parseJson(geometryJson),
      data: parseJson(dataJson)
    }));
  }

  createCanvasObject(projectId: string, input: CanvasObjectInput) {
    validateId(projectId, "projectId");
    const validated = validateCanvasObjectWrite(input);
    const now = nowIso();
    const object: CanvasObject = {
      id: input.id ? cleanCanvasRecordId(input.id, "objectId") : randomId("object"),
      projectId,
      ...validated,
      createdAt: now,
      updatedAt: now
    };
    this.db.prepare(
      `INSERT INTO canvas_objects (id, project_id, kind, geometry_json, data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(object.id, projectId, object.kind, JSON.stringify(object.geometry), JSON.stringify(object.data), now, now);
    this.deps.touchProject(projectId, now);
    return object;
  }

  createCanvasAssetObject(projectId: string, input: Omit<CanvasAssetObject, "id" | "projectId" | "kind" | "createdAt" | "updatedAt">) {
    validateId(projectId, "projectId");
    const now = nowIso();
    const object = createStoredCanvasAsset({
      id: randomId("object"),
      projectId,
      ...input,
      createdAt: now,
      updatedAt: now
    });
    this.db.prepare(
      `INSERT INTO canvas_objects (id, project_id, kind, geometry_json, data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(object.id, projectId, object.kind, JSON.stringify(object.geometry), JSON.stringify(object.data), now, now);
    this.deps.touchProject(projectId, now);
    return object;
  }

  updateCanvasObject(projectId: string, objectId: string, patch: CanvasObjectPatch) {
    validateId(projectId, "projectId");
    validateId(objectId, "objectId");
    const existing = this.listCanvasObjects(projectId).find((object) => object.id === objectId);
    if (!existing) return undefined;
    const now = nowIso();
    if (existing.kind === "asset" && (patch.kind !== undefined || patch.data !== undefined)) {
      throw new Error("Canvas asset metadata cannot be updated through the object endpoint");
    }
    const validated = existing.kind === "asset"
      ? createStoredCanvasAsset({ ...existing, geometry: patch.geometry === undefined ? existing.geometry : patch.geometry as CanvasAssetObject["geometry"] })
      : validateCanvasObjectWrite({
        kind: patch.kind ?? existing.kind,
        geometry: patch.geometry ?? existing.geometry,
        data: patch.data ?? existing.data
      });
    const next = { ...existing, ...validated, updatedAt: now } as CanvasObject;
    this.db.prepare(
      `UPDATE canvas_objects SET kind = ?, geometry_json = ?, data_json = ?, updated_at = ?
       WHERE id = ? AND project_id = ?`
    ).run(next.kind, JSON.stringify(next.geometry), JSON.stringify(next.data), now, objectId, projectId);
    this.deps.touchProject(projectId, now);
    return next;
  }

  deleteCanvasObject(projectId: string, objectId: string) {
    validateId(projectId, "projectId");
    validateId(objectId, "objectId");
    const result = this.db.prepare(`DELETE FROM canvas_objects WHERE id = ? AND project_id = ?`).run(objectId, projectId);
    if (result.changes > 0) this.deps.touchProject(projectId);
    return result.changes > 0;
  }

  getCanvasWorkflow(projectId: string): CanvasWorkflow {
    validateId(projectId, "projectId");
    type Row = { mode: string; stage: string; rolesJson: string; updatedAt: string };
    const row = this.db
      .prepare(`SELECT mode, stage, roles_json as rolesJson, updated_at as updatedAt FROM canvas_workflows WHERE project_id = ?`)
      .get(projectId) as Row | undefined;
    const defaults = defaultCanvasWorkflow();
    if (!row) {
      return { projectId, mode: defaults.mode, stage: defaults.stage, stages: defaults.stages, roles: defaults.roles, updatedAt: "" };
    }
    return {
      projectId,
      mode: isCanvasWorkflowMode(row.mode) ? row.mode : defaults.mode,
      stage: isCanvasWorkflowStage(row.stage) ? row.stage : defaults.stage,
      stages: [...canvasWorkflowStages],
      roles: readWorkflowRoles(parseJson(row.rolesJson), defaults.roles),
      updatedAt: row.updatedAt
    };
  }

  updateCanvasWorkflow(projectId: string, input: CanvasWorkflowInput): CanvasWorkflow {
    validateId(projectId, "projectId");
    const current = this.getCanvasWorkflow(projectId);
    const mode = input.mode === undefined ? current.mode : assertWorkflowMode(input.mode);
    const stage = input.stage === undefined ? current.stage : assertWorkflowStage(input.stage);
    const roles = input.roles === undefined ? current.roles : readWorkflowRoles(input.roles, []);
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO canvas_workflows (project_id, mode, stage, roles_json, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET mode = excluded.mode, stage = excluded.stage, roles_json = excluded.roles_json, updated_at = excluded.updated_at`
      )
      .run(projectId, mode, stage, JSON.stringify(roles), now);
    this.deps.touchProject(projectId, now);
    return { projectId, mode, stage, stages: [...canvasWorkflowStages], roles, updatedAt: now };
  }

  updateCanvasNodeWorkflow(projectId: string, nodeId: string, patch: CanvasNodeWorkflowPatch) {
    validateId(projectId, "projectId");
    validateId(nodeId, "nodeId");
    const existing = this.getCanvasNode(projectId, nodeId);
    if (!existing) return undefined;
    const currentMetadata = (existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {}) as Record<string, unknown>;
    const workflow = this.getCanvasWorkflow(projectId);
    const withStage = patch.stage === undefined
      ? currentMetadata
      : nextCanvasWorkflowNodeMetadata({ stage: assertWorkflowStage(patch.stage) }, currentMetadata);
    const metadata = patch.roles === undefined ? withStage : mergeCanvasWorkflowRoles(withStage, patch.roles, workflow.roles);
    return this.updateCanvasNode(projectId, nodeId, { metadata });
  }

  migrateCanvasWorkflowRoleNodes(projectId: string) {
    validateId(projectId, "projectId");
    const workflow = this.getCanvasWorkflow(projectId);
    const roleDefinitions = new Map(workflow.roles.map((role) => [role.id, role]));
    const now = nowIso();
    let createdRoleNodes = 0;
    let createdEdges = 0;
    let updatedNodes = 0;

    this.deps.withTransaction(() => {
      const nodes = this.listCanvasNodes(projectId);
      const roleNodesByRoleId = new Map<string, CanvasNode>();
      for (const node of nodes) {
        if (node.kind !== "role") continue;
        const role = readWorkflowRoleMetadata(node.metadata);
        if (role && !roleNodesByRoleId.has(role.roleId)) roleNodesByRoleId.set(role.roleId, node);
      }

      for (const node of nodes) {
        if (node.kind === "role") continue;
        const metadata = readWorkflowMetadata(node.metadata);
        if (metadata.roles.length === 0) continue;

        for (const roleId of metadata.roles) {
          const definition = roleDefinitions.get(roleId) ?? { id: roleId, label: roleId, prompt: "" };
          let roleNode = roleNodesByRoleId.get(roleId);
          if (!roleNode) {
            roleNode = this.createCanvasNode(projectId, {
              kind: "role",
              title: definition.label,
              content: "",
              x: node.x - 180,
              y: node.y,
              width: 260,
              height: 180,
              metadata: { workflowRole: { roleId: definition.id, label: definition.label, prompt: definition.prompt } }
            });
            roleNodesByRoleId.set(roleId, roleNode);
            createdRoleNodes += 1;
          }

          const hasEdge = this.listCanvasEdges(projectId).some((edge) => edge.sourceNodeId === roleNode!.id && edge.targetNodeId === node.id);
          if (!hasEdge) {
            this.createCanvasEdge(projectId, { sourceNodeId: roleNode.id, targetNodeId: node.id });
            createdEdges += 1;
          }
        }

        this.db
          .prepare(`UPDATE canvas_nodes SET metadata_json = ?, updated_at = ? WHERE id = ? AND project_id = ?`)
          .run(JSON.stringify(stripLegacyWorkflowRoles(node.metadata)), now, node.id, projectId);
        updatedNodes += 1;
      }
    });

    if (createdRoleNodes > 0 || createdEdges > 0 || updatedNodes > 0) this.deps.touchProject(projectId, now);
    return { createdRoleNodes, createdEdges, updatedNodes };
  }

  listCanvasWorkflowSuggestions(projectId: string, nodeId?: string) {
    validateId(projectId, "projectId");
    if (nodeId) validateId(nodeId, "nodeId");
    const sql = `SELECT id,
                        project_id as projectId,
                        node_id as nodeId,
                        role_node_id as roleNodeId,
                        target_node_id as targetNodeId,
                        role_id as roleId,
                        content,
                        rationale,
                        status,
                        created_at as createdAt,
                        updated_at as updatedAt
                 FROM canvas_workflow_suggestions
                 WHERE project_id = ?${nodeId ? " AND node_id = ?" : ""}
                 ORDER BY created_at ASC`;
    return this.db.prepare(sql).all(...(nodeId ? [projectId, nodeId] : [projectId])) as CanvasWorkflowSuggestion[];
  }

  createCanvasWorkflowSuggestion(projectId: string, input: CanvasWorkflowSuggestionInput) {
    validateId(projectId, "projectId");
    const roleNodeId = cleanText(input.roleNodeId ?? input.nodeId);
    const targetNodeId = cleanText(input.targetNodeId);
    validateId(roleNodeId, "roleNodeId");
    validateId(targetNodeId, "targetNodeId");
    const roleNode = this.getCanvasNode(projectId, roleNodeId);
    const targetNode = this.getCanvasNode(projectId, targetNodeId);
    if (!roleNode || roleNode.kind !== "role") throw new Error("Canvas workflow suggestion role node must exist");
    if (!targetNode || targetNode.kind === "role") throw new Error("Canvas workflow suggestion target node must exist");
    const hasRoleEdge = this.listCanvasEdges(projectId).some((edge) => edge.sourceNodeId === roleNodeId && edge.targetNodeId === targetNodeId);
    if (!hasRoleEdge) throw new Error("Canvas workflow suggestion requires a Role to target edge");
    const content = cleanText(input.content);
    if (!content) throw new Error("Canvas workflow suggestion content is required");
    const roleMetadata = readWorkflowRoleMetadata(roleNode.metadata);
    const now = nowIso();
    const suggestion: CanvasWorkflowSuggestion = {
      id: randomId("suggestion"),
      projectId,
      nodeId: roleNodeId,
      roleNodeId,
      targetNodeId,
      roleId: cleanText(input.roleId) || roleMetadata?.roleId || roleNodeId,
      content,
      rationale: cleanText(input.rationale),
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    this.db
      .prepare(
        `INSERT INTO canvas_workflow_suggestions
          (id, project_id, node_id, role_node_id, target_node_id, role_id, content, rationale, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(suggestion.id, projectId, suggestion.nodeId, suggestion.roleNodeId, suggestion.targetNodeId, suggestion.roleId, suggestion.content, suggestion.rationale, suggestion.status, now, now);
    this.deps.touchProject(projectId, now);
    return suggestion;
  }

  acceptCanvasWorkflowSuggestion(projectId: string, suggestionId: string) {
    return this.applySuggestionStatus(projectId, suggestionId, "accepted", true);
  }

  ignoreCanvasWorkflowSuggestion(projectId: string, suggestionId: string) {
    return this.applySuggestionStatus(projectId, suggestionId, "ignored", false);
  }

  convertCanvasWorkflowSuggestionToNode(projectId: string, suggestionId: string, input: CanvasSuggestionToNodeInput = {}) {
    validateId(projectId, "projectId");
    validateId(suggestionId, "suggestionId");
    const suggestion = this.getCanvasWorkflowSuggestion(projectId, suggestionId);
    if (!suggestion) return undefined;
    const node = this.createCanvasNode(projectId, {
      kind: validateNodeKind(input.kind ?? "note"),
      title: input.title ?? "Role suggestion",
      content: suggestion.content
    });
    const accepted = this.applySuggestionStatus(projectId, suggestionId, "accepted", false);
    return accepted ? { suggestion: accepted, node } : undefined;
  }

  private getCanvasNode(projectId: string, nodeId: string) {
    validateId(nodeId, "nodeId");
    return this.listCanvasNodes(projectId).find((node) => node.id === nodeId);
  }

  private getCanvasWriteRequest(projectId: string, requestId: string) {
    validateId(requestId, "requestId");
    return this.listCanvasWriteRequests(projectId).find((request) => request.id === requestId);
  }

  private getCanvasWorkflowSuggestion(projectId: string, suggestionId: string) {
    validateId(suggestionId, "suggestionId");
    return this.listCanvasWorkflowSuggestions(projectId).find((suggestion) => suggestion.id === suggestionId);
  }

  private applySuggestionStatus(projectId: string, suggestionId: string, status: "accepted" | "ignored", appendContent: boolean) {
    validateId(projectId, "projectId");
    validateId(suggestionId, "suggestionId");
    const suggestion = this.getCanvasWorkflowSuggestion(projectId, suggestionId);
    if (!suggestion) return undefined;
    const now = nowIso();
    this.deps.withTransaction(() => {
      this.db
        .prepare(`UPDATE canvas_workflow_suggestions SET status = ?, updated_at = ? WHERE id = ? AND project_id = ?`)
        .run(status, now, suggestionId, projectId);
      if (appendContent) {
        const node = this.getCanvasNode(projectId, suggestion.targetNodeId || suggestion.nodeId);
        if (node) {
          this.updateCanvasNode(projectId, node.id, { content: node.content ? `${node.content}\n\n${suggestion.content}` : suggestion.content });
        }
      }
    });
    this.deps.touchProject(projectId, now);
    return { ...suggestion, status, updatedAt: now };
  }

  private updateCanvasWriteRequestStatus(projectId: string, requestId: string, status: CanvasWriteRequestStatus, updatedAt = nowIso()) {
    this.db
      .prepare(`UPDATE canvas_write_requests SET status = ?, updated_at = ? WHERE id = ? AND project_id = ?`)
      .run(status, updatedAt, requestId, projectId);
    this.deps.touchProject(projectId, updatedAt);
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

function assertWorkflowStage(stage: unknown) {
  if (!isCanvasWorkflowStage(stage)) throw new Error("Invalid Canvas workflow stage");
  return stage;
}

function assertWorkflowMode(mode: unknown) {
  if (!isCanvasWorkflowMode(mode)) throw new Error("Invalid Canvas workflow mode");
  return mode;
}

function readWorkflowRoles(value: unknown, fallback: CanvasWorkflow["roles"]) {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set<string>();
  return value.flatMap((role) => {
    if (!role || typeof role !== "object") return [];
    const id = cleanText((role as { id?: unknown }).id);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      label: cleanText((role as { label?: unknown }).label) || id,
      prompt: cleanText((role as { prompt?: unknown }).prompt)
    }];
  });
}

function cleanWorkflowRoleNodeMetadata(metadata: Record<string, unknown>) {
  const existing = readWorkflowRoleMetadata(metadata);
  const raw = metadata.workflowRole && typeof metadata.workflowRole === "object" && !Array.isArray(metadata.workflowRole)
    ? metadata.workflowRole as Record<string, unknown>
    : {};
  const roleId = cleanText(raw.roleId) || existing?.roleId || "role";
  const label = cleanText(raw.label) || existing?.label || roleId;
  const prompt = cleanText(raw.prompt) || existing?.prompt || "";
  const description = cleanText(raw.description) || existing?.description || "";
  return {
    ...metadata,
    workflowRole: description
      ? { roleId, label, prompt, description }
      : { roleId, label, prompt }
  };
}

function stripLegacyWorkflowRoles(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const next = { ...(metadata as Record<string, unknown>) };
  const workflow = next.workflow;
  if (workflow && typeof workflow === "object" && !Array.isArray(workflow)) {
    const cleanWorkflow = { ...(workflow as Record<string, unknown>) };
    delete cleanWorkflow.roles;
    if (Object.keys(cleanWorkflow).length > 0) {
      next.workflow = cleanWorkflow;
    } else {
      delete next.workflow;
    }
  }
  return next;
}
