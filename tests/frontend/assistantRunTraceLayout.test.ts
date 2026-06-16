import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("pending assistant messages with run trace use a normal bubble layout", () => {
  const source = readFileSync("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");

  assert.match(source, /hasRunTrace/);
  assert.match(source, /hasReasoningText/);
  assert.match(source, /usesThinkingStatus/);
  assert.match(source, /usesThinkingStatus = isPendingAssistant && !hasRunTrace && !hasReasoningText/);
  assert.doesNotMatch(source, /className=\{isPendingAssistant \? "message-thinking-status" : "message-bubble"\}/);
});

test("pending assistant messages render streamed reasoning before answer text starts", () => {
  const source = readFileSync("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");

  assert.match(
    source,
    /message\.role === "assistant" && message\.isStreaming && !message\.text\.trim\(\) \? \(\s*<>\s*<AssistantRunTrace[\s\S]*?<ReasoningStreamPanel message=\{message\} \/>[\s\S]*?<StreamingStatus/,
  );
});
