import { mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AgentCard, AgentSettings } from "./agentCards.js";
import type { Provider } from "./types.js";
import type { ToolEventRecord } from "./toolRuntime.js";

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type RunRecordInput = {
  threadId: string;
  agentCardId: string;
  mode: "structured" | "chat";
  prompt: string;
  output: string;
  provider: Provider;
  usedMock: boolean;
  errorMessage?: string;
  userMessage?: string;
  toolState?: Record<string, unknown>;
  events?: ToolEventRecord[];
  finishReason?: string;
  usage?: unknown;
};

export type StoredMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  text: string;
  usedMock: boolean;
  createdAt: string;
};

export type StoredThread = {
  id: string;
  agentCardId: string;
  title: string;
  updatedAt: string;
  deletedAt?: string | null;
  assetCount?: number;
};

export type ProjectSummary = StoredThread & {
  agentTitle: string;
  provider?: string;
};

export type StoredOutputVersion = {
  id: string;
  threadId: string;
  runId: string;
  content: string;
  mode: "structured" | "chat";
  provider: Provider;
  usedMock: boolean;
  createdAt: string;
};

export type StoredToolEvent = {
  id: string;
  threadId: string;
  runId: string;
  eventType: string;
  payload: JsonValue;
  createdAt: string;
};

export type CanvasNodeKind = "document" | "note" | "reference";
export type CanvasWriteOperation = "create" | "replace" | "append";
export type CanvasWriteRequestStatus = "pending" | "approved" | "rejected";

export type CanvasNode = {
  id: string;
  threadId: string;
  kind: CanvasNodeKind;
  title: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  metadata: JsonValue;
  createdAt: string;
  updatedAt: string;
};

export type CanvasWriteRequest = {
  id: string;
  threadId: string;
  operation: CanvasWriteOperation;
  targetNodeId?: string;
  nodeKind: CanvasNodeKind;
  title: string;
  content: string;
  rationale: string;
  status: CanvasWriteRequestStatus;
  createdAt: string;
  updatedAt: string;
};

export type CanvasNodeInput = {
  kind: CanvasNodeKind;
  title?: string;
  content?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  metadata?: JsonValue;
};

export type CanvasNodePatch = Partial<Omit<CanvasNodeInput, "kind">> & {
  kind?: CanvasNodeKind;
};

export type CanvasWriteRequestInput = {
  operation: CanvasWriteOperation;
  targetNodeId?: string;
  nodeKind?: CanvasNodeKind;
  title?: string;
  content: string;
  rationale?: string;
};

const appRoot = path.resolve(process.cwd(), ".facetwrite");
const dbDir = path.join(appRoot, "data");
const dbPath = path.join(dbDir, "facetwrite.db");

