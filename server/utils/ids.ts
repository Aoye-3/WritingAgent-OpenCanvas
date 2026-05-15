import { randomUUID } from "node:crypto";

export function safeId(value: unknown) {
  if (typeof value !== "string") return null;
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

export function randomThreadId() {
  return `thread_${randomUUID()}`;
}
