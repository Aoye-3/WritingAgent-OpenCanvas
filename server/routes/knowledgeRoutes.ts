import type { Express } from "express";
import type { KnowledgeService } from "../knowledge/service.js";
import { createOpenAIChatClient, getProviderProfile, normalizeChatRequest, type ChatMessage } from "../providerRuntime.js";
import { listConfiguredModelApiSummaries, resolveConfiguredModelApi, type ConfiguredModelApi } from "../domains/model-config/index.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";

type KnowledgeRouteDeps = {
  knowledgeService: KnowledgeService;
};

export function registerKnowledgeRoutes(app: Express, { knowledgeService }: KnowledgeRouteDeps) {
  app.get("/api/knowledge/bases", async (_request, response) => {
    sendOk(response, { bases: await knowledgeService.listBases() });
  });

  app.post("/api/knowledge/bases", async (request, response) => {
    try {
      sendOk(response, { base: await knowledgeService.createBase(request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create knowledge base"));
    }
  });

  app.get("/api/knowledge/bases/:baseId", async (request, response) => {
    const base = await knowledgeService.getBase(request.params.baseId);
    if (!base) {
      sendError(response, 404, "not_found", "Knowledge base was not found");
      return;
    }
    sendOk(response, { base });
  });

  app.patch("/api/knowledge/bases/:baseId", async (request, response) => {
    try {
      const base = await knowledgeService.updateBase(request.params.baseId, request.body ?? {});
      if (!base) {
        sendError(response, 404, "not_found", "Knowledge base was not found");
        return;
      }
      sendOk(response, { base });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to update knowledge base"));
    }
  });

  app.delete("/api/knowledge/bases/:baseId", async (request, response) => {
    await knowledgeService.deleteBase(request.params.baseId);
    sendOk(response, { ok: true });
  });

  app.post("/api/knowledge/bases/:baseId/items", async (request, response) => {
    try {
      sendOk(response, { item: await knowledgeService.addItem(request.params.baseId, request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to index knowledge item"));
    }
  });

  app.delete("/api/knowledge/bases/:baseId/items/:itemId", async (request, response) => {
    const deleted = await knowledgeService.deleteItem(request.params.baseId, request.params.itemId);
    if (!deleted) {
      sendError(response, 404, "not_found", "Knowledge item was not found");
      return;
    }
    sendOk(response, { ok: true });
  });

  app.post("/api/knowledge/search", async (request, response) => {
    try {
      sendOk(response, {
        results: await knowledgeService.search({
          query: readString(request.body?.query),
          baseIds: readStringArray(request.body?.baseIds),
          limit: readNumber(request.body?.limit),
          threshold: readNumber(request.body?.threshold)
        })
      });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to search knowledge bases"));
    }
  });

  app.post("/api/knowledge/ask", async (request, response) => {
    try {
      const query = readString(request.body?.query).trim();
      if (!query) {
        sendError(response, 400, "bad_request", "query is required");
        return;
      }
      const locale = request.body?.locale === "zh" ? "zh" : "en";
      const results = await knowledgeService.search({
        query,
        baseIds: readStringArray(request.body?.baseIds),
        limit: readNumber(request.body?.limit),
        threshold: readNumber(request.body?.threshold)
      });
      if (results.length === 0) {
        sendOk(response, {
          answer: locale === "zh" ? "没有在当前知识库中检索到相关内容。" : "No relevant content was found in the selected knowledge base.",
          results,
          provider: "none"
        });
        return;
      }

      const config = await resolveKnowledgeChatConfig();
      const profile = getProviderProfile(config.providerId);
      const client = createOpenAIChatClient({ apiKey: config.apiKey ?? "", baseURL: config.baseURL });
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: locale === "zh"
            ? "你是知识库检索测试 Agent。只能依据 Knowledge References 回答；如果引用里没有答案，明确说没有检索到足够信息。回答要简洁，并在末尾列出使用的引用编号。"
            : "You are a knowledge retrieval test Agent. Answer only from the Knowledge References. If the references do not contain the answer, say that there is not enough retrieved information. Keep the answer concise and list used reference numbers at the end."
        },
        {
          role: "user",
          content: [
            "Knowledge References:",
            ...results.map((result) => `[${result.id}] ${result.title} (${result.source}, score ${result.score.toFixed(3)})\n${result.content}`),
            "",
            `Question: ${query}`
          ].join("\n\n")
        }
      ];
      const completion = await client.createChatCompletion(normalizeChatRequest(profile, {
        modelSettings: {
          configuredModelApiId: config.id,
          providerId: config.providerId,
          model: config.modelId,
          responseMode: "normal",
          temperature: 0.2,
          topP: 1,
          contextCount: 0,
          maxTokens: 900,
          maxTokensEnabled: true,
          streaming: false,
          toolCallMode: "none",
          maxToolCalls: 0
        },
        messages,
        tools: [],
        stream: false
      }));
      const answer = completion.choices[0]?.message?.content?.trim();
      sendOk(response, {
        answer: answer || (locale === "zh" ? "模型没有返回回答。" : "The model returned no answer."),
        results,
        provider: config.providerId,
        model: config.modelId,
        usage: completion.usage
      });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to answer from knowledge base"));
    }
  });

  app.post("/api/knowledge/bases/:baseId/reindex", async (request, response) => {
    try {
      sendOk(response, { base: await knowledgeService.reindexBase(request.params.baseId) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to reindex knowledge base"));
    }
  });
}

async function resolveKnowledgeChatConfig(): Promise<ConfiguredModelApi> {
  const summaries = await listConfiguredModelApiSummaries();
  const candidates = summaries.configs.filter((config) =>
    config.enabled &&
    config.keyConfigured &&
    isChatModelType(config.modelType)
  );
  const selected = candidates.find((config) => config.id === summaries.activeConfigId) ?? candidates[0];
  if (!selected) {
    throw new Error("A configured chat model API is required for Knowledge Agent test.");
  }
  const config = await resolveConfiguredModelApi(selected.id);
  if (!config.apiKey?.trim()) {
    throw new Error("A configured chat model API key is required for Knowledge Agent test.");
  }
  return config;
}

function isChatModelType(value: string | undefined) {
  const type = value?.toLowerCase();
  return !type || type === "chat" || type === "vision";
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
