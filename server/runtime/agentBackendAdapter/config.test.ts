import test from "node:test";
import assert from "node:assert/strict";
import { getAgentBackendRuntimeConfig } from "./config.js";

test("keeps direct server local fallback on port 8001 for low-level debugging", () => {
  const config = getAgentBackendRuntimeConfig({});

  assert.equal(config.deploymentMode, "local");
  assert.equal(config.baseUrl, "http://127.0.0.1:8001");
  assert.equal(config.sandboxProvider, "deerflow.sandbox.local:LocalSandboxProvider");
});

test("derives local Agent Runtime base URL from AGENT_RUNTIME_PORT", () => {
  const config = getAgentBackendRuntimeConfig({ AGENT_RUNTIME_PORT: "39123" });

  assert.equal(config.deploymentMode, "local");
  assert.equal(config.baseUrl, "http://127.0.0.1:39123");
});

test("accepts docker and external Agent Runtime deployment modes", () => {
  assert.equal(getAgentBackendRuntimeConfig({ AGENT_RUNTIME_MODE: "docker" }).deploymentMode, "docker");
  assert.equal(getAgentBackendRuntimeConfig({
    AGENT_RUNTIME_MODE: "external",
    AGENT_BACKEND_BASE_URL: "http://runtime.example:9000"
  }).deploymentMode, "external");
});

test("external Agent Runtime mode requires an explicit base URL", () => {
  assert.throws(
    () => getAgentBackendRuntimeConfig({ AGENT_RUNTIME_MODE: "external" }),
    /AGENT_BACKEND_BASE_URL/
  );
});

test("rejects unknown Agent Runtime deployment modes", () => {
  assert.throws(
    () => getAgentBackendRuntimeConfig({ AGENT_RUNTIME_MODE: "container-ish" }),
    /AGENT_RUNTIME_MODE/
  );
});
