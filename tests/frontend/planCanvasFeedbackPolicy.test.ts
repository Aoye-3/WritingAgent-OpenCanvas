import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Plan projection focus is keyed by canvas node instead of every plan update", async () => {
  const source = await readFile("src/features/workspace/WorkspaceView.tsx", "utf8");
  assert.match(source, /const focusKey = `\$\{projected\.id\}:\$\{projected\.canvasNodeId\}`/);
  assert.doesNotMatch(source, /projected\.updatedAt.*projected\.canvasNodeId/);
});

test("active Plans do not globally suppress ordinary Canvas write suggestions", async () => {
  const source = await readFile("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");
  assert.match(source, /const pendingWriteSuggestion = canvasWriteSuggestions\.find/);
  assert.doesNotMatch(source, /hasActivePlan \? undefined : canvasWriteSuggestions/);
  assert.doesNotMatch(source, /Object\.assign\(toolMeta/);
});

test("Canvas Plan nodes prefer structured projection metadata before content fallback", async () => {
  const source = await readFile("src/features/workspace/components/canvas/renderers/PlanNodeRenderer.tsx", "utf8");
  assert.match(source, /planProjection\(node\.metadata\)/);
  assert.match(source, /projection\?\.steps\.length/);
  assert.match(source, /node\.content\.split/);
});

test("pending Plan clarification is rendered as the composer form", async () => {
  const source = await readFile("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");
  assert.match(source, /pendingClarificationPlan/);
  assert.match(source, /pendingAgentClarification/);
  assert.match(source, /drawer-chat-composer-clarification/);
  assert.match(source, /variant="composer"/);
  assert.match(source, /hidden=\{Boolean\(pendingClarificationPlan \|\| pendingAgentClarification\)\}/);
  assert.match(source, /disabled=\{Boolean\(pendingClarificationPlan \|\| pendingAgentClarification\)\}/);
});

test("Agent clarification timeline events render the composer choice card", async () => {
  const source = await readFile("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");
  assert.match(source, /latestPendingAgentClarification\(messages, locallyAnsweredAgentClarificationIds\)/);
  assert.match(source, /agent_backend_agent_clarification_requested/);
  assert.match(source, /agent_clarification_requested/);
  assert.match(source, /clarificationId/);
  assert.match(source, /function AgentClarificationChoiceCard/);
  assert.match(source, /clarification\.options\.map/);
  assert.match(source, /onAnswer=\{\(optionId\) => answerAgentClarification\(pendingAgentClarification, optionId\)\}/);
  assert.doesNotMatch(source, /onUpdateCanvasNode\(node\.id/);
  assert.doesNotMatch(source, /agentClarificationAnsweredCanvasContent/);
});

test("clarification option clicks inject the selected option detail into Plan context", async () => {
  const source = await readFile("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");
  assert.match(source, /option: \{ id: option\.id, label: option\.label, description: option\.description, recommended: option\.recommended \}/);
  assert.match(source, /awaitingPlan: \{/);
});

test("clarification options use tooltip details instead of body prose", async () => {
  const source = await readFile("src/features/workspace/components/PlanClarificationCard.tsx", "utf8");
  assert.match(source, /title=\{option\.description\}/);
  assert.match(source, /aria-label=\{label\}/);
  assert.match(source, /plan-clarification-detail/);
  assert.doesNotMatch(source, /<small>\{option\.description\}<\/small>/);
});

test("fetched thread state is applied to Plan UI state after generation", async () => {
  const runSource = await readFile("src/app/hooks/useGenerationRun.ts", "utf8");
  const appSource = await readFile("src/app/App.tsx", "utf8");
  assert.match(runSource, /const state = await options\.onFetchAndApplyThreadState\(result\.threadId\);[\s\S]*applyCollaborationMessagesFromThreadState\(state\);/);
  assert.match(appSource, /const state = await fetchThreadState\(threadId\);[\s\S]*generationRun\.applyCollaborationMessagesFromThreadState\(state\);/);
});

test("Plan intake prompt reserves clarification options for the product UI", async () => {
  const source = await readFile("server/services/generation/planRequestPolicy.ts", "utf8");
  assert.match(source, /Do not repeat the clarification options as ordinary assistant prose/);
  assert.match(source, /contextValues\.awaitingPlan/);
});

test("chat generation can be stopped while the agent is thinking", async () => {
  const clientSource = await readFile("src/features/generation/generationClient.ts", "utf8");
  const hookSource = await readFile("src/app/hooks/useGenerationRun.ts", "utf8");
  const drawerSource = await readFile("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");
  assert.match(clientSource, /signal: options\.signal/);
  assert.match(hookSource, /stopChatGeneration/);
  assert.match(hookSource, /chatAbortControllerRef\.current\?\.abort\(\)/);
  assert.match(drawerSource, /onStopSending/);
  assert.match(drawerSource, /StopIcon/);
  assert.match(drawerSource, /type=\{isSending \? "button" : "submit"\}/);
});
