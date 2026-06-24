import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { authenticatedAgentBackendFetch } from "../runtime/agentBackendAdapter/auth.js";
import { getAgentBackendRuntimeConfig, type AgentBackendRuntimeConfig } from "../runtime/agentBackendAdapter/config.js";
import { createThreadDirectoryManager, resolveFacetWritePaths } from "../storagePaths.js";

export const OUTPUTS_PREFIX = "/mnt/user-data/outputs/";
export const MAX_MARKDOWN_PREVIEW_BYTES = 1_000_000;

export type ArchivedMarkdownOutput = {
  path: string;
  fileName: string;
  size: number;
  localPath: string;
};

export type ArchiveMarkdownOutput = (threadId: string, virtualPath: string) => Promise<ArchivedMarkdownOutput>;

type ArchiveMarkdownOutputDeps = {
  config?: AgentBackendRuntimeConfig;
  fetchImpl?: typeof fetch;
  getRuntimeConfig?: () => AgentBackendRuntimeConfig;
};

export async function archiveMarkdownOutputFromRuntime(
  threadId: string,
  virtualPath: string,
  deps: ArchiveMarkdownOutputDeps = {}
): Promise<ArchivedMarkdownOutput> {
  const target = resolveArchivedMarkdownOutputPath(threadId, virtualPath);
  const config = deps.config ?? (deps.getRuntimeConfig ?? getAgentBackendRuntimeConfig)();
  if (!config.enabled) {
    throw new Error("Agent Runtime is not enabled, so the Markdown output cannot be archived");
  }

  const artifactPath = target.normalizedPath.replace(/^\/+/, "");
  const response = await authenticatedAgentBackendFetch({
    config,
    path: `/api/threads/${encodeURIComponent(threadId)}/artifacts/${encodePathSegments(artifactPath)}`,
    init: { method: "GET" },
    fetchImpl: deps.fetchImpl
  });
  if (!response.ok) {
    throw new Error(`Agent Runtime artifact request failed with HTTP ${response.status}`);
  }

  const lengthHeader = response.headers.get("content-length");
  const declaredSize = lengthHeader ? Number(lengthHeader) : undefined;
  if (declaredSize && declaredSize > MAX_MARKDOWN_PREVIEW_BYTES) {
    throw new Error("Markdown preview file is too large");
  }

  const content = await response.text();
  const size = Buffer.byteLength(content, "utf8");
  if (size > MAX_MARKDOWN_PREVIEW_BYTES) {
    throw new Error("Markdown preview file is too large");
  }

  await mkdir(path.dirname(target.localPath), { recursive: true });
  await writeFile(target.localPath, content, "utf8");
  return { ...target, size };
}

export async function readArchivedMarkdownOutput(threadId: string, virtualPath: string) {
  const target = resolveArchivedMarkdownOutputPath(threadId, virtualPath);
  const info = await stat(target.localPath);
  if (!info.isFile()) throw new Error("Markdown preview path is not a file");
  if (info.size > MAX_MARKDOWN_PREVIEW_BYTES) {
    throw new Error("Markdown preview file is too large");
  }
  return {
    path: target.normalizedPath,
    fileName: target.fileName,
    size: info.size,
    content: await readFile(target.localPath, "utf8")
  };
}

export function readArchivedMarkdownOutputSync(threadId: string, virtualPath: string) {
  const target = resolveArchivedMarkdownOutputPath(threadId, virtualPath);
  try {
    const info = statSync(target.localPath);
    if (!info.isFile() || info.size > MAX_MARKDOWN_PREVIEW_BYTES) return "";
    return readFileSync(target.localPath, "utf8");
  } catch {
    return "";
  }
}

export function resolveArchivedMarkdownOutputPath(threadId: string, virtualPath: string) {
  const normalizedPath = normalizeMarkdownOutputPath(virtualPath);
  const relativePath = normalizedPath.slice(OUTPUTS_PREFIX.length);
  const threadDirectoryManager = createThreadDirectoryManager(resolveFacetWritePaths().appRoot);
  const root = path.resolve(threadDirectoryManager.threadDataRoot(threadId), "user-data", "outputs");
  const localPath = path.resolve(root, relativePath);
  if (!localPath.startsWith(`${root}${path.sep}`)) {
    throw new Error("Markdown preview path must stay inside this thread's outputs directory");
  }
  return {
    normalizedPath,
    relativePath,
    root,
    localPath,
    path: normalizedPath,
    fileName: path.basename(localPath)
  };
}

export function normalizeMarkdownOutputPath(value: string) {
  const normalized = value.trim().replace(/\\/g, "/");
  if (!normalized.startsWith(OUTPUTS_PREFIX)) {
    throw new Error("Markdown preview path must be under /mnt/user-data/outputs");
  }
  if (!/\.md$/i.test(normalized)) {
    throw new Error("Only Markdown output files can be previewed");
  }
  const relative = normalized.slice(OUTPUTS_PREFIX.length);
  if (!relative || relative.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Markdown preview path is invalid");
  }
  return `${OUTPUTS_PREFIX}${relative}`;
}

function encodePathSegments(value: string) {
  return value.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}
