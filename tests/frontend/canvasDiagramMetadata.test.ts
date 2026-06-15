import test from "node:test";
import assert from "node:assert/strict";
import { readDiagramMetadata } from "../../src/features/workspace/components/canvas/nodeLayout.js";

test("Canvas diagram metadata is recognized from node metadata", () => {
  const metadata = readDiagramMetadata({
    diagram: {
      module: "diagram_delivery",
      deliveryId: "delivery_1",
      diagramKind: "userflow",
      layout: "left-right",
      shape: "diamond",
      tone: "warning",
      sourceId: "choice"
    }
  });

  assert.deepEqual(metadata, {
    module: "diagram_delivery",
    deliveryId: "delivery_1",
    diagramKind: "userflow",
    layout: "left-right",
    shape: "diamond",
    tone: "warning",
    sourceId: "choice",
    parentId: undefined
  });
});

test("Canvas diagram metadata falls back to safe visual defaults", () => {
  const metadata = readDiagramMetadata({
    diagram: {
      module: "diagram_delivery",
      shape: "unknown",
      tone: "unknown"
    }
  });

  assert.equal(metadata?.shape, "rounded");
  assert.equal(metadata?.tone, "neutral");
});
