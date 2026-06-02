import type { DatabaseSync } from "node:sqlite";
import type { KnowledgeBase, KnowledgeBaseInput, KnowledgeEventInput, KnowledgeItem, KnowledgeItemInput, KnowledgeItemStatus } from "../knowledge/types.js";
import { cleanText, nowIso, parseJson, randomId, validateId } from "./storageRepositoryUtils.js";

type KnowledgeRepositoryDeps = {
  withTransaction: <T>(work: () => T) => T;
};

export class KnowledgeRepository {
  constructor(
    readonly db: DatabaseSync,
    private readonly deps: KnowledgeRepositoryDeps
  ) {}

  listKnowledgeBases() {
    const rows = this.db
      .prepare(
        `SELECT id,
                name,
                description,
                embedding_config_id as embeddingConfigId,
                embedding_provider as embeddingProvider,
                embedding_model as embeddingModel,
                embedding_base_url as embeddingBaseUrl,
                dimensions,
                chunk_size as chunkSize,
                chunk_overlap as chunkOverlap,
                document_count as documentCount,
                threshold,
                rerank_enabled as rerankEnabled,
                rerank_config_id as rerankConfigId,
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
                embedding_config_id as embeddingConfigId,
                embedding_provider as embeddingProvider,
                embedding_model as embeddingModel,
                embedding_base_url as embeddingBaseUrl,
                dimensions,
                chunk_size as chunkSize,
                chunk_overlap as chunkOverlap,
                document_count as documentCount,
                threshold,
                rerank_enabled as rerankEnabled,
                rerank_config_id as rerankConfigId,
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

  createKnowledgeBase(input: Required<Omit<KnowledgeBaseInput, "dimensions" | "embeddingConfigId" | "rerankConfigId" | "rerankProvider" | "rerankModel" | "rerankBaseUrl">> & Pick<KnowledgeBaseInput, "dimensions" | "embeddingConfigId" | "rerankConfigId" | "rerankProvider" | "rerankModel" | "rerankBaseUrl">) {
    const now = nowIso();
    const base: KnowledgeBase = {
      id: randomId("kb"),
      name: cleanText(input.name) || "Knowledge Base",
      description: cleanText(input.description),
      embeddingConfigId: cleanText(input.embeddingConfigId),
      embeddingProvider: input.embeddingProvider,
      embeddingModel: cleanText(input.embeddingModel),
      embeddingBaseUrl: cleanText(input.embeddingBaseUrl),
      dimensions: input.dimensions,
      chunkSize: input.chunkSize,
      chunkOverlap: input.chunkOverlap,
      documentCount: input.documentCount,
      threshold: input.threshold,
      rerankEnabled: input.rerankEnabled,
      rerankConfigId: cleanText(input.rerankConfigId),
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
          (id, name, description, embedding_config_id, embedding_provider, embedding_model, embedding_base_url, dimensions, chunk_size, chunk_overlap, document_count, threshold, rerank_enabled, rerank_config_id, rerank_provider, rerank_model, rerank_base_url, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(base.id, base.name, base.description, base.embeddingConfigId ?? null, base.embeddingProvider, base.embeddingModel, base.embeddingBaseUrl, base.dimensions ?? null, base.chunkSize, base.chunkOverlap, base.documentCount, base.threshold, base.rerankEnabled ? 1 : 0, base.rerankConfigId ?? null, base.rerankProvider ?? null, base.rerankModel ?? null, base.rerankBaseUrl ?? null, base.status, now, now);
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
      embeddingConfigId: patch.embeddingConfigId === undefined ? existing.embeddingConfigId : cleanText(patch.embeddingConfigId) || undefined,
      embeddingProvider: patch.embeddingProvider ?? existing.embeddingProvider,
      embeddingModel: patch.embeddingModel === undefined ? existing.embeddingModel : cleanText(patch.embeddingModel) || existing.embeddingModel,
      embeddingBaseUrl: patch.embeddingBaseUrl === undefined ? existing.embeddingBaseUrl : cleanText(patch.embeddingBaseUrl) || existing.embeddingBaseUrl,
      dimensions: patch.dimensions ?? existing.dimensions,
      chunkSize: readPositiveInteger(patch.chunkSize, existing.chunkSize),
      chunkOverlap: readNonNegativeInteger(patch.chunkOverlap, existing.chunkOverlap),
      documentCount: readPositiveInteger(patch.documentCount, existing.documentCount),
      threshold: readThreshold(patch.threshold, existing.threshold),
      rerankEnabled: patch.rerankEnabled ?? existing.rerankEnabled,
      rerankConfigId: patch.rerankConfigId === undefined ? existing.rerankConfigId : cleanText(patch.rerankConfigId) || undefined,
      rerankProvider: patch.rerankProvider === undefined ? existing.rerankProvider : cleanText(patch.rerankProvider) || undefined,
      rerankModel: patch.rerankModel === undefined ? existing.rerankModel : cleanText(patch.rerankModel) || undefined,
      rerankBaseUrl: patch.rerankBaseUrl === undefined ? existing.rerankBaseUrl : cleanText(patch.rerankBaseUrl) || undefined,
      updatedAt: now
    };
    this.db
      .prepare(
        `UPDATE knowledge_bases
         SET name = ?, description = ?, embedding_config_id = ?, embedding_provider = ?, embedding_model = ?, embedding_base_url = ?, dimensions = ?, chunk_size = ?, chunk_overlap = ?, document_count = ?, threshold = ?, rerank_enabled = ?, rerank_config_id = ?, rerank_provider = ?, rerank_model = ?, rerank_base_url = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(next.name, next.description, next.embeddingConfigId ?? null, next.embeddingProvider, next.embeddingModel, next.embeddingBaseUrl, next.dimensions ?? null, next.chunkSize, next.chunkOverlap, next.documentCount, next.threshold, next.rerankEnabled ? 1 : 0, next.rerankConfigId ?? null, next.rerankProvider ?? null, next.rerankModel ?? null, next.rerankBaseUrl ?? null, now, baseId);
    return next;
  }

  setKnowledgeBaseStatus(baseId: string, status: KnowledgeBase["status"]) {
    validateId(baseId, "baseId");
    this.db.prepare(`UPDATE knowledge_bases SET status = ?, updated_at = ? WHERE id = ?`).run(status, nowIso(), baseId);
  }

  deleteKnowledgeBase(baseId: string) {
    validateId(baseId, "baseId");
    this.deps.withTransaction(() => {
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
    this.deps.withTransaction(() => {
      this.db.prepare(`DELETE FROM knowledge_item_events WHERE base_id = ? AND item_id = ?`).run(baseId, itemId);
      this.db.prepare(`DELETE FROM knowledge_items WHERE base_id = ? AND id = ?`).run(baseId, itemId);
    });
  }

  recordKnowledgeEvent(input: KnowledgeEventInput) {
    this.db
      .prepare(`INSERT INTO knowledge_item_events (id, base_id, item_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(randomId("kbe"), input.baseId, input.itemId ?? null, input.eventType, JSON.stringify(input.payload), nowIso());
  }
}

type KnowledgeBaseRow = Omit<KnowledgeBase, "dimensions" | "embeddingConfigId" | "rerankEnabled" | "rerankConfigId" | "rerankProvider" | "rerankModel" | "rerankBaseUrl"> & {
  dimensions: number | null;
  embeddingConfigId: string | null;
  rerankEnabled: number;
  rerankConfigId: string | null;
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
    embeddingConfigId: row.embeddingConfigId ?? undefined,
    rerankEnabled: Boolean(row.rerankEnabled),
    rerankConfigId: row.rerankConfigId ?? undefined,
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
