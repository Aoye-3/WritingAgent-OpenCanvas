import { expect, test, type Page } from "@playwright/test";

const undoButtonName = /Undo|撤销/;
const sendMindChainName = /Send mind chain|发送思维链/;

type CanvasState = {
  canvasNodes: Array<{
    id: string;
    kind: "document" | "note" | "reference" | "role";
    title: string;
    content: string;
    x: number;
    y: number;
    width: number;
    height: number;
    metadata?: { workflow?: { stage?: string; roles?: string[] }; workflowRole?: { roleId?: string; label?: string; prompt?: string } };
  }>;
  canvasWorkflow?: {
    stage: string;
    roles: Array<{ id: string; label: string }>;
  };
  canvasObjects?: Array<{ id: string; kind: "arrow" | "shape" | "table" | "asset" | "text"; data: Record<string, unknown> }>;
};

async function openNewCanvas(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("start-button").click();
  await page.getByTestId("home-create-board").click();
  await expect(page.getByTestId("document-canvas")).toBeVisible();
}

async function getCurrentThreadId(page: Page) {
  const threadId = await page.evaluate(() => window.localStorage.getItem("facetwrite:lastThreadId"));
  expect(threadId).toBeTruthy();
  return threadId!;
}

async function fetchCanvasState(page: Page): Promise<CanvasState> {
  const threadId = await getCurrentThreadId(page);
  const response = await page.request.get(`/api/threads/${threadId}/state`);
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<CanvasState>;
}

test("Project-first workspace separates sessions, models, and run Agent without page scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 1024 });
  await openNewCanvas(page);

  await expect(page.getByRole("complementary", { name: "Project settings and structured inputs" })).toBeVisible();
  await expect(page.getByText(/Conversation model|会话模型/)).toBeVisible();
  await expect(page.getByText(/Available to this Project|项目可用模型/)).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Project settings and structured inputs" }).getByText("AGENTCARD")).toHaveCount(0);

  const firstThreadId = await getCurrentThreadId(page);
  await expect(page.getByRole("button", { name: /History|历史/ })).toBeVisible();
  const rightDrawer = page.getByRole("complementary", { name: "AI collaboration drawer" });
  const compactHeader = rightDrawer.getByTestId("conversation-compact-header");
  const agentRow = rightDrawer.getByTestId("composer-agent-row");
  const composerInput = rightDrawer.getByTestId("ai-collaboration-input");
  await expect(compactHeader).toBeVisible();
  await expect(rightDrawer.getByText(/History and collaboration|历史与协作/)).toHaveCount(0);
  await expect(agentRow.locator(".composer-agent-select")).toBeVisible();
  expect((await agentRow.boundingBox())!.y).toBeLessThan((await composerInput.boundingBox())!.y);
  await expect(rightDrawer.getByRole("button", { name: /Web search|联网搜索/ })).toHaveAttribute("aria-pressed", "true");
  await expect(rightDrawer.getByRole("button", { name: /Knowledge base|知识库引用/ })).toHaveAttribute("aria-pressed", "false");
  await expect(rightDrawer.getByRole("button", { name: /^Send$|^发送$/ })).toHaveClass(/chat-send-icon/);
  const newConversationButton = page.getByRole("button", { name: /New|新建/ });
  await expect(newConversationButton).toBeEnabled();
  await newConversationButton.click();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("facetwrite:lastThreadId"))).not.toBe(firstThreadId);

  await page.getByRole("button", { name: /History|历史/ }).click();
  await expect(page.getByRole("button", { name: /New conversation/ })).toHaveCount(2);

  const pageOverflow = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > window.innerWidth + 1,
    vertical: document.documentElement.scrollHeight > window.innerHeight + 1,
  }));
  expect(pageOverflow).toEqual({ horizontal: false, vertical: false });
});

