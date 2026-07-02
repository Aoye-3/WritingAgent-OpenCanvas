import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeView } from "../../src/features/home/HomeView.js";
import { I18nProvider } from "../../src/features/i18n/I18nProvider.js";
import type { AgentCard, ProjectSummary, StoredThread } from "../../src/features/agents/types.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { window: { localStorage: Pick<Storage, "getItem" | "setItem"> } }).window = {
  localStorage: {
    getItem: () => "en",
    setItem: () => undefined
  }
};

const agentCard: AgentCard = {
  id: "chat-agent",
  category: "chat",
  accent: "blue",
  icon: "bot",
  title: { en: "ChatAgent", zh: "ChatAgent" },
  description: { en: "General canvas agent", zh: "General canvas agent" },
  identityPrompt: "You are ChatAgent.",
  skillRefs: [],
  toolRefs: ["web_search", "knowledge_base", "clear_context", "canvas_write"],
  outputContract: { type: "chat", defaultFormat: "markdown" }
};

function renderHome(projects: ProjectSummary[], extra: Partial<React.ComponentProps<typeof HomeView>> = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(HomeView, {
        activeAgent: agentCard,
        activeView: "home",
        agentCards: [agentCard],
        configuredModels: [],
        disabledSkillRefs: [],
        enabledSkillRefs: [],
        projects,
        skillCatalog: [],
        skillCatalogStatus: "ready",
        skillFolders: [],
        toolState: { web_search: true, knowledge_base: false, canvas_write: true },
        onCreateBoardFromPrompt: async () => undefined,
        onOpenSettings: () => undefined,
        onOpenAgent: () => undefined,
        onOpenThread: () => undefined,
        onNavigate: () => undefined,
        onDeleteThread: () => undefined,
        onRequestSkillCatalog: () => undefined,
        onSelectAgent: () => undefined,
        onSelectModel: () => undefined,
        onTogglePinnedThread: () => undefined,
        onToggleSkill: () => undefined,
        onToolStateChange: () => undefined,
        pinnedThreadIds: [],
        onRenameThread: async () => undefined,
        ...extra
      })
    )
  );
}

test("Home recent projects renders Project names instead of stale thread titles", () => {
  const project: ProjectSummary = {
    id: "project_renamed",
    title: "Renamed project name",
    summary: "",
    updatedAt: "2026-06-16T12:00:00.000Z",
    modelConfigIds: [],
    threadCount: 1,
    assetCount: 2
  };
  const staleThread: StoredThread = {
    id: "thread_old_title",
    projectId: project.id,
    title: "Old conversation title",
    updatedAt: "2026-06-16T11:00:00.000Z"
  };

  const html = renderHome([project], { recentThreads: [staleThread] } as Partial<React.ComponentProps<typeof HomeView>> & { recentThreads: StoredThread[] });

  assert.match(html, /Renamed project name/);
  assert.doesNotMatch(html, /Old conversation title/);
});

test("Home renders recents filters, grid/list controls, and shared composer controls", () => {
  const html = renderHome([
    {
      id: "project_alpha",
      title: "Alpha project",
      summary: "Research notes",
      updatedAt: "2026-06-16T12:00:00.000Z",
      modelConfigIds: [],
      threadCount: 1,
      assetCount: 4,
      agentCardId: "chat-agent",
      canvasPreview: {
        updatedAt: "2026-06-16T12:00:00.000Z",
        nodes: [
          {
            id: "node_alpha",
            kind: "document",
            title: "Draft",
            x: 0,
            y: 0,
            width: 320,
            height: 180
          }
        ],
        objects: [
          {
            id: "object_alpha",
            kind: "shape",
            geometry: { x: 360, y: 80, width: 140, height: 90 },
            data: { shapeId: "rectangle" }
          }
        ]
      }
    },
    {
      id: "project_empty",
      title: "Empty project",
      summary: "",
      updatedAt: "2026-06-15T12:00:00.000Z",
      modelConfigIds: [],
      threadCount: 1,
      assetCount: 0,
      agentCardId: "chat-agent"
    }
  ]);

  assert.match(html, /Recently viewed/);
  assert.match(html, /Pinned/);
  assert.match(html, /All projects/);
  assert.match(html, /Search projects/);
  assert.match(html, /Grid/);
  assert.match(html, /List/);
  assert.match(html, /Skills/);
  assert.match(html, /project-canvas-preview/);
  assert.match(html, /home-project-preview-grid/);
  assert.match(html, /Alpha project/);
  assert.match(html, /Empty project/);
});
