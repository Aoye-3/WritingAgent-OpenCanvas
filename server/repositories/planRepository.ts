import type { DatabaseSync } from "node:sqlite";
import type { JsonValue, PlanActivity, PlanActivityType, PlanArtifact, PlanArtifactLink, PlanClarification, PlanExecution, PlanRun, PlanRunOrigin, PlanRunStatus, PlanStep, PlanStepStatus } from "../storageTypes.js";
import { cleanText, nowIso, parseJson, randomId, validateId } from "./storageRepositoryUtils.js";

export class PlanRepository {
  constructor(private readonly db: DatabaseSync) {}

  createIntake(threadId: string, input: { title: unknown; goal: unknown; origin?: unknown; complexity?: JsonValue; budget?: JsonValue; preflight?: JsonValue }) {
    validateId(threadId, "threadId");
    const thread = this.db.prepare(`SELECT project_id as projectId FROM threads WHERE id = ?`).get(threadId) as { projectId: string } | undefined;
    if (!thread) throw new Error("Thread not found");
    const id = randomId("plan");
    const now = nowIso();
    this.db.prepare(`INSERT INTO plan_runs (id, project_id, thread_id, title, goal, status, approval, status_message, clarification_json, origin, complexity_json, budget_json, preflight_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'draft', 'pending', '', '{}', ?, ?, ?, ?, ?, ?)`)
      .run(id, thread.projectId, threadId, cleanText(input.title) || "Plan intake", cleanText(input.goal) || "Clarify intent", readOrigin(input.origin) ?? null, stringifyJson(input.complexity), stringifyJson(input.budget), stringifyJson(input.preflight), now, now);
    return this.get(threadId, id)!;
  }

  submitClarification(threadId: string, planId: string, clarification: PlanClarification) {
    const plan = this.get(threadId, planId);
    if (!plan || plan.status !== "draft" || plan.approval !== "pending") throw new Error("Plan intake is not available");
    const now = nowIso();
    this.db.prepare(`UPDATE plan_runs SET status = 'awaiting_user', status_message = ?, clarification_json = ?, updated_at = ? WHERE thread_id = ? AND id = ?`)
      .run(clarification.question, JSON.stringify(clarification), now, threadId, planId);
    return this.get(threadId, planId)!;
  }

