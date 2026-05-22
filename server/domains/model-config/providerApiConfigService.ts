import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getProviderReference, getStaticModels } from "../../../shared/modelReferences.js";
import type { ModelReference } from "../../../shared/modelReferences.js";
import { getProviderProfile } from "../../providerRuntime.js";
import { evaluateSettingsWritePolicy } from "../../security/policies/settingsWritePolicy.js";
import type { ProviderId } from "../../types.js";

export type ConfiguredModelApi = {
  id: string;
  providerId: ProviderId;
  modelId: string;
  modelName?: string;
  modelType?: string;
  apiKey?: string;
  baseURL: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ConfiguredModelApiSummary = {
  id: string;
  providerId: ProviderId;
  providerLabel: string;
  modelId: string;
  modelName: string;
  modelType?: string;
  keyConfigured: boolean;
  keyHint?: string;
  baseURL: string;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type ProviderApiConfig = {
  providerId: ProviderId;
  apiKey?: string;
  baseURL?: string;
  defaultModel?: string;
  enabled: boolean;
  updatedAt: string;
};

export type ProviderApiConfigSummary = {
  providerId: ProviderId;
  providerLabel: string;
  keyConfigured: boolean;
  keyHint?: string;
  baseURL: string;
  defaultModel: string;
  enabled: boolean;
  updatedAt?: string;
};

export type ProviderApiConfigStore = {
  version: 2;
  activeConfigId?: string;
  configs: Record<string, ConfiguredModelApi>;
};

type LegacyProviderApiConfigStore = {
  version?: number;
  activeProviderId?: ProviderId;
  providers?: Record<string, ProviderApiConfig>;
  configs?: Record<string, ConfiguredModelApi>;
  activeConfigId?: string;
};

export type SaveConfiguredModelApiPayload = {
  providerId?: string;
  modelId?: string;
  modelName?: string;
  modelType?: string;
  apiKey?: string;
  baseURL?: string;
  enabled?: boolean;
  confirmLocalKeyWrite?: boolean;
};

export type SaveProviderApiConfigPayload = {
  apiKey?: string;
  baseURL?: string;
  defaultModel?: string;
  enabled?: boolean;
  confirmLocalKeyWrite?: boolean;
};

const STORE_VERSION = 2;

export async function listConfiguredModelApiSummaries() {
  const store = await readProviderApiConfigStore();
  return {
    activeConfigId: store.activeConfigId,
    configs: Object.values(store.configs)
      .map(toConfiguredSummary)
      .sort((a, b) => `${a.providerLabel}:${a.modelName}`.localeCompare(`${b.providerLabel}:${b.modelName}`))
  };
}

export async function getConfiguredModelApiSummary(configId: string) {
  const store = await readProviderApiConfigStore();
  const config = store.configs[configId];
  if (!config) throw new Error(`Configured model API was not found: ${configId}`);
  return toConfiguredSummary(config);
}

export async function resolveConfiguredModelApi(configId: string): Promise<ConfiguredModelApi> {
  const store = await readProviderApiConfigStore();
  const config = store.configs[configId];
  if (!config) throw new Error(`Configured model API was not found: ${configId}`);
  return hydrateConfiguredModelApi(config);
}

export async function resolveConfiguredModelApiForProvider(providerId: ProviderId, modelId?: string): Promise<ConfiguredModelApi | undefined> {
  const store = await readProviderApiConfigStore();
  const configs = Object.values(store.configs).filter((config) => config.providerId === providerId && config.enabled !== false);
  const exact = modelId ? configs.find((config) => config.modelId === modelId) : undefined;
  return exact ? hydrateConfiguredModelApi(exact) : configs[0] ? hydrateConfiguredModelApi(configs[0]) : undefined;
}

export async function createConfiguredModelApi(payload: SaveConfiguredModelApiPayload) {
  assertCanWriteApiConfig(payload);
  const providerId = readCleanString(payload.providerId);
  const modelId = readCleanString(payload.modelId);
  if (!providerId) throw new Error("providerId is required");
  if (!modelId) throw new Error("modelId is required");

  const now = new Date().toISOString();
  const store = await readProviderApiConfigStore();
  const config = hydrateConfiguredModelApi({
    id: createConfigId(providerId, modelId, store.configs),
    providerId,
    modelId,
    modelName: readCleanString(payload.modelName) ?? findModel(providerId, modelId)?.name ?? modelId,
    modelType: readCleanString(payload.modelType) ?? inferModelType(providerId, modelId),
    apiKey: readCleanString(payload.apiKey) ?? findReusableProviderApiKey(store, providerId),
    baseURL: readCleanString(payload.baseURL) ?? getProviderProfile(providerId).defaultBaseURL,
    enabled: payload.enabled !== false,
    createdAt: now,
    updatedAt: now
  });
  store.configs[config.id] = config;
  store.activeConfigId = config.id;
  await writeProviderApiConfigStore(store);
  applyActiveProviderEnv(config);
  return toConfiguredSummary(config);
}

export async function saveConfiguredModelApi(configId: string, payload: SaveConfiguredModelApiPayload) {
  assertCanWriteApiConfig(payload);
  const store = await readProviderApiConfigStore();
  const current = store.configs[configId];
  if (!current) throw new Error(`Configured model API was not found: ${configId}`);

  const providerId = readCleanString(payload.providerId) ?? current.providerId;
  const modelId = readCleanString(payload.modelId) ?? current.modelId;
  const next = hydrateConfiguredModelApi({
    ...current,
    providerId,
    modelId,
    modelName: readCleanString(payload.modelName) ?? findModel(providerId, modelId)?.name ?? current.modelName ?? modelId,
    modelType: readCleanString(payload.modelType) ?? current.modelType ?? inferModelType(providerId, modelId),
    baseURL: payload.baseURL === undefined ? current.baseURL : readCleanString(payload.baseURL) ?? getProviderProfile(providerId).defaultBaseURL,
    enabled: payload.enabled ?? current.enabled,
    updatedAt: new Date().toISOString()
  });
  const nextApiKey = readCleanString(payload.apiKey);
  if (nextApiKey) next.apiKey = nextApiKey;
  if (!next.apiKey) next.apiKey = findReusableProviderApiKey(store, providerId);
  store.configs[configId] = next;
  store.activeConfigId = configId;
  await writeProviderApiConfigStore(store);
  applyActiveProviderEnv(next);
  return toConfiguredSummary(next);
}

export async function deleteConfiguredModelApi(configId: string) {
  const policy = evaluateSettingsWritePolicy();
  if (!policy.allowed) throw new Error(policy.reason ?? "Local settings writes are disabled");

  const store = await readProviderApiConfigStore();
  delete store.configs[configId];
  if (store.activeConfigId === configId) store.activeConfigId = Object.keys(store.configs)[0];
  await writeProviderApiConfigStore(store);
  return { ok: true, activeConfigId: store.activeConfigId };
}

export async function listProviderApiConfigSummaries() {
  const store = await readProviderApiConfigStore();
  const configs = Object.values(store.configs);
  const active = store.activeConfigId ? store.configs[store.activeConfigId] : undefined;
  const byProvider = new Map<string, ProviderApiConfigSummary>();
  for (const config of configs) {
    if (byProvider.has(config.providerId)) continue;
    byProvider.set(config.providerId, toProviderSummary(config));
  }
  return {
    activeProviderId: active?.providerId,
    configs: [...byProvider.values()].sort((a, b) => a.providerLabel.localeCompare(b.providerLabel))
  };
}

export async function getProviderApiConfigSummary(providerId: ProviderId) {
  const config = await resolveConfiguredModelApiForProvider(providerId);
  return config ? toProviderSummary(config) : toProviderSummary(createDefaultBinding(providerId));
}

export async function resolveProviderApiConfig(providerId: ProviderId): Promise<ProviderApiConfig & { baseURL: string; defaultModel: string }> {
  const config = await resolveConfiguredModelApiForProvider(providerId);
  const binding = config ?? createDefaultBinding(providerId);
  return {
    providerId,
    apiKey: binding.apiKey,
    baseURL: binding.baseURL,
    defaultModel: binding.modelId,
    enabled: binding.enabled,
    updatedAt: binding.updatedAt
  };
}

export async function saveProviderApiConfig(providerId: ProviderId, payload: SaveProviderApiConfigPayload) {
  const store = await readProviderApiConfigStore();
  const modelId = readCleanString(payload.defaultModel) ?? getProviderProfile(providerId).defaultModel;
  const existing = Object.values(store.configs).find((config) => config.providerId === providerId && config.modelId === modelId)
    ?? Object.values(store.configs).find((config) => config.providerId === providerId);
  if (existing) {
    return saveConfiguredModelApi(existing.id, {
      providerId,
      modelId,
      modelName: findModel(providerId, modelId)?.name ?? modelId,
      modelType: inferModelType(providerId, modelId),
      apiKey: payload.apiKey,
      baseURL: payload.baseURL,
      enabled: payload.enabled,
      confirmLocalKeyWrite: payload.confirmLocalKeyWrite
    }).then((summary) => toProviderSummaryFromConfiguredSummary(summary));
  }
  return createConfiguredModelApi({
    providerId,
    modelId,
    modelName: findModel(providerId, modelId)?.name ?? modelId,
    modelType: inferModelType(providerId, modelId),
    apiKey: payload.apiKey,
    baseURL: payload.baseURL,
    enabled: payload.enabled,
    confirmLocalKeyWrite: payload.confirmLocalKeyWrite
  }).then((summary) => toProviderSummaryFromConfiguredSummary(summary));
}

export async function deleteProviderApiConfig(providerId: ProviderId) {
  const policy = evaluateSettingsWritePolicy();
  if (!policy.allowed) throw new Error(policy.reason ?? "Local settings writes are disabled");

  const store = await readProviderApiConfigStore();
  for (const config of Object.values(store.configs)) {
    if (config.providerId === providerId) delete store.configs[config.id];
  }
  if (store.activeConfigId && !store.configs[store.activeConfigId]) store.activeConfigId = Object.keys(store.configs)[0];
  await writeProviderApiConfigStore(store);
  return { ok: true, activeProviderId: store.activeConfigId ? store.configs[store.activeConfigId]?.providerId : undefined };
}

export async function readProviderApiConfigStore(): Promise<ProviderApiConfigStore> {
  const storePath = providerApiConfigPath();
  let store: ProviderApiConfigStore = { version: STORE_VERSION, configs: {} };

  try {
    const raw = await readFile(storePath, "utf8");
    store = normalizeStore(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const migrated = migrateEnvConfig(store);
  if (migrated.changed) await writeProviderApiConfigStore(migrated.store);
  return migrated.store;
}

export async function writeProviderApiConfigStore(store: ProviderApiConfigStore) {
  const storePath = providerApiConfigPath();
  const workspaceRoot = path.resolve(process.cwd());
  const storeDir = path.dirname(storePath);

  if (!storePath.startsWith(workspaceRoot)) throw new Error("Provider API config must stay inside the project workspace");

  try {
    const stat = await lstat(storePath);
    if (stat.isSymbolicLink()) throw new Error("Refusing to write provider API config through a symlink");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  await mkdir(storeDir, { recursive: true });
  await writeFile(storePath, `${JSON.stringify(normalizeStore(store), null, 2)}\n`, "utf8");
}

function providerApiConfigPath() {
  return path.resolve(process.cwd(), ".facetwrite", "provider-apis.json");
}

function migrateEnvConfig(store: ProviderApiConfigStore) {
  const envApiKey = process.env.OPENAI_API_KEY?.trim();
  const providerId = getProviderProfile(process.env.OPENAI_PROVIDER_ID?.trim()).id;
  if (!envApiKey || Object.values(store.configs).some((config) => config.providerId === providerId && config.apiKey)) {
    return { store, changed: false };
  }

  const profile = getProviderProfile(providerId);
  const modelId = process.env.OPENAI_MODEL?.trim() || profile.defaultModel;
  const now = new Date().toISOString();
  const config = hydrateConfiguredModelApi({
    id: createConfigId(providerId, modelId, store.configs),
    providerId,
    modelId,
    modelName: findModel(providerId, modelId)?.name ?? modelId,
    modelType: inferModelType(providerId, modelId),
    apiKey: envApiKey,
    baseURL: process.env.OPENAI_BASE_URL?.trim() || profile.defaultBaseURL,
    enabled: true,
    createdAt: now,
    updatedAt: now
  });
  return {
    store: normalizeStore({
      ...store,
      activeConfigId: store.activeConfigId ?? config.id,
      configs: { ...store.configs, [config.id]: config }
    }),
    changed: true
  };
}

function normalizeStore(value: unknown): ProviderApiConfigStore {
  if (!value || typeof value !== "object") return { version: STORE_VERSION, configs: {} };

  const input = value as LegacyProviderApiConfigStore;
  if (input.providers && typeof input.providers === "object") {
    return migrateLegacyProviderStore(input);
  }

  const configs: Record<string, ConfiguredModelApi> = {};
  const rawConfigs = input.configs && typeof input.configs === "object" ? input.configs : {};
  for (const [id, config] of Object.entries(rawConfigs)) {
    if (!config || typeof config !== "object") continue;
    const raw = config as Partial<ConfiguredModelApi>;
    const providerId = readCleanString(raw.providerId);
    const modelId = readCleanString(raw.modelId);
    if (!providerId || !modelId) continue;
    const cleanId = readCleanString(raw.id) ?? id;
    configs[cleanId] = hydrateConfiguredModelApi({
      id: cleanId,
      providerId,
      modelId,
      modelName: readCleanString(raw.modelName) ?? findModel(providerId, modelId)?.name ?? modelId,
      modelType: readCleanString(raw.modelType) ?? inferModelType(providerId, modelId),
      apiKey: readCleanString(raw.apiKey),
      baseURL: readCleanString(raw.baseURL) ?? getProviderProfile(providerId).defaultBaseURL,
      enabled: raw.enabled !== false,
      createdAt: readCleanString(raw.createdAt) ?? readCleanString(raw.updatedAt) ?? new Date(0).toISOString(),
      updatedAt: readCleanString(raw.updatedAt) ?? new Date(0).toISOString()
    });
  }

  const activeConfigId = readCleanString(input.activeConfigId);
  return {
    version: STORE_VERSION,
    activeConfigId: activeConfigId && configs[activeConfigId] ? activeConfigId : Object.keys(configs)[0],
    configs
  };
}

function migrateLegacyProviderStore(input: LegacyProviderApiConfigStore): ProviderApiConfigStore {
  const configs: Record<string, ConfiguredModelApi> = {};
  const now = new Date().toISOString();
  for (const [providerId, config] of Object.entries(input.providers ?? {})) {
    if (!config || typeof config !== "object") continue;
    const profile = getProviderProfile(providerId);
    const modelId = readCleanString(config.defaultModel) ?? profile.defaultModel;
    const id = createConfigId(providerId, modelId, configs);
    configs[id] = hydrateConfiguredModelApi({
      id,
      providerId,
      modelId,
      modelName: findModel(providerId, modelId)?.name ?? modelId,
      modelType: inferModelType(providerId, modelId),
      apiKey: readCleanString(config.apiKey),
      baseURL: readCleanString(config.baseURL) ?? profile.defaultBaseURL,
      enabled: config.enabled !== false,
      createdAt: readCleanString(config.updatedAt) ?? now,
      updatedAt: readCleanString(config.updatedAt) ?? now
    });
  }
  const active = input.activeProviderId
    ? Object.values(configs).find((config) => config.providerId === input.activeProviderId)
    : undefined;
  return { version: STORE_VERSION, activeConfigId: active?.id ?? Object.keys(configs)[0], configs };
}

function createDefaultBinding(providerId: ProviderId): ConfiguredModelApi {
  const profile = getProviderProfile(providerId);
  const modelId = profile.defaultModel;
  return hydrateConfiguredModelApi({
    id: createConfigId(providerId, modelId, {}),
    providerId,
    modelId,
    modelName: findModel(providerId, modelId)?.name ?? modelId,
    modelType: inferModelType(providerId, modelId),
    baseURL: profile.defaultBaseURL,
    enabled: true,
    createdAt: "",
    updatedAt: ""
  });
}

function findReusableProviderApiKey(store: ProviderApiConfigStore, providerId: ProviderId) {
  return Object.values(store.configs).find((config) => config.providerId === providerId && readCleanString(config.apiKey))?.apiKey;
}

function hydrateConfiguredModelApi(config: ConfiguredModelApi): ConfiguredModelApi {
  const profile = getProviderProfile(config.providerId);
  return {
    ...config,
    baseURL: config.baseURL?.trim() || profile.defaultBaseURL,
    modelName: config.modelName?.trim() || findModel(config.providerId, config.modelId)?.name || config.modelId,
    modelType: config.modelType?.trim() || inferModelType(config.providerId, config.modelId),
    enabled: config.enabled !== false
  };
}

function toConfiguredSummary(config: ConfiguredModelApi): ConfiguredModelApiSummary {
  const hydrated = hydrateConfiguredModelApi(config);
  return {
    id: hydrated.id,
    providerId: hydrated.providerId,
    providerLabel: getProviderProfile(hydrated.providerId).label,
    modelId: hydrated.modelId,
    modelName: hydrated.modelName ?? hydrated.modelId,
    modelType: hydrated.modelType,
    keyConfigured: Boolean(hydrated.apiKey?.trim()),
    keyHint: hydrated.apiKey ? maskApiKey(hydrated.apiKey) : undefined,
    baseURL: hydrated.baseURL,
    enabled: hydrated.enabled,
    createdAt: hydrated.createdAt || undefined,
    updatedAt: hydrated.updatedAt || undefined
  };
}

function toProviderSummary(config: ConfiguredModelApi): ProviderApiConfigSummary {
  const summary = toConfiguredSummary(config);
  return toProviderSummaryFromConfiguredSummary(summary);
}

function toProviderSummaryFromConfiguredSummary(summary: ConfiguredModelApiSummary): ProviderApiConfigSummary {
  return {
    providerId: summary.providerId,
    providerLabel: summary.providerLabel,
    keyConfigured: summary.keyConfigured,
    keyHint: summary.keyHint,
    baseURL: summary.baseURL,
    defaultModel: summary.modelId,
    enabled: summary.enabled,
    updatedAt: summary.updatedAt
  };
}

function assertCanWriteApiConfig(payload: SaveConfiguredModelApiPayload | SaveProviderApiConfigPayload) {
  const policy = evaluateSettingsWritePolicy();
  if (!policy.allowed) throw new Error(policy.reason ?? "Local settings writes are disabled");
  if (readCleanString(payload.apiKey) && !payload.confirmLocalKeyWrite) {
    throw new Error("Saving a new API key requires confirmLocalKeyWrite=true");
  }
}

function createConfigId(providerId: string, modelId: string, existing: Record<string, unknown>) {
  const base = `${slug(providerId)}--${slug(modelId)}`.slice(0, 80) || `model-api-${randomUUID().slice(0, 8)}`;
  if (!existing[base]) return base;
  return `${base}-${randomUUID().slice(0, 8)}`;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function findModel(providerId: string, modelId: string): ModelReference | undefined {
  return getProviderReference(providerId)?.models.find((model) => model.id === modelId) ?? getStaticModels(providerId).find((model) => model.id === modelId);
}

function inferModelType(providerId: string, modelId: string) {
  const model = findModel(providerId, modelId);
  if (model?.modelType) return model.modelType;
  const lower = modelId.toLowerCase();
  if (lower.includes("embed")) return "embedding";
  if (lower.includes("rerank")) return "rerank";
  if (lower.includes("vision") || lower.includes("vl")) return "vision";
  return "chat";
}

function maskApiKey(apiKey: string) {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) return "configured";
  return `...${trimmed.slice(-4)}`;
}

function applyActiveProviderEnv(config: ConfiguredModelApi) {
  if (config.apiKey) process.env.OPENAI_API_KEY = config.apiKey;
  process.env.OPENAI_PROVIDER_ID = config.providerId;
  process.env.OPENAI_BASE_URL = config.baseURL;
  process.env.OPENAI_MODEL = config.modelId;
}

function readCleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
