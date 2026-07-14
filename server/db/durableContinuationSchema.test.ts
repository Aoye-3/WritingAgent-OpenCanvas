import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { migrateStorageSchema } from "./schema.js";

test("schema version 19 creates durable task continuations without historical backfill", () => {
  const db = new DatabaseSync(":memory:");
  migrateStorageSchema(db);

  const versions = db.prepare("SELECT version FROM schema_version ORDER BY version").all() as Array<{ version: number }>;
  assert.equal(versions.some(({ version }) => version === 19), true);

  const columns = db.prepare("PRAGMA table_info(durable_task_continuations)").all() as Array<{ name: string }>;
  assert.deepEqual(columns.map(({ name }) => name), [
    "thread_id",
    "source_run_id",
    "state",
    "descriptor_json",
    "attempts",
    "claim_token",
    "claimed_at",
    "last_error",
    "created_at",
    "updated_at"
  ]);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM durable_task_continuations").get()!.count, 0);
});
