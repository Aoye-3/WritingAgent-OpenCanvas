import { expect, test } from "@playwright/test";

test("canvas creates node types and supports undo", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("start-button").click();
  await page.getByTestId("home-create-board").click();
  await expect(page.getByTestId("document-canvas")).toBeVisible();

  const viewport = page.getByTestId("canvas-viewport");
  await viewport.click({ button: "right", position: { x: 180, y: 180 } });
  await page.getByTestId("canvas-menu-create-note").click();
  await expect(page.getByTestId("canvas-node")).toHaveCount(1);
  await page.getByRole("button", { name: /Undo|撤销|鎾ら攢/ }).click();
  await expect(page.getByTestId("canvas-node")).toHaveCount(0);

  await viewport.click({ button: "right", position: { x: 180, y: 180 } });
  await page.getByTestId("canvas-menu-create-document").click();
  await expect(page.getByTestId("canvas-node")).toHaveCount(1);
  await page.getByRole("button", { name: /Undo|撤销|鎾ら攢/ }).click();
  await expect(page.getByTestId("canvas-node")).toHaveCount(0);

  await viewport.click({ button: "right", position: { x: 180, y: 180 } });
  await page.getByTestId("canvas-menu-create-reference").click();
  await expect(page.getByTestId("canvas-node")).toHaveCount(1);

  await page.getByRole("button", { name: /Undo|撤销|鎾ら攢/ }).click();
  await expect(page.getByTestId("canvas-node")).toHaveCount(0);
});

test("canvas can connect nodes, delete an edge, and draft a mind chain", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("start-button").click();
  await page.getByTestId("home-create-board").click();
  await expect(page.getByTestId("document-canvas")).toBeVisible();

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
  await page.getByText(/Send mind chain|发送思维链|鍙戦€佹€濈淮閾?/).click();
  await expect(page.getByTestId("ai-collaboration-input")).toContainText(/Chain start|First chain item/);

  await page.locator(".react-flow__edge").evaluate((edge) => {
    edge.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  });
  await page.getByTestId("canvas-delete-edge").click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
});
