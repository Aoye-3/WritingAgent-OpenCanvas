import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { JsonLoader, LocalPathLoader, RAGApplicationBuilder, TextLoader } from "@cherrystudio/embedjs";
import { LibSqlDb } from "@cherrystudio/embedjs-libsql";
import { OllamaEmbeddings } from "@cherrystudio/embedjs-ollama";
import { OpenAiEmbeddings } from "@cherrystudio/embedjs-openai";
import { SitemapLoader } from "@cherrystudio/embedjs-loader-sitemap";
import { WebLoader } from "@cherrystudio/embedjs-loader-web";
import type { BaseLoader } from "@cherrystudio/embedjs-interfaces";
import type { RAGApplication } from "@cherrystudio/embedjs";
import { getBaseURL } from "../config/providerConfig.js";
import type { SQLiteStorageRepository } from "../storage.js";
import type { KnowledgeBase, KnowledgeBaseInput, KnowledgeItem, KnowledgeItemInput, KnowledgeSearchResult } from "./types.js";

type CachedRag = {
  app: RAGApplication;
};

export type KnowledgeSearchInput = {
  query: string;
  baseIds?: string[];
  limit?: number;
  threshold?: number;
};

const knowledgeRoot = path.resolve(process.cwd(), ".facetwrite", "knowledge");
const uploadsRoot = path.join(knowledgeRoot, "uploads");
const defaultChunkSize = 1200;
const defaultChunkOverlap = 180;
const defaultDocumentCount = 6;
const defaultThreshold = 0.2;
const defaultEmbeddingModel = "text-embedding-3-small";
const maxUploadBytes = 20 * 1024 * 1024;
const allowedFileExtensions = new Set([".csv", ".doc", ".docx", ".json", ".md", ".pdf", ".txt"]);
const defaultDimensionsByModel: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536
};

export class KnowledgeService {
  private cache = new Map<string, CachedRag>();

  constructor(private storage: SQLiteStorageRepository) {}

  async listBases() {
    return Promise.all(this.storage.listKnowledgeBases().map(async (base) => ({
      ...base,
      items: this.storage.listKnowledgeItems(base.id)
    })));
  }

  async getBase(baseId: string) {
    const base = this.storage.getKnowledgeBase(baseId);
    return base ? { ...base, items: this.storage.listKnowledgeItems(base.id) } : undefined;
  }

  async createBase(input: KnowledgeBaseInput) {
    await mkdir(knowledgeRoot, { recursive: true });
    const provider = input.embeddingProvider ?? readEmbeddingProvider(process.env.KNOWLEDGE_EMBEDDING_PROVIDER) ?? "openai-compatible";
    const model = input.embeddingModel?.trim() || process.env.OPENAI_EMBEDDING_MODEL?.trim() || defaultEmbeddingModel;
    const base = this.storage.createKnowledgeBase({
      name: input.name?.trim() || "Knowledge Base",
      description: input.description?.trim() || "",
      embeddingProvider: provider,
      embeddingModel: model,
      embeddingBaseUrl: input.embeddingBaseUrl?.trim() || defaultEmbeddingBaseUrl(provider),
      dimensions: input.dimensions ?? defaultDimensionsByModel[model],
      chunkSize: readInteger(input.chunkSize, defaultChunkSize),
      chunkOverlap: readInteger(input.chunkOverlap, defaultChunkOverlap),
      documentCount: readInteger(input.documentCount, defaultDocumentCount),
      threshold: readThreshold(input.threshold, defaultThreshold),
      rerankEnabled: Boolean(input.rerankEnabled),
      rerankProvider: input.rerankProvider,
      rerankModel: input.rerankModel,
      rerankBaseUrl: input.rerankBaseUrl
    });
    this.storage.recordKnowledgeEvent({ baseId: base.id, eventType: "knowledge_base_created", payload: { name: base.name } });
    return base;
  }

  async updateBase(baseId: string, input: KnowledgeBaseInput) {
    const base = this.storage.updateKnowledgeBase(baseId, input);
    if (base) {
      this.cache.delete(base.id);
      this.storage.recordKnowledgeEvent({ baseId: base.id, eventType: "knowledge_base_updated", payload: { name: base.name } });
    }
    return base;
  }

  async deleteBase(baseId: string) {
    this.cache.delete(baseId);
    this.storage.deleteKnowledgeBase(baseId);
    await rm(path.join(knowledgeRoot, baseId), { recursive: true, force: true });
  }

