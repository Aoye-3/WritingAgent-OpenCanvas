import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, apiGet } from "../../src/shared/apiClient.js";

test("api client wraps network failures in ApiError", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };

  try {
    await assert.rejects(
      () => apiGet("/api/unreachable"),
      (error) => error instanceof ApiError
        && error.status === 0
        && error.code === "network_error"
        && /Network request failed/.test(error.message)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("api client reports invalid JSON responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("not-json", { status: 200 });

  try {
    await assert.rejects(
      () => apiGet("/api/bad-json"),
      (error) => error instanceof ApiError
        && error.status === 200
        && /not valid JSON/.test(error.message)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
