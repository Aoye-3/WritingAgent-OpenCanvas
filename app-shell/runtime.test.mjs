import assert from "node:assert/strict";
import test from "node:test";
import { classifyRuntimeState, createLifecycle } from "./runtime.mjs";

test("classifies a stopped runtime as shell owned", () => {
  assert.deepEqual(classifyRuntimeState([]), { action: "start", owned: true });
});

test("classifies a complete runtime as reusable", () => {
  assert.deepEqual(
    classifyRuntimeState(["facetwrite-agent-runtime-nginx", "facetwrite-agent-runtime-frontend", "facetwrite-agent-runtime-gateway"]),
    { action: "reuse", owned: false },
  );
});

test("rejects a partially running runtime", () => {
  assert.throws(
    () => classifyRuntimeState(["facetwrite-agent-runtime-nginx"]),
    /partially running/,
  );
});

test("starts services in order and stops only owned runtime", async () => {
  const events = [];
  const lifecycle = createLifecycle({
    inspectRuntime: async () => [],
    startRuntime: async () => events.push("runtime:start"),
    stopRuntime: async () => events.push("runtime:stop"),
    startApi: async () => ({ stop: async () => events.push("api:stop") }),
    startFrontend: async () => ({ stop: async () => events.push("frontend:stop") }),
    waitForRuntime: async () => events.push("runtime:ready"),
    waitForApi: async () => events.push("api:ready"),
    waitForFrontend: async () => events.push("frontend:ready"),
    onStage: (stage) => events.push(`stage:${stage}`),
  });

  await lifecycle.start();
  await lifecycle.stop();
  await lifecycle.stop();

  assert.deepEqual(events, [
    "stage:docker",
    "stage:runtime",
    "runtime:start",
    "runtime:ready",
    "stage:api",
    "api:ready",
    "stage:frontend",
    "frontend:ready",
    "stage:ready",
    "frontend:stop",
    "api:stop",
    "runtime:stop",
  ]);
});

test("rolls back started services when startup fails", async () => {
  const events = [];
  const lifecycle = createLifecycle({
    inspectRuntime: async () => [],
    startRuntime: async () => events.push("runtime:start"),
    stopRuntime: async () => events.push("runtime:stop"),
    startApi: async () => ({ stop: async () => events.push("api:stop") }),
    startFrontend: async () => {
      throw new Error("frontend failed");
    },
    waitForRuntime: async () => events.push("runtime:ready"),
    waitForApi: async () => events.push("api:ready"),
    waitForFrontend: async () => undefined,
    onStage: () => undefined,
  });

  await assert.rejects(lifecycle.start(), /frontend failed/);
  assert.deepEqual(events, ["runtime:start", "runtime:ready", "api:ready", "api:stop", "runtime:stop"]);
});

test("preserves a reused runtime during shutdown", async () => {
  const events = [];
  const lifecycle = createLifecycle({
    inspectRuntime: async () => ["facetwrite-agent-runtime-nginx", "facetwrite-agent-runtime-frontend", "facetwrite-agent-runtime-gateway"],
    startRuntime: async () => events.push("runtime:start"),
    stopRuntime: async () => events.push("runtime:stop"),
    startApi: async () => ({ stop: async () => events.push("api:stop") }),
    startFrontend: async () => ({ stop: async () => events.push("frontend:stop") }),
    waitForRuntime: async () => events.push("runtime:ready"),
    waitForApi: async () => events.push("api:ready"),
    waitForFrontend: async () => events.push("frontend:ready"),
    onStage: () => undefined,
  });

  await lifecycle.start();
  await lifecycle.stop();

  assert.deepEqual(events, ["runtime:ready", "api:ready", "frontend:ready", "frontend:stop", "api:stop"]);
});

test("attempts every owned cleanup step when one stop fails", async () => {
  const events = [];
  const lifecycle = createLifecycle({
    inspectRuntime: async () => [],
    startRuntime: async () => events.push("runtime:start"),
    stopRuntime: async () => events.push("runtime:stop"),
    startApi: async () => ({ stop: async () => events.push("api:stop") }),
    startFrontend: async () => ({
      stop: async () => {
        events.push("frontend:stop");
        throw new Error("frontend stop failed");
      },
    }),
    waitForRuntime: async () => undefined,
    waitForApi: async () => undefined,
    waitForFrontend: async () => undefined,
    onStage: () => undefined,
  });

  await lifecycle.start();
  await assert.rejects(lifecycle.stop(), /frontend stop failed/);

  assert.deepEqual(events, ["runtime:start", "frontend:stop", "api:stop", "runtime:stop"]);
});
