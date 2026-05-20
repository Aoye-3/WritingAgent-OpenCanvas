import test from "node:test";
import assert from "node:assert/strict";
import { parseSseChunk } from "./sse.js";

test("parses SSE blocks with JSON payloads", () => {
  const events = parseSseChunk('event: custom\ndata: {"type":"task_started","name":"writer"}\n\nevent: messages-tuple\ndata: [{"content":"Hello"}]\n\n');

  assert.equal(events.length, 2);
  assert.deepEqual(events[0], { event: "custom", data: { type: "task_started", name: "writer" } });
  assert.deepEqual(events[1], { event: "messages-tuple", data: [{ content: "Hello" }] });
});