  async addItem(baseId: string, input: KnowledgeItemInput) {
    const base = requireBase(this.storage.getKnowledgeBase(baseId));
    validateKnowledgeItemInput(input);
    const item = this.storage.createKnowledgeItem(baseId, input);
    await this.indexItem(base, item, input);
    return this.storage.getKnowledgeItem(baseId, item.id) ?? item;
  }

  async deleteItem(baseId: string, itemId: string) {
    const base = requireBase(this.storage.getKnowledgeBase(baseId));
    const item = this.storage.getKnowledgeItem(baseId, itemId);
    if (!item) return false;
    const app = await this.getRagApplication(base);
    for (const uniqueId of item.uniqueIds.length ? item.uniqueIds : item.uniqueId ? [item.uniqueId] : []) {
      await app.deleteLoader(uniqueId);
    }
    this.storage.deleteKnowledgeItem(baseId, itemId);
    this.storage.recordKnowledgeEvent({ baseId, itemId, eventType: "knowledge_item_deleted", payload: { title: item.title } });
    return true;
  }

  async reindexBase(baseId: string) {
    const base = requireBase(this.storage.getKnowledgeBase(baseId));
    this.cache.delete(baseId);
    const app = await this.getRagApplication(base);
    await app.reset();
    for (const item of this.storage.listKnowledgeItems(baseId)) {
      await this.indexItem(base, item, {
        type: item.type,
        title: item.title,
        content: item.contentText,
        source: item.source,
        fileName: item.source
      });
    }
    return this.getBase(baseId);
  }

  async search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult[]> {
    const query = input.query.trim();
    if (!query) return [];
    const selectedIds = new Set(input.baseIds?.filter(Boolean));
    const bases = this.storage.listKnowledgeBases().filter((base) => selectedIds.size === 0 || selectedIds.has(base.id));
    const results = await Promise.all(bases.map((base) => this.searchBase(base, query, input)));
    return results.flat().sort((a, b) => b.score - a.score).slice(0, input.limit ?? defaultDocumentCount);
  }

  private async searchBase(base: KnowledgeBase, query: string, input: KnowledgeSearchInput) {
    try {
      const app = await this.getRagApplication(base);
      const rawResults = await app.search(query);
      const threshold = input.threshold ?? base.threshold;
      const mapped = rawResults
        .filter((result) => Number(result.score ?? 0) >= threshold)
        .map((result, index) => ({
          id: index + 1,
          baseId: base.id,
          baseName: base.name,
          content: String(result.pageContent ?? ""),
          score: Number(result.score ?? 0),
          source: readSource(result.metadata),
          title: readTitle(result.metadata, base.name),
          metadata: cleanMetadata(result.metadata)
        }));
      return base.rerankEnabled ? await this.rerank(base, query, mapped) : mapped;
    } catch (error) {
      this.storage.recordKnowledgeEvent({
        baseId: base.id,
        eventType: "knowledge_search_failed",
        payload: { message: safeError(error) }
      });
      return [];
    }
  }

