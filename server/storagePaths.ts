import { mkdir } from "node:fs/promises";
import path from "node:path";
import { validateId } from "./repositories/storageRepositoryUtils.js";

export function resolveFacetWritePaths(root = process.env.FACETWRITE_APP_ROOT ?? ".facetwrite") {
  const appRoot = path.resolve(process.cwd(), root);
  const dbDir = path.join(appRoot, "data");
  return {
    appRoot,
    dbDir,
    dbPath: path.join(dbDir, "facetwrite.db")
  };
}

export function createThreadDirectoryManager(appRoot: string) {
  function threadDataRoot(threadId: string) {
    validateId(threadId, "threadId");
    const root = path.join(appRoot, "threads", threadId);
    const resolved = path.resolve(root);
    if (!resolved.startsWith(appRoot)) {
      throw new Error("Thread data must stay inside the local app workspace");
    }
    return resolved;
  }

  async function ensureThreadDirs(threadId: string) {
    validateId(threadId, "threadId");
    const threadRoot = path.join(threadDataRoot(threadId), "user-data");
    const resolved = path.resolve(threadRoot);
    if (!resolved.startsWith(appRoot)) {
      throw new Error("Thread data must stay inside the local app workspace");
    }

    await Promise.all([
      mkdir(path.join(resolved, "workspace"), { recursive: true }),
      mkdir(path.join(resolved, "uploads"), { recursive: true }),
      mkdir(path.join(resolved, "outputs"), { recursive: true })
    ]);
  }

  return { ensureThreadDirs, threadDataRoot };
}
