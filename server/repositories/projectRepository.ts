import type { DatabaseSync } from "node:sqlite";
import type { ProjectRuntimeSettings, ProjectSummary, RuntimeBudgetProfile } from "../storageTypes.js";
import { nowIso } from "./storageRepositoryUtils.js";

const runtimeBudgetDefaults: Record<RuntimeBudgetProfile, ProjectRuntimeSettings> = {
  low: {
    runtimeBudgetProfile: "low",
    evidenceToolLimit: 4,
    bodyDraftWriteLimit: 1,
    modelCallLimit: 10,
    recursionLimit: 40,
    synthesisReserveSteps: 10
  },
  medium: {
    runtimeBudgetProfile: "medium",
    evidenceToolLimit: 8,
    bodyDraftWriteLimit: 3,
    modelCallLimit: 20,
    recursionLimit: 80,
    synthesisReserveSteps: 16
  },
  high: {
    runtimeBudgetProfile: "high",
    evidenceToolLimit: 18,
    bodyDraftWriteLimit: 5,
    modelCallLimit: 36,
    recursionLimit: 160,
    synthesisReserveSteps: 24
  }
};

export class ProjectRepository {
  constructor(private db: DatabaseSync) {}

  create(projectId: string, title: string, summary: string) {
    const now = nowIso();
    this.db.prepare(`INSERT INTO projects (id, title, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(projectId, title, summary, now, now);
    return this.get(projectId);
  }

  get(projectId: string) {
    return this.db.prepare(
      `SELECT id, title, summary, updated_at as updatedAt, deleted_at as deletedAt
       FROM projects WHERE id = ? AND deleted_at IS NULL`
    ).get(projectId) as { id: string; title: string; summary: string; updatedAt: string; deletedAt?: string | null } | undefined;
  }

  list(includeDeleted = false) {
    const where = includeDeleted ? `projects.deleted_at IS NOT NULL` : `projects.deleted_at IS NULL`;
    type ProjectRow = Omit<ProjectSummary, "modelConfigIds"> & { provider: string | null };
    const rows = this.db.prepare(
      `SELECT projects.id, projects.title, projects.summary, projects.updated_at as updatedAt, projects.deleted_at as deletedAt,
              COUNT(DISTINCT threads.id) as threadCount,
              COUNT(DISTINCT output_versions.id) + COUNT(DISTINCT canvas_nodes.id) + COUNT(DISTINCT canvas_objects.id) as assetCount,
              MAX(runs.provider) as provider
       FROM projects
       LEFT JOIN threads ON threads.project_id = projects.id
       LEFT JOIN output_versions ON output_versions.thread_id = threads.id
       LEFT JOIN runs ON runs.thread_id = threads.id
       LEFT JOIN canvas_nodes ON canvas_nodes.project_id = projects.id
       LEFT JOIN canvas_objects ON canvas_objects.project_id = projects.id
       WHERE ${where}
       GROUP BY projects.id
       ORDER BY projects.updated_at DESC`
    ).all() as ProjectRow[];
    const bindings = this.db.prepare(`SELECT configured_model_api_id as id FROM project_model_bindings WHERE project_id = ? ORDER BY created_at ASC`);
    return rows.map((row) => ({
      ...row,
      assetCount: Number(row.assetCount),
      threadCount: Number(row.threadCount),
      provider: row.provider ?? undefined,
      modelConfigIds: (bindings.all(row.id) as { id: string }[]).map((binding) => binding.id)
    }));
  }

  rename(projectId: string, title: string) {
    const now = nowIso();
    const result = this.db.prepare(`UPDATE projects SET title = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`).run(title, now, projectId);
    return result.changes > 0 ? this.get(projectId) : undefined;
  }

  moveToTrash(projectId: string) {
    const now = nowIso();
    return this.db.prepare(`UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`).run(now, now, projectId).changes > 0;
  }

  restore(projectId: string) {
    const now = nowIso();
    return this.db.prepare(`UPDATE projects SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL`).run(now, projectId).changes > 0;
  }

  touch(projectId: string, updatedAt = nowIso()) {
    this.db.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(updatedAt, projectId);
  }

  getRuntimeSettings(projectId: string): ProjectRuntimeSettings {
    const row = this.db.prepare(
      `SELECT runtime_budget_profile as runtimeBudgetProfile,
              evidence_tool_limit as evidenceToolLimit,
              body_draft_write_limit as bodyDraftWriteLimit,
              model_call_limit as modelCallLimit,
              recursion_limit as recursionLimit,
              synthesis_reserve_steps as synthesisReserveSteps
       FROM project_runtime_settings WHERE project_id = ?`
    ).get(projectId) as ProjectRuntimeSettings | undefined;
    return normalizeRuntimeSettings(row);
  }

  saveRuntimeSettings(projectId: string, input: Partial<ProjectRuntimeSettings>): ProjectRuntimeSettings | undefined {
    if (!this.get(projectId)) return undefined;
    const settings = normalizeRuntimeSettings(input);
    const now = nowIso();
    this.db.prepare(
      `INSERT INTO project_runtime_settings
         (project_id, runtime_budget_profile, evidence_tool_limit, body_draft_write_limit, model_call_limit, recursion_limit, synthesis_reserve_steps, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         runtime_budget_profile = excluded.runtime_budget_profile,
         evidence_tool_limit = excluded.evidence_tool_limit,
         body_draft_write_limit = excluded.body_draft_write_limit,
         model_call_limit = excluded.model_call_limit,
         recursion_limit = excluded.recursion_limit,
         synthesis_reserve_steps = excluded.synthesis_reserve_steps,
         updated_at = excluded.updated_at`
    ).run(
      projectId,
      settings.runtimeBudgetProfile,
      settings.evidenceToolLimit,
      settings.bodyDraftWriteLimit,
      settings.modelCallLimit,
      settings.recursionLimit,
      settings.synthesisReserveSteps,
      now
    );
    this.touch(projectId, now);
    return settings;
  }
}

export function defaultRuntimeBudgetSettings(profile: RuntimeBudgetProfile = "medium"): ProjectRuntimeSettings {
  return { ...runtimeBudgetDefaults[profile] };
}

function normalizeRuntimeSettings(input: Partial<ProjectRuntimeSettings> | undefined): ProjectRuntimeSettings {
  const profile = input?.runtimeBudgetProfile === "low" || input?.runtimeBudgetProfile === "high"
    ? input.runtimeBudgetProfile
    : "medium";
  const defaults = runtimeBudgetDefaults[profile];
  return {
    runtimeBudgetProfile: profile,
    evidenceToolLimit: clampInt(input?.evidenceToolLimit, defaults.evidenceToolLimit, 1, 50),
    bodyDraftWriteLimit: clampInt(input?.bodyDraftWriteLimit, defaults.bodyDraftWriteLimit, 1, 12),
    modelCallLimit: clampInt(input?.modelCallLimit, defaults.modelCallLimit, 3, 80),
    recursionLimit: clampInt(input?.recursionLimit, defaults.recursionLimit, 20, 240),
    synthesisReserveSteps: clampInt(input?.synthesisReserveSteps, defaults.synthesisReserveSteps, 4, 80)
  };
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isInteger(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}
