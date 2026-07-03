import type { ModelReference, ProviderReference } from "./types.js";

function model(provider: string, id: string, group: string, extra: Partial<ModelReference> = {}): ModelReference {
  return {
    id,
    name: extra.name ?? id,
    provider,
    group,
    modelType: extra.modelType ?? "chat",
    ...extra
  };
}

const providerModels: Record<string, ModelReference[]> = {
  cherryin: [],
  silicon: [
    model("silicon", "deepseek-ai/DeepSeek-V3.2", "deepseek-ai", { supportsThinking: true }),
    model("silicon", "Qwen/Qwen3-8B", "Qwen"),
    model("silicon", "BAAI/bge-m3", "BAAI", { modelType: "embedding" })
  ],
  aihubmix: [
    model("aihubmix", "gpt-5", "OpenAI"),
    model("aihubmix", "gpt-5-mini", "OpenAI"),
    model("aihubmix", "gpt-5-nano", "OpenAI"),
    model("aihubmix", "gpt-4.1", "OpenAI"),
    model("aihubmix", "DeepSeek-V3", "DeepSeek"),
    model("aihubmix", "DeepSeek-R1", "DeepSeek", { supportsThinking: true }),
    model("aihubmix", "claude-sonnet-4-20250514", "Claude"),
    model("aihubmix", "gemini-2.5-pro", "Gemini")
  ],
  ovms: [],
  ocoolai: [],
  zhipu: [
    model("zhipu", "glm-4.5", "GLM"),
    model("zhipu", "glm-4.5-air", "GLM"),
    model("zhipu", "glm-4-flash", "GLM")
  ],
  zai: [
    model("zai", "glm-4.5", "GLM"),
    model("zai", "glm-4.5-air", "GLM")
  ],
  deepseek: [
    model("deepseek", "deepseek-v4-flash", "DeepSeek", { supportsThinking: true }),
    model("deepseek", "deepseek-v4-pro", "DeepSeek", { supportsThinking: true })
  ],
  alayanew: [],
  dmxapi: [
    model("dmxapi", "deepseek-chat", "DeepSeek"),
    model("dmxapi", "deepseek-reasoner", "DeepSeek", { supportsThinking: true }),
    model("dmxapi", "gpt-4o", "OpenAI")
  ],
  aionly: [],
  burncloud: [
    model("burncloud", "gpt-5", "OpenAI"),
    model("burncloud", "gemini-2.5-pro", "Gemini"),
    model("burncloud", "deepseek-chat", "DeepSeek"),
    model("burncloud", "deepseek-reasoner", "DeepSeek", { supportsThinking: true })
  ],
  tokenflux: [],
  "302ai": [
    model("302ai", "deepseek-chat", "DeepSeek"),
    model("302ai", "deepseek-reasoner", "DeepSeek", { supportsThinking: true }),
    model("302ai", "gpt-4.1", "OpenAI"),
    model("302ai", "o3", "OpenAI"),
    model("302ai", "qwen3-235b-a22b", "Qwen"),
    model("302ai", "jina-reranker-m0", "Jina AI", { modelType: "rerank" })
  ],
  cephalon: [],
  lanyun: [],
  ph8: [
    model("ph8", "deepseek-v3-241226", "DeepSeek"),
    model("ph8", "deepseek-r1-250120", "DeepSeek", { supportsThinking: true })
  ],
  sophnet: [],
  ppio: [
    model("ppio", "deepseek/deepseek-v3.2", "deepseek", { supportsThinking: true }),
    model("ppio", "minimax/minimax-m2", "minimaxai"),
    model("ppio", "qwen/qwen3-235b-a22b-instruct-2507", "qwen"),
    model("ppio", "qwen/qwen3-vl-235b-a22b-instruct", "qwen", { modelType: "vision" }),
    model("ppio", "qwen/qwen3-embedding-8b", "qwen", { modelType: "embedding" }),
    model("ppio", "qwen/qwen3-reranker-8b", "qwen", { modelType: "rerank" })
  ],
  dashscope: [
    model("dashscope", "qwen3.5-plus", "Qwen", { name: "Qwen3.5-Plus" }),
    model("dashscope", "qwen3.5-flash", "Qwen", { name: "Qwen3.5-Flash" }),
    model("dashscope", "qwen3-max", "Qwen", { name: "Qwen3-Max" }),
    model("dashscope", "kimi-k2.5", "Kimi", { name: "Kimi K2.5" }),
    model("dashscope", "glm-5", "GLM", { name: "GLM-5" }),
    model("dashscope", "MiniMax/MiniMax-M2.5", "MiniMax", { name: "MiniMax M2.5" }),
    model("dashscope", "deepseek-v3.2", "DeepSeek", { name: "DeepSeek V3.2", supportsThinking: true })
  ],
  minimax: [model("minimax", "abab6.5s-chat", "MiniMax"), model("minimax", "MiniMax-M2", "MiniMax")],
  "minimax-global": [model("minimax-global", "MiniMax-M2", "MiniMax")],
  moonshot: [model("moonshot", "moonshot-v1-8k", "Moonshot"), model("moonshot", "kimi-k2-0905-preview", "Kimi")],
  qiniu: [],
  openrouter: [
    model("openrouter", "openai/gpt-4o-mini", "openai"),
    model("openrouter", "anthropic/claude-sonnet-4", "anthropic"),
    model("openrouter", "deepseek/deepseek-chat", "deepseek")
  ],
  "new-api": [],
  ollama: [],
  lmstudio: [],
  anthropic: [
    model("anthropic", "claude-sonnet-4-20250514", "Claude"),
    model("anthropic", "claude-opus-4-20250514", "Claude"),
    model("anthropic", "claude-3-5-haiku-latest", "Claude")
  ],
  openai: [
    model("openai", "gpt-5.4", "GPT 5.4"),
    model("openai", "gpt-5.2", "GPT 5.2"),
    model("openai", "gpt-5.1", "GPT 5.1"),
    model("openai", "gpt-5", "GPT 5"),
    model("openai", "gpt-image-1", "GPT Image", { modelType: "image" })
  ],
  "azure-openai": [model("azure-openai", "gpt-4o", "GPT 4o"), model("azure-openai", "gpt-4o-mini", "GPT 4o")],
  gemini: [
    model("gemini", "gemini-2.5-flash", "Gemini 2.5"),
    model("gemini", "gemini-2.5-pro", "Gemini 2.5"),
    model("gemini", "gemini-2.5-flash-image-preview", "Gemini 2.5", { modelType: "image" })
  ],
  vertexai: [],
  github: [model("github", "gpt-4o-mini", "GitHub Models"), model("github", "Phi-4", "GitHub Models")],
  copilot: [],
  doubao: [
    model("doubao", "doubao-seed-1-8-251228", "Doubao-Seed-1.8", { name: "Doubao-Seed-1.8" }),
    model("doubao", "doubao-1-5-vision-pro-32k-250115", "Doubao-1.5-vision-pro", { name: "doubao-1.5-vision-pro", modelType: "vision" }),
    model("doubao", "doubao-1-5-pro-32k-250115", "Doubao-1.5-pro", { name: "doubao-1.5-pro-32k" }),
    model("doubao", "doubao-1-5-pro-32k-character-250228", "Doubao-1.5-pro", { name: "doubao-1.5-pro-32k-character" }),
    model("doubao", "doubao-1-5-pro-256k-250115", "Doubao-1.5-pro", { name: "Doubao-1.5-pro-256k" }),
    model("doubao", "deepseek-r1-250120", "DeepSeek", { name: "DeepSeek-R1", supportsThinking: true }),
    model("doubao", "deepseek-r1-distill-qwen-32b-250120", "DeepSeek", { name: "DeepSeek-R1-Distill-Qwen-32B", supportsThinking: true }),
    model("doubao", "deepseek-r1-distill-qwen-7b-250120", "DeepSeek", { name: "DeepSeek-R1-Distill-Qwen-7B", supportsThinking: true }),
    model("doubao", "deepseek-v3-250324", "DeepSeek", { name: "DeepSeek-V3" })
  ],
  baichuan: [],
  stepfun: [model("stepfun", "step-1-8k", "Step 1"), model("stepfun", "step-1-flash", "Step 1")],
  yi: [model("yi", "yi-large", "01.AI")],
  infini: [],
  groq: [model("groq", "llama3-8b-8192", "Llama3"), model("groq", "llama3-70b-8192", "Llama3")],
  together: [model("together", "meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo", "Llama", { modelType: "vision" })],
  fireworks: [],
  nvidia: [],
  grok: [model("grok", "grok-3", "Grok"), model("grok", "grok-3-mini", "Grok")],
  hyperbolic: [],
  mistral: [model("mistral", "mistral-large-latest", "Mistral"), model("mistral", "mistral-small-latest", "Mistral")],
  jina: [model("jina", "jina-reranker-m0", "Jina AI", { modelType: "rerank" }), model("jina", "jina-embeddings-v3", "Jina AI", { modelType: "embedding" })],
  perplexity: [model("perplexity", "sonar", "Sonar"), model("perplexity", "sonar-pro", "Sonar")],
  modelscope: [model("modelscope", "Qwen/Qwen3-235B-A22B", "Qwen")],
  xirang: [],
  hunyuan: [model("hunyuan", "hunyuan-turbos-latest", "Hunyuan")],
  "tencent-cloud-ti": [],
  "baidu-cloud": [],
  gpustack: [],
  voyageai: [model("voyageai", "voyage-3-large", "Voyage", { modelType: "embedding" }), model("voyageai", "rerank-2", "Voyage", { modelType: "rerank" })],
  "aws-bedrock": [],
  poe: [],
  longcat: [model("longcat", "LongCat-Flash-Chat", "LongCat")],
  huggingface: [],
  gateway: [],
  cerebras: [model("cerebras", "llama3.1-8b", "Llama"), model("cerebras", "llama3.1-70b", "Llama")],
  mimo: []
};

