export type KnowledgeItemType = "text" | "file" | "url" | "sitemap" | "note";
export type KnowledgeStatus = "ready" | "indexing" | "failed";
export type KnowledgeItemStatus = "pending" | "processing" | "completed" | "failed";

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

export type KnowledgeBase = {
  id: string;
  name: string;
  description: string;
  embeddingProvider: "openai-compatible" | "ollama";
  embeddingModel: string;
  embeddingBaseUrl: string;
  dimensions?: number;
  chunkSize: number;
  chunkOverlap: number;
  documentCount: number;
  threshold: number;
  rerankEnabled: boolean;
  rerankProvider?: string;
  rerankModel?: string;
  rerankBaseUrl?: string;
  status: KnowledgeStatus;
  createdAt: string;
  updatedAt: string;
  items: KnowledgeItem[];
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