export class SQLiteStorageRepository {
  private db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  async ensureThread(threadId: string, agentCardId: string) {
    validateId(threadId, "threadId");
    await ensureThreadDirs(threadId);
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO threads (id, project_id, agent_card_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET agent_card_id = excluded.agent_card_id, updated_at = excluded.updated_at`
      )
      .run(threadId, "local-project", agentCardId, agentCardId, now, now);
  }

  upsertAgentCards(cards: AgentCard[]) {
    const statement = this.db.prepare(
      `INSERT INTO agent_cards (id, payload_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`
    );
    const now = nowIso();
    for (const card of cards) {
      statement.run(card.id, JSON.stringify(card), now);
    }
  }

  recordRun(input: RunRecordInput) {
    const runId = randomId("run");
    const promptVersionId = randomId("prompt");
    const outputVersionId = randomId("output");
    const now = nowIso();

    this.withTransaction(() => {
      this.db
        .prepare(
          `INSERT INTO runs (id, thread_id, agent_card_id, mode, provider, used_mock, status, error_message, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(runId, input.threadId, input.agentCardId, input.mode, input.provider, input.usedMock ? 1 : 0, "completed", input.errorMessage ?? null, now);

      if (input.userMessage) {
        this.addMessage(input.threadId, "user", input.userMessage, false, now);
      }
      this.addMessage(input.threadId, "assistant", input.output, input.usedMock, now);

      this.db
        .prepare(`INSERT INTO prompt_versions (id, thread_id, run_id, prompt, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(promptVersionId, input.threadId, runId, input.prompt, now);
      this.db
        .prepare(`INSERT INTO output_versions (id, thread_id, run_id, content, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(outputVersionId, input.threadId, runId, input.output, now);

      this.recordToolEvent(input.threadId, runId, "run_completed", {
        mode: input.mode,
        provider: input.provider,
        usedMock: input.usedMock,
        finishReason: input.finishReason,
        usage: input.usage
      }, now);
      this.recordToolEvent(input.threadId, runId, "prompt_built", { promptVersionId }, now);
      this.recordToolEvent(input.threadId, runId, "output_version_created", { outputVersionId }, now);

      if (input.toolState && Object.keys(input.toolState).length > 0) {
        this.recordToolEvent(input.threadId, runId, "tool_state_applied", input.toolState, now);
      }

      for (const event of input.events ?? []) {
        this.recordToolEvent(input.threadId, runId, event.eventType, event.payload, now);
      }

      this.db.prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`).run(now, input.threadId);
    });

    return { runId, promptVersionId, outputVersionId };
  }

  listMessages(threadId: string) {
    type StoredMessageRow = Omit<StoredMessage, "usedMock"> & { usedMock: number };
    const rows = this.db
      .prepare(`SELECT id, thread_id as threadId, role, text, used_mock as usedMock, created_at as createdAt FROM messages WHERE thread_id = ? ORDER BY created_at ASC`)
      .all(threadId) as StoredMessageRow[];

    return rows.map((row) => ({ ...row, usedMock: Boolean(row.usedMock) }));
  }

  getThread(threadId: string) {
    return this.db
      .prepare(`SELECT id, agent_card_id as agentCardId, title, updated_at as updatedAt, deleted_at as deletedAt FROM threads WHERE id = ? AND deleted_at IS NULL`)
      .get(threadId) as StoredThread | undefined;
  }

  listRecentThreads(limit = 8) {
    return this.db
      .prepare(`SELECT id, agent_card_id as agentCardId, title, updated_at as updatedAt, deleted_at as deletedAt FROM threads WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as StoredThread[];
  }

  listProjects(cards: AgentCard[], includeDeleted = false) {
    const where = includeDeleted ? `threads.deleted_at IS NOT NULL` : `threads.deleted_at IS NULL`;
    type ProjectRow = ProjectSummary & { assetCount: number; provider: string | null };
    const rows = this.db
      .prepare(
        `SELECT threads.id,
                threads.agent_card_id as agentCardId,
                threads.title,
                threads.updated_at as updatedAt,
                threads.deleted_at as deletedAt,
                COUNT(DISTINCT output_versions.id) as assetCount,
                MAX(runs.provider) as provider
         FROM threads
         LEFT JOIN output_versions ON output_versions.thread_id = threads.id
         LEFT JOIN runs ON runs.thread_id = threads.id
         WHERE ${where}
         GROUP BY threads.id
         ORDER BY threads.updated_at DESC`
      )
      .all() as ProjectRow[];

    return rows.map((row) => {
      const card = cards.find((agentCard) => agentCard.id === row.agentCardId);
      return {
        ...row,
        assetCount: Number(row.assetCount),
        provider: row.provider ?? undefined,
        agentTitle: card?.title.en ?? row.agentCardId
      };
    });
  }

  moveThreadToTrash(threadId: string) {
    const now = nowIso();
    const result = this.db.prepare(`UPDATE threads SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`).run(now, now, threadId);
    return result.changes > 0;
  }

  restoreThread(threadId: string) {
    const now = nowIso();
    const result = this.db.prepare(`UPDATE threads SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL`).run(now, threadId);
    return result.changes > 0;
  }

  async hardDeleteThread(threadId: string) {
    validateId(threadId, "threadId");
    const thread = this.db.prepare(`SELECT id FROM threads WHERE id = ? AND deleted_at IS NOT NULL`).get(threadId);
    if (!thread) return false;

    this.withTransaction(() => {
      this.db.prepare(`DELETE FROM canvas_write_requests WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM canvas_nodes WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM tool_events WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM output_versions WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM prompt_versions WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM runs WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM messages WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM threads WHERE id = ?`).run(threadId);
    });

    await rm(threadDataRoot(threadId), { recursive: true, force: true });
    return true;
  }

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
      x: Number(row.x),
      y: Number(row.y),
      width: Number(row.width),
      height: Number(row.height),
      metadata: parseJson(row.metadataJson)
    }));
  }

  createCanvasNode(threadId: string, input: CanvasNodeInput) {
    validateId(threadId, "threadId");
    const now = nowIso();
    const node: CanvasNode = {
      id: randomId("node"),
      threadId,
      kind: validateNodeKind(input.kind),
      title: cleanText(input.title) || defaultCanvasTitle(input.kind),
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
    this.touchThread(threadId, now);
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
    this.touchThread(threadId, now);
    return next;
  }

  deleteCanvasNode(threadId: string, nodeId: string) {
    validateId(threadId, "threadId");
    validateId(nodeId, "nodeId");
    const result = this.db.prepare(`DELETE FROM canvas_nodes WHERE id = ? AND thread_id = ?`).run(nodeId, threadId);
    if (result.changes > 0) this.touchThread(threadId);
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
    this.touchThread(threadId, now);
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

    return rows.map((row) => ({ ...row, targetNodeId: row.targetNodeId ?? undefined }));
  }

  approveCanvasWriteRequest(threadId: string, requestId: string) {
    validateId(threadId, "threadId");
    validateId(requestId, "requestId");
    const request = this.getCanvasWriteRequest(threadId, requestId);
    if (!request || request.status !== "pending") return undefined;
    const now = nowIso();
    let node: CanvasNode | undefined;
    this.withTransaction(() => {
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

  getAgentSettings(agentCardId: string) {
    const row = this.db.prepare(`SELECT payload_json as payloadJson FROM agent_settings WHERE agent_card_id = ?`).get(agentCardId) as { payloadJson: string } | undefined;
    return row ? parseJson(row.payloadJson) as Partial<AgentSettings> : undefined;
  }

  saveAgentSettings(agentCardId: string, settings: AgentSettings) {
    const now = nowIso();
    this.withTransaction(() => {
      this.db
        .prepare(
          `INSERT INTO agent_settings (agent_card_id, payload_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(agent_card_id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`
        )
        .run(agentCardId, JSON.stringify(settings), now);

      this.db.prepare(`DELETE FROM quick_messages WHERE agent_card_id = ?`).run(agentCardId);
      const statement = this.db.prepare(`INSERT INTO quick_messages (id, agent_card_id, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`);
      for (const text of settings.quickMessages) {
        const trimmed = text.trim();
        if (trimmed) statement.run(randomId("quick"), agentCardId, trimmed, now, now);
      }
    });
  }

  listOutputVersions(threadId: string) {
    type StoredOutputVersionRow = Omit<StoredOutputVersion, "usedMock"> & { usedMock: number };
    const rows = this.db
      .prepare(
        `SELECT output_versions.id,
                output_versions.thread_id as threadId,
                output_versions.run_id as runId,
                output_versions.content,
                output_versions.created_at as createdAt,
                runs.mode,
                runs.provider,
                runs.used_mock as usedMock
         FROM output_versions
         JOIN runs ON runs.id = output_versions.run_id
         WHERE output_versions.thread_id = ?
         ORDER BY output_versions.created_at DESC`
      )
      .all(threadId) as StoredOutputVersionRow[];

    return rows.map((row) => ({ ...row, usedMock: Boolean(row.usedMock) }));
  }

  listToolEvents(threadId: string) {
    type StoredToolEventRow = Omit<StoredToolEvent, "payload"> & { payloadJson: string };
    const rows = this.db
      .prepare(
        `SELECT id,
                thread_id as threadId,
                run_id as runId,
                event_type as eventType,
                payload_json as payloadJson,
                created_at as createdAt
         FROM tool_events
         WHERE thread_id = ?
         ORDER BY created_at DESC`
      )
      .all(threadId) as StoredToolEventRow[];

    return rows.map((row) => ({
      id: row.id,
      threadId: row.threadId,
      runId: row.runId,
      eventType: row.eventType,
      payload: parseJson(row.payloadJson),
      createdAt: row.createdAt
    }));
  }

  recordToolEvent(threadId: string, runId: string, eventType: string, payload: JsonValue, createdAt = nowIso()) {
    this.db
      .prepare(`INSERT INTO tool_events (id, thread_id, run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(randomId("tool"), threadId, runId, eventType, JSON.stringify(payload), createdAt);
  }

  private addMessage(threadId: string, role: "user" | "assistant", text: string, usedMock: boolean, createdAt = nowIso()) {
    this.db
      .prepare(`INSERT INTO messages (id, thread_id, role, text, used_mock, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(randomId("msg"), threadId, role, text, usedMock ? 1 : 0, createdAt);
  }

  private withTransaction<T>(work: () => T) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        agent_card_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        used_mock INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        agent_card_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        provider TEXT NOT NULL,
        used_mock INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        error_message TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_cards (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS prompt_versions (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS output_versions (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tool_events (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_settings (
        agent_card_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS quick_messages (
        id TEXT PRIMARY KEY,
        agent_card_id TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS canvas_nodes (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        width REAL NOT NULL,
        height REAL NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS canvas_write_requests (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        target_node_id TEXT,
        node_kind TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        rationale TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT OR IGNORE INTO projects (id, title, created_at, updated_at)
      VALUES ('local-project', 'Local Workspace', datetime('now'), datetime('now'));

      INSERT OR IGNORE INTO schema_version (version, applied_at)
      VALUES (1, datetime('now'));
    `);

    if (!this.columnExists("threads", "deleted_at")) {
      this.db.exec(`ALTER TABLE threads ADD COLUMN deleted_at TEXT`);
    }
  }

  private columnExists(table: string, column: string) {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return rows.some((row) => row.name === column);
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
    this.touchThread(threadId, updatedAt);
  }

  private touchThread(threadId: string, updatedAt = nowIso()) {
    this.db.prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`).run(updatedAt, threadId);
  }
}

export async function createStorage() {
  await mkdir(dbDir, { recursive: true });
  return new SQLiteStorageRepository();
}

export async function ensureThreadDirs(threadId: string) {
  validateId(threadId, "threadId");
  const threadRoot = path.join(threadDataRoot(threadId), "user-data");
  const resolved = path.resolve(threadRoot);
  if (!resolved.startsWith(appRoot)) {
    throw new Error("Thread data must stay inside the local app workspace");
  }

  await Promise.all([
    mkdir(path.join(resolved, "workspace"), { recursive: true }),
    mkdir(path.join(resolved, "uploads"), { recursive: true }),
    mkdir(path.join(resolved, "outputs"), { recursive: true })
  ]);
}

function threadDataRoot(threadId: string) {
  validateId(threadId, "threadId");
  const root = path.join(appRoot, "threads", threadId);
  const resolved = path.resolve(root);
  if (!resolved.startsWith(appRoot)) {
    throw new Error("Thread data must stay inside the local app workspace");
  }
  return resolved;
}

function validateId(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

function randomId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

function validateNodeKind(value: string): CanvasNodeKind {
  if (value === "document" || value === "note" || value === "reference") return value;
  throw new Error("Invalid canvas node kind");
}

function validateWriteOperation(value: string): CanvasWriteOperation {
  if (value === "create" || value === "replace" || value === "append") return value;
  throw new Error("Invalid canvas write operation");
}

function readFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function defaultCanvasTitle(kind: CanvasNodeKind) {
  if (kind === "note") return "Untitled note";
  if (kind === "reference") return "Untitled reference";
  return "Untitled document";
}

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return { raw: value };
  }
}
