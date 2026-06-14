import assert from "node:assert/strict";
import test from "node:test";
import { resolveRuntimeMode } from "./runtime-config.mjs";

test("defaults the app shell to local Agent Runtime", () => {
  assert.deepEqual(resolveRuntimeMode({}), {
    mode: "local",
    baseUrl: undefined,
    managed: true,
  });
});

test("lets the app shell derive a fixed local runtime URL from AGENT_RUNTIME_PORT", () => {
  assert.deepEqual(resolveRuntimeMode({ AGENT_RUNTIME_PORT: "39123" }), {
    mode: "local",
    baseUrl: "http://127.0.0.1:39123",
    managed: true,
  });
});

test("treats AGENT_RUNTIME_PORT=0 as automatic local port selection", () => {
  assert.deepEqual(resolveRuntimeMode({ AGENT_RUNTIME_PORT: "0" }), {
    mode: "local",
    baseUrl: undefined,
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

test("external mode requires an explicit runtime URL", () => {
  assert.throws(() => resolveRuntimeMode({ AGENT_RUNTIME_MODE: "external" }), /AGENT_BACKEND_BASE_URL/);
});

test("rejects an unsupported app shell runtime mode", () => {
  assert.throws(() => resolveRuntimeMode({ AGENT_RUNTIME_MODE: "unknown" }), /AGENT_RUNTIME_MODE/);
});
