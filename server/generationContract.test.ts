import test from "node:test";
import assert from "node:assert/strict";
import { parseGenerateRequest } from "./contracts/generation.js";

test("parseGenerateRequest normalizes transient skill refs", () => {
  const request = parseGenerateRequest({
    mode: "chat",
    locale: "en",
    transientSkillRefs: [" summary ", "", "summary", 42, "rewrite-polish"]
  });

  assert.deepEqual(request.transientSkillRefs, ["summary", "rewrite-polish"]);
});

test("parseGenerateRequest omits transient skill refs when none are valid", () => {
  const request = parseGenerateRequest({
    mode: "chat",
    locale: "en",
    transientSkillRefs: ["", 42, null]
  });

  assert.equal(request.transientSkillRefs, undefined);
});
