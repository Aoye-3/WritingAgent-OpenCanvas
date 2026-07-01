import type { JsonValue } from "../../storageTypes.js";
import { containsInternalRuntimeProtocol } from "../../../shared/internalRuntimeProtocol.js";
import { createHash } from "node:crypto";

const blockedKey = /(?:prompt|reasoning|thinking|chain.?of.?thought|authorization|cookie|password|secret|api.?key|token|headers?|arguments?|contextValues|raw)/i;

export function sanitizeToolEventPayload(value: unknown, depth = 0): JsonValue {
  if (depth > 4) return "[truncated]";
  if (value === undefined) return null;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return containsInternalRuntimeProtocol(value) ? "[redacted internal runtime protocol]" : value.slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeToolEventPayload(item, depth + 1));
  if (!value || typeof value !== "object") return String(value).slice(0, 500);
  const record = value as Record<string, unknown>;
  if (record.eventType === "canvas_delivery_body_checkpoint_committed" && record.node && typeof record.node === "object" && !Array.isArray(record.node)) {
    return sanitizeCheckpointPayload(record, depth);
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key, item]) => item !== undefined && !blockedKey.test(key))
    .slice(0, 30)
    .map(([key, item]) => [key, sanitizeToolEventPayload(item, depth + 1)]));
}

function sanitizeCheckpointPayload(payload: Record<string, unknown>, depth: number): JsonValue {
  const node = payload.node as Record<string, unknown>;
  const content = typeof node.content === "string" ? node.content : "";
  return Object.fromEntries(Object.entries(payload)
    .filter(([key, item]) => item !== undefined && !blockedKey.test(key))
    .slice(0, 30)
    .map(([key, item]) => key === "node"
      ? [key, {
        id: sanitizeToolEventPayload(node.id, depth + 1),
        title: sanitizeToolEventPayload(node.title, depth + 1),
        displayTitle: sanitizeToolEventPayload(payload.displayTitle, depth + 1),
        contentPreview: sanitizeToolEventPayload(content.slice(0, 240), depth + 1),
        contentHash: createHash("sha256").update(content).digest("hex")
      }]
      : [key, sanitizeToolEventPayload(item, depth + 1)]));
}