test("canvas creates node types and supports undo", async ({ page }) => {
  await openNewCanvas(page);

  const viewport = page.getByTestId("canvas-viewport");
  await viewport.click({ button: "right", position: { x: 180, y: 180 } });
  await page.getByTestId("canvas-menu-create-note").click();
  await expect(page.getByTestId("canvas-node")).toHaveCount(1);
  await page.getByRole("button", { name: undoButtonName }).click();
  await expect(page.getByTestId("canvas-node")).toHaveCount(0);

  await viewport.click({ button: "right", position: { x: 180, y: 180 } });
  await page.getByTestId("canvas-menu-create-document").click();
  await expect(page.getByTestId("canvas-node")).toHaveCount(1);
  await page.getByRole("button", { name: undoButtonName }).click();
  await expect(page.getByTestId("canvas-node")).toHaveCount(0);

  await viewport.click({ button: "right", position: { x: 180, y: 180 } });
  await page.getByTestId("canvas-menu-create-reference").click();
  await expect(page.getByTestId("canvas-node")).toHaveCount(1);
  await page.getByRole("button", { name: undoButtonName }).click();
  await expect(page.getByTestId("canvas-node")).toHaveCount(0);

  await viewport.click({ button: "right", position: { x: 180, y: 180 } });
  await page.getByTestId("canvas-menu-create-role").click();
  await expect(page.getByTestId("canvas-node")).toHaveCount(1);
  await page.getByRole("button", { name: undoButtonName }).click();
  await expect(page.getByTestId("canvas-node")).toHaveCount(0);
});

test("floating toolbar creates visual objects and opens selection Agent actions", async ({ page }) => {
  await openNewCanvas(page);
  const viewport = page.getByTestId("canvas-viewport");

  await page.getByRole("button", { name: "Shape" }).click();
  await expect(page.getByTestId("canvas-shape-library")).toBeVisible();
  await page.getByRole("button", { name: "Star" }).click();
  await viewport.click({ position: { x: 420, y: 300 } });
  await expect(page.getByTestId("canvas-object-shape")).toHaveCount(1);
  await expect(page.getByTestId("canvas-object-shape")).toHaveClass(/is-star/);

  await page.getByRole("button", { name: "Arrow" }).click();
  const box = await viewport.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + 260, box!.y + 420);
  await page.mouse.down();
  await page.mouse.move(box!.x + 540, box!.y + 500);
  await page.mouse.up();
  await expect(page.getByTestId("canvas-free-arrow")).toHaveCount(1);

  await page.getByRole("button", { name: "Agent tool" }).click();
  await expect(page.getByTestId("canvas-agent-tool-menu")).toBeVisible();
});

test("floating toolbar separates node tools with distinct icons", async ({ page }) => {
  await openNewCanvas(page);

  const nodeTools = page.getByTestId("board-node-tools");
  await expect(nodeTools.getByRole("button")).toHaveCount(4);
  for (const name of ["Reference", "Document", "Note", "Role"]) {
    await expect(nodeTools.getByRole("button", { name })).toBeVisible();
  }
  await expect(page.getByTestId("board-other-tools").getByRole("button")).toHaveCount(6);
  await expect(page.getByTestId("board-other-tools").getByRole("button", { name: "Text" })).toBeVisible();

  const nodeIconClasses = await nodeTools.locator("svg").evaluateAll((icons) => icons.map((icon) => icon.getAttribute("class")));
  expect(new Set(nodeIconClasses).size).toBe(4);
});

