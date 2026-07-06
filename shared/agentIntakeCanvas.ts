const TEXT_HEAVY_KEYS = new Set([
  "body",
  "content",
  "excerpt",
  "fileContent",
  "html",
  "markdown",
  "preview",
  "raw",
  "sourceText",
  "text"
]);

export function sanitizeCanvasForAgentIntake(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeValue(value, 0);
  return isRecord(sanitized) ? sanitized : {};
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 5) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!isRecord(value)) return value;

  const entries = Object.entries(value).flatMap(([key, entry]) => {
    if (TEXT_HEAVY_KEYS.has(key)) return [];
    const sanitized = sanitizeValue(entry, depth + 1);
    return sanitized === undefined ? [] : [[key, sanitized] as const];
  });
  return Object.fromEntries(entries);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
