import type { KnowledgeBase } from "../../knowledge/types.js";
import { resolveConfiguredModelApi } from "../model-config/index.js";

export async function resolveKnowledgeModelConfig(configId?: string) {
  return configId ? resolveConfiguredModelApi(configId) : undefined;
}

export async function resolveKnowledgeEmbedding(base: Pick<KnowledgeBase, "embeddingConfigId">) {
  return resolveKnowledgeModelConfig(base.embeddingConfigId);
}

export async function resolveKnowledgeRerank(base: Pick<KnowledgeBase, "rerankConfigId">) {
  return resolveKnowledgeModelConfig(base.rerankConfigId);
}
