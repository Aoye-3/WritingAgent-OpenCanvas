import assert from "node:assert/strict";
import test from "node:test";
import {
  CANVAS_CLIPBOARD_MIME,
  createCanvasClipboardPayload,
  placeCanvasClipboardPayload,
} from "../../shared/canvasClipboard.js";

const node = (id: string, x: number, y: number) => ({
  id,
  threadId: "thread_1",
  kind: "document" as const,
  title: id,
  content: `${id} content`,
  x,
  y,
  width: 100,
  height: 60,
  metadata: {},
  createdAt: "",
  updatedAt: "",
});

test("clipboard payload keeps nodes, free text, and only internal edges", () => {
  assert.equal(CANVAS_CLIPBOARD_MIME, "application/x-facetwrite-canvas+json");
  const payload = createCanvasClipboardPayload({
    nodes: [node("a", 10, 20), node("b", 210, 120)],
    objects: [
      { id: "text", threadId: "thread_1", kind: "text", geometry: { x: 50, y: 250, width: 320, height: 40 }, data: { text: "hello", fontSize: 16, color: "#1f2937" }, createdAt: "", updatedAt: "" },
      { id: "shape", threadId: "thread_1", kind: "shape", geometry: { x: 0, y: 0, width: 20, height: 20 }, data: { shapeId: "rectangle" }, createdAt: "", updatedAt: "" },
    ],
    edges: [
      { id: "internal", threadId: "thread_1", sourceNodeId: "a", targetNodeId: "b", label: "yes", createdAt: "", updatedAt: "" },
      { id: "external", threadId: "thread_1", sourceNodeId: "a", targetNodeId: "c", label: "no", createdAt: "", updatedAt: "" },
    ],
  });

  assert.deepEqual(payload.objects.map((object) => object.sourceId), ["text"]);
  assert.deepEqual(payload.edges, [{ sourceId: "a", targetId: "b", label: "yes" }]);
});

test("placing clipboard payload preserves relative layout around requested center", () => {
  const payload = createCanvasClipboardPayload({ nodes: [node("a", 10, 20), node("b", 210, 120)], objects: [], edges: [] });
  const placed = placeCanvasClipboardPayload(payload, { x: 500, y: 400 });
  const left = Math.min(...placed.nodes.map((item) => item.draft.x));
  const right = Math.max(...placed.nodes.map((item) => item.draft.x + item.draft.width));
  const top = Math.min(...placed.nodes.map((item) => item.draft.y));
  const bottom = Math.max(...placed.nodes.map((item) => item.draft.y + item.draft.height));
  assert.equal((left + right) / 2, 500);
  assert.equal((top + bottom) / 2, 400);
  assert.equal(placed.nodes[1].draft.x - placed.nodes[0].draft.x, 200);
  assert.equal(placed.nodes[1].draft.y - placed.nodes[0].draft.y, 100);
});
