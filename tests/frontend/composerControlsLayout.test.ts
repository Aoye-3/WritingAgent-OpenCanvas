import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("composer moves thinking control out of the bottom tool row", () => {
  const source = readFileSync("src/features/workspace/components/AIComposer.tsx", "utf8");

  assert.match(source, /ThinkingModeButton/);
  assert.doesNotMatch(source, /composer-think-controls/);
  assert.doesNotMatch(source, /composer-effort-select/);
});

test("thinking mode button offers disabled, high, and max choices", () => {
  const source = readFileSync("src/features/workspace/components/AIComposer.tsx", "utf8");
  const styles = readFileSync("src/app/styles.css", "utf8");

  assert.match(source, /LightbulbIcon/);
  assert.match(source, /className=\{choice === "disabled" \? "thinking-mode-button" : "thinking-mode-button is-active"\}/);
  assert.match(source, /<div className="thinking-mode-control">/);
  assert.match(source, /<div className="thinking-mode-menu" role="menu">/);
  assert.doesNotMatch(source, /thinking-mode-trigger/);
  assert.doesNotMatch(source, /thinking-mode-options/);
  assert.match(styles, /\.thinking-mode-button span svg/);
  assert.match(source, /\["disabled", "high", "max"\]/);
});

test("composer keeps skill and plan controls as accessible icon buttons", () => {
  const source = readFileSync("src/features/workspace/components/AIComposer.tsx", "utf8");

  assert.match(source, /aria-label=\{skillText\(locale, "skills"\)\}/);
  assert.match(source, /aria-haspopup="dialog"/);
  assert.match(source, /<SkillPickerDialog/);
  assert.match(source, /aria-label=\{t\("workspace\.createTaskPlan"\)\}/);
  assert.match(source, /<ModelConfigIcon aria-hidden="true" size=\{15\} \/>/);
  assert.doesNotMatch(source, /composer-skill-menu/);
  assert.doesNotMatch(source, />Plan<\/button>/);
  assert.doesNotMatch(source, /<span>Skill<\/span>/);
});

test("composer keeps model selection available as a compact select", () => {
  const source = readFileSync("src/features/workspace/components/AIComposer.tsx", "utf8");
  const styles = readFileSync("src/app/styles.css", "utf8");

  assert.match(source, /className="composer-model-select"/);
  assert.match(source, /aria-label=\{t\("workspace\.conversationModel"\)\}/);
  assert.match(styles, /\.view-workspace \.chat-send-icon \{\s*flex: 0 0 34px;\s*margin-left: auto;/);
});

test("running composer switches between stop and queued send based on typed text", () => {
  const source = readFileSync("src/features/workspace/components/AIComposer.tsx", "utf8");

  assert.match(source, /function shouldShowStopControl\(isSending: boolean, input: string\)/);
  assert.match(source, /const showStopControl = shouldShowStopControl\(isSending, value\);/);
  assert.match(source, /type=\{showStopControl \? "button" : "submit"\}/);
  assert.match(source, /onClick=\{showStopControl \? onStopSending : undefined\}/);
});
