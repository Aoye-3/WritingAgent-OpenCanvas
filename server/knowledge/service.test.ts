import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createStorage } from "../storage.js";
import { KnowledgeService, normalizeOpenAiCompatibleBaseUrl, validateKnowledgeItemInput } from "./service.js";

test("rejects local file path imports unless explicitly enabled", () => {
  const previous = process.env.KNOWLEDGE_ALLOW_LOCAL_FILE_PATHS;
  delete process.env.KNOWLEDGE_ALLOW_LOCAL_FILE_PATHS;

  assert.throws(
    () => validateKnowledgeItemInput({ type: "file", source: "F:\\private\\notes.pdf" }),
    /Local file path imports are disabled/
  );

  if (previous === undefined) {
    delete process.env.KNOWLEDGE_ALLOW_LOCAL_FILE_PATHS;
  } else {
    process.env.KNOWLEDGE_ALLOW_LOCAL_FILE_PATHS = previous;
  }
});

test("accepts uploaded knowledge files with supported extensions", () => {
  assert.doesNotThrow(() => validateKnowledgeItemInput({
    type: "file",
    fileName: "story-notes.md",
    fileBase64: Buffer.from("# Notes").toString("base64")
  }));
});

test("rejects unsafe knowledge import sources", () => {
  assert.throws(
    () => validateKnowledgeItemInput({ type: "file", fileName: "../secret.exe", fileBase64: Buffer.from("x").toString("base64") }),
    /not supported/
  );
  assert.throws(
    () => validateKnowledgeItemInput({ type: "url", source: "file:///etc/passwd" }),
    /http or https/
  );
  assert.throws(
    () => validateKnowledgeItemInput({ type: "sitemap", source: "ftp://example.com/sitemap.xml" }),
    /http or https/
  );
});

test("normalizes OpenAI-compatible embedding base URLs to the v1 API root", () => {
  assert.equal(normalizeOpenAiCompatibleBaseUrl("https://api.siliconflow.cn"), "https://api.siliconflow.cn/v1");
  assert.equal(normalizeOpenAiCompatibleBaseUrl("https://api.siliconflow.cn/"), "https://api.siliconflow.cn/v1");
  assert.equal(normalizeOpenAiCompatibleBaseUrl("https://api.siliconflow.cn/v1"), "https://api.siliconflow.cn/v1");
});

test("indexes uploaded docx files through normalized OpenAI-compatible embedding base URLs", async () => {
  const embeddingServer = await startEmbeddingServer();
  const previousApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  const storage = await createStorage();
  const service = new KnowledgeService(storage);
  const base = await service.createBase({
    name: `docx-smoke-${Date.now()}`,
    embeddingProvider: "openai-compatible",
    embeddingModel: "test-embedding-model",
    embeddingBaseUrl: embeddingServer.baseUrl,
    dimensions: 3,
    threshold: 0
  });

  try {
    const docx = await readFile(path.resolve(process.cwd(), "node_modules", "mammoth", "test", "test-data", "single-paragraph.docx"));
    const item = await service.addItem(base.id, {
      type: "file",
      title: "Single paragraph",
      fileName: "single-paragraph.docx",
      fileBase64: docx.toString("base64")
    });

    assert.equal(item.status, "completed");
    assert.equal(item.errorMessage, undefined);
    assert.ok(item.uniqueId);
    assert.ok(embeddingServer.paths.every((requestPath) => requestPath === "/v1/embeddings"));

    const results = await service.search({ query: "Walking imported air", baseIds: [base.id], threshold: 0, limit: 1 });
    assert.equal(results.length, 1);
    assert.match(results[0].content, /Walking on imported air/);
  } finally {
    await service.deleteBase(base.id);
    await embeddingServer.close();
    if (previousApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousApiKey;
    }
  }
});

test("marks uploaded docx items as failed when embedding indexing fails", async () => {
  const embeddingServer = await startEmbeddingServer({ fail: true });
  const previousApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  const storage = await createStorage();
  const service = new KnowledgeService(storage);
  const base = await service.createBase({
    name: `docx-failure-${Date.now()}`,
    embeddingProvider: "openai-compatible",
    embeddingModel: "test-embedding-model",
    embeddingBaseUrl: `${embeddingServer.baseUrl}/v1`,
    dimensions: 3,
    threshold: 0
  });

  try {
    const docx = await readFile(path.resolve(process.cwd(), "node_modules", "mammoth", "test", "test-data", "single-paragraph.docx"));
    const item = await service.addItem(base.id, {
      type: "file",
      title: "Single paragraph",
      fileName: "single-paragraph.docx",
      fileBase64: docx.toString("base64")
    });

    assert.equal(item.status, "failed");
    assert.match(item.errorMessage ?? "", /Embedding server failed/);
    assert.ok(storage.listKnowledgeItems(base.id).some((stored) => stored.id === item.id && stored.status === "failed"));
  } finally {
    await service.deleteBase(base.id);
    await embeddingServer.close();
    if (previousApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousApiKey;
    }
  }
});

async function startEmbeddingServer(options: { fail?: boolean } = {}) {
  const paths: string[] = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    paths.push(request.url ?? "");
    if (request.method !== "POST" || request.url !== "/v1/embeddings") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Not found" } }));
      return;
    }
    if (options.fail) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Embedding server failed" } }));
      return;
    }
    const body = await readRequestJson<{ input?: string | string[]; model?: string }>(request);
    const inputs = Array.isArray(body.input) ? body.input : [body.input ?? ""];
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      object: "list",
      data: inputs.map((input, index) => ({
        object: "embedding",
        index,
        embedding: String(input).toLowerCase().includes("walking") ? [1, 0, 0] : [0, 1, 0]
      })),
      model: body.model ?? "test-embedding-model",
      usage: { prompt_tokens: inputs.length, total_tokens: inputs.length }
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  assert.ok(address);
  const port = (address as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    paths,
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

function readRequestJson<T>(request: IncomingMessage) {
  return new Promise<T>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("error", reject);
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
      } catch (error) {
        reject(error);
      }
    });
  });
}
