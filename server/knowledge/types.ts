import type { JsonValue } from "../storageTypes.js";

export type KnowledgeItemType = "text" | "file" | "url" | "sitemap" | "note";
export type KnowledgeItemStatus = "pending" | "processing" | "completed" | "failed";
export type KnowledgeBaseStatus = "ready" | "indexing" | "failed";

export type KnowledgeBase = {
  id: string;
  name: string;
  description: string;
  embeddingProvider: "openai-compatible" | "ollama";
  embeddingConfigId?: string;
  embeddingModel: string;
  embeddingBaseUrl: string;
  dimensions?: number;
  chunkSize: number;
  chunkOverlap: number;
  documentCount: number;
  threshold: number;
  rerankEnabled: boolean;
  rerankConfigId?: string;
  rerankProvider?: string;
  rerankModel?: string;
  rerankBaseUrl?: string;
  status: KnowledgeBaseStatus;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeItem = {
  id: string;
  baseId: string;
  type: KnowledgeItemType;
  title: string;
  source: string;
  contentText?: string;
  uniqueId?: string;
  uniqueIds: string[];
  status: KnowledgeItemStatus;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeSearchResult = {
  id: number;
  baseId: string;
  baseName: string;
  content: string;
  score: number;
  source: string;
  title: string;
  metadata: Record<string, unknown>;
};

export type KnowledgeItemInput = {
  type: KnowledgeItemType;
  title?: string;
  content?: string;
  source?: string;
  fileName?: string;
  fileBase64?: string;
};

export type KnowledgeBaseInput = {
  name?: string;
  description?: string;
  embeddingProvider?: "openai-compatible" | "ollama";
  embeddingConfigId?: string;
  embeddingModel?: string;
  embeddingBaseUrl?: string;
  dimensions?: number;
  chunkSize?: number;
  chunkOverlap?: number;
  documentCount?: number;
  threshold?: number;
  rerankEnabled?: boolean;
  rerankConfigId?: string;
  rerankProvider?: string;
  rerankModel?: string;
  rerankBaseUrl?: string;
};

export type KnowledgeEventInput = {
  baseId: string;
  itemId?: string;
  eventType: string;
  payload: JsonValue;
};
