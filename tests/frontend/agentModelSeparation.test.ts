import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Agent settings no longer expose an Agent-owned Model tab", async () => {
  const source = await readFile("src/features/agents/components/AgentSettingsTabs.tsx", "utf8");

  assert.match(source, /export const tabs = \["prompt", "knowledge", "tools", "mcp", "quick", "memory"\]/);
  assert.doesNotMatch(source, /function AgentModelTab/);
  assert.doesNotMatch(source, /settings\.model/);
});

test("frontend default entrypoint uses the neutral ChatAgent", async () => {
  const source = await readFile("src/app/App.tsx", "utf8");

  assert.match(source, /id: "chat-agent"/);
  assert.match(source, /title: \{ en: "ChatAgent"/);
  assert.doesNotMatch(source, /id: "blog-post"/);
  assert.doesNotMatch(source, /fallbackAgentCards\[0\]\.title/);
});

test("home screen no longer promotes multiple built-in writing Agents", async () => {
  const source = await readFile("src/features/home/HomeView.tsx", "utf8");

  assert.doesNotMatch(source, /featuredAgents/);
  assert.doesNotMatch(source, /preferred = \["blog-post"/);
  assert.doesNotMatch(source, /home-agent-card-row/);
  assert.doesNotMatch(source, /Recent agents/);
});

test("workspace model controls do not read model runtime state from Agent settings", async () => {
  const workspaceSource = await readFile("src/features/workspace/WorkspaceView.tsx", "utf8");
  const drawerSource = await readFile("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");
  const generationSource = await readFile("src/app/hooks/useGenerationRun.ts", "utf8");

  assert.doesNotMatch(workspaceSource, /activeAgent\.settings\?\.model/);
  assert.doesNotMatch(drawerSource, /AgentSettings\["model"\]/);
  assert.doesNotMatch(generationSource, /activeAgent\.settings\?\.model/);
});

test("workspace uses independent dual-layer Briefs and moves model selection into the composer", async () => {
  const appSource = await readFile("src/app/App.tsx", "utf8");
  const inputDrawerSource = await readFile("src/features/workspace/components/AgentInputDrawer.tsx", "utf8");
  const collaborationSource = await readFile("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");
  const generationSource = await readFile("src/app/hooks/useGenerationRun.ts", "utf8");

  assert.match(inputDrawerSource, /Project Brief/);
  assert.match(inputDrawerSource, /Current Task Brief/);
  assert.doesNotMatch(inputDrawerSource, /Conversation model/);
  assert.doesNotMatch(inputDrawerSource, /activeAgent\.fields/);
  assert.match(collaborationSource, /composer-model-select/);
  assert.match(collaborationSource, /onSelectModel/);
  assert.doesNotMatch(appSource, /saveThreadInputs/);
  assert.doesNotMatch(appSource, /projectInputs/);
  assert.doesNotMatch(appSource, /agentValues/);
  assert.match(generationSource, /await options\.beforeGenerate\(\)/);
  assert.match(collaborationSource, /catch \{\s*setInput\(text\)/);
});

test("Agent cards no longer own structured input field definitions", async () => {
  const serverTypes = await readFile("server/agents/types.ts", "utf8");
  const frontendTypes = await readFile("src/features/agents/types.ts", "utf8");

  assert.doesNotMatch(serverTypes, /AgentCardField/);
  assert.doesNotMatch(serverTypes, /defaultValues:/);
  assert.doesNotMatch(serverTypes, /fields:/);
  assert.doesNotMatch(frontendTypes, /AgentCardField/);
  assert.doesNotMatch(frontendTypes, /defaultValues:/);
  assert.doesNotMatch(frontendTypes, /fields:/);
});
