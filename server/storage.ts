import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AgentCard, AgentSettings } from "./agentCards.js";
import { createFacetWriteDatabase, runSqliteTransaction } from "./db/sqlite.js";
import { AgentSettingsRepository } from "./repositories/agentSettingsRepository.js";
import { CanvasRepository } from "./repositories/canvasRepository.js";
import { ClaimReviewRepository } from "./repositories/claimReviewRepository.js";
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
  CanvasNodePositionUpdate,
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
  CreateClaimFromSelectionInput,
  JsonValue,
  ProjectRuntimeSettings,
  ProjectBrief,
  RunRecordInput,
  StoredBrief,
  TaskBrief
} from "./storageTypes.js";
export type {
  CanvasEdge,
  CanvasEdgeInput,
  CanvasNode,
  CanvasNodeInput,
  CanvasNodeKind,
  CanvasNodePatch,
  CanvasNodePositionUpdate,
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
  ClaimCandidate,
  ClaimSourceAnchor,
  ClaimStatus,
  CreateClaimFromSelectionInput,
  ExtractClaimsInput,
  JsonValue,
  ProjectSummary,
  ProjectRuntimeSettings,
  ProjectBrief,
  RuntimeBudgetProfile,
  RunRecordInput,
  StoredMessage,
  StoredOutputVersion,
  StoredBrief,
  StoredThread,
  StoredToolEvent,
  TaskBrief
} from "./storageTypes.js";

export { resolveFacetWritePaths } from "./storagePaths.js";

const storagePaths = resolveFacetWritePaths();
const appRoot = storagePaths.appRoot;
const dbDir = storagePaths.dbDir;
const dbPath = storagePaths.dbPath;
const threadDirectoryManager = createThreadDirectoryManager(appRoot);
const projectThumbnailRoot = path.join(appRoot, "project-thumbnails");
const projectThumbnailTypes = new Map<string, ".webp" | ".png">([
  ["image/webp", ".webp"],
  ["image/png", ".png"]
]);
const maxThreadTitleLength = 120;
const maxProjectTitleLength = 120;

