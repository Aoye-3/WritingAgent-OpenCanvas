import type { DatabaseSync } from "node:sqlite";
import type { StoredThread } from "../storageTypes.js";
import { nowIso } from "./storageRepositoryUtils.js";

export class ThreadRepository {
  constructor(private db: DatabaseSync) {}

  getThread(threadId: string) {
    return this.db
      .prepare(`SELECT id, project_id as projectId, title, configured_model_api_id as configuredModelApiId, context_reset_at as contextResetAt, updated_at as updatedAt, deleted_at as deletedAt FROM threads WHERE id = ? AND deleted_at IS NULL`)
      .get(threadId) as StoredThread | undefined;
  }

  listRecentThreads(limit = 8) {
    return this.db
      .prepare(`SELECT id, project_id as projectId, title, configured_model_api_id as configuredModelApiId, context_reset_at as contextResetAt, updated_at as updatedAt, deleted_at as deletedAt FROM threads WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as StoredThread[];
  }

  listProjectThreads(projectId: string) {
    return this.db
      .prepare(`SELECT id, project_id as projectId, title, configured_model_api_id as configuredModelApiId, context_reset_at as contextResetAt, updated_at as updatedAt, deleted_at as deletedAt
        FROM threads WHERE project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC`)
      .all(projectId) as StoredThread[];
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

  renameThread(threadId: string, title: string) {
    const now = nowIso();
    const result = this.db
      .prepare(`UPDATE threads SET title = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
      .run(title, now, threadId);
    if (result.changes === 0) return undefined;
    return this.getThread(threadId);
  }

  touchThread(threadId: string, updatedAt = nowIso()) {
    this.db.prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`).run(updatedAt, threadId);
  }

  resetContext(threadId: string) {
    const now = nowIso();
    const result = this.db.prepare(`UPDATE threads SET context_reset_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`).run(now, now, threadId);
    return result.changes > 0 ? this.getThread(threadId) : undefined;
  }
}
