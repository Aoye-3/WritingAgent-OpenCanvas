import assert from "node:assert/strict";
import test from "node:test";
import { sendWindowStage } from "./window-status.mjs";

test("sends a stage to a live window", () => {
  const messages = [];
  const window = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (...message) => messages.push(message),
    },
  };

  assert.equal(sendWindowStage(window, "ready"), true);
  assert.deepEqual(messages, [["shell:stage", { stage: "ready", message: undefined }]]);
});

test("does not send to a destroyed window", () => {
  const window = {
    isDestroyed: () => true,
    webContents: {
      isDestroyed: () => false,
      send: () => assert.fail("send should not be called"),
    },
  };

  assert.equal(sendWindowStage(window, "stopping"), false);
});
