import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("assistant runtime state renders in a loop panel instead of driving the message bubble", () => {
  const source = readFileSync("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");

  assert.match(source, /hasRunTrace/);
  assert.match(source, /hasReasoningText/);
  assert.match(source, /hasProgressSegments/);
  assert.match(source, /hasRuntimePanel/);
  assert.match(source, /<AgentLoopRunPanel/);
  assert.match(source, /<div className="agent-loop-message-frame" key=\{message\.id\}>\s*\{runtimePanel\}\s*<article className=\{`message message-\$\{message\.role\}/);
  assert.match(source, /usesThinkingStatus/);
  assert.match(source, /usesThinkingStatus = isPendingAssistant && !hasRunTrace && !hasReasoningText && !hasProgressSegments/);
  assert.doesNotMatch(source, /className=\{isPendingAssistant \? "message-thinking-status" : "message-bubble"\}/);
});

test("loop panel keeps L2 progress and L3 raw logs separate from final answer text", () => {
  const source = readFileSync("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");

  assert.match(
    source,
    /function AgentLoopRunPanel[\s\S]*<CompletionVerdictSummary[\s\S]*progressSegments\.length \? \(\s*<ProgressSegmentList[\s\S]*\) : \(\s*<>\s*<AssistantRunTrace[\s\S]*<ReasoningStreamPanel message=\{message\} \/>[\s\S]*<RawRunLogDetails/,
  );
  assert.match(source, /<MarkdownText text=\{message\.text\}/);
});
