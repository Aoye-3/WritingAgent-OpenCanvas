import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AgentCard, AgentSettings } from "./agentCards.js";
import { createFacetWriteDatabase, runSqliteTransaction } from "./db/sqlite.js";
import { AgentSettingsRepository } from "./repositories/agentSettingsRepository.js";
import { cleanText, defaultCanvasTitle, nowIso, parseJson, randomId, readFiniteNumber, validateId, validateNodeKind, validateWriteOperation } from "./repositories/storageRepositoryUtils.js";
import { ThreadRepository } from "./repositories/threadRepository.js";
import type { Provider } from "./types.js";
import type { ToolEventRecord } from "./toolRuntime.js";
import { sanitizeVisibleText } from "./services/generation/outputNormalizer.js";
import type { KnowledgeBase, KnowledgeBaseInput, KnowledgeEventInput, KnowledgeItem, KnowledgeItemInput, KnowledgeItemStatus } from "./knowledge/types.js";

export type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

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

export type StoredStructuredValues = Record<string, string | string[]>;

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
const maxThreadTitleLength = 120;

export class SQLiteStorageRepository {
  private db: DatabaseSync;
  private threads: ThreadRepository;
  private agentSettings: AgentSettingsRepository;

  constructor() {
    this.db = createFacetWriteDatabase(dbPath);
    this.threads = new ThreadRepository(this.db);
    this.agentSettings = new AgentSettingsRepository(this.db, (work) => this.withTransaction(work));
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

    return rows.map((row) => ({
      ...row,
      text: row.role === "assistant" ? sanitizeVisibleText(row.text) : row.text,
      usedMock: Boolean(row.usedMock)
    }));
  }

  getThread(threadId: string) {
    return this.threads.getThread(threadId);
  }

  listRecentThreads(limit = 8) {
    return this.threads.listRecentThreads(limit);
  }

  listProjects(cards: AgentCard[], includeDeleted = false) {
    return this.threads.listProjects(cards, includeDeleted);
  }

  moveThreadToTrash(threadId: string) {
    return this.threads.moveThreadToTrash(threadId);
  }

  restoreThread(threadId: string) {
    return this.threads.restoreThread(threadId);
  }

  renameThread(threadId: string, title: unknown) {
    validateId(threadId, "threadId");
    const cleanTitle = cleanText(title);
    if (!cleanTitle) {
      throw new Error("Thread title is required");
    }
    if (cleanTitle.length > maxThreadTitleLength) {
      throw new Error(`Thread title must be ${maxThreadTitleLength} characters or fewer`);
    }
    return this.threads.renameThread(threadId, cleanTitle);
  }

  getThreadInputValues(threadId: string): StoredStructuredValues {
    validateId(threadId, "threadId");
    const row = this.db
      .prepare(`SELECT structured_values_json as structuredValuesJson FROM thread_inputs WHERE thread_id = ?`)
      .get(threadId) as { structuredValuesJson: string } | undefined;
    if (!row) return {};
    return cleanStructuredValues(parseJson(row.structuredValuesJson));
  }

