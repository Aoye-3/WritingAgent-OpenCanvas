import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeView } from "../../src/features/home/HomeView.js";
import { I18nProvider } from "../../src/features/i18n/I18nProvider.js";
import type { ProjectSummary, StoredThread } from "../../src/features/agents/types.js";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { window: { localStorage: Pick<Storage, "getItem" | "setItem"> } }).window = {
  localStorage: {
    getItem: () => "en",
    setItem: () => undefined
  }
};

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

  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(HomeView, {
        activeView: "home",
        agentCards: [],
        projects: [project],
        recentThreads: [staleThread],
        onOpenSettings: () => undefined,
        onOpenAgent: () => undefined,
        onOpenThread: () => undefined,
        onNavigate: () => undefined,
        onDeleteThread: () => undefined,
        onTogglePinnedThread: () => undefined,
        pinnedThreadIds: [],
        onRenameThread: async () => undefined
      } as React.ComponentProps<typeof HomeView> & { projects: ProjectSummary[] })
    )
  );

  assert.match(html, /Renamed project name/);
  assert.doesNotMatch(html, /Old conversation title/);
});