export class SQLiteStorageRepository {
  private db: DatabaseSync;
  private threads: ThreadRepository;
  private projects: ProjectRepository;
  private agentSettings: AgentSettingsRepository;
  private canvas: CanvasRepository;
  private claims: ClaimReviewRepository;
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
    this.claims = new ClaimReviewRepository(this.db, {
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

  createPlanRun(threadId: string, input: Parameters<PlanRepository["create"]>[1]) {
    const plan = this.plans.create(threadId, input);
    return plan.status === "awaiting_approval" ? this.syncPlanCanvasProjection(threadId, plan.id) ?? plan : plan;
  }
  createPlanIntake(threadId: string, input: Parameters<PlanRepository["createIntake"]>[1]) { return this.plans.createIntake(threadId, input); }
  updatePlanMetadata(threadId: string, planId: string, input: Parameters<PlanRepository["updateMetadata"]>[2]) { const plan = this.plans.updateMetadata(threadId, planId, input); return plan ? this.syncPlanCanvasProjection(threadId, planId) : undefined; }
  submitPlanClarification(threadId: string, planId: string, clarification: import("./storageTypes.js").PlanClarification) { return this.plans.submitClarification(threadId, planId, clarification); }
  revisePlanRun(threadId: string, planId: string, input: Parameters<PlanRepository["revise"]>[2]) {
    const plan = this.plans.revise(threadId, planId, input);
    return plan ? this.syncPlanCanvasProjection(threadId, plan.id) : undefined;
  }
  listPlanRuns(threadId: string) { return this.plans.list(threadId); }
  getPlanRun(threadId: string, planId: string) { return this.plans.get(threadId, planId); }
  approvePlanRun(threadId: string, planId: string) { const plan = this.plans.approve(threadId, planId); return plan ? this.syncPlanCanvasProjection(threadId, planId) : undefined; }
  pausePlanRun(threadId: string, planId: string, message = "Plan paused") { const plan = this.plans.pause(threadId, planId, message); return plan ? this.syncPlanCanvasProjection(threadId, planId) : undefined; }
  resumePlanRun(threadId: string, planId: string) { const plan = this.plans.resume(threadId, planId); return plan ? this.syncPlanCanvasProjection(threadId, planId) : undefined; }
  getPlanExecution(threadId: string, planId: string) { return this.plans.getExecution(threadId, planId); }
  listRunnablePlanExecutions() { return this.plans.listRunnableExecutions(); }
  claimPlanExecution(threadId: string, planId: string, owner: string) { return this.plans.claimExecution(threadId, planId, owner); }
  renewPlanExecutionLease(threadId: string, planId: string, owner: string) { return this.plans.renewExecutionLease(threadId, planId, owner); }
  releasePlanExecutionLease(threadId: string, planId: string, owner: string) { return this.plans.releaseExecution(threadId, planId, owner); }
  recordPlanActivity(threadId: string, planId: string, input: Parameters<PlanRepository["recordActivity"]>[2]) { return this.plans.recordActivity(threadId, planId, input); }
  listPlanActivities(threadId: string, planId: string) { return this.plans.listActivities(threadId, planId); }
  ensurePlanCanvasProjection(threadId: string, planId: string) { return this.syncPlanCanvasProjection(threadId, planId); }
  cancelPlanRun(threadId: string, planId: string) { const plan = this.plans.setStatus(threadId, planId, "cancelled", "rejected"); return plan ? this.syncPlanCanvasProjection(threadId, planId) : undefined; }
  setPlanWaitingForUser(threadId: string, planId: string, message: string) { return this.plans.setStatus(threadId, planId, "awaiting_user", undefined, message); }
  resumePlanWithAnswer(threadId: string, planId: string, answer: string | { optionId?: string; customAnswer?: string; answer?: string }) { return this.plans.resumeWithAnswer(threadId, planId, answer); }
  setPlanRunStatus(threadId: string, planId: string, status: import("./storageTypes.js").PlanRunStatus, message = "") { const plan = this.plans.setStatus(threadId, planId, status, undefined, message); return plan ? this.syncPlanCanvasProjection(threadId, planId) : undefined; }
  updatePlanStep(threadId: string, planId: string, stepId: string, patch: Parameters<PlanRepository["updateStep"]>[3]) { const step = this.plans.updateStep(threadId, planId, stepId, patch); this.syncPlanCanvasProjection(threadId, planId); return step; }
  retryPlanStep(threadId: string, planId: string, stepId: string) { const step = this.plans.retryStep(threadId, planId, stepId); this.syncPlanCanvasProjection(threadId, planId); return step; }
  stagePlanArtifact(threadId: string, planId: string, input: Parameters<PlanRepository["stageArtifact"]>[2]) { return this.plans.stageArtifact(threadId, planId, input); }
  markPlanArtifactCommitted(threadId: string, planId: string, artifactId: string, canvasTargetId: string) { const artifact = this.plans.markArtifact(threadId, planId, artifactId, "committed", canvasTargetId); this.syncPlanCanvasProjection(threadId, planId); return artifact; }
  markPlanArtifactFailed(threadId: string, planId: string, artifactId: string, error: string) { return this.plans.markArtifact(threadId, planId, artifactId, "failed", undefined, error); }
  stagePlanArtifactLinks(threadId: string, planId: string, links: Parameters<PlanRepository["stageArtifactLinks"]>[2]) { return this.plans.stageArtifactLinks(threadId, planId, links); }
  markPlanArtifactLinkCommitted(threadId: string, planId: string, linkId: string, canvasEdgeId: string) { return this.plans.markArtifactLinkCommitted(threadId, planId, linkId, canvasEdgeId); }
  createCanvasWriteSuggestion(threadId: string, runId: string, items: Array<{ title: string; content: string }>) {
    const projectId = this.getThread(threadId)?.projectId;
    if (!projectId) throw new Error("Thread not found");
    return this.canvas.createWriteSuggestion(threadId, projectId, runId, items);
  }
  listCanvasWriteSuggestions(threadId: string) { return this.canvas.listWriteSuggestions(threadId); }
  acceptCanvasWriteSuggestion(threadId: string, suggestionId: string) { return this.canvas.acceptWriteSuggestion(threadId, suggestionId); }
  dismissCanvasWriteSuggestion(threadId: string, suggestionId: string) { return this.canvas.dismissWriteSuggestion(threadId, suggestionId); }

  listClaims(threadId: string, sourceNodeId?: string, sourceDocumentPath?: string) { return this.claims.listClaims(threadId, sourceNodeId, sourceDocumentPath); }
  createClaim(projectId: string, threadId: string, input: Omit<CreateClaimFromSelectionInput, "selectedText" | "surroundingContext"> & { claimText: string; evidenceText: string; createdBy: "ai" | "user_selection"; extractionRunId?: string }) {
    return this.claims.createClaim(projectId, threadId, input);
  }
  updateClaim(threadId: string, claimId: string, input: import("../shared/claimReview.js").UpdateClaimInput) {
    return this.claims.updateClaim(threadId, claimId, input);
  }
  deleteClaim(threadId: string, claimId: string) {
    return this.claims.deleteClaim(threadId, claimId);
  }
  setClaimCanvasNode(threadId: string, claimId: string, canvasNodeId: string) {
    return this.claims.setClaimCanvasNode(threadId, claimId, canvasNodeId);
  }

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

  getProjectRuntimeSettings(projectId: string) {
    validateId(projectId, "projectId");
    return this.projects.getRuntimeSettings(projectId);
  }

  saveProjectRuntimeSettings(projectId: string, input: Partial<ProjectRuntimeSettings>) {
    validateId(projectId, "projectId");
    return this.projects.saveRuntimeSettings(projectId, input);
  }

  async ensureThread(threadId: string, projectId: string, title = "New conversation") {
    validateId(threadId, "threadId");
    validateId(projectId, "projectId");
    if (!this.getProject(projectId)) {
      const now = nowIso();
      this.db.prepare(`INSERT INTO projects (id, title, summary, created_at, updated_at) VALUES (?, 'Untitled project', '', ?, ?)
        ON CONFLICT(id) DO UPDATE SET deleted_at = NULL, updated_at = excluded.updated_at`)
        .run(projectId, now, now);
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

  async saveProjectThumbnail(projectId: string, input: { imageBase64: unknown; mimeType: unknown }) {
    validateId(projectId, "projectId");
    if (!this.getProject(projectId)) return undefined;
    const mimeType = typeof input.mimeType === "string" ? input.mimeType.toLowerCase() : "";
    const extension = projectThumbnailTypes.get(mimeType);
    if (!extension) throw new Error("Unsupported project thumbnail image type");
    const buffer = readThumbnailBase64(input.imageBase64);
    if (buffer.byteLength === 0 || buffer.byteLength > 2 * 1024 * 1024) throw new Error("Project thumbnail must be between 1 byte and 2MB");
    await mkdir(projectThumbnailRoot, { recursive: true });
    await Promise.all([...projectThumbnailTypes.values()]
      .filter((candidate) => candidate !== extension)
      .map((candidate) => rm(resolveProjectThumbnailPath(projectId, candidate), { force: true })));
    const updatedAt = nowIso();
    await writeFile(resolveProjectThumbnailPath(projectId, extension), buffer);
    await writeFile(resolveProjectThumbnailMetadataPath(projectId), `${JSON.stringify({ mimeType, updatedAt })}\n`, "utf8");
    this.projects.touch(projectId, updatedAt);
    return { mimeType, updatedAt };
  }

  async readProjectThumbnail(projectId: string) {
    validateId(projectId, "projectId");
    if (!this.getProject(projectId)) return undefined;
    for (const [mimeType, extension] of projectThumbnailTypes) {
      try {
        const content = await readFile(resolveProjectThumbnailPath(projectId, extension));
        const metadata = await readProjectThumbnailMetadata(projectId);
        return { content, mimeType, updatedAt: metadata?.updatedAt };
      } catch {
        // Try the next supported thumbnail format.
      }
    }
    return undefined;
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

  getProjectBrief(projectId: string): StoredBrief<ProjectBrief> {
    validateId(projectId, "projectId");
    const row = this.db
      .prepare(`SELECT payload_json as payloadJson, revision FROM project_briefs WHERE project_id = ?`)
      .get(projectId) as { payloadJson: string; revision: number } | undefined;
    return row ? { brief: cleanProjectBrief(parseJson(row.payloadJson)), revision: row.revision } : { brief: {}, revision: 0 };
  }

  saveProjectBrief(projectId: string, brief: unknown, revision: number): StoredBrief<ProjectBrief> | undefined {
    validateId(projectId, "projectId");
    if (!this.getProject(projectId)) return undefined;
    const values = cleanProjectBrief(brief);
    validateBriefRevision(revision, "Project Brief");
    const current = this.db
      .prepare(`SELECT revision FROM project_briefs WHERE project_id = ?`)
      .get(projectId) as { revision: number } | undefined;
    if (current && revision <= current.revision) throw new Error("Stale Project Brief revision");
    const now = nowIso();
    this.db.prepare(
      `INSERT INTO project_briefs (project_id, payload_json, revision, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET payload_json = excluded.payload_json, revision = excluded.revision, updated_at = excluded.updated_at`
    ).run(projectId, JSON.stringify(values), revision, now);
    this.db.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(now, projectId);
    return { brief: values, revision };
  }

  getTaskBrief(threadId: string): StoredBrief<TaskBrief> {
    validateId(threadId, "threadId");
    const row = this.db
      .prepare(`SELECT payload_json as payloadJson, revision FROM thread_task_briefs WHERE thread_id = ?`)
      .get(threadId) as { payloadJson: string; revision: number } | undefined;
    return row ? { brief: cleanTaskBrief(parseJson(row.payloadJson)), revision: row.revision } : { brief: {}, revision: 0 };
  }

  saveTaskBrief(threadId: string, brief: unknown, revision: number): StoredBrief<TaskBrief> | undefined {
    validateId(threadId, "threadId");
    if (!this.getThread(threadId)) return undefined;
    const values = cleanTaskBrief(brief);
    validateBriefRevision(revision, "Task Brief");
    const current = this.db
      .prepare(`SELECT revision FROM thread_task_briefs WHERE thread_id = ?`)
      .get(threadId) as { revision: number } | undefined;
    if (current && revision <= current.revision) throw new Error("Stale Task Brief revision");
    const now = nowIso();
    this.db.prepare(
      `INSERT INTO thread_task_briefs (thread_id, payload_json, revision, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET payload_json = excluded.payload_json, revision = excluded.revision, updated_at = excluded.updated_at`
    ).run(threadId, JSON.stringify(values), revision, now);
    this.db.prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`).run(now, threadId);
    return { brief: values, revision };
  }

  getProjectSharedContext(projectId: string) {
    validateId(projectId, "projectId");
    const project = this.getProject(projectId);
    if (!project) return undefined;
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
    const canvasNodes = takeBudgetedValues(
      this.listCanvasNodes(projectId)
        .filter((node) => node.includeInProjectContext)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((node) => ({ id: node.id, kind: node.kind, title: node.title, content: projectContextCanvasNodeContent(node) })),
      8_000
    );
    const recentOutputs = takeBudgetedValues(outputRows.map((row) => row.content), 6_000);
    return {
      projectId,
      title: truncateContextValue(project.title, 2_000),
      summary: truncateContextValue(project.summary, 2_000),
      projectBrief: this.getProjectBrief(projectId).brief,
      canvasNodes,
      recentOutputs
    };
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
        this.db.prepare(`DELETE FROM agent_clarifications WHERE thread_id = ?`).run(threadId);
        this.db.prepare(`DELETE FROM tool_events WHERE thread_id = ?`).run(threadId);
        this.db.prepare(`DELETE FROM output_versions WHERE thread_id = ?`).run(threadId);
        this.db.prepare(`DELETE FROM prompt_versions WHERE thread_id = ?`).run(threadId);
        this.db.prepare(`DELETE FROM runs WHERE thread_id = ?`).run(threadId);
        this.db.prepare(`DELETE FROM messages WHERE thread_id = ?`).run(threadId);
      }
      this.db.prepare(`DELETE FROM claim_candidates WHERE project_id = ?`).run(projectId);
      for (const table of ["canvas_edges", "canvas_objects", "canvas_workflow_suggestions", "canvas_workflows", "canvas_write_requests", "canvas_nodes"]) {
        this.db.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
      }
      this.db.prepare(`DELETE FROM project_briefs WHERE project_id = ?`).run(projectId);
      this.db.prepare(`DELETE FROM thread_task_briefs WHERE thread_id IN (SELECT id FROM threads WHERE project_id = ?)`).run(projectId);
      this.db.prepare(`DELETE FROM project_model_bindings WHERE project_id = ?`).run(projectId);
      this.db.prepare(`DELETE FROM threads WHERE project_id = ?`).run(projectId);
      this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
    });
    await Promise.all([
      ...[...threadIds, projectId].map((id) => rm(threadDataRoot(id), { recursive: true, force: true })),
      rm(resolveProjectThumbnailPath(projectId, ".webp"), { force: true }),
      rm(resolveProjectThumbnailPath(projectId, ".png"), { force: true }),
      rm(resolveProjectThumbnailMetadataPath(projectId), { force: true })
    ]);
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
      this.db.prepare(`DELETE FROM agent_clarifications WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM claim_candidates WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM tool_events WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM output_versions WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM prompt_versions WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM runs WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM messages WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM thread_task_briefs WHERE thread_id = ?`).run(threadId);
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

  updateCanvasNodePositions(threadId: string, updates: CanvasNodePositionUpdate[]) {
    return this.canvas.updateCanvasNodePositions(threadId, updates);
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

  listAgentClarifications(threadId: string) {
    return this.runs.listAgentClarifications(threadId);
  }

  answerAgentClarification(threadId: string, clarificationId: string, input: { selectedOptionId?: string; selectedOptionLabel?: string; answer?: string }) {
    return this.runs.answerAgentClarification(threadId, clarificationId, input);
  }

  recordToolEvent(threadId: string, runId: string, eventType: string, payload: JsonValue, createdAt = nowIso()) {
    this.runs.recordToolEvent(threadId, runId, eventType, payload, createdAt);
  }

  findRuntimeRunMetadata(threadId: string, runId: string) {
    return this.runs.findRuntimeRunMetadata(threadId, runId);
  }

  private syncPlanCanvasProjection(threadId: string, planId: string) {
    const plan = this.plans.get(threadId, planId);
    if (!plan || plan.status === "draft" || plan.status === "awaiting_user") return plan;
    const currentStep = plan.steps.find((step) => step.id === plan.currentStepId);
    const artifactCount = plan.artifacts.filter((artifact) => artifact.status === "committed").length;
    const stepSummaries = plan.steps.map((step) => ({
      id: step.id,
      title: step.title,
      detail: step.detail,
      status: step.status,
      attempt: step.attempt,
      error: step.error
    }));
    const artifactSummaries = plan.artifacts.map((artifact) => ({
      id: artifact.id,
      stepId: artifact.stepId,
      type: artifact.type,
      status: artifact.status,
      title: artifact.title,
      canvasTargetId: artifact.canvasTargetId,
      error: artifact.error
    }));
    const content = [
      `# ${plan.title}`,
      plan.goal,
      "",
      `Status: ${plan.status}${currentStep ? ` | Current: ${currentStep.title}` : ""}`,
      artifactCount ? `Artifacts: ${artifactCount} committed` : "Artifacts: none yet",
      "",
      ...plan.steps.map((step) => `${step.status === "completed" || step.status === "skipped" ? "[x]" : "[ ]"} ${step.title}${step.status === "running" ? " (running)" : step.status === "failed" ? ` (failed${step.error ? `: ${step.error}` : ""})` : ""}`),
      ...(plan.statusMessage ? ["", plan.statusMessage] : [])
    ].join("\n");
    const metadata = {
      planProjection: {
        planId: plan.id,
        threadId: plan.threadId,
        status: plan.status,
        approval: plan.approval,
        currentStepId: plan.currentStepId,
        statusMessage: plan.statusMessage,
        origin: plan.origin,
        complexity: plan.complexity,
        budget: plan.budget,
        preflight: plan.preflight,
        artifactCount,
        steps: stepSummaries,
        artifacts: artifactSummaries
      }
    };
    const existing = plan.canvasNodeId ? this.listCanvasNodes(plan.projectId).find((node) => node.id === plan.canvasNodeId) : undefined;
    const node = existing
      ? this.updateCanvasNode(plan.projectId, existing.id, { title: plan.title, content, metadata, includeInProjectContext: false })
      : this.createCanvasNode(plan.projectId, { kind: "plan", title: plan.title, content, width: 380, height: 300, metadata, includeInProjectContext: false });
    if (!node) return plan;
    if (!existing) return this.plans.setCanvasNodeId(threadId, planId, node.id);
    return this.plans.get(threadId, planId);
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

function projectContextCanvasNodeContent(node: { kind: string; content: string; metadata: unknown }) {
  if (node.kind !== "clarification") return node.content;
  const metadata = node.metadata && typeof node.metadata === "object" && !Array.isArray(node.metadata) ? node.metadata as Record<string, unknown> : {};
  const clarification = metadata.clarification && typeof metadata.clarification === "object" && !Array.isArray(metadata.clarification)
    ? metadata.clarification as Record<string, unknown>
    : undefined;
  if (!clarification || clarification.status !== "answered") return "";
  const question = typeof clarification.question === "string" ? clarification.question.trim() : "";
  const selectedOptionId = typeof clarification.selectedOptionId === "string" ? clarification.selectedOptionId : "";
  const customAnswer = typeof clarification.customAnswer === "string" ? clarification.customAnswer.trim() : "";
  const options = Array.isArray(clarification.options) ? clarification.options : [];
  const selected = options.find((option) => option && typeof option === "object" && !Array.isArray(option) && (option as Record<string, unknown>).id === selectedOptionId) as Record<string, unknown> | undefined;
  const label = typeof selected?.label === "string" ? selected.label.trim() : "";
  const detail = typeof selected?.detail === "string" ? selected.detail.trim() : typeof selected?.description === "string" ? selected.description.trim() : "";
  return [
    question ? `Question: ${question}` : "",
    customAnswer ? `Answer: ${customAnswer}` : label ? `Answer: ${label}` : "",
    detail ? `Detail: ${detail}` : ""
  ].filter(Boolean).join("\n");
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

function resolveProjectThumbnailPath(projectId: string, extension: ".webp" | ".png") {
  validateId(projectId, "projectId");
  const root = path.resolve(projectThumbnailRoot);
  const resolved = path.resolve(root, `${projectId}${extension}`);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Project thumbnail path must stay inside the local app workspace");
  return resolved;
}

function resolveProjectThumbnailMetadataPath(projectId: string) {
  validateId(projectId, "projectId");
  const root = path.resolve(projectThumbnailRoot);
  const resolved = path.resolve(root, `${projectId}.json`);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Project thumbnail metadata path must stay inside the local app workspace");
  return resolved;
}

async function readProjectThumbnailMetadata(projectId: string) {
  try {
    const parsed = parseJson(await readFile(resolveProjectThumbnailMetadataPath(projectId), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const updatedAt = (parsed as { updatedAt?: unknown }).updatedAt;
    return typeof updatedAt === "string" ? { updatedAt } : undefined;
  } catch {
    return undefined;
  }
}

function readThumbnailBase64(value: unknown) {
  if (typeof value !== "string") throw new Error("Project thumbnail image data must be base64");
  const imageBase64 = value.trim();
  if (!imageBase64 || imageBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) {
    throw new Error("Project thumbnail image data must be base64");
  }
  return Buffer.from(imageBase64, "base64");
}

function cleanProjectBrief(value: unknown): ProjectBrief {
  return cleanBriefRecord(value, ["goal", "audience", "background", "standingConstraints"]);
}

function cleanTaskBrief(value: unknown): TaskBrief {
  const values = cleanBriefRecord(value, ["objective", "deliverableDetails", "mustCover", "temporaryConstraints"]) as TaskBrief;
  const deliverableType = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>).deliverableType
    : undefined;
  if (deliverableType === "auto" || deliverableType === "document" || deliverableType === "outline" || deliverableType === "analysis" || deliverableType === "checklist" || deliverableType === "proposal") {
    values.deliverableType = deliverableType;
  }
  return values;
}

function cleanBriefRecord<T extends Record<string, string | undefined>>(value: unknown, keys: Array<keyof T>): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as T;
  const input = value as Record<string, unknown>;
  return Object.fromEntries(keys.flatMap((key) => {
    const item = input[String(key)];
    return typeof item === "string" && item.trim() ? [[key, item.trim().slice(0, 8000)]] : [];
  })) as T;
}

function validateBriefRevision(revision: number, label: string) {
  if (!Number.isInteger(revision) || revision < 1) throw new Error(`${label} revision must be a positive integer`);
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

function truncateContextRecord<T>(value: T): T {
  if (typeof value === "string") return truncateContextValue(value) as T;
  if (Array.isArray(value)) return value.map((item) => truncateContextRecord(item)) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, truncateContextRecord(item)])) as T;
}

