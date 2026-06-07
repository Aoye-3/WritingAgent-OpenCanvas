import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AgentCard, AgentSettings } from "./agentCards.js";
import { createFacetWriteDatabase, runSqliteTransaction } from "./db/sqlite.js";
import { AgentSettingsRepository } from "./repositories/agentSettingsRepository.js";
import { CanvasRepository } from "./repositories/canvasRepository.js";
import { KnowledgeRepository } from "./repositories/knowledgeRepository.js";
import { RunRepository } from "./repositories/runRepository.js";
import { cleanText, nowIso, parseJson, validateId } from "./repositories/storageRepositoryUtils.js";
import { ThreadRepository } from "./repositories/threadRepository.js";
import type { KnowledgeBase, KnowledgeBaseInput, KnowledgeEventInput, KnowledgeItemInput, KnowledgeItemStatus } from "./knowledge/types.js";
import { createThreadDirectoryManager, resolveFacetWritePaths } from "./storagePaths.js";
import type {
  CanvasEdgeInput,
  CanvasNodeInput,
  CanvasNodePatch,
  CanvasObjectInput,
  CanvasObjectPatch,
  CanvasNodeWorkflowPatch,
  CanvasSettings,
  CanvasSuggestionToNodeInput,
  CanvasWorkflow,
  CanvasWorkflowInput,
  CanvasWorkflowSuggestionInput,
  CanvasWriteRequestInput,
  CanvasWriteRequestStatus,
  JsonValue,
  RunRecordInput,
  StoredStructuredValues
} from "./storageTypes.js";
export type {
  CanvasEdge,
  CanvasEdgeInput,
  CanvasNode,
  CanvasNodeInput,
  CanvasNodeKind,
  CanvasNodePatch,
  CanvasObject,
  CanvasObjectInput,
  CanvasObjectKind,
  CanvasObjectPatch,
  CanvasNodeWorkflowPatch,
  CanvasSettings,
  CanvasSuggestionToNodeInput,
  CanvasWorkflow,
  CanvasWorkflowInput,
  CanvasWorkflowSuggestion,
  CanvasWorkflowSuggestionInput,
  CanvasWriteOperation,
  CanvasWriteRequest,
  CanvasWriteRequestInput,
  CanvasWriteRequestStatus,
  JsonValue,
  ProjectSummary,
  RunRecordInput,
  StoredMessage,
  StoredOutputVersion,
  StoredStructuredValues,
  StoredThread,
  StoredToolEvent
} from "./storageTypes.js";

export { resolveFacetWritePaths } from "./storagePaths.js";

const storagePaths = resolveFacetWritePaths();
const appRoot = storagePaths.appRoot;
const dbDir = storagePaths.dbDir;
const dbPath = storagePaths.dbPath;
const threadDirectoryManager = createThreadDirectoryManager(appRoot);
const maxThreadTitleLength = 120;

export class SQLiteStorageRepository {
  private db: DatabaseSync;
  private threads: ThreadRepository;
  private agentSettings: AgentSettingsRepository;
  private canvas: CanvasRepository;
  private knowledge: KnowledgeRepository;
  private runs: RunRepository;

  constructor() {
    this.db = createFacetWriteDatabase(dbPath);
    this.threads = new ThreadRepository(this.db);
    this.agentSettings = new AgentSettingsRepository(this.db, (work) => this.withTransaction(work));
    this.canvas = new CanvasRepository(this.db, {
      withTransaction: (work) => this.withTransaction(work),
      touchThread: (threadId, updatedAt) => this.touchThread(threadId, updatedAt)
    });
    this.knowledge = new KnowledgeRepository(this.db, {
      withTransaction: (work) => this.withTransaction(work)
    });
    this.runs = new RunRepository(this.db, {
      withTransaction: (work) => this.withTransaction(work),
      touchThread: (threadId, updatedAt) => this.touchThread(threadId, updatedAt)
    });
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
    return this.runs.recordRun(input);
  }

  listMessages(threadId: string) {
    return this.runs.listMessages(threadId);
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
      this.db.prepare(`DELETE FROM canvas_edges WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM canvas_objects WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM canvas_workflow_suggestions WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM canvas_workflows WHERE thread_id = ?`).run(threadId);
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
    return this.canvas.listCanvasNodes(threadId);
  }

  listCanvasEdges(threadId: string) {
    return this.canvas.listCanvasEdges(threadId);
  }

  createCanvasEdge(threadId: string, input: CanvasEdgeInput) {
    return this.canvas.createCanvasEdge(threadId, input);
  }

  deleteCanvasEdge(threadId: string, edgeId: string) {
    return this.canvas.deleteCanvasEdge(threadId, edgeId);
  }

