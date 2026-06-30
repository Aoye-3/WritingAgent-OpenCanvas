import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("pending assistant messages with run trace use a normal bubble layout", () => {
  const source = readFileSync("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");

  assert.match(source, /hasRunTrace/);
  assert.match(source, /hasReasoningText/);
  assert.match(source, /hasProgressSegments/);
  assert.match(source, /usesThinkingStatus/);
  assert.match(source, /usesThinkingStatus = isPendingAssistant && !hasRunTrace && !hasReasoningText && !hasProgressSegments/);
  assert.doesNotMatch(source, /className=\{isPendingAssistant \? "message-thinking-status" : "message-bubble"\}/);
});

test("pending assistant messages render streamed reasoning before answer text starts", () => {
  const source = readFileSync("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");

  assert.match(
    source,
    /hasProgressSegments \? \(\s*<>\s*<ProgressSegmentList[\s\S]*?<StreamingStatus[\s\S]*?\) : \(\s*<>\s*<AssistantRunTrace[\s\S]*?<ReasoningStreamPanel message=\{message\} \/>[\s\S]*?<StreamingStatus/,
  );
});
