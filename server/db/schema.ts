import type { DatabaseSync } from "node:sqlite";

export function migrateStorageSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      agent_card_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS thread_inputs (
      thread_id TEXT PRIMARY KEY,
      structured_values_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      used_mock INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      agent_card_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      provider TEXT NOT NULL,
      used_mock INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_cards (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_versions (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS output_versions (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_events (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_settings (
      agent_card_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quick_messages (
      id TEXT PRIMARY KEY,
      agent_card_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS canvas_nodes (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL NOT NULL,
      height REAL NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS canvas_write_requests (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      target_node_id TEXT,
      node_kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      rationale TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_bases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      embedding_provider TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      embedding_base_url TEXT NOT NULL,
      dimensions INTEGER,
      chunk_size INTEGER NOT NULL,
      chunk_overlap INTEGER NOT NULL,
      document_count INTEGER NOT NULL,
      threshold REAL NOT NULL,
      rerank_enabled INTEGER NOT NULL DEFAULT 0,
      rerank_provider TEXT,
      rerank_model TEXT,
      rerank_base_url TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_items (
      id TEXT PRIMARY KEY,
      base_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      content_text TEXT,
      unique_id TEXT,
      unique_ids_json TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_item_events (
      id TEXT PRIMARY KEY,
      base_id TEXT NOT NULL,
      item_id TEXT,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    INSERT OR IGNORE INTO projects (id, title, created_at, updated_at)
    VALUES ('local-project', 'Local Workspace', datetime('now'), datetime('now'));

    INSERT OR IGNORE INTO schema_version (version, applied_at)
    VALUES (1, datetime('now'));
  `);

  if (!columnExists(db, "threads", "deleted_at")) {
    db.exec(`ALTER TABLE threads ADD COLUMN deleted_at TEXT`);
  }
}

function columnExists(db: DatabaseSync, table: string, column: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((row) => row.name === column);
}
