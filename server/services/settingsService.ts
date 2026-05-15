import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SettingsPayload, SettingsStatus } from "../contracts/settings.js";
import { getBaseURL, getModel, getProviderId, getSystemPrompt } from "../config/providerConfig.js";
import { createOpenAIChatClient, getProviderProfile } from "../providerRuntime.js";
import type { ProviderId } from "../types.js";

type ValidationState = {
  at?: string;
  ok: boolean;
  error?: string;
};

let lastValidation: ValidationState = { ok: false };

export function getSettingsStatus(override?: { apiKey?: string; providerId?: ProviderId; baseURL?: string; model?: string; systemPrompt?: string; error?: string }): SettingsStatus {
  const providerId = override?.providerId ?? getProviderId();
  const profile = getProviderProfile(providerId);
  const keyConfigured = Boolean(override?.apiKey || process.env.OPENAI_API_KEY);
  const baseURL = override?.baseURL || getBaseURL(providerId);
  const model = override?.model || getModel(providerId);
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
  const providerId = payload.providerId ?? getProviderId();
  const apiKey = payload.apiKey?.trim() || process.env.OPENAI_API_KEY;
  const baseURL = payload.baseURL?.trim() || getBaseURL(providerId);
  const model = payload.model?.trim() || getModel(providerId);
  const systemPrompt = payload.systemPrompt?.trim() || getSystemPrompt();

  try {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    await validateProvider({ apiKey, baseURL, model, providerId });
    lastValidation = { at: new Date().toISOString(), ok: true };
    return {
      ...getSettingsStatus({ apiKey, providerId, baseURL, model, systemPrompt }),
      ok: true,
      message: `${getProviderProfile(providerId).label} validation succeeded`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown validation error";
    lastValidation = { at: new Date().toISOString(), ok: false, error: message };
    return {
      ...getSettingsStatus({ apiKey, providerId, baseURL, model, error: message }),
      ok: false,
      message
    };
  }
}

export async function saveSettings(payload: SettingsPayload) {
  const providerId = payload.providerId;
  const apiKey = payload.apiKey?.trim();
  const baseURL = payload.baseURL?.trim();
  const model = payload.model?.trim();
  const systemPrompt = payload.systemPrompt?.trim();

  if (apiKey && !payload.confirmLocalKeyWrite) {
    throw new Error("Saving a new API key requires confirmLocalKeyWrite=true");
  }

  await writeEnvSettings({ apiKey, providerId, baseURL, model, systemPrompt });
  if (apiKey) process.env.OPENAI_API_KEY = apiKey;
  if (providerId) process.env.OPENAI_PROVIDER_ID = providerId;
  if (baseURL) process.env.OPENAI_BASE_URL = baseURL;
  if (model) process.env.OPENAI_MODEL = model;
  if (systemPrompt) process.env.AGENT_SYSTEM_PROMPT = systemPrompt;
  return getSettingsStatus();
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
