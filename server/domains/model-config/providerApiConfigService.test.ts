import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  deleteProviderApiConfig,
  listProviderApiConfigSummaries,
  readProviderApiConfigStore,
  resolveProviderApiConfig,
  saveProviderApiConfig
} from "./providerApiConfigService.js";

test("provider API config store saves multiple providers and returns redacted summaries", async () => {
  await withTempWorkspace(async () => {
    await saveProviderApiConfig("deepseek", {
      apiKey: "sk-deepseek-123456",
      baseURL: "https://api.deepseek.com",
      defaultModel: "deepseek-v4-flash",
      confirmLocalKeyWrite: true
    });
    await saveProviderApiConfig("silicon", {
      apiKey: "sk-silicon-abcdef",
      baseURL: "https://api.siliconflow.cn/v1",
      defaultModel: "deepseek-ai/DeepSeek-V3",
      confirmLocalKeyWrite: true
    });

    const list = await listProviderApiConfigSummaries();
    assert.equal(list.configs.filter((config) => config.keyConfigured).length, 2);
    assert.equal(list.configs.some((config) => config.keyHint === "...3456"), true);
    assert.equal(list.configs.some((config) => config.keyHint === "...cdef"), true);
    assert.equal(JSON.stringify(list).includes("sk-deepseek"), false);

    const raw = await readFile(path.resolve(process.cwd(), ".facetwrite", "provider-apis.json"), "utf8");
    assert.equal(raw.includes("sk-deepseek-123456"), true);
    assert.equal(raw.includes("sk-silicon-abcdef"), true);
  });
});

test("provider API config store does not create a default model from OPENAI env settings", async () => {
  await withTempWorkspace(async () => {
    process.env.OPENAI_PROVIDER_ID = "dashscope";
    process.env.OPENAI_API_KEY = "sk-env-dashscope";
    process.env.OPENAI_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    process.env.OPENAI_MODEL = "qwen-plus";

    const store = await readProviderApiConfigStore();
    assert.equal(Object.values(store.configs).some((item) => item.providerId === "dashscope"), false);
    await assert.rejects(() => resolveProviderApiConfig("dashscope"), /not configured/i);
  });
});

test("saving a Model Config does not mutate runtime OPENAI defaults", async () => {
  await withTempWorkspace(async () => {
    await saveProviderApiConfig("deepseek", {
      apiKey: "sk-explicit",
      defaultModel: "deepseek-explicit",
      confirmLocalKeyWrite: true
    });
    assert.equal(process.env.OPENAI_API_KEY, undefined);
    assert.equal(process.env.OPENAI_MODEL, undefined);
  });
});

test("provider API config save requires explicit confirmation when writing a key", async () => {
  await withTempWorkspace(async () => {
    await assert.rejects(
      () => saveProviderApiConfig("deepseek", { apiKey: "sk-secret", defaultModel: "deepseek-explicit" }),
      /confirmLocalKeyWrite/
    );
  });
});

test("provider API config can delete one provider without touching others", async () => {
  await withTempWorkspace(async () => {
    await saveProviderApiConfig("deepseek", { apiKey: "sk-a", defaultModel: "deepseek-explicit", confirmLocalKeyWrite: true });
    await saveProviderApiConfig("silicon", { apiKey: "sk-b", defaultModel: "silicon-explicit", confirmLocalKeyWrite: true });
    await deleteProviderApiConfig("deepseek");

    const list = await listProviderApiConfigSummaries();
    assert.equal(list.configs.some((config) => config.providerId === "deepseek" && config.keyConfigured), false);
    assert.equal(list.configs.some((config) => config.providerId === "silicon" && config.keyConfigured), true);
  });
});

async function withTempWorkspace(fn: () => Promise<void>) {
  const cwd = process.cwd();
  const env = { ...process.env };
  const temp = await mkdtemp(path.join(os.tmpdir(), "facetwrite-provider-api-"));
  process.chdir(temp);
  delete process.env.OPENAI_PROVIDER_ID;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_MODEL;
  try {
    await fn();
  } finally {
    process.chdir(cwd);
    process.env = env;
    await rm(temp, { recursive: true, force: true });
  }
}