const providersBase: Array<Omit<ProviderReference, "models" | "defaultModel"> & { defaultModel?: string }> = [
  { id: "cherryin", name: "CherryIN", type: "new-api", apiHost: "https://open.cherryin.cc", anthropicApiHost: "https://open.cherryin.cc", enabled: true },
  { id: "silicon", name: "SiliconFlow", type: "openai", apiHost: "https://api.siliconflow.cn", anthropicApiHost: "https://api.siliconflow.cn", enabled: false, websites: { official: "https://www.siliconflow.cn", apiKey: "https://cloud.siliconflow.cn/i/d1nTBKXU", docs: "https://docs.siliconflow.cn/", models: "https://cloud.siliconflow.cn/models" } },
  { id: "aihubmix", name: "AiHubMix", type: "openai", apiHost: "https://aihubmix.com", anthropicApiHost: "https://aihubmix.com", enabled: false },
  { id: "ovms", name: "OpenVINO Model Server", type: "openai", apiHost: "http://localhost:8000/v3/", enabled: false },
  { id: "ocoolai", name: "ocoolAI", type: "openai", apiHost: "https://api.ocoolai.com", enabled: false },
  { id: "zhipu", name: "ZhiPu", type: "openai", apiHost: "https://open.bigmodel.cn/api/paas/v4/", anthropicApiHost: "https://open.bigmodel.cn/api/anthropic", enabled: false },
  { id: "zai", name: "Z.ai", type: "openai", apiHost: "https://api.z.ai/api/paas/v4/", anthropicApiHost: "https://api.z.ai/api/anthropic", enabled: false },
  { id: "deepseek", name: "DeepSeek", type: "openai", apiHost: "https://api.deepseek.com", anthropicApiHost: "https://api.deepseek.com/anthropic", enabled: false, defaultModel: "deepseek-v4-flash", websites: { official: "https://deepseek.com/", apiKey: "https://platform.deepseek.com/api_keys", docs: "https://platform.deepseek.com/api-docs/", models: "https://platform.deepseek.com/api-docs/" } },
  { id: "alayanew", name: "AlayaNew", type: "openai", apiHost: "https://deepseek.alayanew.com", enabled: false },
  { id: "dmxapi", name: "DMXAPI", type: "openai", apiHost: "https://www.dmxapi.cn", anthropicApiHost: "https://www.dmxapi.cn", enabled: false },
  { id: "aionly", name: "AIOnly", type: "openai", apiHost: "https://api.aiionly.com", enabled: false },
  { id: "burncloud", name: "BurnCloud", type: "openai", apiHost: "https://ai.burncloud.com", enabled: false },
  { id: "tokenflux", name: "TokenFlux", type: "openai", apiHost: "https://api.tokenflux.ai/openai/v1", anthropicApiHost: "https://api.tokenflux.ai/anthropic", enabled: false },
  { id: "302ai", name: "302.AI", type: "openai", apiHost: "https://api.302.ai", anthropicApiHost: "https://api.302.ai", enabled: false },
  { id: "cephalon", name: "Cephalon", type: "openai", apiHost: "https://cephalon.cloud/user-center/v1/model", enabled: false },
  { id: "lanyun", name: "LANYUN", type: "openai", apiHost: "https://maas-api.lanyun.net", enabled: false },
  { id: "ph8", name: "PH8", type: "openai", apiHost: "https://ph8.co", enabled: false },
  { id: "sophnet", name: "SophNet", type: "openai", apiHost: "https://www.sophnet.com/api/open-apis/v1", enabled: false },
  { id: "ppio", name: "PPIO", type: "openai", apiHost: "https://api.ppinfra.com/v3/openai", enabled: false },
  { id: "dashscope", name: "Bailian", type: "openai", apiHost: "https://dashscope.aliyuncs.com/compatible-mode/v1/", anthropicApiHost: "https://dashscope.aliyuncs.com/apps/anthropic", enabled: false, websites: { official: "https://www.aliyun.com/product/bailian", apiKey: "https://bailian.console.aliyun.com/?tab=model#/api-key", docs: "https://help.aliyun.com/zh/model-studio/getting-started/", models: "https://bailian.console.aliyun.com/?tab=model#/model-market" } },
  { id: "minimax", name: "MiniMax", type: "openai", apiHost: "https://api.minimaxi.com/v1/", anthropicApiHost: "https://api.minimaxi.com/anthropic", enabled: false },
  { id: "minimax-global", name: "MiniMax Global", type: "openai", apiHost: "https://api.minimax.io/v1/", anthropicApiHost: "https://api.minimax.io/anthropic", enabled: false },
  { id: "moonshot", name: "Moonshot", type: "openai", apiHost: "https://api.moonshot.cn/v1", enabled: false },
  { id: "qiniu", name: "Qiniu", type: "openai", apiHost: "https://api.qnaigc.com/v1", enabled: false },
  { id: "openrouter", name: "OpenRouter", type: "openai", apiHost: "https://openrouter.ai/api/v1/", enabled: false, websites: { official: "https://openrouter.ai/", apiKey: "https://openrouter.ai/settings/keys", docs: "https://openrouter.ai/docs/quick-start", models: "https://openrouter.ai/models" } },
  { id: "new-api", name: "New API", type: "new-api", apiHost: "", enabled: false },
  { id: "ollama", name: "Ollama", type: "ollama", apiHost: "http://localhost:11434", enabled: false },
  { id: "lmstudio", name: "LM Studio", type: "openai", apiHost: "http://localhost:1234/v1", enabled: false },
  { id: "anthropic", name: "Anthropic", type: "anthropic", apiHost: "https://api.anthropic.com", enabled: false },
  { id: "openai", name: "OpenAI", type: "openai", apiHost: "https://api.openai.com/v1", enabled: false, defaultModel: "gpt-5" },
  { id: "azure-openai", name: "Azure OpenAI", type: "azure-openai", apiHost: "", enabled: false },
  { id: "gemini", name: "Google Gemini", type: "gemini", apiHost: "https://generativelanguage.googleapis.com/v1beta", enabled: false },
  { id: "vertexai", name: "Vertex AI", type: "vertex-ai", apiHost: "https://aiplatform.googleapis.com", enabled: false },
  { id: "github", name: "GitHub Models", type: "openai", apiHost: "https://models.github.ai/inference", enabled: false },
  { id: "copilot", name: "GitHub Copilot", type: "openai", apiHost: "https://api.githubcopilot.com/", enabled: false },
  { id: "doubao", name: "Volcengine Ark", type: "openai", apiHost: "https://ark.cn-beijing.volces.com/api/v3/", enabled: false, websites: { official: "https://console.volcengine.com/ark/", apiKey: "https://www.volcengine.com/experience/ark", docs: "https://www.volcengine.com/docs/82379/1182403", models: "https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint" } },
  { id: "baichuan", name: "Baichuan AI", type: "openai", apiHost: "https://api.baichuan-ai.com", enabled: false },
  { id: "stepfun", name: "StepFun", type: "openai", apiHost: "https://api.stepfun.com", enabled: false },
  { id: "yi", name: "01.AI", type: "openai", apiHost: "https://api.lingyiwanwu.com/v1", enabled: false },
  { id: "infini", name: "Infini AI", type: "openai", apiHost: "https://cloud.infini-ai.com/maas/v1", enabled: false },
  { id: "groq", name: "Groq", type: "openai", apiHost: "https://api.groq.com/openai/v1", enabled: false },
  { id: "together", name: "Together", type: "openai", apiHost: "https://api.together.xyz/v1", enabled: false },
  { id: "fireworks", name: "Fireworks", type: "openai", apiHost: "https://api.fireworks.ai/inference/v1", enabled: false },
  { id: "nvidia", name: "NVIDIA", type: "openai", apiHost: "https://integrate.api.nvidia.com/v1", enabled: false },
  { id: "grok", name: "xAI Grok", type: "openai", apiHost: "https://api.x.ai/v1", enabled: false },
  { id: "hyperbolic", name: "Hyperbolic", type: "openai", apiHost: "https://api.hyperbolic.xyz/v1", enabled: false },
  { id: "mistral", name: "Mistral", type: "openai", apiHost: "https://api.mistral.ai/v1", enabled: false },
  { id: "jina", name: "Jina AI", type: "openai", apiHost: "https://api.jina.ai/v1", enabled: false },
  { id: "perplexity", name: "Perplexity", type: "openai", apiHost: "https://api.perplexity.ai", enabled: false },
  { id: "modelscope", name: "ModelScope", type: "openai", apiHost: "https://api-inference.modelscope.cn/v1", enabled: false },
  { id: "xirang", name: "Xirang", type: "openai", apiHost: "https://wishub-x1.ctyun.cn/v1", enabled: false },
  { id: "hunyuan", name: "Tencent Hunyuan", type: "openai", apiHost: "https://api.hunyuan.cloud.tencent.com/v1", enabled: false },
  { id: "tencent-cloud-ti", name: "Tencent Cloud TI", type: "openai", apiHost: "https://api.lkeap.cloud.tencent.com/v1", enabled: false },
  { id: "baidu-cloud", name: "Baidu Cloud", type: "openai", apiHost: "https://qianfan.baidubce.com/v2", enabled: false },
  { id: "gpustack", name: "GPUStack", type: "openai", apiHost: "http://localhost:8080/v1-openai", enabled: false },
  { id: "voyageai", name: "Voyage AI", type: "openai", apiHost: "https://api.voyageai.com/v1", enabled: false },
  { id: "aws-bedrock", name: "AWS Bedrock", type: "aws-bedrock", apiHost: "", enabled: false },
  { id: "poe", name: "Poe", type: "openai", apiHost: "https://api.poe.com/v1", enabled: false },
  { id: "longcat", name: "LongCat", type: "openai", apiHost: "https://api.longcat.chat/openai/v1", enabled: false },
  { id: "huggingface", name: "Hugging Face", type: "openai", apiHost: "https://router.huggingface.co/v1", enabled: false },
  { id: "gateway", name: "Vercel AI Gateway", type: "openai", apiHost: "https://ai-gateway.vercel.sh/v1", enabled: false },
  { id: "cerebras", name: "Cerebras", type: "openai", apiHost: "https://api.cerebras.ai/v1", enabled: false },
  { id: "mimo", name: "MiMo", type: "openai", apiHost: "https://api.mimo.cn/openai/v1", enabled: false }
];

export const providerReferences: ProviderReference[] = providersBase.map((provider) => {
  const models = providerModels[provider.id] ?? [];
  return {
    ...provider,
    defaultModel: provider.defaultModel ?? models[0]?.id,
    models
  };
});

export function getProviderReference(providerId?: string): ProviderReference | undefined {
  return providerReferences.find((provider) => provider.id === providerId);
}

export function isKnownProviderId(providerId: unknown): providerId is string {
  return typeof providerId === "string" && providerReferences.some((provider) => provider.id === providerId);
}

export function getStaticModels(providerId: string): ModelReference[] {
  return getProviderReference(providerId)?.models ?? [];
}
