import type { DatabaseSync } from "node:sqlite";
import type { ProjectSummary } from "../storageTypes.js";
import { nowIso } from "./storageRepositoryUtils.js";

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
}
