import { randomUUID } from "node:crypto";
import type { CanvasNodeKind, CanvasWriteOperation, JsonValue } from "../storageTypes.js";

export function randomId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

export function validateId(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

export function validateNodeKind(value: string): CanvasNodeKind {
  if (value === "document" || value === "note" || value === "reference" || value === "role" || value === "plan") return value;
  throw new Error("Invalid canvas node kind");
}

export function validateWriteOperation(value: string): CanvasWriteOperation {
  if (value === "create" || value === "replace" || value === "append" || value === "replace_range" || value === "delete") return value;
  throw new Error("Invalid canvas write operation");
}

export function readFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function defaultCanvasTitle(kind: CanvasNodeKind) {
  if (kind === "note") return "Untitled note";
  if (kind === "reference") return "Untitled reference";
  if (kind === "role") return "Role";
  if (kind === "plan") return "Plan";
  return "Untitled document";
}

export function nowIso() {
  return new Date().toISOString();
}

export function parseJson(value: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return { raw: value };
  }
}