test("reference tool previews centered placement and returns to select", async ({ page }) => {
  await openNewCanvas(page);
  const viewport = page.getByTestId("canvas-viewport");
  const box = await viewport.boundingBox();
  expect(box).toBeTruthy();

  await page.getByRole("button", { name: "Reference" }).click();
  await page.mouse.move(box!.x + 420, box!.y + 300);
  const preview = page.getByTestId("canvas-creation-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveClass(/is-reference/);

  await viewport.click({ position: { x: 420, y: 300 } });
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Select" })).toHaveClass(/is-active/);
  await expect.poll(async () => (await fetchCanvasState(page)).canvasNodes[0]).toMatchObject({
    kind: "reference",
    x: 270,
    y: 205,
    width: 300,
    height: 190,
  });
});

test("creation tools create on pointer press without entering the canvas grab gesture", async ({ page }) => {
  await openNewCanvas(page);
  const viewport = page.getByTestId("canvas-viewport");
  const box = await viewport.boundingBox();
  expect(box).toBeTruthy();

  await page.getByRole("button", { name: "Document" }).click();
  await page.mouse.move(box!.x + 520, box!.y + 360);
  await expect(page.getByTestId("canvas-creation-preview")).toBeVisible();
  await expect(page.locator(".react-flow__pane")).toHaveCSS("cursor", "crosshair");
  await page.mouse.down();
  await page.mouse.move(box!.x + 524, box!.y + 364);
  await page.mouse.up();

  await expect(page.getByTestId("canvas-node")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Select" })).toHaveClass(/is-active/);
});

test("shape and table tools show typed previews and create from their centers", async ({ page }) => {
  await openNewCanvas(page);
  const viewport = page.getByTestId("canvas-viewport");
  const box = await viewport.boundingBox();
  expect(box).toBeTruthy();

  await page.getByRole("button", { name: "Shape" }).click();
  await page.getByRole("button", { name: "Star" }).click();
  await page.mouse.move(box!.x + 420, box!.y + 300);
  await expect(page.getByTestId("canvas-creation-preview")).toHaveClass(/is-star/);
  await viewport.click({ position: { x: 420, y: 300 } });
  await expect(page.getByRole("button", { name: "Select" })).toHaveClass(/is-active/);

  await page.getByRole("button", { name: "Table" }).click();
  await page.mouse.move(box!.x + 250, box!.y + 400);
  await expect(page.getByTestId("canvas-creation-preview").locator(".canvas-creation-preview-table")).toBeVisible();
  await viewport.click({ position: { x: 250, y: 400 } });

  await expect.poll(async () => (await fetchCanvasState(page)).canvasObjects).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "shape", geometry: { x: 310, y: 230, width: 220, height: 140 }, data: { shapeId: "star" } }),
    expect.objectContaining({ kind: "table", geometry: { x: 70, y: 310, width: 360, height: 180 } }),
  ]));
});

test("creation preview only appears on blank canvas and clears on escape or pointer leave", async ({ page }) => {
  await openNewCanvas(page);
  const viewport = page.getByTestId("canvas-viewport");
  const box = await viewport.boundingBox();
  expect(box).toBeTruthy();

  await page.getByRole("button", { name: "Note" }).click();
  await page.mouse.move(box!.x + 420, box!.y + 300);
  await expect(page.getByTestId("canvas-creation-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("canvas-creation-preview")).toHaveCount(0);

  await page.getByRole("button", { name: "Note" }).click();
  await page.mouse.move(box!.x + 420, box!.y + 300);
  await page.mouse.move(box!.x - 5, box!.y - 5);
  await expect(page.getByTestId("canvas-creation-preview")).toHaveCount(0);

  await viewport.click({ button: "right", position: { x: 180, y: 180 } });
  await page.getByTestId("canvas-menu-create-note").click();
  const node = page.getByTestId("canvas-node").first();
  const nodeBox = await node.boundingBox();
  expect(nodeBox).toBeTruthy();

  await page.getByRole("button", { name: "Document" }).click();
  await node.hover();
  await expect(page.getByTestId("canvas-creation-preview")).toHaveCount(0);
  await node.click();
  await expect(page.getByTestId("canvas-node")).toHaveCount(1);
});

test("shape search, table editing, asset upload, undo, and refresh persistence work", async ({ page }) => {
  await openNewCanvas(page);
  const viewport = page.getByTestId("canvas-viewport");

  await page.getByRole("button", { name: "Shape" }).click();
  await page.getByLabel("Search shapes").fill("star");
  await page.getByRole("button", { name: "Star" }).click();
  await viewport.click({ position: { x: 420, y: 300 } });
  await expect(page.getByTestId("canvas-object-shape")).toHaveClass(/is-star/);

  await page.getByRole("button", { name: "Shape" }).click();
  await expect(page.getByText("Recents")).toBeVisible();
  await page.getByRole("button", { name: "Close shape library" }).click();

  await page.getByRole("button", { name: "Table" }).click();
  await viewport.click({ position: { x: 650, y: 360 } });
  const table = page.getByTestId("canvas-object-table");
  await expect(table).toBeVisible();
  await table.locator("td").first().fill("Canvas cell");
  await table.locator("td").first().blur();

  await page.getByRole("button", { name: "Asset" }).click();
  await page.locator("input.canvas-asset-input").setInputFiles({
    name: "canvas-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Canvas asset"),
  });
  await expect(page.getByTestId("canvas-object-asset")).toBeVisible();
  await page.getByRole("button", { name: undoButtonName }).click();
  await expect(page.getByTestId("canvas-object-asset")).toHaveCount(0);

  await page.reload();
  const persisted = await fetchCanvasState(page);
  expect(persisted.canvasObjects).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "shape", data: { shapeId: "star" } }),
    expect.objectContaining({ kind: "table", data: { rows: expect.arrayContaining([expect.arrayContaining(["Canvas cell"])]) } }),
  ]));
  expect(persisted.canvasObjects?.some((object) => object.kind === "asset")).toBe(false);
});

