import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { clearAgentBackendSession } from "../runtime/agentBackendAdapter/auth.js";
import type { AgentBackendRuntimeConfig } from "../runtime/agentBackendAdapter/config.js";
import {
  archiveMarkdownOutputFromRuntime,
  readArchivedMarkdownOutput,
  resolveArchivedMarkdownOutputPath
} from "./threadOutputArchive.js";
import { readMarkdownOutputPreview } from "./threadOutputPreview.js";

const runtimeConfig: AgentBackendRuntimeConfig = {
  enabled: true,
  baseUrl: "http://agent-runtime.test",
  assistantId: "lead_agent",
  auth: {
    email: "admin@example.test",
    password: "secret",
    autoSetup: false,
    timeoutMs: 1000
  }
};

test("archives runtime Markdown output into FacetWrite thread outputs and overwrites existing copies", async () => {
  await withFacetWriteRoot("archive-overwrite", async () => {
    clearAgentBackendSession();
    const contents = ["# First archive\n", "# Updated archive\n"];
    const fetchImpl = runtimeFetch(contents);

    const first = await archiveMarkdownOutputFromRuntime("thread_archive", "/mnt/user-data/outputs/report.md", {
      config: runtimeConfig,
      fetchImpl
    });
    assert.equal(await readFile(first.localPath, "utf8"), "# First archive\n");

    const second = await archiveMarkdownOutputFromRuntime("thread_archive", "/mnt/user-data/outputs/report.md", {
      config: runtimeConfig,
      fetchImpl
    });
    assert.equal(second.localPath, first.localPath);
    assert.equal(await readFile(second.localPath, "utf8"), "# Updated archive\n");
  });
});

test("rejects invalid Markdown output archive paths before calling runtime", async () => {
  await withFacetWriteRoot("archive-invalid-path", async () => {
    clearAgentBackendSession();
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("not reached");
    };

    await assert.rejects(
      archiveMarkdownOutputFromRuntime("thread_archive", "/mnt/user-data/uploads/report.md", {
        config: runtimeConfig,
        fetchImpl
      }),
      /under \/mnt\/user-data\/outputs/
    );
    assert.equal(calls, 0);
  });
});

test("rejects oversized runtime Markdown artifacts", async () => {
  await withFacetWriteRoot("archive-too-large", async () => {
    clearAgentBackendSession();
    const fetchImpl = runtimeFetch(["# Too large\n"], { contentLength: "1000001" });
    await assert.rejects(
      archiveMarkdownOutputFromRuntime("thread_archive", "/mnt/user-data/outputs/large.md", {
        config: runtimeConfig,
        fetchImpl
      }),
      /too large/
    );
  });
});

test("reports runtime artifact failures while archiving", async () => {
  await withFacetWriteRoot("archive-runtime-failure", async () => {
    clearAgentBackendSession();
    const fetchImpl = runtimeFetch([], { artifactStatus: 404 });
    await assert.rejects(
      archiveMarkdownOutputFromRuntime("thread_archive", "/mnt/user-data/outputs/missing.md", {
        config: runtimeConfig,
        fetchImpl
      }),
      /HTTP 404/
    );
  });
});

test("Markdown preview reads local archive and lazy archives missing historical outputs", async () => {
  await withFacetWriteRoot("preview-lazy-archive", async () => {
    const local = resolveArchivedMarkdownOutputPath("thread_preview", "/mnt/user-data/outputs/local.md");
    await mkdir(path.dirname(local.localPath), { recursive: true });
    await writeFile(local.localPath, "# Local archive\n", "utf8");

    const localPreview = await readMarkdownOutputPreview("thread_preview", "/mnt/user-data/outputs/local.md");
    assert.equal(localPreview.content, "# Local archive\n");

    const lazyPreview = await readMarkdownOutputPreview(
      "thread_preview",
      "/mnt/user-data/outputs/lazy.md",
      async (threadId, virtualPath) => {
        const target = resolveArchivedMarkdownOutputPath(threadId, virtualPath);
        await mkdir(path.dirname(target.localPath), { recursive: true });
        await writeFile(target.localPath, "# Lazy archive\n", "utf8");
        return { ...target, size: Buffer.byteLength("# Lazy archive\n", "utf8") };
      }
    );
    assert.equal(lazyPreview.content, "# Lazy archive\n");

    const saved = await readArchivedMarkdownOutput("thread_preview", "/mnt/user-data/outputs/lazy.md");
    assert.equal(saved.content, "# Lazy archive\n");
  });
});

async function withFacetWriteRoot(name: string, run: () => Promise<void>) {
  const previousRoot = process.env.FACETWRITE_APP_ROOT;
  const appRoot = `.facetwrite-test/${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  process.env.FACETWRITE_APP_ROOT = appRoot;
  try {
    await run();
  } finally {
    if (previousRoot === undefined) {
      delete process.env.FACETWRITE_APP_ROOT;
    } else {
      process.env.FACETWRITE_APP_ROOT = previousRoot;
    }
    await rm(path.resolve(process.cwd(), appRoot), { recursive: true, force: true });
    clearAgentBackendSession();
  }
}

function runtimeFetch(contents: string[], options: { artifactStatus?: number; contentLength?: string } = {}): typeof fetch {
  let artifactIndex = 0;
  return async (url, init) => {
    const value = String(url);
    if (value.endsWith("/api/v1/auth/setup-status")) {
      return new Response(JSON.stringify({ needs_setup: false }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (value.endsWith("/api/v1/auth/login/local")) {
      assert.equal(init?.method, "POST");
      return new Response("", {
        status: 200,
        headers: { "set-cookie": "access_token=test-token; Path=/, csrf_token=test-csrf; Path=/" }
      });
    }
    if (value.includes("/api/threads/thread_archive/artifacts/mnt/user-data/outputs/")) {
      const body = contents[artifactIndex] ?? "";
      artifactIndex += 1;
      return new Response(body, {
        status: options.artifactStatus ?? 200,
        headers: options.contentLength ? { "content-length": options.contentLength } : undefined
      });
    }
    return new Response(`Unexpected request: ${value}`, { status: 500 });
  };
}
