import test from "node:test";
import assert from "node:assert/strict";
import { getAgentBackendRuntimeConfig } from "./config.js";

test("defaults Agent Runtime deployment to local Gateway mode", () => {
  const config = getAgentBackendRuntimeConfig({});

  assert.equal(config.deploymentMode, "local");
  assert.equal(config.baseUrl, "http://127.0.0.1:8001");
  assert.equal(config.sandboxProvider, "deerflow.sandbox.local:LocalSandboxProvider");
});

test("accepts docker and external Agent Runtime deployment modes", () => {
  assert.equal(getAgentBackendRuntimeConfig({ AGENT_RUNTIME_MODE: "docker" }).deploymentMode, "docker");
  assert.equal(getAgentBackendRuntimeConfig({ AGENT_RUNTIME_MODE: "external" }).deploymentMode, "external");
});

test("rejects unknown Agent Runtime deployment modes", () => {
  assert.throws(
    () => getAgentBackendRuntimeConfig({ AGENT_RUNTIME_MODE: "container-ish" }),
    /AGENT_RUNTIME_MODE/
  );
});
