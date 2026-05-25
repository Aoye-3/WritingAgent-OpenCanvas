import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type FacetWriteMemoryState = {
  content: string;
  updatedAt?: string;
};

const memoryDir = path.resolve(process.cwd(), ".facetwrite", "memory");
const memoryPath = path.join(memoryDir, "facetwrite-memory.json");
const maxMemoryLength = 20000;

export class AgentRuntimeMemoryService {
  async readMemory(): Promise<FacetWriteMemoryState> {
    try {
      const raw = await readFile(memoryPath, "utf8");
      const parsed = JSON.parse(raw) as { content?: unknown; updatedAt?: unknown };
      return {
        content: typeof parsed.content === "string" ? parsed.content : "",
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined
      };
    } catch (error) {
      if (isMissingFile(error)) return { content: "" };
      throw error;
    }
  }

  async saveMemory(content: unknown): Promise<FacetWriteMemoryState> {
    if (typeof content !== "string") {
      throw new Error("Memory content must be a string");
    }
    const memory = {
      content: content.slice(0, maxMemoryLength),
      updatedAt: new Date().toISOString()
    };
    await mkdir(memoryDir, { recursive: true });
    await writeFile(memoryPath, JSON.stringify(memory, null, 2), "utf8");
    return memory;
  }

  async clearMemory(): Promise<FacetWriteMemoryState> {
    await rm(memoryPath, { force: true });
    return { content: "" };
  }
}

function isMissingFile(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}
