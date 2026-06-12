import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { buildSpawnCommand, parseRunningServices, runDetachedCommand, waitForHttp } from "./platform.mjs";

test("runs Windows command scripts through ComSpec", () => {
  assert.deepEqual(
    buildSpawnCommand("npm.cmd", ["run", "dev:server"], {
      platform: "win32",
      comspec: "C:\\Windows\\System32\\cmd.exe",
    }),
    {
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", "run", "dev:server"],
    },
  );
});

test("starts executable commands directly", () => {
  assert.deepEqual(
    buildSpawnCommand("node.exe", ["server.js"], { platform: "win32" }),
    { command: "node.exe", args: ["server.js"] },
  );
});

test("runs daemon bootstrap commands without inheritable output pipes", async () => {
  const child = new EventEmitter();
  let spawnOptions;
  const completion = runDetachedCommand("powershell.exe", ["-File", "runtime.ps1", "up"], {
    cwd: "F:\\project",
    spawnImpl: (_command, _args, options) => {
      spawnOptions = options;
      queueMicrotask(() => child.emit("close", 0));
      return child;
    },
  });

  await completion;
  assert.equal(spawnOptions.stdio, "ignore");
  assert.equal(spawnOptions.windowsHide, true);
});

test("parses running compose service names", () => {
  assert.deepEqual(
    parseRunningServices("facetwrite-agent-runtime-nginx\r\nfacetwrite-agent-runtime-gateway\r\n"),
    ["facetwrite-agent-runtime-nginx", "facetwrite-agent-runtime-gateway"],
  );
});

test("waitForHttp retries until the endpoint is ready", async () => {
  let attempts = 0;
  await waitForHttp("http://example.test", {
    attempts: 3,
    delayMs: 0,
    fetchImpl: async () => {
      attempts += 1;
      return { ok: attempts === 3 };
    },
  });
  assert.equal(attempts, 3);
});

test("waitForHttp reports the unavailable endpoint", async () => {
  await assert.rejects(
    waitForHttp("http://example.test", {
      attempts: 2,
      delayMs: 0,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    }),
    /did not become ready/,
  );
});