  private async rerank(base: KnowledgeBase, query: string, results: KnowledgeSearchResult[]) {
    if (!base.rerankEnabled || !base.rerankProvider || !base.rerankModel || !base.rerankBaseUrl || results.length === 0) {
      return results;
    }
    try {
      const response = await fetch(buildRerankUrl(base.rerankProvider, base.rerankBaseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.RERANK_API_KEY ?? process.env.OPENAI_API_KEY ?? ""}`
        },
        body: JSON.stringify({
          model: base.rerankModel,
          query,
          documents: results.map((result) => result.content),
          top_n: base.documentCount
        })
      });
      if (!response.ok) throw new Error(`Rerank returned HTTP ${response.status}`);
      const data = await response.json() as { results?: Array<{ index?: number; relevance_score?: number }> };
      const scoreByIndex = new Map((data.results ?? []).map((entry) => [entry.index, entry.relevance_score]));
      return results
        .map((result, index) => ({ ...result, score: scoreByIndex.get(index) ?? result.score }))
        .sort((a, b) => b.score - a.score);
    } catch (error) {
      this.storage.recordKnowledgeEvent({ baseId: base.id, eventType: "knowledge_rerank_failed", payload: { message: safeError(error) } });
      return results;
    }
  }

  private async indexItem(base: KnowledgeBase, item: KnowledgeItem, input: KnowledgeItemInput) {
    this.storage.updateKnowledgeItemIndex({ baseId: base.id, itemId: item.id, status: "processing" });
    this.storage.setKnowledgeBaseStatus(base.id, "indexing");
    try {
      const app = await this.getRagApplication(base);
      const loader = await this.createLoader(base, item, input);
      const result = await app.addLoader(loader, true);
      this.storage.updateKnowledgeItemIndex({
        baseId: base.id,
        itemId: item.id,
        status: "completed",
        uniqueId: result.uniqueId,
        uniqueIds: [result.uniqueId]
      });
      this.storage.setKnowledgeBaseStatus(base.id, "ready");
      this.storage.recordKnowledgeEvent({
        baseId: base.id,
        itemId: item.id,
        eventType: "knowledge_item_indexed",
        payload: { entriesAdded: result.entriesAdded, loaderType: result.loaderType }
      });
    } catch (error) {
      this.storage.updateKnowledgeItemIndex({ baseId: base.id, itemId: item.id, status: "failed", errorMessage: safeError(error) });
      this.storage.setKnowledgeBaseStatus(base.id, "failed");
      this.storage.recordKnowledgeEvent({ baseId: base.id, itemId: item.id, eventType: "knowledge_item_failed", payload: { message: safeError(error) } });
    }
  }

  private async createLoader(base: KnowledgeBase, item: KnowledgeItem, input: KnowledgeItemInput): Promise<BaseLoader> {
    if (item.type === "url") {
      return new WebLoader({ urlOrContent: item.source, chunkSize: base.chunkSize, chunkOverlap: base.chunkOverlap }) as unknown as BaseLoader;
    }
    if (item.type === "sitemap") {
      return new SitemapLoader({ url: item.source, chunkSize: base.chunkSize, chunkOverlap: base.chunkOverlap }) as unknown as BaseLoader;
    }
    if (item.type === "file") {
      const filePath = await this.materializeFile(base.id, item.id, input);
      return filePath.toLowerCase().endsWith(".json")
        ? new JsonLoader({ object: JSON.parse(await readFile(filePath, "utf8")) }) as unknown as BaseLoader
        : new LocalPathLoader({ path: filePath, chunkSize: base.chunkSize, chunkOverlap: base.chunkOverlap }) as unknown as BaseLoader;
    }
    return new TextLoader({ text: input.content ?? item.contentText ?? "", chunkSize: base.chunkSize, chunkOverlap: base.chunkOverlap }) as unknown as BaseLoader;
  }

  private async materializeFile(baseId: string, itemId: string, input: KnowledgeItemInput) {
    if (input.source?.trim() && !input.fileBase64) {
      const storedPath = resolveStoredUploadPath(baseId, itemId, input.source);
      try {
        await access(storedPath);
        return storedPath;
      } catch {
        return resolveAllowedLocalImportPath(input.source);
      }
    }
    if (!input.fileBase64 || !input.fileName) {
      throw new Error("File items require fileBase64 plus fileName");
    }
    const baseDir = path.join(uploadsRoot, baseId);
    await mkdir(baseDir, { recursive: true });
    const safeName = sanitizeKnowledgeFileName(input.fileName) || `${itemId}.txt`;
    const filePath = path.join(baseDir, `${itemId}-${safeName}`);
    const resolved = path.resolve(filePath);
    if (!isInsidePath(resolved, uploadsRoot)) {
      throw new Error("Knowledge upload path must stay inside the local workspace");
    }
    const buffer = Buffer.from(input.fileBase64, "base64");
    if (buffer.byteLength > maxUploadBytes) {
      throw new Error("Knowledge file upload exceeds the 20MB limit");
    }
    await writeFile(resolved, buffer);
    return resolved;
  }

  private async getRagApplication(base: KnowledgeBase) {
    const cached = this.cache.get(base.id);
    if (cached) return cached.app;
    await mkdir(path.join(knowledgeRoot, base.id), { recursive: true });
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (base.embeddingProvider !== "ollama" && !apiKey) {
      throw new Error("OPENAI_API_KEY is required for OpenAI-compatible knowledge embeddings");
    }
    const embeddingModel = base.embeddingProvider === "ollama"
      ? new OllamaEmbeddings({
          model: base.embeddingModel,
          baseUrl: base.embeddingBaseUrl.replace(/\/api$/, ""),
          dimensions: base.dimensions
        })
      : new OpenAiEmbeddings({
          model: base.embeddingModel,
          apiKey: apiKey ?? "",
          dimensions: base.dimensions,
          configuration: {
            baseURL: base.embeddingBaseUrl
          }
        });
    const app = await new RAGApplicationBuilder()
      .setModel("NO_MODEL")
      .setEmbeddingModel(embeddingModel)
      .setVectorDatabase(new LibSqlDb({ path: path.join(knowledgeRoot, base.id, "vectors.db") }))
      .setSearchResultCount(base.documentCount)
      .build();
    this.cache.set(base.id, { app });
    return app;
  }
}

export function validateKnowledgeItemInput(input: KnowledgeItemInput) {
  if (input.type === "url" || input.type === "sitemap") {
    validateHttpUrl(input.source, input.type);
  }
  if (input.type !== "file") return;
  if (input.source?.trim()) {
    resolveAllowedLocalImportPath(input.source);
    return;
  }
  if (!input.fileBase64 || !input.fileName) {
    throw new Error("File imports require a selected file upload");
  }
  const fileName = sanitizeKnowledgeFileName(input.fileName);
  if (!fileName) throw new Error("Knowledge file name is invalid");
  validateKnowledgeFileExtension(fileName);
  const byteLength = Buffer.from(input.fileBase64, "base64").byteLength;
  if (byteLength <= 0) throw new Error("Knowledge file upload is empty");
  if (byteLength > maxUploadBytes) throw new Error("Knowledge file upload exceeds the 20MB limit");
}

function requireBase(base: KnowledgeBase | undefined) {
  if (!base) throw new Error("Knowledge base was not found");
  return base;
}

function defaultEmbeddingBaseUrl(provider: "openai-compatible" | "ollama") {
  if (provider === "ollama") return process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434";
  return process.env.OPENAI_EMBEDDING_BASE_URL?.trim() || getBaseURL();
}

function readEmbeddingProvider(value?: string) {
  return value === "ollama" || value === "openai-compatible" ? value : undefined;
}

function readInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function readThreshold(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

function validateHttpUrl(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} import requires a URL`);
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${label} import URL is invalid`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} import only supports http or https URLs`);
  }
}

