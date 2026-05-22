import type { ModelReference, ProviderReference } from "../../../../shared/modelReferences.js";

export type ProviderModelsPayload = {
  providerId?: string;
  apiKey?: string;
  baseURL?: string;
};

export type ProviderModelsResult = {
  providerId: string;
  models: ModelReference[];
  source: "remote" | "static";
  error?: string;
};

export type FetchContext = {
  apiKey: string;
  baseURL: string;
  provider: ProviderReference;
  signal?: AbortSignal;
};

export type ModelFetcher = {
  match: (provider: ProviderReference) => boolean;
  fetch: (context: FetchContext) => Promise<ModelReference[]>;
};
