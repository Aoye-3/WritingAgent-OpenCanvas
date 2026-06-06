import { expect, test, type Page } from "@playwright/test";

const undoButtonName = /Undo|撤销|鎾ら攢/;
const sendMindChainName = /Send mind chain|发送思维链|鍙戦€佹€濈淮閾?/;

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
};

async function openNewCanvas(page: Page) {
  await page.goto("/");
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
  await viewport.click({ position: { x: 420, y: 300 } });
  await expect(page.getByTestId("canvas-object-shape")).toHaveCount(1);

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

  await page.getByTestId("canvas-node-title").first().fill("Persistent title");
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
  await page.getByTestId("canvas-node-title").first().fill("Workflow draft");
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
  await page.getByRole("button", { name: /Accept|接受|鎺ュ彈/ }).click();

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
  await page.getByTestId("canvas-node-title").first().fill("Chain start");
  await page.getByTestId("canvas-node-content").first().fill("First chain item");
  for (let index = 0; index < 4; index += 1) {
    await page.getByRole("button", { name: "Zoom out" }).click();
  }

  await viewport.click({ button: "right", position: { x: 100, y: 250 } });
  await page.getByTestId("canvas-menu-create-reference").click();
  await page.getByTestId("canvas-node-title").last().fill("Chain end");
  await page.getByTestId("canvas-node-content").last().fill("Second chain item");
  await viewport.click();

  const threadId = await getCurrentThreadId(page);
  await expect.poll(async () => {
    const current = await fetchCanvasState(page);
    return {
      sourceNode: current.canvasNodes.find((node) => node.content === "First chain item"),
      targetNode: current.canvasNodes.find((node) => node.content === "Second chain item")
    };
  }).toMatchObject({
    sourceNode: { content: "First chain item" },
    targetNode: { content: "Second chain item" }
  });
  const state = await fetchCanvasState(page);
  const sourceNode = state.canvasNodes.find((node) => node.content === "First chain item")!;
  const targetNode = state.canvasNodes.find((node) => node.content === "Second chain item")!;
  const edgeResponse = await page.request.post(`/api/threads/${threadId}/canvas/edges`, {
    data: { sourceNodeId: sourceNode.id, targetNodeId: targetNode.id }
  });
  expect(edgeResponse.ok()).toBeTruthy();
  await page.getByLabel("Canvas workflow stage").selectOption("publish");

  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  await page.getByTestId("canvas-node").first().click({ button: "right" });
  await page.getByText(sendMindChainName).click();
  await expect(page.getByTestId("ai-collaboration-input")).toContainText("First chain item");
  await expect(page.getByTestId("ai-collaboration-input")).toContainText("Second chain item");

  await page.locator(".react-flow__edge").evaluate((edge) => {
    edge.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  });
  await page.getByTestId("canvas-delete-edge").click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);

  await page.getByTestId("ai-collaboration-input").fill("");
  await page.getByTestId("canvas-node").first().click({ button: "right" });
  await page.getByText(sendMindChainName).click();
  await expect(page.getByTestId("ai-collaboration-input")).toContainText("First chain item");
  await expect(page.getByTestId("ai-collaboration-input")).not.toContainText("Second chain item");
});
