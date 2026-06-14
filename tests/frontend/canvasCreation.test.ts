import assert from "node:assert/strict";
import test from "node:test";
import {
  createCanvasNodeDraft,
  getCanvasCreationSize,
  pointToCenteredOrigin,
} from "../../src/features/workspace/components/canvas/canvasCreation.js";

test("maps node tools to their persisted kinds and default sizes", () => {
  assert.deepEqual(getCanvasCreationSize("document"), { width: 640, height: 260 });
  assert.deepEqual(getCanvasCreationSize("note"), { width: 380, height: 190 });
  assert.deepEqual(getCanvasCreationSize("reference"), { width: 420, height: 190 });
  assert.deepEqual(getCanvasCreationSize("role"), { width: 340, height: 190 });
  assert.deepEqual(getCanvasCreationSize("shape"), { width: 220, height: 140 });
  assert.deepEqual(getCanvasCreationSize("table"), { width: 360, height: 180 });
});

test("converts a center point to the element origin", () => {
  assert.deepEqual(pointToCenteredOrigin({ x: 400, y: 300 }, { width: 300, height: 190 }), {
    x: 250,
    y: 205,
  });
});

test("creates node drafts with shared default geometry", () => {
  assert.deepEqual(createCanvasNodeDraft("reference", { x: 250, y: 205 }, "en"), {
    kind: "reference",
    title: "Reference",
    content: "",
    x: 250,
    y: 205,
    width: 420,
    height: 190,
  });

  const role = createCanvasNodeDraft("role", { x: 40, y: 60 }, "en");
  assert.match(role.metadata!.workflowRole.roleId, /^role_/);
  assert.deepEqual(role, {
    kind: "role",
    title: "role",
    content: "",
    x: 40,
    y: 60,
    width: 340,
    height: 190,
    metadata: {
      workflowRole: {
        roleId: role.metadata!.workflowRole.roleId,
        label: "Role",
        prompt: "",
      },
    },
  });
});
