import assert from "node:assert/strict";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const apiBase = "http://127.0.0.1:17777";
const frontendUrl = "http://127.0.0.1:17776";
const generationCount = 5;
const startedAt = Date.now();
const report = { startedAt: new Date(startedAt).toISOString(), generations: [], capabilities: {} };
let projectId;
let threadId;
let browser;

try {
  const status = await api("/api/agent-runtime/status");
  assert.equal(status.reachable, true);
  assert.equal(status.runtimeProvider, "agent-backend");
  assert.equal(status.deploymentMode, "local");
  assert.equal(status.sandboxProvider, "deerflow.sandbox.local:LocalSandboxProvider");

  const config = await api("/api/agent-runtime/config");
  assert.ok(config.skills.some((skill) => skill.name === "deep-research" && skill.enabled));

  const models = await api("/api/settings/configured-model-apis");
  const selectableModels = models.configs.filter((model) => model.enabled && model.keyConfigured && model.modelType === "chat");
  assert.ok(selectableModels.length > 0);
  assert.ok(selectableModels.every((model) => model.modelType === "chat"));
  const sync = await api("/api/settings/model-runtime-sync-status");
  assert.ok(sync.models.some((model) => model.status === "synced"));

  const title = `Local Runtime Acceptance ${Date.now()}`;
  const projectPayload = await api("/api/projects", { method: "POST", body: { title } });
  projectId = projectPayload.project.id;
  const threadPayload = await api("/api/threads", {
    method: "POST",
    body: { projectId, title: "Acceptance conversation" }
  });
  threadId = threadPayload.thread.id;
  assert.ok(threadPayload.thread.configuredModelApiId);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
  await page.goto(frontendUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const start = page.getByText("Start", { exact: true });
  if (await start.isVisible().catch(() => false)) await start.click();
  await page.getByRole("button", { name: "Projects", exact: true }).first().click();
  const row = page.locator("article.project-table-row").filter({ hasText: title });
  await row.getByRole("button", { name: "Open" }).click();
  await page.getByTestId("ai-collaboration-input").waitFor();

  assert.equal(await page.getByText("Project available models", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Project context", { exact: true }).count(), 0);
  assert.equal(await page.getByText("Agent Runtime / local", { exact: true }).count(), 2);
  const modelOptions = await page.getByLabel("Conversation model").locator("option").allTextContents();
  assert.ok(modelOptions.some((label) => label.includes("DeepSeek")));
  assert.ok(modelOptions.every((label) => !label.includes("bge-m3")));

  for (let index = 0; index < generationCount; index++) {
    const token = `LOCAL_RUNTIME_OK_${index + 1}_${Date.now()}`;
    await page.getByTestId("ai-collaboration-input").fill(`Reply with exactly ${token} and nothing else.`);
    await page.getByRole("button", { name: "Send" }).click();
    const message = await waitForAssistantMessage(token);
    assert.equal(message.usedMock, false);
    const state = await api(`/api/threads/${threadId}/state`);
    const completed = state.toolEvents.find((event) => event.eventType === "run_completed" && event.payload?.configuredModelApiId);
    assert.equal(completed?.payload?.provider, "agent-backend");
    assert.equal(completed?.payload?.usedMock, false);
    report.generations.push({ token, provider: completed.payload.provider, usedMock: false });
  }

  const skillResult = await generate({
    chatInstruction: "Use the deep-research skill and web_search. Find the official Python homepage and answer with two short bullet points: title and URL.",
    toolState: { web_search: true, knowledge_base: false, clear_context: false, canvas_write: false }
  });
  assert.equal(skillResult.provider, "agent-backend");
  assert.equal(skillResult.usedMock, false);
  const skillTools = skillResult.events.map((event) => event.payload?.toolName).filter(Boolean);
  assert.ok(skillTools.includes("read_file"));
  assert.ok(skillTools.includes("web_search"));
  report.capabilities.skillAndWebSearch = { tools: skillTools, text: skillResult.text };

  const beforeCanvas = await api(`/api/threads/${threadId}/state`);
  const canvasResult = await generate({
    chatInstruction: "Use canvas_write to propose creating a document titled Acceptance Draft with content Local canvas approval test. Do not claim it is already approved.",
    toolState: { web_search: false, knowledge_base: false, clear_context: false, canvas_write: true }
  });
  assert.equal(canvasResult.provider, "agent-backend");
  assert.equal(canvasResult.usedMock, false);
  assert.ok(canvasResult.events.some((event) => event.payload?.toolName === "canvas_write"));
  const afterCanvas = await api(`/api/threads/${threadId}/state`);
  assert.equal(afterCanvas.canvasNodes.length, beforeCanvas.canvasNodes.length);
  assert.ok(afterCanvas.canvasWriteRequests.some((request) => request.status === "pending"));
  report.capabilities.canvasWrite = { pending: true, nodesUnchanged: true };

  const memoryPath = await waitForRuntimeMemory();
  report.capabilities.memory = { updated: true, path: path.relative(root, memoryPath) };
  report.completedAt = new Date().toISOString();
  await mkdir(path.join(root, "test-results"), { recursive: true });
  await writeFile(path.join(root, "test-results", "local-runtime-acceptance-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close().catch(() => undefined);
  if (projectId) {
    await api(`/api/projects/${projectId}/trash`, { method: "POST", body: {} }).catch(() => undefined);
    await api(`/api/projects/${projectId}`, { method: "DELETE" }).catch(() => undefined);
  }
}

async function generate({ chatInstruction, toolState }) {
  return api("/api/generate", {
    method: "POST",
    body: { mode: "chat", locale: "en", projectId, threadId, agentCardId: "blog-post", chatInstruction, toolState }
  });
}

async function waitForAssistantMessage(text) {
  return poll(async () => {
    const payload = await api(`/api/threads/${threadId}/messages`);
    return payload.messages.find((message) => message.role === "assistant" && message.text.trim() === text);
  }, 180_000, `assistant reply ${text}`);
}

async function waitForRuntimeMemory() {
  const usersRoot = path.join(root, "modules", "agent-runtime", "backend", ".deer-flow", "users");
  return poll(async () => {
    const entries = await readdir(usersRoot, { recursive: true, withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || entry.name !== "memory.json") continue;
      const filePath = path.join(entry.parentPath, entry.name);
      const info = await stat(filePath);
      if (info.mtimeMs >= startedAt) return filePath;
    }
    return undefined;
  }, 120_000, "Agent Runtime memory.json update");
}

async function poll(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function api(url, options = {}) {
  const response = await fetch(`${apiBase}${url}`, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${url} failed: ${JSON.stringify(payload)}`);
  return payload;
}
