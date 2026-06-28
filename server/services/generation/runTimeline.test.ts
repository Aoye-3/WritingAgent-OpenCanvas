import test from "node:test";
import assert from "node:assert/strict";
import { createRunTimelineBuilder, toolEventToTimelineEvent } from "./runTimeline.js";

test("run timeline maps safe tool events without exposing private reasoning", () => {
  const builder = createRunTimelineBuilder({ threadId: "thread_1", runId: "pending", locale: "zh" });
  const event = toolEventToTimelineEvent(builder, {
    eventType: "agent_backend_tool_started",
    payload: {
      toolName: "web_search",
      reasoning_content: "hidden chain",
      thinking: "private"
    }
  });

  assert.equal(event.eventType, "tool_started");
  assert.equal(event.title, "联网搜索");
  assert.equal(JSON.stringify(event).includes("hidden chain"), false);
  assert.equal(JSON.stringify(event).includes("private"), false);
});

test("run timeline uses monotonic sequence numbers", () => {
  const builder = createRunTimelineBuilder({ threadId: "thread_1", runId: "pending", locale: "en" });
  const first = builder.event("phase_started", "running", "Thinking", "Preparing the run");
  const second = builder.event("run_completed", "completed", "Completed", "Run completed");

  assert.deepEqual([first.sequence, second.sequence], [1, 2]);
});

test("run timeline treats committed Canvas delivery events as completed node updates", () => {
  const builder = createRunTimelineBuilder({ threadId: "thread_1", runId: "pending", locale: "en" });
  const event = toolEventToTimelineEvent(builder, {
    eventType: "canvas_delivery_body_checkpoint_committed",
    payload: {
      status: "committed",
      nodeId: "node_body",
      title: "Body",
      displayTitle: "Body draft 1",
      deliveryId: "delivery_1",
      reasoning: "hidden",
      prompt: "hidden"
    }
  });

  assert.equal(event.eventType, "canvas_node_committed");
  assert.equal(event.status, "completed");
  assert.equal(event.title, "Body draft 1");
  assert.equal(event.summary, "Body draft node updated.");
  assert.deepEqual(event.payload?.nodeId, "node_body");
  assert.deepEqual(event.payload?.deliveryId, "delivery_1");
  assert.equal(JSON.stringify(event).includes("hidden"), false);
});

test("run timeline treats Canvas synthesis as a running decision", () => {
  const builder = createRunTimelineBuilder({ threadId: "thread_1", runId: "pending", locale: "en" });
  const event = toolEventToTimelineEvent(builder, {
    eventType: "canvas_delivery_synthesis_started",
    payload: {
      status: "running",
      deliveryId: "delivery_1"
    }
  });

  assert.equal(event.eventType, "decision");
  assert.equal(event.status, "running");
  assert.equal(event.title, "Final synthesis");
});

test("run timeline keeps Canvas delivery started events running", () => {
  const builder = createRunTimelineBuilder({ threadId: "thread_1", runId: "pending", locale: "en" });
  const event = toolEventToTimelineEvent(builder, {
    eventType: "canvas_delivery_outline_started",
    payload: {
      status: "running",
      tool: "canvas_delivery",
      deliveryId: "delivery_1"
    }
  });

  assert.equal(event.eventType, "tool_started");
  assert.equal(event.status, "running");
  assert.equal(event.title, "Canvas delivery");
});

test("run timeline does not turn invalid clarification payloads into waiting choices", () => {
  const builder = createRunTimelineBuilder({ threadId: "thread_1", runId: "pending", locale: "en" });
  const event = toolEventToTimelineEvent(builder, {
    eventType: "agent_backend_agent_clarification_requested",
    payload: {
      type: "agent_clarification_requested",
      question: "Which scope?",
      options: [{ id: "only", label: "Only one" }]
    }
  });

  assert.equal(event.eventType, "tool_completed");
  assert.equal(event.status, "failed");
  assert.equal(event.payload?.eventType, "agent_backend_agent_clarification_invalid");
});

test("run timeline includes invalid clarification reason in the summary", () => {
  const builder = createRunTimelineBuilder({ threadId: "thread_1", runId: "pending", locale: "en" });
  const event = toolEventToTimelineEvent(builder, {
    eventType: "agent_backend_agent_clarification_invalid",
    payload: {
      type: "agent_clarification_invalid",
      summary: "Agent clarification payload was invalid",
      reason: "missing_options"
    }
  });

  assert.equal(event.eventType, "tool_completed");
  assert.equal(event.status, "failed");
  assert.equal(event.summary, "Agent clarification payload was invalid: missing_options");
});

test("run timeline includes Plan tool failure reason in the summary", () => {
  const builder = createRunTimelineBuilder({ threadId: "thread_1", runId: "pending", locale: "en" });
  const event = toolEventToTimelineEvent(builder, {
    eventType: "agent_backend_tool_failed",
    payload: {
      toolName: "plan_clarification_submit",
      reason: "invalid_clarification"
    }
  });

  assert.equal(event.eventType, "tool_completed");
  assert.equal(event.status, "failed");
  assert.equal(event.summary, "Plan Clarification Submit failed: invalid_clarification");
});