test("canvas deletes a selected node from the corner action", async ({ page }) => {
  await openNewCanvas(page);

  const viewport = page.getByTestId("canvas-viewport");
  await viewport.click({ button: "right", position: { x: 180, y: 180 } });
  await page.getByTestId("canvas-menu-create-note").click();
  await expect(page.getByTestId("canvas-node")).toHaveCount(1);

  await page.getByTestId("canvas-node").first().click();
  await page.getByLabel("Delete node").first().click();
  await expect(page.getByTestId("canvas-node")).toHaveCount(0);
});

test("canvas persists blur edits and preserves node data across kind conversion", async ({ page }) => {
  await openNewCanvas(page);

  const viewport = page.getByTestId("canvas-viewport");
  await viewport.click({ button: "right", position: { x: 180, y: 180 } });
  await page.getByTestId("canvas-menu-create-document").click();

  await page.getByTestId("canvas-node-title").first().dblclick();
  await page.getByTestId("canvas-node-title").first().fill("Persistent title");
  await page.getByTestId("canvas-node-content").first().dblclick();
  await page.getByTestId("canvas-node-content").first().fill("Persistent body");
  await page.getByTestId("canvas-node-content").first().blur();

  await expect.poll(async () => {
    const state = await fetchCanvasState(page);
    return state.canvasNodes[0];
  }).toMatchObject({
    kind: "document",
    title: "Persistent title",
    content: "Persistent body"
  });

  const beforeConversion = (await fetchCanvasState(page)).canvasNodes[0];
  const threadId = await getCurrentThreadId(page);
  const response = await page.request.patch(`/api/threads/${threadId}/canvas/nodes/${beforeConversion.id}`, {
    data: { kind: "reference" }
  });
  expect(response.ok()).toBeTruthy();

  await expect.poll(async () => {
    const state = await fetchCanvasState(page);
    return state.canvasNodes[0];
  }).toMatchObject({
    kind: "reference",
    title: "Persistent title",
    content: "Persistent body",
    x: beforeConversion.x,
    y: beforeConversion.y,
    width: beforeConversion.width,
    height: beforeConversion.height
  });
});

test("canvas workflow stage, role nodes, and suggestions are visible in the UI", async ({ page }) => {
  await openNewCanvas(page);

  await page.getByLabel("Canvas workflow stage").selectOption("research");
  const viewport = page.getByTestId("canvas-viewport");
  await viewport.click({ button: "right", position: { x: 180, y: 180 } });
  await page.getByTestId("canvas-menu-create-document").click();
  await page.getByTestId("canvas-node-title").first().dblclick();
  await page.getByTestId("canvas-node-title").first().fill("Workflow draft");
  await page.getByTestId("canvas-node-content").first().dblclick();
  await page.getByTestId("canvas-node-content").first().fill("Initial workflow body");
  await page.getByTestId("canvas-node-content").first().blur();

  await expect.poll(async () => {
    const state = await fetchCanvasState(page);
    return state.canvasNodes[0]?.metadata?.workflow?.stage;
  }).toBe("research");

  const threadId = await getCurrentThreadId(page);

  const stateWithDocument = await fetchCanvasState(page);
  const nodeId = stateWithDocument.canvasNodes.find((node) => node.kind === "document")!.id;
  const roleResponse = await page.request.post(`/api/threads/${threadId}/canvas/nodes`, {
    data: {
      kind: "role",
      title: "Evidence",
      x: 760,
      y: 180,
      metadata: { workflowRole: { roleId: "evidence", label: "Evidence", prompt: "Check sources before advising." } }
    }
  });
  expect(roleResponse.ok()).toBeTruthy();
  const roleNodeId = ((await roleResponse.json()) as { node: { id: string } }).node.id;
  const edgeResponse = await page.request.post(`/api/threads/${threadId}/canvas/edges`, {
    data: { sourceNodeId: roleNodeId, targetNodeId: nodeId }
  });
  expect(edgeResponse.ok()).toBeTruthy();

  const suggestionResponse = await page.request.post(`/api/threads/${threadId}/canvas/suggestions`, {
    data: { roleNodeId, targetNodeId: nodeId, roleId: "evidence", content: "Add one concrete source." }
  });
  expect(suggestionResponse.ok()).toBeTruthy();

  await page.getByLabel("Canvas workflow stage").selectOption("publish");
  await expect(page.getByText("Add one concrete source.")).toBeVisible();
  await page.getByRole("button", { name: /Accept|接受/ }).click();

  await expect.poll(async () => {
    const state = await fetchCanvasState(page);
    return state.canvasNodes.find((node) => node.id === nodeId)?.content;
  }).toContain("Add one concrete source.");

  const finalState = await fetchCanvasState(page);
  expect(finalState.canvasNodes.find((node) => node.id === nodeId)?.metadata?.workflow?.roles).toBeUndefined();
});

