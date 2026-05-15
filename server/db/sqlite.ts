import { DatabaseSync } from "node:sqlite";
import { migrateStorageSchema } from "./schema.js";

export function createFacetWriteDatabase(dbPath: string) {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrateStorageSchema(db);
  return db;
}

export function runSqliteTransaction<T>(db: DatabaseSync, work: () => T) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
