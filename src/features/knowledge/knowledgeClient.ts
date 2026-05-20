import { apiDelete, apiGet, apiPatch, apiPost } from "../../shared/apiClient";
import type { KnowledgeBase, KnowledgeItem, KnowledgeItemType, KnowledgeSearchResult } from "./types";

export type KnowledgeBaseDraft = {
  name: string;
  description?: string;
  embeddingConfigId?: string;
  embeddingProvider?: "openai-compatible" | "ollama";
  embeddingModel?: string;
  embeddingBaseUrl?: string;
  documentCount?: number;
  threshold?: number;
  rerankEnabled?: boolean;
  rerankConfigId?: string;
  rerankProvider?: string;
  rerankModel?: string;
  rerankBaseUrl?: string;
};

export type KnowledgeItemDraft = {
  type: KnowledgeItemType;
  title?: string;
  content?: string;
  source?: string;
  fileName?: string;
  fileBase64?: string;
};

export const knowledgeClient = {
  async listBases() {
    return apiGet<{ bases: KnowledgeBase[] }>("/api/knowledge/bases");
  },
  async createBase(draft: KnowledgeBaseDraft) {
    return apiPost<{ base: KnowledgeBase }>("/api/knowledge/bases", draft);
  },
  async updateBase(baseId: string, draft: Partial<KnowledgeBaseDraft>) {
    return apiPatch<{ base: KnowledgeBase }>(`/api/knowledge/bases/${baseId}`, draft);
  },
  async deleteBase(baseId: string) {
    return apiDelete<{ ok: true }>(`/api/knowledge/bases/${baseId}`);
  },
  async addItem(baseId: string, draft: KnowledgeItemDraft) {
    return apiPost<{ item: KnowledgeItem }>(`/api/knowledge/bases/${baseId}/items`, draft);
  },
  async deleteItem(baseId: string, itemId: string) {
    return apiDelete<{ ok: true }>(`/api/knowledge/bases/${baseId}/items/${itemId}`);
  },
  async reindex(baseId: string) {
    return apiPost<{ base: KnowledgeBase }>(`/api/knowledge/bases/${baseId}/reindex`);
  },
  async search(input: { query: string; baseIds?: string[]; limit?: number; threshold?: number }) {
    return apiPost<{ results: KnowledgeSearchResult[] }>("/api/knowledge/search", input);
  }
};