  createCanvasNode(threadId: string, input: CanvasNodeInput) {
    return this.canvas.createCanvasNode(threadId, input);
  }

  updateCanvasNode(threadId: string, nodeId: string, patch: CanvasNodePatch) {
    return this.canvas.updateCanvasNode(threadId, nodeId, patch);
  }

  deleteCanvasNode(threadId: string, nodeId: string) {
    return this.canvas.deleteCanvasNode(threadId, nodeId);
  }

  createCanvasWriteRequest(threadId: string, input: CanvasWriteRequestInput) {
    return this.canvas.createCanvasWriteRequest(threadId, input);
  }

  listCanvasWriteRequests(threadId: string, status?: CanvasWriteRequestStatus) {
    return this.canvas.listCanvasWriteRequests(threadId, status);
  }

  approveCanvasWriteRequest(threadId: string, requestId: string) {
    return this.canvas.approveCanvasWriteRequest(threadId, requestId);
  }

  rejectCanvasWriteRequest(threadId: string, requestId: string) {
    return this.canvas.rejectCanvasWriteRequest(threadId, requestId);
  }

  getCanvasSettings(): CanvasSettings {
    return this.canvas.getCanvasSettings();
  }

  saveCanvasSettings(input: Partial<CanvasSettings>): CanvasSettings {
    return this.canvas.saveCanvasSettings(input);
  }

  listCanvasObjects(threadId: string) {
    return this.canvas.listCanvasObjects(threadId);
  }

  createCanvasObject(threadId: string, input: CanvasObjectInput) {
    return this.canvas.createCanvasObject(threadId, input);
  }

