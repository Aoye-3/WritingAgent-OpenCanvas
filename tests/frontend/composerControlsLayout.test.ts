import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("composer moves thinking control out of the bottom tool row", () => {
  const source = readFileSync("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");

  assert.match(source, /ThinkingModeButton/);
  assert.doesNotMatch(source, /composer-think-controls/);
  assert.doesNotMatch(source, /composer-effort-select/);
});

test("thinking mode button offers disabled, high, and max choices", () => {
  const source = readFileSync("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");
  const styles = readFileSync("src/app/styles.css", "utf8");

  assert.match(source, /LightbulbIcon/);
  assert.doesNotMatch(source, /<span aria-hidden="true">T<\/span>/);
  assert.match(styles, /\.thinking-mode-button span svg/);
  assert.match(source, /value: "disabled"/);
  assert.match(source, /value: "high"/);
  assert.match(source, /value: "max"/);
});

test("composer keeps skill and plan controls as accessible icon buttons", () => {
  const source = readFileSync("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");

  assert.match(source, /aria-label=\{skillText\(locale, "skills"\)\}/);
  assert.match(source, /aria-label=\{t\("workspace\.createTaskPlan"\)\}/);
  assert.match(source, /<ModelConfigIcon aria-hidden="true" size=\{15\} \/>/);
  assert.doesNotMatch(source, />Plan<\/button>/);
  assert.doesNotMatch(source, /<span>Skill<\/span>/);
});

test("composer keeps model selection available as a compact select", () => {
  const source = readFileSync("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");
  const styles = readFileSync("src/app/styles.css", "utf8");

  assert.match(source, /className="composer-model-select"/);
  assert.match(source, /aria-label=\{t\("workspace\.conversationModel"\)\}/);
  assert.match(styles, /\.view-workspace \.chat-send-icon \{\s*flex: 0 0 34px;\s*margin-left: auto;/);
});
