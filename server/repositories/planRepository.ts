import type { DatabaseSync } from "node:sqlite";
import type { JsonValue, PlanArtifact, PlanArtifactLink, PlanRun, PlanRunStatus, PlanStep, PlanStepStatus } from "../storageTypes.js";
import { cleanText, nowIso, parseJson, randomId, validateId } from "./storageRepositoryUtils.js";

export class PlanRepository {
  constructor(private readonly db: DatabaseSync) {}

  create(threadId: string, input: { title: unknown; goal: unknown; runId?: string; steps: Array<{ id?: string; title: unknown; detail?: unknown }> }) {
    validateId(threadId, "threadId");
    const thread = this.db.prepare(`SELECT project_id as projectId FROM threads WHERE id = ?`).get(threadId) as { projectId: string } | undefined;
    if (!thread) throw new Error("Thread not found");
    const title = cleanText(input.title);
    const goal = cleanText(input.goal);
    if (!title || !goal || !Array.isArray(input.steps) || input.steps.length === 0) throw new Error("Plan title, goal, and steps are required");
    const id = randomId("plan");
    const now = nowIso();
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`INSERT INTO plan_runs (id, project_id, thread_id, run_id, title, goal, status, approval, status_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'awaiting_approval', 'pending', '', ?, ?)`)
        .run(id, thread.projectId, threadId, input.runId ?? null, title, goal, now, now);
      const insert = this.db.prepare(`INSERT INTO plan_steps (id, plan_run_id, step_order, title, detail, status, attempt) VALUES (?, ?, ?, ?, ?, 'pending', 0)`);
      input.steps.forEach((step, order) => insert.run(step.id ? cleanId(step.id) : `step_${order + 1}`, id, order, cleanText(step.title), cleanText(step.detail)));
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.get(threadId, id)!;
  }

  list(threadId: string) {
    validateId(threadId, "threadId");
    const ids = this.db.prepare(`SELECT id FROM plan_runs WHERE thread_id = ? ORDER BY created_at ASC`).all(threadId) as { id: string }[];
    return ids.map(({ id }) => this.get(threadId, id)!);
  }

  get(threadId: string, planId: string): PlanRun | undefined {
    validateId(threadId, "threadId"); validateId(planId, "planId");
    const row = this.db.prepare(`SELECT id, project_id as projectId, thread_id as threadId, run_id as runId, title, goal, status, approval, status_message as statusMessage, created_at as createdAt, updated_at as updatedAt FROM plan_runs WHERE thread_id = ? AND id = ?`).get(threadId, planId) as Omit<PlanRun, "steps" | "artifacts" | "links"> | undefined;
    if (!row) return undefined;
    const steps = this.db.prepare(`SELECT id, plan_run_id as planRunId, step_order as 'order', title, detail, status, attempt, started_at as startedAt, completed_at as completedAt, error FROM plan_steps WHERE plan_run_id = ? ORDER BY step_order`).all(planId) as PlanStep[];
    const artifacts = (this.db.prepare(`SELECT id, plan_run_id as planRunId, step_id as stepId, type, status, title, payload_json as payloadJson, source_json as sourceJson, canvas_target_id as canvasTargetId, layout_json as layoutJson, error, created_at as createdAt, updated_at as updatedAt FROM plan_artifacts WHERE plan_run_id = ? ORDER BY created_at`).all(planId) as Array<Omit<PlanArtifact, "payload" | "source" | "layout"> & { payloadJson: string; sourceJson: string; layoutJson: string }>).map(({ payloadJson, sourceJson, layoutJson, ...item }) => ({ ...item, payload: parseJson(payloadJson) as JsonValue, source: parseJson(sourceJson) as JsonValue, layout: parseJson(layoutJson) as JsonValue }));
    const links = this.db.prepare(`SELECT id, plan_run_id as planRunId, from_artifact_id as fromArtifactId, to_artifact_id as toArtifactId, label, canvas_edge_id as canvasEdgeId FROM plan_artifact_links WHERE plan_run_id = ?`).all(planId) as PlanRun["links"];
    return { ...row, steps, artifacts, links };
  }

  setStatus(threadId: string, planId: string, status: PlanRunStatus, approval?: "pending" | "approved" | "rejected", message = "") {
    const now = nowIso();
    this.db.prepare(`UPDATE plan_runs SET status = ?, approval = COALESCE(?, approval), status_message = ?, updated_at = ? WHERE thread_id = ? AND id = ?`).run(status, approval ?? null, cleanText(message), now, threadId, planId);
    return this.get(threadId, planId);
  }

  revise(threadId: string, planId: string, input: { title: unknown; goal: unknown; steps: Array<{ id?: string; title: unknown; detail?: unknown }> }) {
    const plan = this.get(threadId, planId);
    if (!plan) return undefined;
    if (plan.approval !== "pending") throw new Error("Only a pending plan can be revised");
    const title = cleanText(input.title);
    const goal = cleanText(input.goal);
    if (!title || !goal || !Array.isArray(input.steps) || input.steps.length === 0) throw new Error("Plan title, goal, and steps are required");
    const now = nowIso();
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`DELETE FROM plan_artifact_links WHERE plan_run_id = ?`).run(planId);
      this.db.prepare(`DELETE FROM plan_artifacts WHERE plan_run_id = ?`).run(planId);
      this.db.prepare(`DELETE FROM plan_steps WHERE plan_run_id = ?`).run(planId);
      this.db.prepare(`UPDATE plan_runs SET title = ?, goal = ?, status = 'awaiting_approval', approval = 'pending', status_message = '', updated_at = ? WHERE thread_id = ? AND id = ?`)
        .run(title, goal, now, threadId, planId);
      const insert = this.db.prepare(`INSERT INTO plan_steps (id, plan_run_id, step_order, title, detail, status, attempt) VALUES (?, ?, ?, ?, ?, 'pending', 0)`);
      input.steps.forEach((step, order) => insert.run(step.id ? cleanId(step.id) : `step_${order + 1}`, planId, order, cleanText(step.title), cleanText(step.detail)));
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.get(threadId, planId);
  }

  resumeWithAnswer(threadId: string, planId: string, answer: unknown) {
    const plan = this.get(threadId, planId);
    if (!plan) return undefined;
    if (plan.status !== "awaiting_user") throw new Error("Plan is not waiting for user input");
    return this.setStatus(threadId, planId, plan.approval === "approved" ? "running" : "draft", plan.approval, cleanText(answer));
  }

  updateStep(threadId: string, planId: string, stepId: string, patch: { status: PlanStepStatus; detail?: unknown; error?: unknown }) {
    const current = this.get(threadId, planId)?.steps.find((step) => step.id === stepId);
    if (!current) return undefined;
    const now = nowIso();
    const startedAt = patch.status === "running" ? current.startedAt ?? now : current.startedAt ?? null;
    const completedAt = ["completed", "failed", "skipped"].includes(patch.status) ? now : null;
    this.db.prepare(`UPDATE plan_steps SET status = ?, detail = ?, error = ?, started_at = ?, completed_at = ? WHERE plan_run_id = ? AND id = ?`)
      .run(patch.status, patch.detail === undefined ? current.detail : cleanText(patch.detail), patch.error === undefined ? current.error ?? null : cleanText(patch.error), startedAt, completedAt, planId, stepId);
    this.db.prepare(`UPDATE plan_runs SET updated_at = ? WHERE id = ?`).run(now, planId);
    return this.get(threadId, planId)?.steps.find((step) => step.id === stepId);
  }

  retryStep(threadId: string, planId: string, stepId: string) {
    this.db.prepare(`UPDATE plan_steps SET status = 'pending', attempt = attempt + 1, started_at = NULL, completed_at = NULL, error = NULL WHERE plan_run_id = ? AND id = ?`).run(planId, stepId);
    this.setStatus(threadId, planId, "running", "approved");
    return this.get(threadId, planId)?.steps.find((step) => step.id === stepId);
  }

  stageArtifact(threadId: string, planId: string, input: { artifactId: string; stepId: string; type: "text" | "image"; title: unknown; payload: JsonValue; source?: JsonValue; layout?: JsonValue }) {
    const plan = this.get(threadId, planId);
    if (!plan) throw new Error("Plan not found");
    const runningStep = plan.steps.find((step) => step.status === "running");
    if (!runningStep || runningStep.id !== input.stepId) throw new Error("Artifact must belong to the currently running step");
    const id = cleanId(input.artifactId); const now = nowIso();
    this.db.prepare(`INSERT INTO plan_artifacts (id, plan_run_id, step_id, type, status, title, payload_json, source_json, layout_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'staged', ?, ?, ?, ?, ?, ?) ON CONFLICT(plan_run_id, id) DO UPDATE SET step_id = excluded.step_id, type = excluded.type, title = excluded.title, payload_json = excluded.payload_json, source_json = excluded.source_json, layout_json = excluded.layout_json, updated_at = excluded.updated_at`)
      .run(id, planId, cleanId(input.stepId), input.type, cleanText(input.title), JSON.stringify(input.payload), JSON.stringify(input.source ?? {}), JSON.stringify(input.layout ?? {}), now, now);
    return this.get(threadId, planId)?.artifacts.find((artifact) => artifact.id === id);
  }

  markArtifact(threadId: string, planId: string, artifactId: string, status: "committed" | "failed", canvasTargetId?: string, error = "") {
    if (!this.get(threadId, planId)) return undefined;
    this.db.prepare(`UPDATE plan_artifacts SET status = ?, canvas_target_id = ?, error = ?, updated_at = ? WHERE plan_run_id = ? AND id = ?`)
      .run(status, canvasTargetId ?? null, cleanText(error), nowIso(), planId, cleanId(artifactId));
    return this.get(threadId, planId)?.artifacts.find((artifact) => artifact.id === artifactId);
  }

  stageArtifactLinks(threadId: string, planId: string, links: Array<{ id: string; fromArtifactId: string; toArtifactId: string; label?: unknown }>) {
    if (!this.get(threadId, planId)) throw new Error("Plan not found");
    const insert = this.db.prepare(`INSERT INTO plan_artifact_links (id, plan_run_id, from_artifact_id, to_artifact_id, label) VALUES (?, ?, ?, ?, ?) ON CONFLICT(plan_run_id, id) DO UPDATE SET from_artifact_id = excluded.from_artifact_id, to_artifact_id = excluded.to_artifact_id, label = excluded.label`);
    for (const link of links) insert.run(cleanId(link.id), planId, cleanId(link.fromArtifactId), cleanId(link.toArtifactId), cleanText(link.label));
    return this.get(threadId, planId)!.links;
  }

  markArtifactLinkCommitted(threadId: string, planId: string, linkId: string, canvasEdgeId: string): PlanArtifactLink | undefined {
    this.db.prepare(`UPDATE plan_artifact_links SET canvas_edge_id = ? WHERE plan_run_id = ? AND id = ?`).run(canvasEdgeId, planId, cleanId(linkId));
    return this.get(threadId, planId)?.links.find((link) => link.id === linkId);
  }
}

function cleanId(value: string) {
  const id = value.trim();
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw new Error("Plan identifier is invalid");
  return id;
}
