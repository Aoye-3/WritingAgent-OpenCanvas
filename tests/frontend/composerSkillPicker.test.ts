import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("composer skill picker uses the public skill catalog and transient request context", () => {
  const source = readFileSync("src/features/workspace/components/AICollaborationDrawer.tsx", "utf8");

  assert.match(source, /fetchSkillCatalog/);
  assert.match(source, /selectedSkillRefs/);
  assert.match(source, /transientSkillRefs/);
  assert.match(source, /setSelectedSkillRefs\(\[\]\)/);
  assert.match(source, /SkillPickerMenu/);
});
