import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { CanvasNode, StoredToolEvent } from "../../src/features/agents/types.js";
import { createMarkdownOutputNodeDraft, deriveMarkdownOutputItems } from "../../src/features/workspace/components/canvas/markdownOutputs.js";

function event(input: Partial<StoredToolEvent> & Pick<StoredToolEvent, "eventType" | "payload">): StoredToolEvent {
  return {
    id: input.id ?? crypto.randomUUID(),
    threadId: input.threadId ?? "thread_1",
    runId: input.runId ?? "run_1",
    eventType: input.eventType,
    payload: input.payload,
    createdAt: input.createdAt ?? "2026-07-15T10:00:00.000Z"
  };
}

test("indexes only completed Markdown outputs from the current thread", () => {
  const items = deriveMarkdownOutputItems([
    event({ eventType: "agent_backend_tool_completed", payload: { toolName: "write_file", path: "/mnt/user-data/outputs/report.md" } }),
    event({ eventType: "agent_backend_tool_started", payload: { toolName: "write_file", path: "/mnt/user-data/outputs/draft.md" } }),
    event({ eventType: "agent_backend_tool_completed", payload: { toolName: "write_file", path: "/mnt/user-data/workspace/private.md" } }),
    event({ eventType: "agent_backend_tool_completed", payload: { toolName: "write_file", path: "/mnt/user-data/outputs/data.csv" } }),
    event({ threadId: "thread_2", eventType: "agent_backend_tool_completed", payload: { toolName: "write_file", path: "/mnt/user-data/outputs/other.md" } })
  ], [], "thread_1");

  assert.deepEqual(items.map((item) => item.path), ["/mnt/user-data/outputs/report.md"]);
});

test("deduplicates write and present events while preferring the presented state", () => {
  const items = deriveMarkdownOutputItems([
    event({ createdAt: "2026-07-15T10:00:00.000Z", eventType: "agent_backend_tool_completed", payload: { toolName: "write_file", path: "/mnt/user-data/outputs/report.md" } }),
    event({ createdAt: "2026-07-15T10:01:00.000Z", eventType: "agent_backend_tool_completed", payload: { toolName: "present_files", filepaths: ["/mnt/user-data/outputs/report.md"] } })
  ], [], "thread_1");

  assert.equal(items.length, 1);
  assert.equal(items[0]?.status, "presented");
  assert.equal(items[0]?.sourceTool, "present_files");
});

test("links an indexed output to an existing file document node", () => {
  const node = {
    id: "node_1",
    kind: "file_document",
    title: "Document: report.md",
    metadata: { fileDocument: { path: "/mnt/user-data/outputs/report.md", threadId: "thread_1", fileName: "report.md", status: "presented", sourceTool: "present_files" } },
    createdAt: "2026-07-15T10:02:00.000Z"
  } as CanvasNode;

  const items = deriveMarkdownOutputItems([], [node], "thread_1");

  assert.equal(items[0]?.nodeId, "node_1");
  assert.equal(items[0]?.path, "/mnt/user-data/outputs/report.md");
});

test("creates a file document draft at the requested visible-canvas origin", () => {
  const [item] = deriveMarkdownOutputItems([
    event({ eventType: "agent_backend_tool_completed", payload: { toolName: "present_files", filepaths: ["/mnt/user-data/outputs/report.md"] } })
  ], [], "thread_1");

  assert.deepEqual(createMarkdownOutputNodeDraft(item!, { x: 220, y: 140 }, "zh"), {
    kind: "file_document",
    title: "文档：report.md",
    content: "# 文档：report.md\n\n- 文件: report.md\n- 路径: `/mnt/user-data/outputs/report.md`\n- 状态: 已呈现，可预览",
    x: 220,
    y: 140,
    width: 360,
    height: 220,
    metadata: {
      fileDocument: {
        path: "/mnt/user-data/outputs/report.md",
        fileName: "report.md",
        title: "文档：report.md",
        status: "presented",
        sourceTool: "present_files",
        threadId: "thread_1"
      }
    },
    includeInProjectContext: false
  });
});

test("wires the current thread output list to the canvas toolbar and existing preview flow", () => {
  const app = readFileSync("src/app/App.tsx", "utf8");
  const workspace = readFileSync("src/features/workspace/WorkspaceView.tsx", "utf8");
  const mainCanvas = readFileSync("src/features/workspace/components/WorkspaceMainCanvas.tsx", "utf8");
  const canvas = readFileSync("src/features/workspace/components/DocumentCanvas.tsx", "utf8");
  const styles = readFileSync("src/app/styles.css", "utf8");

  assert.match(app, /toolEvents=\{generationRun\.toolEvents\}/);
  assert.match(workspace, /toolEvents=\{toolEvents\}/);
  assert.match(mainCanvas, /toolEvents=\{props\.toolEvents\}/);
  assert.match(canvas, /className="canvas-top-stack"/);
  assert.match(canvas, /aria-expanded=\{outputsExpanded\}/);
  assert.match(canvas, /openOutputPreview/);
  assert.match(canvas, /createMarkdownOutputNodeDraft/);
  assert.match(styles, /\.view-workspace\[data-right-collapsed="false"\] \.canvas-top-stack/);
});
