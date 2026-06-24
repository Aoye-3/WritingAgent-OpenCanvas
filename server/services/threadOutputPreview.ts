import {
  archiveMarkdownOutputFromRuntime,
  readArchivedMarkdownOutput,
  type ArchiveMarkdownOutput
} from "./threadOutputArchive.js";

export type MarkdownOutputPreview = {
  path: string;
  fileName: string;
  size: number;
  content: string;
};

export async function readMarkdownOutputPreview(
  threadId: string,
  virtualPath: string,
  archiveMarkdownOutput: ArchiveMarkdownOutput = archiveMarkdownOutputFromRuntime
): Promise<MarkdownOutputPreview> {
  try {
    return await readArchivedMarkdownOutput(threadId, virtualPath);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code !== "ENOENT") throw error;
  }
  await archiveMarkdownOutput(threadId, virtualPath);
  return readArchivedMarkdownOutput(threadId, virtualPath);
}