test("canvas can connect nodes, delete an edge, and draft a mind chain", async ({ page }) => {
  await openNewCanvas(page);
  const viewport = page.getByTestId("canvas-viewport");
  await viewport.click({ button: "right", position: { x: 180, y: 180 } });
  await page.getByTestId("canvas-menu-create-note").click();
  await expect(page.getByTestId("canvas-node")).toHaveCount(1);
  for (let index = 0; index < 4; index += 1) {
    await page.getByRole("button", { name: "Zoom out" }).click();
  }
  await viewport.click({ button: "right", position: { x: 100, y: 250 } });
  await page.getByTestId("canvas-menu-create-reference").click();
  await expect(page.getByTestId("canvas-node")).toHaveCount(2);
  const threadId = await getCurrentThreadId(page);
  await expect.poll(async () => (await fetchCanvasState(page)).canvasNodes.length).toBe(2);
  const initialState = await fetchCanvasState(page);
  const [sourceNode, targetNode] = initialState.canvasNodes;
  const sourceResponse = await page.request.patch(`/api/threads/${threadId}/canvas/nodes/${sourceNode.id}`, {
    data: { title: "Chain start", content: "First chain item" }
  });
  const targetResponse = await page.request.patch(`/api/threads/${threadId}/canvas/nodes/${targetNode.id}`, {
    data: { title: "Chain end", content: "Second chain item" }
  });
  expect(sourceResponse.ok()).toBeTruthy();
  expect(targetResponse.ok()).toBeTruthy();
  const edgeResponse = await page.request.post(`/api/threads/${threadId}/canvas/edges`, {
    data: { sourceNodeId: sourceNode.id, targetNodeId: targetNode.id }
  });
  expect(edgeResponse.ok()).toBeTruthy();
  await page.getByLabel("Canvas workflow stage").selectOption("publish");

  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  await page.getByTestId("canvas-node").first().click({ button: "right", position: { x: 36, y: 72 } });
  await page.getByText(sendMindChainName).click();
  await expect(page.getByTestId("ai-collaboration-input")).toHaveValue("");
  await expect(page.getByTestId("mind-chain-context-chip")).toContainText(/Mind chain \u00b7 2 nodes|\u601d\u7ef4\u94fe \u00b7 2 \u8282\u70b9/);
  const composerInput = page.getByTestId("ai-collaboration-input");
  const resizeHandle = page.getByTestId("composer-resize-handle");
  await expect(resizeHandle).toBeVisible();
  const inputBeforeResize = await composerInput.boundingBox();
  const handleBox = await resizeHandle.boundingBox();
  expect(inputBeforeResize).toBeTruthy();
  expect(handleBox).toBeTruthy();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y - 80);
  await page.mouse.up();
  const inputAfterResize = await composerInput.boundingBox();
  expect(inputAfterResize?.height).toBeGreaterThan(inputBeforeResize!.height + 60);
  await expect(composerInput).toHaveCSS("resize", "none");
  await expect(page.getByTestId("ai-collaboration-input")).toHaveCSS("max-height", "240px");
  await page.getByRole("button", { name: /Remove mind chain context|\u79fb\u9664\u601d\u7ef4\u94fe\u4e0a\u4e0b\u6587/ }).click();
  await expect(page.getByTestId("mind-chain-context-chip")).toHaveCount(0);

  await page.getByTestId("canvas-node").first().click({ button: "right" });
  await page.getByText(sendMindChainName).click();
  await expect(page.getByTestId("mind-chain-context-chip")).toContainText(/Mind chain \u00b7 2 nodes|\u601d\u7ef4\u94fe \u00b7 2 \u8282\u70b9/);
  let sentPayload: { chatInstruction?: string; contextValues?: Record<string, unknown> } | undefined;
  await page.route("**/api/generate/stream", async (route) => {
    sentPayload = route.request().postDataJSON() as typeof sentPayload;
    await route.fulfill({
      contentType: "text/event-stream",
      body: `event: final\ndata: ${JSON.stringify({ text: "Done", prompt: "", provider: "mock", usedMock: false, threadId })}\n\n`
    });
  });
  await page.getByTestId("ai-collaboration-input").fill("Use this chain");
  await page.getByRole("button", { name: /Send|\u53d1\u9001/ }).click();
  await expect(page.getByTestId("mind-chain-context-chip")).toHaveCount(0);
  expect(sentPayload?.chatInstruction).toBe("Use this chain");
  expect(String(sentPayload?.contextValues?.canvasMindChain)).toContain("First chain item");
  expect(String(sentPayload?.contextValues?.canvasMindChain)).toContain("Second chain item");
  await expect(page.locator(".message-user").last()).toContainText("Use this chain");

  await page.getByTestId("canvas-node").first().click({ button: "right" });
  await page.getByText(sendMindChainName).click();
  await expect(page.getByTestId("mind-chain-context-chip")).toContainText(/Mind chain \u00b7 2 nodes|\u601d\u7ef4\u94fe \u00b7 2 \u8282\u70b9/);

  await page.locator(".react-flow__edge").evaluate((edge) => {
    edge.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  });
  await page.getByTestId("canvas-delete-edge").click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);

  await page.getByTestId("canvas-node").first().click({ button: "right" });
  await page.getByText(sendMindChainName).click();
  await expect(page.getByTestId("ai-collaboration-input")).toHaveValue("");
  await expect(page.getByTestId("mind-chain-context-chip")).toContainText(/Mind chain \u00b7 1 node|\u601d\u7ef4\u94fe \u00b7 1 \u8282\u70b9/);
});

