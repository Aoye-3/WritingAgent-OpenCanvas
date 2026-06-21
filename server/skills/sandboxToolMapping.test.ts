import test from "node:test";
import assert from "node:assert/strict";
import { mapExternalToolsToSandboxTools } from "./sandboxToolMapping.js";

test("external skill tool names map to Agent Runtime sandbox tools", () => {
  assert.deepEqual(
    mapExternalToolsToSandboxTools(["Read", "Bash", "Write", "Edit", "WebFetch", "Unknown", "read"]),
    ["read_file", "bash", "write_file", "str_replace", "web_fetch"]
  );
});
