import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { saveProviderApiConfig } from "../providerApiConfigService.js";
import { listProviderModels } from "./service.js";

test("provider model listing uses the selected provider's local API config", async () => {
  await withTempWorkspace(async () => {
    process.env.OPENAI_API_KEY = "sk-wrong-global";
    await saveProviderApiConfig("deepseek", {
      apiKey: "sk-deepseek-local",
      baseURL: "https://api.deepseek.local",
      defaultModel: "deepseek-chat",
      confirmLocalKeyWrite: true
    });

    const requests: Array<{ url: string; authorization?: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requests.push({
        url: String(url),
        authorization: (init?.headers as Record<string, string> | undefined)?.Authorization
      });
      return new Response(JSON.stringify({ data: [{ id: "deepseek-local-model", owned_by: "deepseek" }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    try {
      const result = await listProviderModels({ providerId: "deepseek" });
      assert.equal(result.source, "remote");
      assert.equal(result.models[0]?.id, "deepseek-local-model");
      assert.equal(requests[0]?.url, "https://api.deepseek.local/v1/models");
      assert.equal(requests[0]?.authorization, "Bearer sk-deepseek-local");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("provider model listing falls back to static models with a safe error", async () => {
  await withTempWorkspace(async () => {
    await saveProviderApiConfig("deepseek", {
      apiKey: "sk-deepseek-local",
      baseURL: "https://api.deepseek.local",
      confirmLocalKeyWrite: true
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("Authorization failed for sk-deepseek-local");
    }) as typeof fetch;

    try {
      const result = await listProviderModels({ providerId: "deepseek" });
      assert.equal(result.source, "static");
      assert.ok(result.models.length > 0);
      assert.equal(result.error?.includes("sk-deepseek-local"), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("provider model listing reports missing API keys before remote fetch", async () => {
  await withTempWorkspace(async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error("should not be called");
    }) as typeof fetch;

    try {
      const result = await listProviderModels({ providerId: "deepseek" });
      assert.equal(result.source, "static");
      assert.equal(result.error, "DeepSeek API key is not configured for remote model listing");
      assert.equal(called, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("provider model listing reports empty Base URL before remote fetch", async () => {
  await withTempWorkspace(async () => {
    const result = await listProviderModels({ providerId: "new-api" });
    assert.equal(result.source, "static");
    assert.equal(result.error, "New API requires a Base URL before remote model listing");
  });
});

async function withTempWorkspace(fn: () => Promise<void>) {
  const cwd = process.cwd();
  const env = { ...process.env };
  const temp = await mkdtemp(path.join(os.tmpdir(), "facetwrite-model-list-"));
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