  async createCanvasAsset(threadId: string, input: { fileName: string; fileBase64: string }) {
    validateId(threadId, "threadId");
    const fileName = cleanText(input.fileName);
    const extension = path.extname(fileName).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".docx", ".txt", ".md"].includes(extension)) {
      throw new Error("Unsupported Canvas asset file type");
    }
    const buffer = Buffer.from(input.fileBase64, "base64");
    if (buffer.byteLength === 0 || buffer.byteLength > 20 * 1024 * 1024) throw new Error("Canvas asset must be between 1 byte and 20MB");
    await ensureThreadDirs(threadId);
    const storedName = `${Date.now().toString(36)}-${fileName.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    const relativePath = path.join("uploads", storedName).replace(/\\/g, "/");
    const fullPath = resolveThreadRelativePath(threadId, relativePath);
    await writeFile(fullPath, buffer);
      return this.canvas.createCanvasAssetObject(threadId, {
        geometry: { x: 160, y: 160, width: extension.match(/\.(png|jpe?g|gif|webp)$/) ? 320 : 260, height: 180 },
        data: { name: fileName, extension, size: buffer.byteLength, relativePath, previewable: Boolean(extension.match(/\.(png|jpe?g|gif|webp)$/)) }
      });
  }

  async readCanvasAsset(threadId: string, objectId: string) {
    const object = this.canvas.listCanvasObjects(threadId).find((item) => item.id === objectId && item.kind === "asset");
    const relativePath = object && typeof object.data === "object" && !Array.isArray(object.data) ? (object.data as { relativePath?: unknown }).relativePath : undefined;
    if (typeof relativePath !== "string") return undefined;
    const extension = typeof (object!.data as { extension?: unknown }).extension === "string" ? (object!.data as { extension: string }).extension : "";
    return { content: await readFile(resolveThreadRelativePath(threadId, relativePath)), extension };
  }

  updateCanvasObject(threadId: string, objectId: string, patch: CanvasObjectPatch) {
    return this.canvas.updateCanvasObject(threadId, objectId, patch);
  }

  async deleteCanvasObject(threadId: string, objectId: string) {
    const object = this.canvas.listCanvasObjects(threadId).find((item) => item.id === objectId);
    const deleted = this.canvas.deleteCanvasObject(threadId, objectId);
    if (deleted && object?.kind === "asset" && object.data && typeof object.data === "object" && !Array.isArray(object.data)) {
      const relativePath = (object.data as { relativePath?: unknown }).relativePath;
      if (typeof relativePath === "string") await rm(resolveThreadRelativePath(threadId, relativePath), { force: true });
    }
    return deleted;
  }

  getCanvasWorkflow(threadId: string): CanvasWorkflow {
    return this.canvas.getCanvasWorkflow(threadId);
  }

  updateCanvasWorkflow(threadId: string, input: CanvasWorkflowInput): CanvasWorkflow {
    return this.canvas.updateCanvasWorkflow(threadId, input);
  }

  updateCanvasNodeWorkflow(threadId: string, nodeId: string, patch: CanvasNodeWorkflowPatch) {
    return this.canvas.updateCanvasNodeWorkflow(threadId, nodeId, patch);
  }

  migrateCanvasWorkflowRoleNodes(threadId: string) {
    return this.canvas.migrateCanvasWorkflowRoleNodes(threadId);
  }

  listCanvasWorkflowSuggestions(threadId: string, nodeId?: string) {
    return this.canvas.listCanvasWorkflowSuggestions(threadId, nodeId);
  }

  createCanvasWorkflowSuggestion(threadId: string, input: CanvasWorkflowSuggestionInput) {
    return this.canvas.createCanvasWorkflowSuggestion(threadId, input);
  }

  acceptCanvasWorkflowSuggestion(threadId: string, suggestionId: string) {
    return this.canvas.acceptCanvasWorkflowSuggestion(threadId, suggestionId);
  }

  ignoreCanvasWorkflowSuggestion(threadId: string, suggestionId: string) {
    return this.canvas.ignoreCanvasWorkflowSuggestion(threadId, suggestionId);
  }

  convertCanvasWorkflowSuggestionToNode(threadId: string, suggestionId: string, input: CanvasSuggestionToNodeInput = {}) {
    return this.canvas.convertCanvasWorkflowSuggestionToNode(threadId, suggestionId, input);
  }

  listKnowledgeBases() {
    return this.knowledge.listKnowledgeBases();
  }

  getKnowledgeBase(baseId: string) {
    return this.knowledge.getKnowledgeBase(baseId);
  }

  createKnowledgeBase(input: Required<Omit<KnowledgeBaseInput, "dimensions" | "embeddingConfigId" | "rerankConfigId" | "rerankProvider" | "rerankModel" | "rerankBaseUrl">> & Pick<KnowledgeBaseInput, "dimensions" | "embeddingConfigId" | "rerankConfigId" | "rerankProvider" | "rerankModel" | "rerankBaseUrl">) {
    return this.knowledge.createKnowledgeBase(input);
  }

  updateKnowledgeBase(baseId: string, patch: KnowledgeBaseInput) {
    return this.knowledge.updateKnowledgeBase(baseId, patch);
  }

  setKnowledgeBaseStatus(baseId: string, status: KnowledgeBase["status"]) {
    this.knowledge.setKnowledgeBaseStatus(baseId, status);
  }

  deleteKnowledgeBase(baseId: string) {
    this.knowledge.deleteKnowledgeBase(baseId);
  }

  listKnowledgeItems(baseId: string) {
    return this.knowledge.listKnowledgeItems(baseId);
  }

  getKnowledgeItem(baseId: string, itemId: string) {
    return this.knowledge.getKnowledgeItem(baseId, itemId);
  }

  createKnowledgeItem(baseId: string, input: KnowledgeItemInput) {
    return this.knowledge.createKnowledgeItem(baseId, input);
  }

  updateKnowledgeItemIndex(input: { baseId: string; itemId: string; status: KnowledgeItemStatus; uniqueId?: string; uniqueIds?: string[]; errorMessage?: string }) {
    this.knowledge.updateKnowledgeItemIndex(input);
  }

  deleteKnowledgeItem(baseId: string, itemId: string) {
    this.knowledge.deleteKnowledgeItem(baseId, itemId);
  }

  recordKnowledgeEvent(input: KnowledgeEventInput) {
    this.knowledge.recordKnowledgeEvent(input);
  }

  getAgentSettings(agentCardId: string) {
    return this.agentSettings.getAgentSettings(agentCardId);
  }

  saveAgentSettings(agentCardId: string, settings: AgentSettings) {
    this.agentSettings.saveAgentSettings(agentCardId, settings);
  }

  listOutputVersions(threadId: string) {
    return this.runs.listOutputVersions(threadId);
  }

  listToolEvents(threadId: string) {
    return this.runs.listToolEvents(threadId);
  }

  recordToolEvent(threadId: string, runId: string, eventType: string, payload: JsonValue, createdAt = nowIso()) {
    this.runs.recordToolEvent(threadId, runId, eventType, payload, createdAt);
  }

  private withTransaction<T>(work: () => T) {
    return runSqliteTransaction(this.db, work);
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
  await threadDirectoryManager.ensureThreadDirs(threadId);
}

function threadDataRoot(threadId: string) {
  return threadDirectoryManager.threadDataRoot(threadId);
}

function resolveThreadRelativePath(threadId: string, relativePath: string) {
  const root = path.resolve(threadDataRoot(threadId), "user-data");
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Canvas asset path must stay inside the thread workspace");
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

