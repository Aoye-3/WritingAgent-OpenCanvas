import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { buildKnowledgeAskMessages, registerKnowledgeRoutes } from "./knowledgeRoutes.js";
import type { KnowledgeService } from "../knowledge/service.js";
import type { KnowledgeSearchResult } from "../knowledge/types.js";
import type { ConfiguredModelApi } from "../domains/model-config/index.js";

async function request(app: express.Express, body: unknown) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const response = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}/api/knowledge/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return {
      status: response.status,
      body: await response.json() as Record<string, unknown>
    };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function createTestApp(results: KnowledgeSearchResult[], capture?: { messages?: unknown[] }) {
  const app = express();
  app.use(express.json());
  registerKnowledgeRoutes(app, {
    knowledgeService: fakeKnowledgeService(results),
    resolveChatConfig: async () => fakeChatConfig(),
    createChatClient: () => ({
      createChatCompletion: async (body) => {
        capture!.messages = body.messages;
        return {
          choices: [{ message: { role: "assistant", content: "Answer from retrieved references. References: [1]" } }],
          usage: { total_tokens: 10 }
        };
      }
    })
  });
  return app;
}

test("requires a query for knowledge ask", async () => {
  const result = await request(createTestApp([]), { query: "   " });

  assert.equal(result.status, 400);
  assert.equal((result.body.error as { code: string }).code, "bad_request");
  assert.equal((result.body.error as { message: string }).message, "query is required");
});

test("returns an explicit Chinese no-result answer without calling a chat model", async () => {
  const capture: { messages?: unknown[] } = {};
  const result = await request(createTestApp([], capture), { query: "知识库里有什么？", locale: "zh" });

  assert.equal(result.status, 200);
  assert.equal(result.body.answer, "没有在当前知识库中检索到相关内容。");
  assert.deepEqual(result.body.results, []);
  assert.equal(result.body.provider, "none");
  assert.equal(capture.messages, undefined);
});

test("builds a one-shot knowledge prompt from retrieved references only", async () => {
  const capture: { messages?: unknown[] } = {};
  const result = await request(createTestApp([fakeResult()], capture), { query: "What does the consent form cover?", locale: "en" });

  assert.equal(result.status, 200);
  assert.equal(result.body.answer, "Answer from retrieved references. References: [1]");
  assert.ok(capture.messages);
  assert.equal(capture.messages!.length, 2);
  const userMessage = capture.messages![1] as { content: string };
  assert.match(userMessage.content, /Knowledge References:/);
  assert.match(userMessage.content, /Consent form requirements/);
  assert.match(userMessage.content, /Question: What does the consent form cover\?/);
  assert.equal(userMessage.content.includes("Hackathon"), false);
  assert.equal(userMessage.content.includes("已有上下文记忆"), false);
});

test("uses Chinese system instructions for the knowledge test Agent", () => {
  const messages = buildKnowledgeAskMessages("inside?", [fakeResult()], "zh");

  assert.match(String(messages[0].content), /\u53ea\u80fd\u4f9d\u636e Knowledge References \u56de\u7b54/);
  assert.match(String(messages[0].content), /\u6ca1\u6709\u68c0\u7d22\u5230\u8db3\u591f\u4fe1\u606f/);
});

function fakeKnowledgeService(results: KnowledgeSearchResult[]) {
  return {
    async search() {
      return results;
    },
    async listBases() {
      return [];
    },
    async createBase() {
      throw new Error("not used");
    },
    async getBase() {
      return undefined;
    },
    async updateBase() {
      return undefined;
    },
    async deleteBase() {},
    async addItem() {
      throw new Error("not used");
    },
    async deleteItem() {
      return false;
    },
    async reindexBase() {
      return undefined;
    }
  } as unknown as KnowledgeService;
}

function fakeResult(): KnowledgeSearchResult {
  return {
    id: 1,
    baseId: "kb_1",
    baseName: "Testing",
    title: "Consent form requirements",
    source: "Consent-Form-Template.docx",
    content: "The consent form covers participant rights and data use.",
    score: 0.87,
    metadata: {}
  };
}

function fakeChatConfig(): ConfiguredModelApi {
  return {
    id: "cfg_chat",
    providerId: "openai",
    modelId: "gpt-test",
    modelType: "chat",
    apiKey: "test-key",
    baseURL: "https://api.openai.test/v1",
    enabled: true,
    createdAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z"
  };
}
