import type { ModelReference, ProviderReference } from "../../../../shared/modelReferences.js";
import type { FetchContext } from "./types.js";

export function defaultHeaders(context: FetchContext) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(context.apiKey ? { Authorization: `Bearer ${context.apiKey}`, "X-Api-Key": context.apiKey } : {})
  };
}

export function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function formatOpenAIBaseURL(value: string) {
  const clean = trimSlash(value);
  return /\/v\d+(beta)?$/i.test(clean) ? clean : `${clean}/v1`;
}

export async function getJson(url: string, context: FetchContext): Promise<unknown> {
  const response = await fetch(url, {
    headers: defaultHeaders(context),
    signal: context.signal
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<unknown>;
}

export function modelFromId(provider: ProviderReference, id: string, extra: Partial<ModelReference> = {}): ModelReference {
  const group = extra.group ?? (id.includes("/") ? id.split("/")[0] : provider.id);
  return {
    id,
    name: extra.name ?? id,
    provider: provider.id,
    group,
    modelType: extra.modelType ?? "chat",
    description: extra.description,
    ownedBy: extra.ownedBy,
    supportedEndpointTypes: extra.supportedEndpointTypes
  };
}

export function dedup(models: ModelReference[]) {
  const seen = new Set<string>();
  return models.filter((item) => {
    const id = item.id.trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function readArray(value: unknown, key: string): unknown[] {
  return value && typeof value === "object" && Array.isArray((value as Record<string, unknown>)[key])
    ? ((value as Record<string, unknown>)[key] as unknown[])
    : [];
}

export function readString(record: unknown, keys: string[]) {
  if (!record || typeof record !== "object") return undefined;
  for (const key of keys) {
    const value = (record as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function parseOpenAIModels(provider: ProviderReference, payload: unknown, modelType?: ModelReference["modelType"]) {
  return dedup(readArray(payload, "data").map((entry) => {
    const id = readString(entry, ["id", "model_id", "name"]);
    if (!id) return undefined;
    return modelFromId(provider, id, {
      name: readString(entry, ["model_name", "display_name"]) ?? id,
      description: readString(entry, ["description", "desc"]),
      ownedBy: readString(entry, ["owned_by", "organization"]),
      modelType
    });
  }).filter((entry): entry is ModelReference => Boolean(entry)));
}

export function safeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "Remote model list request timed out";
    return error.message
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
      .replace(/\bsk-[A-Za-z0-9._~+/=-]+/g, "sk-[redacted]");
  }
  return "Unable to fetch remote model list";
}