function resolveAllowedLocalImportPath(value: string) {
  if (process.env.KNOWLEDGE_ALLOW_LOCAL_FILE_PATHS !== "true") {
    throw new Error("Local file path imports are disabled. Upload a file instead.");
  }
  const resolved = path.resolve(value.trim());
  const roots = readAllowedImportRoots();
  if (roots.length === 0 || !roots.some((root) => isInsidePath(resolved, root))) {
    throw new Error("Local file path import is outside KNOWLEDGE_ALLOWED_IMPORT_ROOTS");
  }
  validateKnowledgeFileExtension(resolved);
  return resolved;
}

function resolveStoredUploadPath(baseId: string, itemId: string, source: string) {
  const safeName = sanitizeKnowledgeFileName(source) || `${itemId}.txt`;
  const resolved = path.resolve(path.join(uploadsRoot, baseId, `${itemId}-${safeName}`));
  if (!isInsidePath(resolved, uploadsRoot)) {
    throw new Error("Knowledge upload path must stay inside the local workspace");
  }
  validateKnowledgeFileExtension(resolved);
  return resolved;
}

function readAllowedImportRoots() {
  return (process.env.KNOWLEDGE_ALLOWED_IMPORT_ROOTS ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

function sanitizeKnowledgeFileName(fileName: string) {
  return path.basename(fileName).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
}

function validateKnowledgeFileExtension(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  if (!allowedFileExtensions.has(extension)) {
    throw new Error("Knowledge file type is not supported");
  }
}

function isInsidePath(candidate: string, root: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown knowledge error";
  return /api[_-]?key|authorization|token|password|secret/i.test(message) ? "Knowledge provider failed with a credential-related error." : message.slice(0, 300);
}

function readSource(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return "knowledge";
  const value = (metadata as { source?: unknown; originalPath?: unknown; originalSource?: unknown }).source ??
    (metadata as { originalPath?: unknown }).originalPath ??
    (metadata as { originalSource?: unknown }).originalSource;
  return typeof value === "string" ? value : "knowledge";
}

function readTitle(metadata: unknown, fallback: string) {
  const source = readSource(metadata);
  return source === "knowledge" ? fallback : path.basename(source);
}

function cleanMetadata(metadata: unknown) {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
}

function buildRerankUrl(provider: string, baseUrl: string) {
  const clean = baseUrl.replace(/\/$/, "");
  if (provider === "jina") return `${clean}/v1/rerank`;
  if (provider === "voyageai") return `${clean}/v1/rerank`;
  return `${clean}/rerank`;
}
