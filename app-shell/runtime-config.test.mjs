import assert from "node:assert/strict";
import test from "node:test";
import { resolveRuntimeMode } from "./runtime-config.mjs";

test("defaults the app shell to local Agent Runtime", () => {
  assert.deepEqual(resolveRuntimeMode({}), {
    mode: "local",
    baseUrl: "http://127.0.0.1:8001",
    managed: true,
  });
});

test("uses Docker and external runtime URLs without changing their contracts", () => {
  assert.deepEqual(resolveRuntimeMode({ AGENT_RUNTIME_MODE: "docker" }), {
    mode: "docker",
    baseUrl: "http://127.0.0.1:2026",
    managed: true,
  });
  assert.deepEqual(resolveRuntimeMode({
    AGENT_RUNTIME_MODE: "external",
    AGENT_BACKEND_BASE_URL: "http://runtime.example:9000/",
  }), {
    mode: "external",
    baseUrl: "http://runtime.example:9000",
    managed: false,
  });
});

test("rejects an unsupported app shell runtime mode", () => {
  assert.throws(() => resolveRuntimeMode({ AGENT_RUNTIME_MODE: "unknown" }), /AGENT_RUNTIME_MODE/);
});
