import type { DatabaseSync } from "node:sqlite";
import type { AgentCard } from "../agentCards.js";
import type { ProjectSummary, StoredThread } from "../storage.js";
import { nowIso } from "./storageRepositoryUtils.js";

export class ThreadRepository {
  constructor(private db: DatabaseSync) {}

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

  touchThread(threadId: string, updatedAt = nowIso()) {
    this.db.prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`).run(updatedAt, threadId);
  }
}
