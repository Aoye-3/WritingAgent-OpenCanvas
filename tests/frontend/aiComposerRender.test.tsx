import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { AgentCard, SkillCatalogItem, SkillFolderItem } from "../../src/features/agents/types";
import { I18nProvider } from "../../src/features/i18n/I18nProvider";
import type { ConfiguredModelApiSummary } from "../../src/features/settings/types";
import { AIComposer } from "../../src/features/workspace/components/AIComposer";

const agent: AgentCard = {
  id: "chat-agent",
  category: "chat",
  accent: "blue",
  icon: "bot",
  title: { en: "ChatAgent", zh: "ChatAgent" },
  description: { en: "Chat", zh: "Chat" },
  identityPrompt: "You are helpful.",
  skillRefs: [],
  toolRefs: ["web_search", "knowledge_base"],
  outputContract: { type: "chat", defaultFormat: "markdown" }
};

const reasoningModel: ConfiguredModelApiSummary = {
  id: "deepseek--deepseek-v4-flash",
  providerId: "deepseek",
  providerLabel: "DeepSeek",
  modelId: "deepseek-v4-flash",
  modelName: "deepseek-v4-flash",
  supportsThinking: false,
  keyConfigured: true,
  baseURL: "http://localhost",
  enabled: true,
  capabilityGroup: "reasoning"
};

const chatModel: ConfiguredModelApiSummary = {
  ...reasoningModel,
  id: "deepseek--deepseek-chat",
  modelId: "deepseek-chat",
  modelName: "deepseek-chat",
  capabilityGroup: "chat"
};

const localStorage = {
  getItem: () => "en",
  setItem: () => undefined
};

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { localStorage }
});

Object.defineProperty(globalThis, "React", {
  configurable: true,
  value: React
});

function renderComposer(model: ConfiguredModelApiSummary, className?: string) {
  return renderToStaticMarkup(
    <I18nProvider>
      <AIComposer
        activeAgent={agent}
        agentCards={[agent]}
        allowedTools={agent.toolRefs}
        className={className}
        configuredModels={[reasoningModel, chatModel]}
        disabledSkillRefs={[]}
        enabledSkillRefs={[]}
        isSending={false}
        modelSelectionDisabled={false}
        modelSettings={{
          providerId: model.providerId,
          modelId: model.modelId,
          modelName: model.modelName,
          supportsThinking: model.supportsThinking
        }}
        placeholder="Ask"
        selectedModelConfigId={model.id}
        skillCatalog={[] as SkillCatalogItem[]}
        skillCatalogStatus="ready"
        skillFolders={[] as SkillFolderItem[]}
        submitEmpty={false}
        toolState={{ web_search: true, knowledge_base: false }}
        value=""
        onRequestSkillCatalog={() => undefined}
        onSelectAgent={() => undefined}
        onSelectModel={() => undefined}
        onStopSending={() => undefined}
        onSubmit={() => undefined}
        onToggleSkill={() => undefined}
        onToolStateChange={() => undefined}
        onValueChange={() => undefined}
      />
    </I18nProvider>
  );
}

test("AIComposer renders the thinking button for detected reasoning models", () => {
  const markup = renderComposer(reasoningModel, "home-ai-composer");

  assert.match(markup, /class="drawer-chat-composer ai-composer home-ai-composer"/);
  assert.match(markup, /aria-label="Thinking mode"/);
  assert.match(markup, /class="thinking-mode-control"/);
  assert.match(markup, /class="thinking-mode-button"/);
  assert.match(markup, /aria-haspopup="dialog"/);
  assert.doesNotMatch(markup, /composer-skill-menu/);
});

test("AIComposer does not render thinking controls for non-thinking chat models", () => {
  const markup = renderComposer(chatModel);

  assert.doesNotMatch(markup, /aria-label="Thinking mode"/);
  assert.doesNotMatch(markup, /thinking-mode-button/);
});
