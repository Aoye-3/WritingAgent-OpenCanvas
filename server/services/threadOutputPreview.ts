import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createThreadDirectoryManager, resolveFacetWritePaths } from "../storagePaths.js";

const OUTPUTS_PREFIX = "/mnt/user-data/outputs/";
const MAX_MARKDOWN_PREVIEW_BYTES = 1_000_000;

export type MarkdownOutputPreview = {
  path: string;
  fileName: string;
  size: number;
  content: string;
};

const threadDirectoryManager = createThreadDirectoryManager(resolveFacetWritePaths().appRoot);

export async function readMarkdownOutputPreview(threadId: string, virtualPath: string): Promise<MarkdownOutputPreview> {
  const normalizedPath = normalizeMarkdownOutputPath(virtualPath);
  const relativePath = normalizedPath.slice(OUTPUTS_PREFIX.length);
  const root = path.resolve(threadDirectoryManager.threadDataRoot(threadId), "user-data", "outputs");
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Markdown preview path must stay inside this thread's outputs directory");
  }
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error("Markdown preview path is not a file");
  if (info.size > MAX_MARKDOWN_PREVIEW_BYTES) {
    throw new Error("Markdown preview file is too large");
  }
  return {
    path: normalizedPath,
    fileName: path.basename(resolved),
    size: info.size,
    content: await readFile(resolved, "utf8")
  };
}

function normalizeMarkdownOutputPath(value: string) {
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
