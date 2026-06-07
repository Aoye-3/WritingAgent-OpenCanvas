import type { DatabaseSync } from "node:sqlite";
import type {
  CanvasEdge,
  CanvasEdgeInput,
  CanvasNode,
  CanvasNodeInput,
  CanvasNodePatch,
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
  isCanvasWorkflowStage,
  mergeCanvasWorkflowRoles,
  nextCanvasWorkflowNodeMetadata,
  readWorkflowMetadata,
  readWorkflowRoleMetadata
} from "../../shared/canvasWorkflow.js";
import { createStoredCanvasAsset, normalizeStoredCanvasObject, validateCanvasObjectWrite, type CanvasAssetObject } from "../../shared/canvasObjects.js";
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
    const workflow = this.getCanvasWorkflow(threadId);
    const rawMetadata = (input.metadata ?? {}) as Record<string, unknown>;
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
      metadata: kind === "role" ? cleanWorkflowRoleNodeMetadata(rawMetadata) : nextCanvasWorkflowNodeMetadata(workflow, rawMetadata),
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

  listCanvasObjects(threadId: string) {
    validateId(threadId, "threadId");
    type Row = Omit<CanvasObject, "geometry" | "data"> & { geometryJson: string; dataJson: string };
    const rows = this.db.prepare(
      `SELECT id, thread_id as threadId, kind, geometry_json as geometryJson, data_json as dataJson,
              created_at as createdAt, updated_at as updatedAt
       FROM canvas_objects WHERE thread_id = ? ORDER BY created_at ASC`
    ).all(threadId) as Row[];
    return rows.map(({ geometryJson, dataJson, ...row }) => normalizeStoredCanvasObject({
      ...row,
      geometry: parseJson(geometryJson),
      data: parseJson(dataJson)
    }));
  }

  createCanvasObject(threadId: string, input: CanvasObjectInput) {
    validateId(threadId, "threadId");
    const validated = validateCanvasObjectWrite(input);
    const now = nowIso();
    const object: CanvasObject = {
      id: input.id ? cleanCanvasRecordId(input.id, "objectId") : randomId("object"),
      threadId,
      ...validated,
      createdAt: now,
      updatedAt: now
    };
    this.db.prepare(
      `INSERT INTO canvas_objects (id, thread_id, kind, geometry_json, data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(object.id, threadId, object.kind, JSON.stringify(object.geometry), JSON.stringify(object.data), now, now);
    this.deps.touchThread(threadId, now);
    return object;
  }

  createCanvasAssetObject(threadId: string, input: Omit<CanvasAssetObject, "id" | "threadId" | "kind" | "createdAt" | "updatedAt">) {
    validateId(threadId, "threadId");
    const now = nowIso();
    const object = createStoredCanvasAsset({
      id: randomId("object"),
      threadId,
      ...input,
      createdAt: now,
      updatedAt: now
    });
    this.db.prepare(
      `INSERT INTO canvas_objects (id, thread_id, kind, geometry_json, data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(object.id, threadId, object.kind, JSON.stringify(object.geometry), JSON.stringify(object.data), now, now);
    this.deps.touchThread(threadId, now);
    return object;
  }

  updateCanvasObject(threadId: string, objectId: string, patch: CanvasObjectPatch) {
    validateId(threadId, "threadId");
    validateId(objectId, "objectId");
    const existing = this.listCanvasObjects(threadId).find((object) => object.id === objectId);
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
       WHERE id = ? AND thread_id = ?`
    ).run(next.kind, JSON.stringify(next.geometry), JSON.stringify(next.data), now, objectId, threadId);
    this.deps.touchThread(threadId, now);
    return next;
  }

  deleteCanvasObject(threadId: string, objectId: string) {
    validateId(threadId, "threadId");
    validateId(objectId, "objectId");
    const result = this.db.prepare(`DELETE FROM canvas_objects WHERE id = ? AND thread_id = ?`).run(objectId, threadId);
    if (result.changes > 0) this.deps.touchThread(threadId);
    return result.changes > 0;
  }

  getCanvasWorkflow(threadId: string): CanvasWorkflow {
    validateId(threadId, "threadId");
    type Row = { stage: string; rolesJson: string; updatedAt: string };
    const row = this.db
      .prepare(`SELECT stage, roles_json as rolesJson, updated_at as updatedAt FROM canvas_workflows WHERE thread_id = ?`)
      .get(threadId) as Row | undefined;
    const defaults = defaultCanvasWorkflow();
    if (!row) {
      return { threadId, stage: defaults.stage, stages: defaults.stages, roles: defaults.roles, updatedAt: "" };
    }
    return {
      threadId,
      stage: isCanvasWorkflowStage(row.stage) ? row.stage : defaults.stage,
      stages: [...canvasWorkflowStages],
      roles: readWorkflowRoles(parseJson(row.rolesJson), defaults.roles),
      updatedAt: row.updatedAt
    };
  }

  updateCanvasWorkflow(threadId: string, input: CanvasWorkflowInput): CanvasWorkflow {
    validateId(threadId, "threadId");
    const current = this.getCanvasWorkflow(threadId);
    const stage = input.stage === undefined ? current.stage : assertWorkflowStage(input.stage);
    const roles = input.roles === undefined ? current.roles : readWorkflowRoles(input.roles, []);
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO canvas_workflows (thread_id, stage, roles_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET stage = excluded.stage, roles_json = excluded.roles_json, updated_at = excluded.updated_at`
      )
      .run(threadId, stage, JSON.stringify(roles), now);
    this.deps.touchThread(threadId, now);
    return { threadId, stage, stages: [...canvasWorkflowStages], roles, updatedAt: now };
  }

  updateCanvasNodeWorkflow(threadId: string, nodeId: string, patch: CanvasNodeWorkflowPatch) {
    validateId(threadId, "threadId");
    validateId(nodeId, "nodeId");
    const existing = this.getCanvasNode(threadId, nodeId);
    if (!existing) return undefined;
    const currentMetadata = (existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {}) as Record<string, unknown>;
    const workflow = this.getCanvasWorkflow(threadId);
    const withStage = patch.stage === undefined
      ? currentMetadata
      : nextCanvasWorkflowNodeMetadata({ stage: assertWorkflowStage(patch.stage) }, currentMetadata);
    const metadata = patch.roles === undefined ? withStage : mergeCanvasWorkflowRoles(withStage, patch.roles, workflow.roles);
    return this.updateCanvasNode(threadId, nodeId, { metadata });
  }

  migrateCanvasWorkflowRoleNodes(threadId: string) {
    validateId(threadId, "threadId");
    const workflow = this.getCanvasWorkflow(threadId);
    const roleDefinitions = new Map(workflow.roles.map((role) => [role.id, role]));
    const now = nowIso();
    let createdRoleNodes = 0;
    let createdEdges = 0;
    let updatedNodes = 0;

    this.deps.withTransaction(() => {
      const nodes = this.listCanvasNodes(threadId);
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
            roleNode = this.createCanvasNode(threadId, {
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

          const hasEdge = this.listCanvasEdges(threadId).some((edge) => edge.sourceNodeId === roleNode!.id && edge.targetNodeId === node.id);
          if (!hasEdge) {
            this.createCanvasEdge(threadId, { sourceNodeId: roleNode.id, targetNodeId: node.id });
            createdEdges += 1;
          }
        }

        this.db
          .prepare(`UPDATE canvas_nodes SET metadata_json = ?, updated_at = ? WHERE id = ? AND thread_id = ?`)
          .run(JSON.stringify(stripLegacyWorkflowRoles(node.metadata)), now, node.id, threadId);
        updatedNodes += 1;
      }
    });

    if (createdRoleNodes > 0 || createdEdges > 0 || updatedNodes > 0) this.deps.touchThread(threadId, now);
    return { createdRoleNodes, createdEdges, updatedNodes };
  }

  listCanvasWorkflowSuggestions(threadId: string, nodeId?: string) {
    validateId(threadId, "threadId");
    if (nodeId) validateId(nodeId, "nodeId");
    const sql = `SELECT id,
                        thread_id as threadId,
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
                 WHERE thread_id = ?${nodeId ? " AND node_id = ?" : ""}
                 ORDER BY created_at ASC`;
    return this.db.prepare(sql).all(...(nodeId ? [threadId, nodeId] : [threadId])) as CanvasWorkflowSuggestion[];
  }

  createCanvasWorkflowSuggestion(threadId: string, input: CanvasWorkflowSuggestionInput) {
    validateId(threadId, "threadId");
    const roleNodeId = cleanText(input.roleNodeId ?? input.nodeId);
    const targetNodeId = cleanText(input.targetNodeId);
    validateId(roleNodeId, "roleNodeId");
    validateId(targetNodeId, "targetNodeId");
    const roleNode = this.getCanvasNode(threadId, roleNodeId);
    const targetNode = this.getCanvasNode(threadId, targetNodeId);
    if (!roleNode || roleNode.kind !== "role") throw new Error("Canvas workflow suggestion role node must exist");
    if (!targetNode || targetNode.kind === "role") throw new Error("Canvas workflow suggestion target node must exist");
    const hasRoleEdge = this.listCanvasEdges(threadId).some((edge) => edge.sourceNodeId === roleNodeId && edge.targetNodeId === targetNodeId);
    if (!hasRoleEdge) throw new Error("Canvas workflow suggestion requires a Role to target edge");
    const content = cleanText(input.content);
    if (!content) throw new Error("Canvas workflow suggestion content is required");
    const roleMetadata = readWorkflowRoleMetadata(roleNode.metadata);
    const now = nowIso();
    const suggestion: CanvasWorkflowSuggestion = {
      id: randomId("suggestion"),
      threadId,
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
          (id, thread_id, node_id, role_node_id, target_node_id, role_id, content, rationale, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(suggestion.id, threadId, suggestion.nodeId, suggestion.roleNodeId, suggestion.targetNodeId, suggestion.roleId, suggestion.content, suggestion.rationale, suggestion.status, now, now);
    this.deps.touchThread(threadId, now);
    return suggestion;
  }

  acceptCanvasWorkflowSuggestion(threadId: string, suggestionId: string) {
    return this.applySuggestionStatus(threadId, suggestionId, "accepted", true);
  }

  ignoreCanvasWorkflowSuggestion(threadId: string, suggestionId: string) {
    return this.applySuggestionStatus(threadId, suggestionId, "ignored", false);
  }

  convertCanvasWorkflowSuggestionToNode(threadId: string, suggestionId: string, input: CanvasSuggestionToNodeInput = {}) {
    validateId(threadId, "threadId");
    validateId(suggestionId, "suggestionId");
    const suggestion = this.getCanvasWorkflowSuggestion(threadId, suggestionId);
    if (!suggestion) return undefined;
    const node = this.createCanvasNode(threadId, {
      kind: validateNodeKind(input.kind ?? "note"),
      title: input.title ?? "Role suggestion",
      content: suggestion.content,
      metadata: { workflow: { stage: this.getCanvasWorkflow(threadId).stage } }
    });
    const accepted = this.applySuggestionStatus(threadId, suggestionId, "accepted", false);
    return accepted ? { suggestion: accepted, node } : undefined;
  }

  private getCanvasNode(threadId: string, nodeId: string) {
    validateId(nodeId, "nodeId");
    return this.listCanvasNodes(threadId).find((node) => node.id === nodeId);
  }

  private getCanvasWriteRequest(threadId: string, requestId: string) {
    validateId(requestId, "requestId");
    return this.listCanvasWriteRequests(threadId).find((request) => request.id === requestId);
  }

  private getCanvasWorkflowSuggestion(threadId: string, suggestionId: string) {
    validateId(suggestionId, "suggestionId");
    return this.listCanvasWorkflowSuggestions(threadId).find((suggestion) => suggestion.id === suggestionId);
  }

  private applySuggestionStatus(threadId: string, suggestionId: string, status: "accepted" | "ignored", appendContent: boolean) {
    validateId(threadId, "threadId");
    validateId(suggestionId, "suggestionId");
    const suggestion = this.getCanvasWorkflowSuggestion(threadId, suggestionId);
    if (!suggestion) return undefined;
    const now = nowIso();
    this.deps.withTransaction(() => {
      this.db
        .prepare(`UPDATE canvas_workflow_suggestions SET status = ?, updated_at = ? WHERE id = ? AND thread_id = ?`)
        .run(status, now, suggestionId, threadId);
      if (appendContent) {
        const node = this.getCanvasNode(threadId, suggestion.targetNodeId || suggestion.nodeId);
        if (node) {
          this.updateCanvasNode(threadId, node.id, { content: node.content ? `${node.content}\n\n${suggestion.content}` : suggestion.content });
        }
      }
    });
    this.deps.touchThread(threadId, now);
    return { ...suggestion, status, updatedAt: now };
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

function assertWorkflowStage(stage: unknown) {
  if (!isCanvasWorkflowStage(stage)) throw new Error("Invalid Canvas workflow stage");
  return stage;
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
    next.workflow = cleanWorkflow;
  }
  return next;
}
