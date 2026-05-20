import type { ModelReference } from "../../../../shared/modelReferences.js";
import type { ModelFetcher } from "./types.js";
import { dedup, formatOpenAIBaseURL, getJson, modelFromId, parseOpenAIModels, readArray, readString, trimSlash } from "./utils.js";

const ollamaFetcher: ModelFetcher = {
  match: (provider) => provider.type === "ollama" || provider.id === "ollama",
  async fetch(context) {
    const baseURL = trimSlash(context.baseURL).replace(/\/v1$/i, "").replace(/\/api$/i, "");
    const payload = await getJson(`${baseURL}/api/tags`, context);
    return dedup(readArray(payload, "models").map((entry) => {
      const id = readString(entry, ["name"]);
      return id ? modelFromId(context.provider, id, { ownedBy: "ollama" }) : undefined;
    }).filter((entry): entry is ModelReference => Boolean(entry)));
  }
};

const geminiFetcher: ModelFetcher = {
  match: (provider) => provider.type === "gemini" || provider.id === "gemini",
  async fetch(context) {
    const baseURL = trimSlash(context.baseURL).replace(/\/v1(beta)?$/i, "");
    const payload = await getJson(`${baseURL}/v1beta/models?key=${encodeURIComponent(context.apiKey)}`, context);
    return dedup(readArray(payload, "models").map((entry) => {
      const rawName = readString(entry, ["name"]);
      if (!rawName) return undefined;
      const id = rawName.startsWith("models/") ? rawName.slice(7) : rawName;
      return modelFromId(context.provider, id, {
        name: readString(entry, ["displayName"]) ?? id,
        description: readString(entry, ["description"])
      });
    }).filter((entry): entry is ModelReference => Boolean(entry)));
  }
};

const openRouterFetcher: ModelFetcher = {
  match: (provider) => provider.id === "openrouter",
  async fetch(context) {
    const chat = await getJson("https://openrouter.ai/api/v1/models", context);
    const embedding = await getJson("https://openrouter.ai/api/v1/embeddings/models", context).catch(() => ({ data: [] }));
    return dedup([
      ...parseOpenAIModels(context.provider, chat),
      ...parseOpenAIModels(context.provider, embedding, "embedding")
    ]);
  }
};

const ppioFetcher: ModelFetcher = {
  match: (provider) => provider.id === "ppio",
  async fetch(context) {
    const baseURL = formatOpenAIBaseURL(context.baseURL);
    const [chat, embedding, rerank] = await Promise.all([
      getJson(`${baseURL}/models`, context),
      getJson(`${baseURL}/models?model_type=embedding`, context).catch(() => ({ data: [] })),
      getJson(`${baseURL}/models?model_type=reranker`, context).catch(() => ({ data: [] }))
    ]);
    return dedup([
      ...parseOpenAIModels(context.provider, chat),
      ...parseOpenAIModels(context.provider, embedding, "embedding"),
      ...parseOpenAIModels(context.provider, rerank, "rerank")
    ]);
  }
};

const aiHubMixFetcher: ModelFetcher = {
  match: (provider) => provider.id === "aihubmix",
  async fetch(context) {
    return parseOpenAIModels(context.provider, await getJson("https://aihubmix.com/api/v1/models", context));
  }
};

const togetherFetcher: ModelFetcher = {
  match: (provider) => provider.id === "together",
  async fetch(context) {
    const payload = await getJson(`${formatOpenAIBaseURL(context.baseURL)}/models`, context);
    if (!Array.isArray(payload)) return parseOpenAIModels(context.provider, payload);
    return dedup(payload.map((entry) => {
      const id = readString(entry, ["id"]);
      return id ? modelFromId(context.provider, id, {
        name: readString(entry, ["display_name"]) ?? id,
        description: readString(entry, ["description"]),
        ownedBy: readString(entry, ["organization"])
      }) : undefined;
    }).filter((entry): entry is ModelReference => Boolean(entry)));
  }
};

const newApiFetcher: ModelFetcher = {
  match: (provider) => provider.type === "new-api" || provider.id === "new-api" || provider.id === "cherryin",
  async fetch(context) {
    return parseOpenAIModels(context.provider, await getJson(`${formatOpenAIBaseURL(context.baseURL)}/models`, context));
  }
};

const githubFetcher: ModelFetcher = {
  match: (provider) => provider.id === "github",
  async fetch(context) {
    const [catalog, v1] = await Promise.all([
      getJson("https://models.github.ai/catalog/models", context),
      getJson("https://models.github.ai/v1/models", context).catch(() => ({ data: [] }))
    ]);
    const catalogModels = Array.isArray(catalog) ? catalog.map((entry) => {
      const id = readString(entry, ["id"]);
      return id ? modelFromId(context.provider, id, {
        name: readString(entry, ["name"]) ?? id,
        description: readString(entry, ["summary", "description"]),
        ownedBy: readString(entry, ["publisher"])
      }) : undefined;
    }).filter((entry): entry is ModelReference => Boolean(entry)) : [];
    return dedup([...catalogModels, ...parseOpenAIModels(context.provider, v1)]);
  }
};

const gatewayFetcher: ModelFetcher = {
  match: (provider) => provider.id === "gateway",
  async fetch(context) {
    const payload = await getJson("https://ai-gateway.vercel.sh/v3/ai/config", context);
    return dedup(readArray(payload, "models").map((entry) => {
      const id = readString(entry, ["id"]);
      return id ? modelFromId(context.provider, id, {
        name: readString(entry, ["name"]) ?? id,
        description: readString(entry, ["description"])
      }) : undefined;
    }).filter((entry): entry is ModelReference => Boolean(entry)));
  }
};

export const openAICompatibleFetcher: ModelFetcher = {
  match: () => true,
  async fetch(context) {
    return parseOpenAIModels(context.provider, await getJson(`${formatOpenAIBaseURL(context.baseURL)}/models`, context));
  }
};

export const modelFetchers: ModelFetcher[] = [
  aiHubMixFetcher,
  ollamaFetcher,
  geminiFetcher,
  githubFetcher,
  togetherFetcher,
  newApiFetcher,
  openRouterFetcher,
  ppioFetcher,
  gatewayFetcher,
  openAICompatibleFetcher
];
