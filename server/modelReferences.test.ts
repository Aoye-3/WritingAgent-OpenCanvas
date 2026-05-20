import test from "node:test";
import assert from "node:assert/strict";
import { getProviderReference, isKnownProviderId, providerReferences } from "../shared/modelReferences.js";
import { parseSettingsPayload } from "./contracts/settings.js";
import { getProviderProfile } from "./providerRuntime.js";

test("model reference registry loads provider metadata without logo fields", () => {
  assert.ok(providerReferences.length >= 50);
  for (const provider of providerReferences) {
    assert.equal("logo" in provider, false);
    assert.equal("logoUrl" in provider, false);
    assert.equal(typeof provider.id, "string");
    assert.equal(typeof provider.name, "string");
    assert.equal(typeof provider.apiHost, "string");
  }
});

test("provider and model ids are internally consistent", () => {
  const providerIds = new Set<string>();
  for (const provider of providerReferences) {
    assert.equal(providerIds.has(provider.id), false, `duplicate provider ${provider.id}`);
    providerIds.add(provider.id);
    const modelIds = new Set<string>();
    for (const model of provider.models) {
      assert.equal(model.provider, provider.id);
      assert.equal(modelIds.has(model.id), false, `duplicate model ${provider.id}:${model.id}`);
      modelIds.add(model.id);
    }
  }
});

test("settings payload accepts registry providers", () => {
  assert.equal(parseSettingsPayload({ providerId: "silicon" }).providerId, "silicon");
  assert.equal(parseSettingsPayload({ providerId: "doubao" }).providerId, "doubao");
  assert.equal(parseSettingsPayload({ providerId: "dashscope" }).providerId, "dashscope");
  assert.equal(parseSettingsPayload({ providerId: "missing" }).providerId, undefined);
});

test("provider runtime creates OpenAI-compatible profile from registry provider", () => {
  const profile = getProviderProfile("silicon");
  const reference = getProviderReference("silicon");

  assert.ok(reference);
  assert.equal(profile.id, "silicon");
  assert.equal(profile.defaultBaseURL, reference?.apiHost);
  assert.equal(profile.capabilities.chatCompletions, true);
  assert.equal(profile.capabilities.thinking, false);
  assert.equal(isKnownProviderId("dashscope"), true);
});