  saveThreadInputValues(threadId: string, structuredValues: unknown) {
    validateId(threadId, "threadId");
    const thread = this.getThread(threadId);
    if (!thread) return undefined;
    const values = cleanStructuredValues(structuredValues);
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO thread_inputs (thread_id, structured_values_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET structured_values_json = excluded.structured_values_json, updated_at = excluded.updated_at`
      )
      .run(threadId, JSON.stringify(values), now);
    this.touchThread(threadId, now);
    return values;
  }

  async hardDeleteThread(threadId: string) {
    validateId(threadId, "threadId");
    const thread = this.db.prepare(`SELECT id FROM threads WHERE id = ? AND deleted_at IS NOT NULL`).get(threadId);
    if (!thread) return false;

    this.withTransaction(() => {
      this.db.prepare(`DELETE FROM canvas_write_requests WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM canvas_nodes WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM thread_inputs WHERE thread_id = ?`).run(threadId);
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
      content: sanitizeVisibleText(row.content),
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

  listKnowledgeBases() {
    const rows = this.db
      .prepare(
        `SELECT id,
                name,
                description,
                embedding_provider as embeddingProvider,
                embedding_model as embeddingModel,
                embedding_base_url as embeddingBaseUrl,
                dimensions,
                chunk_size as chunkSize,
                chunk_overlap as chunkOverlap,
                document_count as documentCount,
                threshold,
                rerank_enabled as rerankEnabled,
                rerank_provider as rerankProvider,
                rerank_model as rerankModel,
                rerank_base_url as rerankBaseUrl,
                status,
                created_at as createdAt,
                updated_at as updatedAt
         FROM knowledge_bases
         ORDER BY updated_at DESC`
      )
      .all() as KnowledgeBaseRow[];
    return rows.map(mapKnowledgeBaseRow);
  }

  getKnowledgeBase(baseId: string) {
    validateId(baseId, "baseId");
    const row = this.db
      .prepare(
        `SELECT id,
                name,
                description,
                embedding_provider as embeddingProvider,
                embedding_model as embeddingModel,
                embedding_base_url as embeddingBaseUrl,
                dimensions,
                chunk_size as chunkSize,
                chunk_overlap as chunkOverlap,
                document_count as documentCount,
                threshold,
                rerank_enabled as rerankEnabled,
                rerank_provider as rerankProvider,
                rerank_model as rerankModel,
                rerank_base_url as rerankBaseUrl,
                status,
                created_at as createdAt,
                updated_at as updatedAt
         FROM knowledge_bases
         WHERE id = ?`
      )
      .get(baseId) as KnowledgeBaseRow | undefined;
    return row ? mapKnowledgeBaseRow(row) : undefined;
  }

  createKnowledgeBase(input: Required<Omit<KnowledgeBaseInput, "dimensions" | "rerankProvider" | "rerankModel" | "rerankBaseUrl">> & Pick<KnowledgeBaseInput, "dimensions" | "rerankProvider" | "rerankModel" | "rerankBaseUrl">) {
    const now = nowIso();
    const base: KnowledgeBase = {
      id: randomId("kb"),
      name: cleanText(input.name) || "Knowledge Base",
      description: cleanText(input.description),
      embeddingProvider: input.embeddingProvider,
      embeddingModel: cleanText(input.embeddingModel),
      embeddingBaseUrl: cleanText(input.embeddingBaseUrl),
      dimensions: input.dimensions,
      chunkSize: input.chunkSize,
      chunkOverlap: input.chunkOverlap,
      documentCount: input.documentCount,
      threshold: input.threshold,
      rerankEnabled: input.rerankEnabled,
      rerankProvider: cleanText(input.rerankProvider),
      rerankModel: cleanText(input.rerankModel),
      rerankBaseUrl: cleanText(input.rerankBaseUrl),
      status: "ready",
      createdAt: now,
      updatedAt: now
    };
    this.db
      .prepare(
        `INSERT INTO knowledge_bases
          (id, name, description, embedding_provider, embedding_model, embedding_base_url, dimensions, chunk_size, chunk_overlap, document_count, threshold, rerank_enabled, rerank_provider, rerank_model, rerank_base_url, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(base.id, base.name, base.description, base.embeddingProvider, base.embeddingModel, base.embeddingBaseUrl, base.dimensions ?? null, base.chunkSize, base.chunkOverlap, base.documentCount, base.threshold, base.rerankEnabled ? 1 : 0, base.rerankProvider ?? null, base.rerankModel ?? null, base.rerankBaseUrl ?? null, base.status, now, now);
    return base;
  }

  updateKnowledgeBase(baseId: string, patch: KnowledgeBaseInput) {
    const existing = this.getKnowledgeBase(baseId);
    if (!existing) return undefined;
    const now = nowIso();
    const next: KnowledgeBase = {
      ...existing,
      name: patch.name === undefined ? existing.name : cleanText(patch.name) || existing.name,
      description: patch.description === undefined ? existing.description : cleanText(patch.description),
      embeddingProvider: patch.embeddingProvider ?? existing.embeddingProvider,
      embeddingModel: patch.embeddingModel === undefined ? existing.embeddingModel : cleanText(patch.embeddingModel) || existing.embeddingModel,
      embeddingBaseUrl: patch.embeddingBaseUrl === undefined ? existing.embeddingBaseUrl : cleanText(patch.embeddingBaseUrl) || existing.embeddingBaseUrl,
      dimensions: patch.dimensions ?? existing.dimensions,
      chunkSize: readPositiveInteger(patch.chunkSize, existing.chunkSize),
      chunkOverlap: readNonNegativeInteger(patch.chunkOverlap, existing.chunkOverlap),
      documentCount: readPositiveInteger(patch.documentCount, existing.documentCount),
      threshold: readThreshold(patch.threshold, existing.threshold),
      rerankEnabled: patch.rerankEnabled ?? existing.rerankEnabled,
      rerankProvider: patch.rerankProvider === undefined ? existing.rerankProvider : cleanText(patch.rerankProvider) || undefined,
      rerankModel: patch.rerankModel === undefined ? existing.rerankModel : cleanText(patch.rerankModel) || undefined,
      rerankBaseUrl: patch.rerankBaseUrl === undefined ? existing.rerankBaseUrl : cleanText(patch.rerankBaseUrl) || undefined,
      updatedAt: now
    };
    this.db
      .prepare(
        `UPDATE knowledge_bases
         SET name = ?, description = ?, embedding_provider = ?, embedding_model = ?, embedding_base_url = ?, dimensions = ?, chunk_size = ?, chunk_overlap = ?, document_count = ?, threshold = ?, rerank_enabled = ?, rerank_provider = ?, rerank_model = ?, rerank_base_url = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(next.name, next.description, next.embeddingProvider, next.embeddingModel, next.embeddingBaseUrl, next.dimensions ?? null, next.chunkSize, next.chunkOverlap, next.documentCount, next.threshold, next.rerankEnabled ? 1 : 0, next.rerankProvider ?? null, next.rerankModel ?? null, next.rerankBaseUrl ?? null, now, baseId);
    return next;
  }

  setKnowledgeBaseStatus(baseId: string, status: KnowledgeBase["status"]) {
    validateId(baseId, "baseId");
    this.db.prepare(`UPDATE knowledge_bases SET status = ?, updated_at = ? WHERE id = ?`).run(status, nowIso(), baseId);
  }

  deleteKnowledgeBase(baseId: string) {
    validateId(baseId, "baseId");
    this.withTransaction(() => {
      this.db.prepare(`DELETE FROM knowledge_item_events WHERE base_id = ?`).run(baseId);
      this.db.prepare(`DELETE FROM knowledge_items WHERE base_id = ?`).run(baseId);
      this.db.prepare(`DELETE FROM knowledge_bases WHERE id = ?`).run(baseId);
    });
  }

  listKnowledgeItems(baseId: string) {
    validateId(baseId, "baseId");
    const rows = this.db
      .prepare(
        `SELECT id,
                base_id as baseId,
                type,
                title,
                source,
                content_text as contentText,
                unique_id as uniqueId,
                unique_ids_json as uniqueIdsJson,
                status,
                error_message as errorMessage,
                created_at as createdAt,
                updated_at as updatedAt
         FROM knowledge_items
         WHERE base_id = ?
         ORDER BY created_at DESC`
      )
      .all(baseId) as KnowledgeItemRow[];
    return rows.map(mapKnowledgeItemRow);
  }

  getKnowledgeItem(baseId: string, itemId: string) {
    validateId(itemId, "itemId");
    return this.listKnowledgeItems(baseId).find((item) => item.id === itemId);
  }

  createKnowledgeItem(baseId: string, input: KnowledgeItemInput) {
    validateId(baseId, "baseId");
    const now = nowIso();
    const item: KnowledgeItem = {
      id: randomId("kbi"),
      baseId,
      type: input.type,
      title: cleanText(input.title) || cleanText(input.fileName) || cleanText(input.source) || "Knowledge item",
      source: cleanText(input.source) || cleanText(input.fileName) || "manual",
      contentText: input.content,
      uniqueIds: [],
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    this.db
      .prepare(
        `INSERT INTO knowledge_items
          (id, base_id, type, title, source, content_text, unique_id, unique_ids_json, status, error_message, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(item.id, baseId, item.type, item.title, item.source, item.contentText ?? null, null, JSON.stringify([]), item.status, null, now, now);
    return item;
  }

  updateKnowledgeItemIndex(input: { baseId: string; itemId: string; status: KnowledgeItemStatus; uniqueId?: string; uniqueIds?: string[]; errorMessage?: string }) {
    validateId(input.baseId, "baseId");
    validateId(input.itemId, "itemId");
    this.db
      .prepare(
        `UPDATE knowledge_items
         SET status = ?, unique_id = ?, unique_ids_json = ?, error_message = ?, updated_at = ?
         WHERE id = ? AND base_id = ?`
      )
      .run(input.status, input.uniqueId ?? null, JSON.stringify(input.uniqueIds ?? []), input.errorMessage ?? null, nowIso(), input.itemId, input.baseId);
  }

  deleteKnowledgeItem(baseId: string, itemId: string) {
    validateId(baseId, "baseId");
    validateId(itemId, "itemId");
    this.withTransaction(() => {
      this.db.prepare(`DELETE FROM knowledge_item_events WHERE base_id = ? AND item_id = ?`).run(baseId, itemId);
      this.db.prepare(`DELETE FROM knowledge_items WHERE base_id = ? AND id = ?`).run(baseId, itemId);
    });
  }

  recordKnowledgeEvent(input: KnowledgeEventInput) {
    this.db
      .prepare(`INSERT INTO knowledge_item_events (id, base_id, item_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(randomId("kbe"), input.baseId, input.itemId ?? null, input.eventType, JSON.stringify(input.payload), nowIso());
  }

  getAgentSettings(agentCardId: string) {
    return this.agentSettings.getAgentSettings(agentCardId);
  }

  saveAgentSettings(agentCardId: string, settings: AgentSettings) {
    this.agentSettings.saveAgentSettings(agentCardId, settings);
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

    return rows.map((row) => ({
      ...row,
      content: sanitizeVisibleText(row.content),
      usedMock: Boolean(row.usedMock)
    }));
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
    return runSqliteTransaction(this.db, work);
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
    this.threads.touchThread(threadId, updatedAt);
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

function cleanStructuredValues(value: unknown): StoredStructuredValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const values: StoredStructuredValues = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(key)) continue;
    if (typeof rawValue === "string") {
      values[key] = rawValue.slice(0, 8000);
    } else if (Array.isArray(rawValue)) {
      values[key] = rawValue
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.slice(0, 1000))
        .slice(0, 50);
    }
  }
  return values;
}

type KnowledgeBaseRow = Omit<KnowledgeBase, "dimensions" | "rerankEnabled" | "rerankProvider" | "rerankModel" | "rerankBaseUrl"> & {
  dimensions: number | null;
  rerankEnabled: number;
  rerankProvider: string | null;
  rerankModel: string | null;
  rerankBaseUrl: string | null;
};

type KnowledgeItemRow = Omit<KnowledgeItem, "contentText" | "uniqueId" | "uniqueIds" | "errorMessage"> & {
  contentText: string | null;
  uniqueId: string | null;
  uniqueIdsJson: string;
  errorMessage: string | null;
};

function mapKnowledgeBaseRow(row: KnowledgeBaseRow): KnowledgeBase {
  return {
    ...row,
    dimensions: row.dimensions ?? undefined,
    rerankEnabled: Boolean(row.rerankEnabled),
    rerankProvider: row.rerankProvider ?? undefined,
    rerankModel: row.rerankModel ?? undefined,
    rerankBaseUrl: row.rerankBaseUrl ?? undefined
  };
}

function mapKnowledgeItemRow(row: KnowledgeItemRow): KnowledgeItem {
  const uniqueIds = parseJson(row.uniqueIdsJson);
  return {
    ...row,
    contentText: row.contentText ?? undefined,
    uniqueId: row.uniqueId ?? undefined,
    uniqueIds: Array.isArray(uniqueIds) ? uniqueIds.filter((value): value is string => typeof value === "string") : [],
    errorMessage: row.errorMessage ?? undefined
  };
}

function readPositiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function readNonNegativeInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function readThreshold(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}
