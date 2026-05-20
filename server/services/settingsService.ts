import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SettingsPayload, SettingsStatus } from "../contracts/settings.js";
import { getProviderId, getSystemPrompt } from "../config/providerConfig.js";
import { createOpenAIChatClient, getProviderProfile } from "../providerRuntime.js";
import { evaluateSettingsWritePolicy } from "../security/policies/settingsWritePolicy.js";
import type { ProviderId } from "../types.js";
import { listProviderApiConfigSummaries, resolveProviderApiConfig, saveProviderApiConfig } from "../domains/model-config/index.js";

type ValidationState = {
  at?: string;
  ok: boolean;
  error?: string;
};

let lastValidation: ValidationState = { ok: false };

export async function getSettingsStatus(override?: { apiKey?: string; providerId?: ProviderId; baseURL?: string; model?: string; systemPrompt?: string; error?: string }): Promise<SettingsStatus> {
  const summaries = await listProviderApiConfigSummaries();
  const providerId = override?.providerId ?? summaries.activeProviderId ?? getProviderId();
  const config = await resolveProviderApiConfig(providerId);
  const profile = getProviderProfile(providerId);
  const keyConfigured = Boolean(override?.apiKey || config.apiKey);
  const baseURL = override?.baseURL || config.baseURL;
  const model = override?.model || config.defaultModel;
  const systemPrompt = override?.systemPrompt || getSystemPrompt();
  const online = keyConfigured && lastValidation.ok && !override?.error;

  return {
    keyConfigured,
    providerId,
    providerLabel: profile.label,
    baseURL,
    model,
    systemPrompt,
    apiHealth: online ? "online" : "offline",
    provider: online ? providerId : "mock",
    capabilities: profile.capabilities,
    modelAliases: profile.modelAliases,
    lastValidated: lastValidation.at,
    lastError: override?.error || lastValidation.error
  };
}

export async function validateSettings(payload: SettingsPayload) {
  const summaries = await listProviderApiConfigSummaries();
  const providerId = payload.providerId ?? summaries.activeProviderId ?? getProviderId();
  const config = await resolveProviderApiConfig(providerId);
  const apiKey = payload.apiKey?.trim() || config.apiKey;
  const baseURL = payload.baseURL?.trim() || config.baseURL;
  const model = payload.model?.trim() || config.defaultModel;
  const systemPrompt = payload.systemPrompt?.trim() || getSystemPrompt();

  try {
    if (!apiKey) {
      throw new Error(`${getProviderProfile(providerId).label} API key is not configured`);
    }

    await validateProvider({ apiKey, baseURL, model, providerId });
    lastValidation = { at: new Date().toISOString(), ok: true };
    return {
      ...(await getSettingsStatus({ apiKey, providerId, baseURL, model, systemPrompt })),
      ok: true,
      message: `${getProviderProfile(providerId).label} validation succeeded`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown validation error";
    lastValidation = { at: new Date().toISOString(), ok: false, error: message };
    return {
      ...(await getSettingsStatus({ apiKey, providerId, baseURL, model, error: message })),
      ok: false,
      message
    };
  }
}

export async function saveSettings(payload: SettingsPayload) {
  const policy = evaluateSettingsWritePolicy();
  if (!policy.allowed) {
    throw new Error(policy.reason ?? "Local settings writes are disabled");
  }

  const summaries = await listProviderApiConfigSummaries();
  const providerId = payload.providerId ?? summaries.activeProviderId ?? getProviderId();
  const apiKey = payload.apiKey?.trim();
  const baseURL = payload.baseURL?.trim();
  const model = payload.model?.trim();
  const systemPrompt = payload.systemPrompt?.trim();

  if (apiKey && !payload.confirmLocalKeyWrite) {
    throw new Error("Saving a new API key requires confirmLocalKeyWrite=true");
  }

  await saveProviderApiConfig(providerId, {
    apiKey,
    baseURL,
    defaultModel: model,
    enabled: true,
    confirmLocalKeyWrite: payload.confirmLocalKeyWrite
  });
  if (systemPrompt) {
    await writeEnvSettings({ systemPrompt });
    process.env.AGENT_SYSTEM_PROMPT = systemPrompt;
  }
  return getSettingsStatus({ providerId });
}

async function validateProvider(settings: { apiKey: string; providerId: ProviderId; baseURL: string; model: string }) {
  const profile = getProviderProfile(settings.providerId);
  await createOpenAIChatClient({ apiKey: settings.apiKey, baseURL: settings.baseURL }).createChatCompletion({
    model: settings.model || profile.defaultModel,
    messages: [
      { role: "system", content: "Reply with ok." },
      { role: "user", content: "ping" }
    ],
    max_tokens: 5,
    temperature: 0
  });
}

async function writeEnvSettings(payload: SettingsPayload) {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const workspaceRoot = path.resolve(process.cwd());

  if (!envPath.startsWith(workspaceRoot)) {
    throw new Error(".env.local must stay inside the project workspace");
  }

  try {
    const stat = await lstat(envPath);
    if (stat.isSymbolicLink()) {
      throw new Error("Refusing to write settings through a symlink");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  let contents = "";
  try {
    contents = await readFile(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const lines = contents.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const keyLines = upsertEnvLine(lines, "OPENAI_API_KEY", payload.apiKey);
  const providerLines = upsertEnvLine(keyLines, "OPENAI_PROVIDER_ID", payload.providerId);
  const baseLines = upsertEnvLine(providerLines, "OPENAI_BASE_URL", payload.baseURL);
  const modelLines = upsertEnvLine(baseLines, "OPENAI_MODEL", payload.model);
  const promptLines = upsertEnvLine(modelLines, "AGENT_SYSTEM_PROMPT", payload.systemPrompt);
  await writeFile(envPath, `${promptLines.join("\n")}\n`, "utf8");
}

function upsertEnvLine(lines: string[], key: string, value?: string) {
  if (!value) return lines;
  const nextLine = `${key}=${formatEnvValue(value)}`;
  const index = lines.findIndex((line) => line.trim().startsWith(`${key}=`));
  if (index === -1) {
    return [...lines, nextLine];
  }

  return lines.map((line, lineIndex) => (lineIndex === index ? nextLine : line));
}

function formatEnvValue(value: string) {
  if (/[\s#"'\\]/.test(value)) {
    return JSON.stringify(value);
  }

  return value;
}