test("external plain text paste creates editable free text and conversion undoes as one action", async ({ page }) => {
  await openNewCanvas(page);
  const viewport = page.getByTestId("canvas-viewport");
  await page.getByTestId("board-other-tools").getByRole("button", { name: "Text", exact: true }).click();
  const box = await viewport.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + 420, box!.y + 300);
  await expect(page.getByTestId("canvas-creation-preview")).toBeVisible();
  await viewport.click({ position: { x: 420, y: 300 } });
  await expect(page.getByTestId("canvas-object-text")).toHaveCount(1);
  await page.locator(".canvas-free-text-editor").fill("temporary");
  await page.locator(".canvas-free-text-editor").blur();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("canvas-object-text")).toHaveCount(0);
  await viewport.click({ position: { x: 420, y: 320 } });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "Pasted line one\nPasted line two");
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    document.body.dispatchEvent(event);
  });

  await expect.poll(async () => (await fetchCanvasState(page)).canvasObjects?.map((object) => object.kind)).toContain("text");
  await expect(page.getByTestId("canvas-object-text")).toHaveCount(1);
  await expect(page.locator(".canvas-free-text-editor")).toBeVisible();
  await page.locator(".canvas-free-text-editor").blur();
  await page.getByTestId("canvas-object-text").click();
  await expect(page.locator(".canvas-free-text-menu")).toBeVisible();
  await page.getByRole("button", { name: "To reference" }).click();
  await expect(page.getByTestId("canvas-node")).toHaveCount(1);
  await expect(page.getByTestId("canvas-object-text")).toHaveCount(0);

  await page.getByRole("button", { name: undoButtonName }).click();
  await expect(page.getByTestId("canvas-node")).toHaveCount(0);
  await expect(page.getByTestId("canvas-object-text")).toContainText("Pasted line one");
});
