import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AgentCard, AgentSettings } from "./agentCards.js";
import { createFacetWriteDatabase, runSqliteTransaction } from "./db/sqlite.js";
import { AgentSettingsRepository } from "./repositories/agentSettingsRepository.js";
import { CanvasRepository } from "./repositories/canvasRepository.js";
import { KnowledgeRepository } from "./repositories/knowledgeRepository.js";
import { RunRepository } from "./repositories/runRepository.js";
import { ProjectRepository } from "./repositories/projectRepository.js";
import { cleanText, nowIso, parseJson, validateId } from "./repositories/storageRepositoryUtils.js";
import { ThreadRepository } from "./repositories/threadRepository.js";
import { PlanRepository } from "./repositories/planRepository.js";
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
const maxProjectTitleLength = 120;

export class SQLiteStorageRepository {
  private db: DatabaseSync;
  private threads: ThreadRepository;
  private projects: ProjectRepository;
  private agentSettings: AgentSettingsRepository;
  private canvas: CanvasRepository;
  private knowledge: KnowledgeRepository;
  private runs: RunRepository;
  private plans: PlanRepository;

  constructor() {
    this.db = createFacetWriteDatabase(dbPath);
    this.threads = new ThreadRepository(this.db);
    this.projects = new ProjectRepository(this.db);
    this.agentSettings = new AgentSettingsRepository(this.db, (work) => this.withTransaction(work));
    this.canvas = new CanvasRepository(this.db, {
      withTransaction: (work) => this.withTransaction(work),
      touchProject: (projectId, updatedAt) => this.touchProject(projectId, updatedAt)
    });
    this.knowledge = new KnowledgeRepository(this.db, {
      withTransaction: (work) => this.withTransaction(work)
    });
    this.runs = new RunRepository(this.db, {
      withTransaction: (work) => this.withTransaction(work),
      touchThread: (threadId, updatedAt) => this.touchThread(threadId, updatedAt)
    });
    this.plans = new PlanRepository(this.db);
  }

  createPlanRun(threadId: string, input: Parameters<PlanRepository["create"]>[1]) { return this.plans.create(threadId, input); }
  revisePlanRun(threadId: string, planId: string, input: Parameters<PlanRepository["revise"]>[2]) { return this.plans.revise(threadId, planId, input); }
  listPlanRuns(threadId: string) { return this.plans.list(threadId); }
  getPlanRun(threadId: string, planId: string) { return this.plans.get(threadId, planId); }
  approvePlanRun(threadId: string, planId: string) { return this.plans.setStatus(threadId, planId, "running", "approved"); }
  cancelPlanRun(threadId: string, planId: string) { return this.plans.setStatus(threadId, planId, "cancelled", "rejected"); }
  setPlanWaitingForUser(threadId: string, planId: string, message: string) { return this.plans.setStatus(threadId, planId, "awaiting_user", undefined, message); }
  resumePlanWithAnswer(threadId: string, planId: string, answer: string) { return this.plans.resumeWithAnswer(threadId, planId, answer); }
  setPlanRunStatus(threadId: string, planId: string, status: import("./storageTypes.js").PlanRunStatus, message = "") { return this.plans.setStatus(threadId, planId, status, undefined, message); }
  updatePlanStep(threadId: string, planId: string, stepId: string, patch: Parameters<PlanRepository["updateStep"]>[3]) { return this.plans.updateStep(threadId, planId, stepId, patch); }
  retryPlanStep(threadId: string, planId: string, stepId: string) { return this.plans.retryStep(threadId, planId, stepId); }
  stagePlanArtifact(threadId: string, planId: string, input: Parameters<PlanRepository["stageArtifact"]>[2]) { return this.plans.stageArtifact(threadId, planId, input); }
  markPlanArtifactCommitted(threadId: string, planId: string, artifactId: string, canvasTargetId: string) { return this.plans.markArtifact(threadId, planId, artifactId, "committed", canvasTargetId); }
  markPlanArtifactFailed(threadId: string, planId: string, artifactId: string, error: string) { return this.plans.markArtifact(threadId, planId, artifactId, "failed", undefined, error); }
  stagePlanArtifactLinks(threadId: string, planId: string, links: Parameters<PlanRepository["stageArtifactLinks"]>[2]) { return this.plans.stageArtifactLinks(threadId, planId, links); }
  markPlanArtifactLinkCommitted(threadId: string, planId: string, linkId: string, canvasEdgeId: string) { return this.plans.markArtifactLinkCommitted(threadId, planId, linkId, canvasEdgeId); }