  create(threadId: string, input: { title: unknown; goal: unknown; runId?: string; steps: Array<{ id?: string; title: unknown; detail?: unknown }>; clarification?: PlanClarification; origin?: unknown; complexity?: JsonValue; budget?: JsonValue; preflight?: JsonValue }) {
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
      this.db.prepare(`INSERT INTO plan_runs (id, project_id, thread_id, run_id, title, goal, status, approval, status_message, clarification_json, origin, complexity_json, budget_json, preflight_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', '', ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, thread.projectId, threadId, input.runId ?? null, title, goal, input.clarification ? "awaiting_user" : "awaiting_approval", JSON.stringify(input.clarification ?? {}), readOrigin(input.origin) ?? null, stringifyJson(input.complexity), stringifyJson(input.budget), stringifyJson(input.preflight), now, now);
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
    const row = this.db.prepare(`SELECT id, project_id as projectId, thread_id as threadId, run_id as runId, title, goal, status, approval, status_message as statusMessage, clarification_json as clarificationJson, origin, complexity_json as complexityJson, budget_json as budgetJson, preflight_json as preflightJson, canvas_node_id as canvasNodeId, current_step_id as currentStepId, execution_version as executionVersion, created_at as createdAt, updated_at as updatedAt FROM plan_runs WHERE thread_id = ? AND id = ?`).get(threadId, planId) as (Omit<PlanRun, "steps" | "artifacts" | "links" | "clarification" | "complexity" | "budget" | "preflight"> & { clarificationJson: string; complexityJson?: string; budgetJson?: string; preflightJson?: string }) | undefined;
    if (!row) return undefined;
    const steps = this.db.prepare(`SELECT id, plan_run_id as planRunId, step_order as 'order', title, detail, status, attempt, started_at as startedAt, completed_at as completedAt, error FROM plan_steps WHERE plan_run_id = ? ORDER BY step_order`).all(planId) as PlanStep[];
    const artifacts = (this.db.prepare(`SELECT id, plan_run_id as planRunId, step_id as stepId, type, status, title, payload_json as payloadJson, source_json as sourceJson, canvas_target_id as canvasTargetId, layout_json as layoutJson, error, created_at as createdAt, updated_at as updatedAt FROM plan_artifacts WHERE plan_run_id = ? ORDER BY created_at`).all(planId) as Array<Omit<PlanArtifact, "payload" | "source" | "layout"> & { payloadJson: string; sourceJson: string; layoutJson: string }>).map(({ payloadJson, sourceJson, layoutJson, ...item }) => ({ ...item, payload: parseJson(payloadJson) as JsonValue, source: parseJson(sourceJson) as JsonValue, layout: parseJson(layoutJson) as JsonValue }));
    const links = this.db.prepare(`SELECT id, plan_run_id as planRunId, from_artifact_id as fromArtifactId, to_artifact_id as toArtifactId, label, canvas_edge_id as canvasEdgeId FROM plan_artifact_links WHERE plan_run_id = ?`).all(planId) as PlanRun["links"];
    const { clarificationJson, complexityJson, budgetJson, preflightJson, origin, ...plan } = row;
    const clarification = parseJson(clarificationJson) as PlanClarification;
    return {
      ...plan,
      ...(readOrigin(origin) ? { origin: readOrigin(origin) } : {}),
      complexity: parseJson(complexityJson ?? "{}") as JsonValue,
      budget: parseJson(budgetJson ?? "{}") as JsonValue,
      preflight: parseJson(preflightJson ?? "{}") as JsonValue,
      ...(clarification?.question ? { clarification } : {}),
      steps,
      artifacts,
      links
    };
  }

  updateMetadata(threadId: string, planId: string, input: { origin?: unknown; complexity?: JsonValue; budget?: JsonValue; preflight?: JsonValue }) {
    if (!this.get(threadId, planId)) return undefined;
    const now = nowIso();
    this.db.prepare(`UPDATE plan_runs SET origin = COALESCE(?, origin), complexity_json = COALESCE(?, complexity_json), budget_json = COALESCE(?, budget_json), preflight_json = COALESCE(?, preflight_json), updated_at = ? WHERE thread_id = ? AND id = ?`)
      .run(input.origin === undefined ? null : readOrigin(input.origin) ?? null, input.complexity === undefined ? null : stringifyJson(input.complexity), input.budget === undefined ? null : stringifyJson(input.budget), input.preflight === undefined ? null : stringifyJson(input.preflight), now, threadId, planId);
    return this.get(threadId, planId);
  }

  setStatus(threadId: string, planId: string, status: PlanRunStatus, approval?: "pending" | "approved" | "rejected", message = "") {
    const now = nowIso();
    this.db.prepare(`UPDATE plan_runs SET status = ?, approval = COALESCE(?, approval), status_message = ?, updated_at = ? WHERE thread_id = ? AND id = ?`).run(status, approval ?? null, cleanText(message), now, threadId, planId);
    return this.get(threadId, planId);
  }

  approve(threadId: string, planId: string) {
    const plan = this.get(threadId, planId);
    if (!plan) return undefined;
    if (plan.status !== "awaiting_approval" || plan.approval !== "pending") throw new Error("Plan is not awaiting approval");
    const now = nowIso();
    const firstStepId = plan.steps.find((step) => step.status === "pending")?.id;
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`UPDATE plan_runs SET status = 'running', approval = 'approved', current_step_id = ?, execution_version = execution_version + 1, status_message = '', updated_at = ? WHERE thread_id = ? AND id = ?`)
        .run(firstStepId ?? null, now, threadId, planId);
      this.db.prepare(`INSERT INTO plan_executions (plan_run_id, thread_id, status, current_step_id, cancel_token, attempt, started_at, updated_at)
        VALUES (?, ?, 'running', ?, ?, 0, ?, ?)
        ON CONFLICT(plan_run_id) DO UPDATE SET status = 'running', current_step_id = excluded.current_step_id, cancel_token = excluded.cancel_token, paused_at = NULL, completed_at = NULL, updated_at = excluded.updated_at`)
        .run(planId, threadId, firstStepId ?? null, randomId("cancel"), now, now);
      this.recordActivity(threadId, planId, { type: "plan_ready", status: "approved", summary: "Plan approved and queued for execution" });
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.get(threadId, planId);
  }

  pause(threadId: string, planId: string, message = "Plan paused") {
    const plan = this.get(threadId, planId);
    if (!plan) return undefined;
    if (plan.status !== "running") return plan;
    const now = nowIso();
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`UPDATE plan_runs SET status = 'paused', status_message = ?, updated_at = ? WHERE thread_id = ? AND id = ?`).run(cleanText(message), now, threadId, planId);
      this.db.prepare(`UPDATE plan_executions SET status = 'paused', paused_at = ?, updated_at = ? WHERE thread_id = ? AND plan_run_id = ?`).run(now, now, threadId, planId);
      this.recordActivity(threadId, planId, { type: "plan_paused", status: "paused", summary: cleanText(message) || "Plan paused" });
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.get(threadId, planId);
  }

  resume(threadId: string, planId: string) {
    const plan = this.get(threadId, planId);
    if (!plan) return undefined;
    if (plan.status !== "paused") throw new Error("Only a paused Plan can resume");
    const now = nowIso();
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`UPDATE plan_runs SET status = 'running', status_message = '', execution_version = execution_version + 1, updated_at = ? WHERE thread_id = ? AND id = ?`).run(now, threadId, planId);
      this.db.prepare(`UPDATE plan_executions SET status = 'running', cancel_token = ?, paused_at = NULL, attempt = attempt + 1, updated_at = ? WHERE thread_id = ? AND plan_run_id = ?`).run(randomId("cancel"), now, threadId, planId);
      this.recordActivity(threadId, planId, { type: "plan_resumed", status: "running", summary: "Plan execution resumed" });
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.get(threadId, planId);
  }

  getExecution(threadId: string, planId: string): PlanExecution | undefined {
    return this.db.prepare(`SELECT plan_run_id as planRunId, thread_id as threadId, status, current_step_id as currentStepId, lease_owner as leaseOwner, lease_expires_at as leaseExpiresAt, last_heartbeat_at as lastHeartbeatAt, cancel_token as cancelToken, attempt, started_at as startedAt, paused_at as pausedAt, completed_at as completedAt, updated_at as updatedAt FROM plan_executions WHERE thread_id = ? AND plan_run_id = ?`).get(threadId, planId) as PlanExecution | undefined;
  }

  listRunnableExecutions() {
    return this.db.prepare(`SELECT thread_id as threadId, plan_run_id as planId FROM plan_executions WHERE status = 'running'`).all() as Array<{ threadId: string; planId: string }>;
  }

  claimExecution(threadId: string, planId: string, owner: string) {
    const now = nowIso();
    const expires = new Date(Date.now() + 60_000).toISOString();
    const result = this.db.prepare(`UPDATE plan_executions SET lease_owner = ?, lease_expires_at = ?, last_heartbeat_at = ?, updated_at = ?
      WHERE thread_id = ? AND plan_run_id = ? AND status = 'running' AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at < ?)`)
      .run(owner, expires, now, now, threadId, planId, now);
    return result.changes === 1;
  }

  renewExecutionLease(threadId: string, planId: string, owner: string) {
    const now = nowIso();
    const expires = new Date(Date.now() + 60_000).toISOString();
    const result = this.db.prepare(`UPDATE plan_executions SET lease_expires_at = ?, last_heartbeat_at = ?, updated_at = ?
      WHERE thread_id = ? AND plan_run_id = ? AND status = 'running' AND lease_owner = ?`)
      .run(expires, now, now, threadId, planId, owner);
    return result.changes === 1;
  }

  releaseExecution(threadId: string, planId: string, owner: string) {
    this.db.prepare(`UPDATE plan_executions SET lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE thread_id = ? AND plan_run_id = ? AND lease_owner = ?`)
      .run(nowIso(), threadId, planId, owner);
  }

  recordActivity(threadId: string, planId: string, input: { runId?: string; stepId?: string; type: PlanActivityType; status: string; summary: unknown; detail?: JsonValue }): PlanActivity {
    if (!this.get(threadId, planId)) throw new Error("Plan not found");
    const sequenceRow = this.db.prepare(`SELECT COALESCE(MAX(sequence), 0) + 1 as sequence FROM run_activities WHERE plan_run_id = ?`).get(planId) as { sequence: number };
    const activity: PlanActivity = {
      id: randomId("activity"), threadId, planRunId: planId, runId: input.runId, stepId: input.stepId,
      type: input.type, status: cleanText(input.status), summary: cleanText(input.summary), detail: input.detail ?? {},
      sequence: sequenceRow.sequence, createdAt: nowIso()
    };
    this.db.prepare(`INSERT INTO run_activities (id, thread_id, plan_run_id, run_id, step_id, activity_type, status, summary, detail_json, sequence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(activity.id, threadId, planId, activity.runId ?? null, activity.stepId ?? null, activity.type, activity.status, activity.summary, JSON.stringify(activity.detail), activity.sequence, activity.createdAt);
    return activity;
  }

  listActivities(threadId: string, planId: string): PlanActivity[] {
    const rows = this.db.prepare(`SELECT id, thread_id as threadId, plan_run_id as planRunId, run_id as runId, step_id as stepId, activity_type as type, status, summary, detail_json as detailJson, sequence, created_at as createdAt FROM run_activities WHERE thread_id = ? AND plan_run_id = ? ORDER BY sequence`).all(threadId, planId) as Array<Omit<PlanActivity, "detail"> & { detailJson: string }>;
    return rows.map(({ detailJson, ...row }) => ({ ...row, detail: parseJson(detailJson) as JsonValue }));
  }

  setCanvasNodeId(threadId: string, planId: string, canvasNodeId?: string) {
    this.db.prepare(`UPDATE plan_runs SET canvas_node_id = ?, updated_at = ? WHERE thread_id = ? AND id = ?`).run(canvasNodeId ?? null, nowIso(), threadId, planId);
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

  resumeWithAnswer(threadId: string, planId: string, answer: string | { optionId?: string; customAnswer?: string; answer?: string }) {
    const plan = this.get(threadId, planId);
    if (!plan) return undefined;
    if (plan.status !== "awaiting_user") throw new Error("Plan is not waiting for user input");
    const structured = typeof answer === "string" ? { answer } : answer;
    const optionId = cleanText(structured.optionId);
    const customAnswer = cleanText(structured.customAnswer);
    const textAnswer = cleanText(structured.answer);
    if (plan.clarification) {
      if (optionId && !plan.clarification.options.some((option) => option.id === optionId)) throw new Error("Clarification option is invalid");
      this.db.prepare(`UPDATE plan_runs SET clarification_json = ? WHERE thread_id = ? AND id = ?`).run(JSON.stringify({
        ...plan.clarification,
        status: "answered",
        ...(optionId ? { selectedOptionId: optionId } : {}),
        ...(customAnswer || textAnswer ? { customAnswer: customAnswer || textAnswer } : {})
      }), threadId, planId);
    }
    return this.setStatus(threadId, planId, plan.approval === "approved" ? "running" : "draft", plan.approval, optionId || customAnswer || textAnswer);
  }

  updateStep(threadId: string, planId: string, stepId: string, patch: { status: PlanStepStatus; detail?: unknown; error?: unknown }) {
    const planBeforeUpdate = this.get(threadId, planId);
    const current = planBeforeUpdate?.steps.find((step) => step.id === stepId);
    if (!current) return undefined;
    if (patch.status === "completed" && !planBeforeUpdate?.artifacts.some((artifact) => artifact.stepId === stepId && artifact.status === "committed")) {
      throw new Error("Plan step cannot complete before its Artifact is committed");
    }
    const now = nowIso();
    const startedAt = patch.status === "running" ? current.startedAt ?? now : current.startedAt ?? null;
    const completedAt = ["completed", "failed", "skipped"].includes(patch.status) ? now : null;
    this.db.prepare(`UPDATE plan_steps SET status = ?, detail = ?, error = ?, started_at = ?, completed_at = ? WHERE plan_run_id = ? AND id = ?`)
      .run(patch.status, patch.detail === undefined ? current.detail : cleanText(patch.detail), patch.error === undefined ? current.error ?? null : cleanText(patch.error), startedAt, completedAt, planId, stepId);
    this.db.prepare(`UPDATE plan_runs SET updated_at = ? WHERE id = ?`).run(now, planId);
    if (patch.status === "completed" || patch.status === "skipped") {
      const plan = this.get(threadId, planId);
      const allDone = plan?.steps.every((step) => step.status === "completed" || step.status === "skipped");
      const completedStepsHaveArtifacts = plan?.steps
        .filter((step) => step.status === "completed")
        .every((step) => plan.artifacts.some((artifact) => artifact.stepId === step.id && artifact.status === "committed"));
      if (plan && allDone && completedStepsHaveArtifacts) {
        this.setStatus(threadId, planId, "completed", "approved");
        this.db.prepare(`UPDATE plan_runs SET current_step_id = NULL WHERE thread_id = ? AND id = ?`).run(threadId, planId);
        this.db.prepare(`UPDATE plan_executions SET status = 'completed', current_step_id = NULL, completed_at = ?, updated_at = ? WHERE thread_id = ? AND plan_run_id = ?`).run(now, now, threadId, planId);
      } else if (plan) {
        const nextStepId = plan.steps.find((step) => step.status === "pending")?.id ?? null;
        this.db.prepare(`UPDATE plan_runs SET current_step_id = ? WHERE thread_id = ? AND id = ?`).run(nextStepId, threadId, planId);
        this.db.prepare(`UPDATE plan_executions SET current_step_id = ?, updated_at = ? WHERE thread_id = ? AND plan_run_id = ?`).run(nextStepId, now, threadId, planId);
      }
    }
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
    const existing = plan.artifacts.find((artifact) => artifact.id === id);
    if (existing?.status === "committed") return existing;
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

function readOrigin(value: unknown): PlanRunOrigin | undefined {
  return value === "explicit_plan" || value === "auto_complex_task" || value === "approved_execution" ? value : undefined;
}

function stringifyJson(value: JsonValue | undefined) {
  return JSON.stringify(value ?? {});
}
