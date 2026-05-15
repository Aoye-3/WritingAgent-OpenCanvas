import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSettingsWritePolicy } from "./settingsWritePolicy.js";

test("settings writes are disabled by default in production", () => {
  const policy = evaluateSettingsWritePolicy({ NODE_ENV: "production" });

  assert.equal(policy.allowed, false);
  assert.match(policy.reason ?? "", /production/i);
});

test("settings writes can be explicitly enabled for local runtime setup", () => {
  const policy = evaluateSettingsWritePolicy({
    NODE_ENV: "production",
    LOCAL_SETTINGS_WRITE_ENABLED: "true"
  });

  assert.equal(policy.allowed, true);
});
