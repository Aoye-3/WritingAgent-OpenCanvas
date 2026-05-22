import { KnowledgeService } from "../../knowledge/service.js";
import type { SQLiteStorageRepository } from "../../storage.js";

export { KnowledgeService } from "../../knowledge/service.js";
export type {
  KnowledgeBase,
  KnowledgeBaseInput,
  KnowledgeItem,
  KnowledgeItemInput,
  KnowledgeSearchResult
} from "../../knowledge/types.js";
export { resolveKnowledgeEmbedding, resolveKnowledgeModelConfig, resolveKnowledgeRerank } from "./modelConfigResolvers.js";

export function createKnowledgeService(storage: SQLiteStorageRepository) {
  return new KnowledgeService(storage);
}
