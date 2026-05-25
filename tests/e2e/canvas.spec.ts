import { expect, test, type Page } from "@playwright/test";

const undoButtonName = /Undo|撤销/;
const sendMindChainName = /Send mind chain|发送思维链/;

type CanvasState = {
  canvasNodes: Array<{
    id: string;
    kind: "document" | "note" | "reference";
    title: string;
    content: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
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

  await viewport.click({ button: "right", position: { x: 100, y: 360 } });
  await page.getByTestId("canvas-menu-create-reference").click();
  await page.getByTestId("canvas-node-title").last().fill("Chain end");
  await page.getByTestId("canvas-node-content").last().fill("Second chain item");
  await viewport.click();

  const ports = page.getByTestId("canvas-node-link-port");
  const sourceBox = await ports.first().boundingBox();
  const targetBox = await ports.last().boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 8 });
  await page.mouse.up();

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
