import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveFacetWritePaths } from "./storagePaths.js";

test("storage paths can be isolated with FACETWRITE_APP_ROOT", () => {
  const paths = resolveFacetWritePaths(".facetwrite-test/e2e");

  assert.equal(paths.appRoot, path.resolve(process.cwd(), ".facetwrite-test/e2e"));
  assert.equal(paths.dbPath, path.resolve(process.cwd(), ".facetwrite-test/e2e/data/facetwrite.db"));
});
