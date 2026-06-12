import type { StoredThread } from "../features/agents/types";

export const PROJECT_FIRST_API_CONTRACT = "facetwrite-project-first-v1";
export const PROJECT_FIRST_SCHEMA_VERSION = 3;

export type ProjectFirstHealth = {
  ok: boolean;
  schemaVersion: number;
  apiContract: string;
};

export function assertProjectFirstContract(value: unknown): asserts value is ProjectFirstHealth {
  const health = value as Partial<ProjectFirstHealth> | null;
  if (!health || health.ok !== true || health.schemaVersion !== PROJECT_FIRST_SCHEMA_VERSION || health.apiContract !== PROJECT_FIRST_API_CONTRACT) {
    throw new Error("Backend version is incompatible with the Project-first workspace. Restart FacetWrite from this project directory.");
  }
}

export function selectProjectThread(threads: StoredThread[]) {
  return [...threads].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}