  createProject(projectId: string, title: unknown, summary = "") {
    validateId(projectId, "projectId");
    const cleanTitle = cleanText(title);
    if (!cleanTitle) throw new Error("Project title is required");
    if (cleanTitle.length > maxProjectTitleLength) throw new Error(`Project title must be ${maxProjectTitleLength} characters or fewer`);
    return this.projects.create(projectId, cleanTitle, cleanText(summary));
  }

  getProject(projectId: string) {
    validateId(projectId, "projectId");
    return this.projects.get(projectId);
  }

  async ensureThread(threadId: string, projectId: string, title = "New conversation") {
    validateId(threadId, "threadId");
    validateId(projectId, "projectId");
    if (!this.getProject(projectId)) {
      this.createProject(projectId, "Untitled project");
    }
    await ensureThreadDirs(threadId);
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO threads (id, project_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, updated_at = excluded.updated_at`
      )
      .run(threadId, projectId, cleanText(title) || "New conversation", now, now);
    return this.getThread(threadId);
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

  resetThreadContext(threadId: string) {
    validateId(threadId, "threadId");
    return this.threads.resetContext(threadId);
  }

  listRecentThreads(limit = 8) {
    return this.threads.listRecentThreads(limit);
  }

  listProjectThreads(projectId: string) {
    validateId(projectId, "projectId");
    return this.threads.listProjectThreads(projectId);
  }

  listProjects(_cards?: AgentCard[], includeDeleted = false) {
    return this.projects.list(includeDeleted);
  }

  getProjectModelBindings(projectId: string) {
    validateId(projectId, "projectId");
    return (this.db
      .prepare(`SELECT configured_model_api_id as id FROM project_model_bindings WHERE project_id = ? ORDER BY created_at ASC`)
      .all(projectId) as { id: string }[]).map((row) => row.id);
  }

  setProjectModelBindings(projectId: string, configIds: string[]) {
    validateId(projectId, "projectId");
    if (!this.getProject(projectId)) throw new Error("Project not found");
    const ids = [...new Set(configIds.map((id) => {
      validateId(id, "configuredModelApiId");
      return id;
    }))];
    const now = nowIso();
    this.withTransaction(() => {
      this.db.prepare(`DELETE FROM project_model_bindings WHERE project_id = ?`).run(projectId);
      const insert = this.db.prepare(`INSERT INTO project_model_bindings (project_id, configured_model_api_id, created_at) VALUES (?, ?, ?)`);
      ids.forEach((id) => insert.run(projectId, id, now));
      this.db.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(now, projectId);
    });
    return ids;
  }

  setThreadModelConfig(threadId: string, configuredModelApiId?: string) {
    validateId(threadId, "threadId");
      if (configuredModelApiId) validateId(configuredModelApiId, "configuredModelApiId");
      const thread = this.getThread(threadId);
      if (!thread) return undefined;
      this.db.prepare(`UPDATE threads SET configured_model_api_id = ?, updated_at = ? WHERE id = ?`).run(configuredModelApiId ?? null, nowIso(), threadId);
    return this.getThread(threadId);
  }

  getProjectAgentInputValues(projectId: string, agentCardId: string): StoredStructuredValues {
    validateId(projectId, "projectId");
    validateId(agentCardId, "agentCardId");
    const row = this.db
      .prepare(`SELECT structured_values_json as structuredValuesJson FROM project_agent_inputs WHERE project_id = ? AND agent_card_id = ?`)
      .get(projectId, agentCardId) as { structuredValuesJson: string } | undefined;
    return row ? cleanStructuredValues(parseJson(row.structuredValuesJson)) : {};
  }

  saveProjectAgentInputValues(projectId: string, agentCardId: string, structuredValues: unknown, revision: number) {
    validateId(projectId, "projectId");
    validateId(agentCardId, "agentCardId");
    if (!this.getProject(projectId)) return undefined;
    const values = cleanStructuredValues(structuredValues);
    if (!Number.isInteger(revision) || revision < 1) throw new Error("Project Agent input revision must be a positive integer");
    const current = this.db
      .prepare(`SELECT revision FROM project_agent_inputs WHERE project_id = ? AND agent_card_id = ?`)
      .get(projectId, agentCardId) as { revision: number } | undefined;
    if (current && revision <= current.revision) throw new Error("Stale Project Agent input revision");
    const now = nowIso();
    this.db.prepare(
      `INSERT INTO project_agent_inputs (project_id, agent_card_id, structured_values_json, revision, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id, agent_card_id) DO UPDATE SET structured_values_json = excluded.structured_values_json, revision = excluded.revision, updated_at = excluded.updated_at`
    ).run(projectId, agentCardId, JSON.stringify(values), revision, now);
    this.db.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(now, projectId);
    return { structuredValues: values, revision };
  }

  getProjectSharedContext(projectId: string) {
    validateId(projectId, "projectId");
    const project = this.getProject(projectId);
    if (!project) return undefined;
    const inputRows = this.db
      .prepare(`SELECT agent_card_id as agentCardId, structured_values_json as valuesJson FROM project_agent_inputs WHERE project_id = ? ORDER BY updated_at DESC`)
      .all(projectId) as { agentCardId: string; valuesJson: string }[];
    const outputRows = this.db
      .prepare(
        `SELECT output_versions.content
         FROM output_versions
         JOIN threads ON threads.id = output_versions.thread_id
         WHERE threads.project_id = ? AND output_versions.include_in_project_context = 1
         ORDER BY output_versions.created_at DESC
         LIMIT 24`
      )
      .all(projectId) as { content: string }[];
    const agentInputs = takeBudgetedEntries(
      inputRows.map((row) => [row.agentCardId, cleanStructuredValues(parseJson(row.valuesJson))] as const),
      8_000
    );
    const canvasNodes = takeBudgetedValues(
      this.listCanvasNodes(projectId)
        .filter((node) => node.includeInProjectContext)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((node) => ({ id: node.id, kind: node.kind, title: node.title, content: node.content })),
      8_000
    );
    const recentOutputs = takeBudgetedValues(outputRows.map((row) => row.content), 6_000);
    return {
      projectId,
      title: truncateContextValue(project.title, 2_000),
      summary: truncateContextValue(project.summary, 2_000),
      agentInputs: Object.fromEntries(agentInputs),
      canvasNodes,
      recentOutputs
    };
  }

  getAllProjectAgentInputValues(projectId: string) {
    return this.getProjectSharedContext(projectId)?.agentInputs ?? {};
  }

  getAllProjectAgentInputRevisions(projectId: string) {
    validateId(projectId, "projectId");
    return Object.fromEntries((this.db
      .prepare(`SELECT agent_card_id as agentCardId, revision FROM project_agent_inputs WHERE project_id = ?`)
      .all(projectId) as { agentCardId: string; revision: number }[]).map((row) => [row.agentCardId, row.revision]));
  }

  renameProject(projectId: string, title: unknown) {
    validateId(projectId, "projectId");
    const cleanTitle = cleanText(title);
    if (!cleanTitle) throw new Error("Project title is required");
    if (cleanTitle.length > maxProjectTitleLength) throw new Error(`Project title must be ${maxProjectTitleLength} characters or fewer`);
    return this.projects.rename(projectId, cleanTitle);
  }

  moveProjectToTrash(projectId: string) {
    validateId(projectId, "projectId");
    return this.projects.moveToTrash(projectId);
  }

  restoreProject(projectId: string) {
    validateId(projectId, "projectId");
    return this.projects.restore(projectId);
  }

  async hardDeleteProject(projectId: string) {
    validateId(projectId, "projectId");
    const project = this.db.prepare(`SELECT id FROM projects WHERE id = ? AND deleted_at IS NOT NULL`).get(projectId);
    if (!project) return false;
    const threadIds = (this.db.prepare(`SELECT id FROM threads WHERE project_id = ?`).all(projectId) as { id: string }[]).map((row) => row.id);
    this.withTransaction(() => {
      for (const threadId of threadIds) {
        this.db.prepare(`DELETE FROM plan_artifact_links WHERE plan_run_id IN (SELECT id FROM plan_runs WHERE thread_id = ?)`).run(threadId);
        this.db.prepare(`DELETE FROM plan_artifacts WHERE plan_run_id IN (SELECT id FROM plan_runs WHERE thread_id = ?)`).run(threadId);
        this.db.prepare(`DELETE FROM plan_steps WHERE plan_run_id IN (SELECT id FROM plan_runs WHERE thread_id = ?)`).run(threadId);
        this.db.prepare(`DELETE FROM plan_runs WHERE thread_id = ?`).run(threadId);
        this.db.prepare(`DELETE FROM tool_events WHERE thread_id = ?`).run(threadId);
        this.db.prepare(`DELETE FROM output_versions WHERE thread_id = ?`).run(threadId);
        this.db.prepare(`DELETE FROM prompt_versions WHERE thread_id = ?`).run(threadId);
        this.db.prepare(`DELETE FROM runs WHERE thread_id = ?`).run(threadId);
        this.db.prepare(`DELETE FROM messages WHERE thread_id = ?`).run(threadId);
      }
      for (const table of ["canvas_edges", "canvas_objects", "canvas_workflow_suggestions", "canvas_workflows", "canvas_write_requests", "canvas_nodes"]) {
        this.db.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
      }
      this.db.prepare(`DELETE FROM project_agent_inputs WHERE project_id = ?`).run(projectId);
      this.db.prepare(`DELETE FROM project_model_bindings WHERE project_id = ?`).run(projectId);
      this.db.prepare(`DELETE FROM threads WHERE project_id = ?`).run(projectId);
      this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
    });
    await Promise.all([...threadIds, projectId].map((id) => rm(threadDataRoot(id), { recursive: true, force: true })));
    return true;
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

  async hardDeleteThread(threadId: string) {
    validateId(threadId, "threadId");
    const thread = this.db.prepare(`SELECT id FROM threads WHERE id = ? AND deleted_at IS NOT NULL`).get(threadId);
    if (!thread) return false;

    this.withTransaction(() => {
      this.db.prepare(`DELETE FROM plan_artifact_links WHERE plan_run_id IN (SELECT id FROM plan_runs WHERE thread_id = ?)`).run(threadId);
      this.db.prepare(`DELETE FROM plan_artifacts WHERE plan_run_id IN (SELECT id FROM plan_runs WHERE thread_id = ?)`).run(threadId);
      this.db.prepare(`DELETE FROM plan_steps WHERE plan_run_id IN (SELECT id FROM plan_runs WHERE thread_id = ?)`).run(threadId);
      this.db.prepare(`DELETE FROM plan_runs WHERE thread_id = ?`).run(threadId);
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

  async createCanvasAsset(threadId: string, input: { fileName: string; fileBase64: string; sourceUrl?: string; pageUrl?: string; caption?: string; alt?: string }) {
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
        data: { name: fileName, extension, size: buffer.byteLength, relativePath, previewable: Boolean(extension.match(/\.(png|jpe?g|gif|webp)$/)), sourceUrl: cleanText(input.sourceUrl), pageUrl: cleanText(input.pageUrl), caption: cleanText(input.caption), alt: cleanText(input.alt) }
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

  setOutputVersionProjectContext(threadId: string, outputVersionId: string, included: boolean) {
    validateId(threadId, "threadId");
    validateId(outputVersionId, "outputVersionId");
    return this.runs.setOutputVersionProjectContext(threadId, outputVersionId, included);
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

  private touchProject(projectId: string, updatedAt = nowIso()) {
    this.projects.touch(projectId, updatedAt);
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

function truncateContextValue(value: string, limit = 4_000) {
  return value.length <= limit ? value : value.slice(0, limit);
}

function takeBudgetedValues<T>(values: T[], budget: number) {
  const selected: T[] = [];
  let used = 0;
  for (const value of values) {
    const normalized = typeof value === "string" ? truncateContextValue(value) : truncateContextRecord(value);
    const size = JSON.stringify(normalized).length;
    if (used + size > budget) continue;
    selected.push(normalized as T);
    used += size;
  }
  return selected;
}

function takeBudgetedEntries<T>(entries: ReadonlyArray<readonly [string, T]>, budget: number) {
  const selected: Array<readonly [string, T]> = [];
  let used = 0;
  for (const [key, value] of entries) {
    const normalized = truncateContextRecord(value);
    const size = key.length + JSON.stringify(normalized).length;
    if (used + size > budget) continue;
    selected.push([key, normalized as T]);
    used += size;
  }
  return selected;
}

function truncateContextRecord<T>(value: T): T {
  if (typeof value === "string") return truncateContextValue(value) as T;
  if (Array.isArray(value)) return value.map((item) => truncateContextRecord(item)) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, truncateContextRecord(item)])) as T;
}

