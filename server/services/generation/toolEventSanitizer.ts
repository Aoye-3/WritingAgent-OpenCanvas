import type { JsonValue } from "../../storageTypes.js";

const blockedKey = /(?:prompt|reasoning|thinking|chain.?of.?thought|authorization|cookie|password|secret|api.?key|token|headers?|arguments?|contextValues|raw)/i;

export function sanitizeToolEventPayload(value: unknown, depth = 0): JsonValue {
  if (depth > 4) return "[truncated]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeToolEventPayload(item, depth + 1));
  if (!value || typeof value !== "object") return String(value).slice(0, 500);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !blockedKey.test(key))
    .slice(0, 30)
    .map(([key, item]) => [key, sanitizeToolEventPayload(item, depth + 1)]));
}
