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
      range_start INTEGER,
      range_end INTEGER,
      original_text TEXT,
      base_node_updated_at TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS canvas_edges (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      source_node_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS canvas_objects (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      geometry_json TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plan_runs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, thread_id TEXT NOT NULL, run_id TEXT,
      title TEXT NOT NULL, goal TEXT NOT NULL, status TEXT NOT NULL, approval TEXT NOT NULL,
      status_message TEXT NOT NULL, clarification_json TEXT NOT NULL DEFAULT '{}',
      origin TEXT, complexity_json TEXT NOT NULL DEFAULT '{}', budget_json TEXT NOT NULL DEFAULT '{}',
      preflight_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plan_steps (
      id TEXT NOT NULL, plan_run_id TEXT NOT NULL, step_order INTEGER NOT NULL, title TEXT NOT NULL,
      detail TEXT NOT NULL, status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
      started_at TEXT, completed_at TEXT, error TEXT, PRIMARY KEY(plan_run_id, id)
    );
    CREATE TABLE IF NOT EXISTS plan_artifacts (
      id TEXT NOT NULL, plan_run_id TEXT NOT NULL, step_id TEXT NOT NULL, type TEXT NOT NULL,
      status TEXT NOT NULL, title TEXT NOT NULL, payload_json TEXT NOT NULL, source_json TEXT NOT NULL,
      canvas_target_id TEXT, layout_json TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, PRIMARY KEY(plan_run_id, id)
    );
    CREATE TABLE IF NOT EXISTS plan_artifact_links (
      id TEXT NOT NULL, plan_run_id TEXT NOT NULL, from_artifact_id TEXT NOT NULL,
      to_artifact_id TEXT NOT NULL, label TEXT NOT NULL, canvas_edge_id TEXT,
      PRIMARY KEY(plan_run_id, id)
    );

    CREATE TABLE IF NOT EXISTS canvas_workflows (
      thread_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'batch_delivery',
      stage TEXT NOT NULL,
      roles_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS canvas_workflow_suggestions (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      role_node_id TEXT NOT NULL DEFAULT '',
      target_node_id TEXT NOT NULL DEFAULT '',
      role_id TEXT NOT NULL,
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
      embedding_config_id TEXT,
      embedding_provider TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      embedding_base_url TEXT NOT NULL,
      dimensions INTEGER,
      chunk_size INTEGER NOT NULL,
      chunk_overlap INTEGER NOT NULL,
      document_count INTEGER NOT NULL,
      threshold REAL NOT NULL,
      rerank_enabled INTEGER NOT NULL DEFAULT 0,
      rerank_config_id TEXT,
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
  if (!columnExists(db, "knowledge_bases", "embedding_config_id")) {
    db.exec(`ALTER TABLE knowledge_bases ADD COLUMN embedding_config_id TEXT`);
  }
  if (!columnExists(db, "knowledge_bases", "rerank_config_id")) {
    db.exec(`ALTER TABLE knowledge_bases ADD COLUMN rerank_config_id TEXT`);
  }
  if (!columnExists(db, "canvas_workflow_suggestions", "role_node_id")) {
    db.exec(`ALTER TABLE canvas_workflow_suggestions ADD COLUMN role_node_id TEXT NOT NULL DEFAULT ''`);
  }
  if (!columnExists(db, "canvas_workflows", "mode")) {
    db.exec(`ALTER TABLE canvas_workflows ADD COLUMN mode TEXT NOT NULL DEFAULT 'batch_delivery'`);
  }
  if (!columnExists(db, "canvas_workflow_suggestions", "target_node_id")) {
    db.exec(`ALTER TABLE canvas_workflow_suggestions ADD COLUMN target_node_id TEXT NOT NULL DEFAULT ''`);
  }
  if (!columnExists(db, "canvas_write_requests", "range_start")) {
    db.exec(`ALTER TABLE canvas_write_requests ADD COLUMN range_start INTEGER`);
  }
  if (!columnExists(db, "canvas_write_requests", "range_end")) {
    db.exec(`ALTER TABLE canvas_write_requests ADD COLUMN range_end INTEGER`);
  }
  if (!columnExists(db, "canvas_write_requests", "original_text")) {
    db.exec(`ALTER TABLE canvas_write_requests ADD COLUMN original_text TEXT`);
  }
  if (!columnExists(db, "canvas_write_requests", "base_node_updated_at")) {
    db.exec(`ALTER TABLE canvas_write_requests ADD COLUMN base_node_updated_at TEXT`);
  }
  if (!columnExists(db, "projects", "summary")) {
    db.exec(`ALTER TABLE projects ADD COLUMN summary TEXT NOT NULL DEFAULT ''`);
  }
  if (!columnExists(db, "projects", "deleted_at")) {
    db.exec(`ALTER TABLE projects ADD COLUMN deleted_at TEXT`);
  }
  if (!columnExists(db, "threads", "configured_model_api_id")) {
    db.exec(`ALTER TABLE threads ADD COLUMN configured_model_api_id TEXT`);
  }
  if (!columnExists(db, "threads", "context_reset_at")) {
    db.exec(`ALTER TABLE threads ADD COLUMN context_reset_at TEXT`);
  }
  if (!columnExists(db, "runs", "configured_model_api_id")) {
    db.exec(`ALTER TABLE runs ADD COLUMN configured_model_api_id TEXT`);
  }
  if (!columnExists(db, "runs", "model_id")) {
    db.exec(`ALTER TABLE runs ADD COLUMN model_id TEXT`);
  }
  if (!columnExists(db, "runs", "client_request_id")) {
    db.exec(`ALTER TABLE runs ADD COLUMN client_request_id TEXT`);
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_thread_client_request ON runs(thread_id, client_request_id) WHERE client_request_id IS NOT NULL`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_model_bindings (
      project_id TEXT NOT NULL,
      configured_model_api_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, configured_model_api_id)
    );

    CREATE TABLE IF NOT EXISTS project_agent_inputs (
      project_id TEXT NOT NULL,
      agent_card_id TEXT NOT NULL,
      structured_values_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, agent_card_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_runtime_settings (
      project_id TEXT PRIMARY KEY,
      runtime_budget_profile TEXT NOT NULL,
      evidence_tool_limit INTEGER NOT NULL,
      body_draft_write_limit INTEGER NOT NULL,
      model_call_limit INTEGER NOT NULL,
      recursion_limit INTEGER NOT NULL,
      synthesis_reserve_steps INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const version2 = db.prepare(`SELECT version FROM schema_version WHERE version = 2`).get();
  if (!version2) {
    db.exec(`
      DELETE FROM canvas_edges;
      DELETE FROM canvas_objects;
      DELETE FROM canvas_workflow_suggestions;
      DELETE FROM canvas_workflows;
      DELETE FROM canvas_write_requests;
      DELETE FROM canvas_nodes;
      DELETE FROM thread_inputs;
      DELETE FROM project_agent_inputs;
      DELETE FROM project_model_bindings;
      DELETE FROM tool_events;
      DELETE FROM output_versions;
      DELETE FROM prompt_versions;
      DELETE FROM runs;
      DELETE FROM messages;
      DELETE FROM threads;
      DELETE FROM projects;
      INSERT INTO schema_version (version, applied_at) VALUES (2, datetime('now'));
    `);
  }

  const version3 = db.prepare(`SELECT version FROM schema_version WHERE version = 3`).get();
  if (!version3) {
    db.exec(`
      DELETE FROM tool_events;
      DELETE FROM output_versions;
      DELETE FROM prompt_versions;
      DELETE FROM runs;
      DELETE FROM messages;
      DELETE FROM threads;
      DELETE FROM projects;

      DROP TABLE IF EXISTS thread_inputs;
      DROP TABLE IF EXISTS canvas_edges;
      DROP TABLE IF EXISTS canvas_objects;
      DROP TABLE IF EXISTS canvas_workflow_suggestions;
      DROP TABLE IF EXISTS canvas_workflows;
      DROP TABLE IF EXISTS canvas_write_requests;
      DROP TABLE IF EXISTS canvas_nodes;

      CREATE TABLE canvas_nodes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        width REAL NOT NULL,
        height REAL NOT NULL,
        metadata_json TEXT NOT NULL,
        include_in_project_context INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE canvas_write_requests (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        target_node_id TEXT,
        node_kind TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        rationale TEXT NOT NULL,
        range_start INTEGER,
        range_end INTEGER,
        original_text TEXT,
        base_node_updated_at TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE canvas_edges (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_node_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE canvas_objects (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        geometry_json TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE canvas_workflows (
        project_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL DEFAULT 'batch_delivery',
        stage TEXT NOT NULL,
        roles_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE canvas_workflow_suggestions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        role_node_id TEXT NOT NULL DEFAULT '',
        target_node_id TEXT NOT NULL DEFAULT '',
        role_id TEXT NOT NULL,
        content TEXT NOT NULL,
        rationale TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      ALTER TABLE threads RENAME TO threads_v2;
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        configured_model_api_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      DROP TABLE threads_v2;

      ALTER TABLE output_versions RENAME TO output_versions_v2;
      CREATE TABLE output_versions (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        content TEXT NOT NULL,
        include_in_project_context INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      DROP TABLE output_versions_v2;

      DROP TABLE project_agent_inputs;
      CREATE TABLE project_agent_inputs (
        project_id TEXT NOT NULL,
        agent_card_id TEXT NOT NULL,
        structured_values_json TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, agent_card_id)
      );

      INSERT INTO schema_version (version, applied_at) VALUES (3, datetime('now'));
    `);
  }

  const version4 = db.prepare(`SELECT version FROM schema_version WHERE version = 4`).get();
  if (!version4) {
    if (!columnExists(db, "threads", "context_reset_at")) {
      db.exec(`ALTER TABLE threads ADD COLUMN context_reset_at TEXT`);
    }
    db.exec(`INSERT INTO schema_version (version, applied_at) VALUES (4, datetime('now'))`);
  }

  const version5 = db.prepare(`SELECT version FROM schema_version WHERE version = 5`).get();
  if (!version5) {
    db.exec(`
      ALTER TABLE plan_artifact_links RENAME TO plan_artifact_links_v4;
      CREATE TABLE plan_artifact_links (
        id TEXT NOT NULL, plan_run_id TEXT NOT NULL, from_artifact_id TEXT NOT NULL,
        to_artifact_id TEXT NOT NULL, label TEXT NOT NULL, canvas_edge_id TEXT,
        PRIMARY KEY(plan_run_id, id)
      );
      INSERT OR IGNORE INTO plan_artifact_links SELECT id, plan_run_id, from_artifact_id, to_artifact_id, label, canvas_edge_id FROM plan_artifact_links_v4;
      DROP TABLE plan_artifact_links_v4;
      INSERT INTO schema_version (version, applied_at) VALUES (5, datetime('now'));
    `);
  }

  const version6 = db.prepare(`SELECT version FROM schema_version WHERE version = 6`).get();
  if (!version6) {
    if (!columnExists(db, "plan_runs", "clarification_json")) {
      db.exec(`ALTER TABLE plan_runs ADD COLUMN clarification_json TEXT NOT NULL DEFAULT '{}'`);
    }
    db.exec(`INSERT INTO schema_version (version, applied_at) VALUES (6, datetime('now'))`);
  }

  const version7 = db.prepare(`SELECT version FROM schema_version WHERE version = 7`).get();
  if (!version7) {
    if (!columnExists(db, "plan_runs", "canvas_node_id")) {
      db.exec(`ALTER TABLE plan_runs ADD COLUMN canvas_node_id TEXT`);
    }
    if (!columnExists(db, "plan_runs", "current_step_id")) {
      db.exec(`ALTER TABLE plan_runs ADD COLUMN current_step_id TEXT`);
    }
    if (!columnExists(db, "plan_runs", "execution_version")) {
      db.exec(`ALTER TABLE plan_runs ADD COLUMN execution_version INTEGER NOT NULL DEFAULT 0`);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS plan_executions (
        plan_run_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, status TEXT NOT NULL,
        current_step_id TEXT, lease_owner TEXT, cancel_token TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL, paused_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS run_activities (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, plan_run_id TEXT NOT NULL, run_id TEXT, step_id TEXT,
        activity_type TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL, detail_json TEXT NOT NULL,
        sequence INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_run_activities_plan_sequence ON run_activities(plan_run_id, sequence);
      INSERT INTO schema_version (version, applied_at) VALUES (7, datetime('now'));
    `);
  }

  const version8 = db.prepare(`SELECT version FROM schema_version WHERE version = 8`).get();
  if (!version8) {
    db.exec(`
      UPDATE canvas_write_requests
      SET project_id = (SELECT threads.project_id FROM threads WHERE threads.id = canvas_write_requests.project_id),
          status = CASE
            WHEN status = 'pending' AND operation IN ('create', 'append') THEN 'stale'
            ELSE status
          END,
          updated_at = datetime('now')
      WHERE EXISTS (SELECT 1 FROM threads WHERE threads.id = canvas_write_requests.project_id);
      INSERT INTO schema_version (version, applied_at) VALUES (8, datetime('now'));
    `);
  }

  const version9 = db.prepare(`SELECT version FROM schema_version WHERE version = 9`).get();
  if (!version9) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS plan_executions (
        plan_run_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, status TEXT NOT NULL,
        current_step_id TEXT, lease_owner TEXT, lease_expires_at TEXT, last_heartbeat_at TEXT,
        cancel_token TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL, paused_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL
      );
    `);
    if (!columnExists(db, "plan_executions", "lease_expires_at")) db.exec(`ALTER TABLE plan_executions ADD COLUMN lease_expires_at TEXT`);
    if (!columnExists(db, "plan_executions", "last_heartbeat_at")) db.exec(`ALTER TABLE plan_executions ADD COLUMN last_heartbeat_at TEXT`);
    db.exec(`INSERT INTO schema_version (version, applied_at) VALUES (9, datetime('now'))`);
  }

  const version10 = db.prepare(`SELECT version FROM schema_version WHERE version = 10`).get();
  if (!version10) {
    if (tableExists(db, "run_activities")) {
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_run_activities_plan_sequence_unique ON run_activities(plan_run_id, sequence)`);
    }
    db.exec(`INSERT INTO schema_version (version, applied_at) VALUES (10, datetime('now'))`);
  }

  const version11 = db.prepare(`SELECT version FROM schema_version WHERE version = 11`).get();
  if (!version11) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS canvas_write_suggestions (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, project_id TEXT NOT NULL, run_id TEXT NOT NULL,
        status TEXT NOT NULL, items_json TEXT NOT NULL, node_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_canvas_write_suggestions_thread ON canvas_write_suggestions(thread_id, created_at);
      INSERT INTO schema_version (version, applied_at) VALUES (11, datetime('now'));
    `);
  }

  const version12 = db.prepare(`SELECT version FROM schema_version WHERE version = 12`).get();
  if (!version12) {
    db.exec(`
      DROP TABLE IF EXISTS project_agent_inputs;
      CREATE TABLE IF NOT EXISTS project_briefs (
        project_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS thread_task_briefs (
        thread_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      INSERT INTO schema_version (version, applied_at) VALUES (12, datetime('now'));
    `);
  }

  const version13 = db.prepare(`SELECT version FROM schema_version WHERE version = 13`).get();
  if (!version13) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_clarifications (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        status TEXT NOT NULL,
        question TEXT NOT NULL,
        options_json TEXT NOT NULL,
        resume_context_json TEXT NOT NULL,
        selected_option_id TEXT,
        selected_option_label TEXT,
        answer TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_clarifications_thread_status ON agent_clarifications(thread_id, status, updated_at);
      INSERT INTO schema_version (version, applied_at) VALUES (13, datetime('now'));
    `);
  }

  const version14 = db.prepare(`SELECT version FROM schema_version WHERE version = 14`).get();
  if (!version14) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS claim_candidates (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        source_node_id TEXT NOT NULL,
        source_document_path TEXT NOT NULL,
        source_file_name TEXT NOT NULL,
        claim_text TEXT NOT NULL,
        original_claim_text TEXT,
        evidence_text TEXT NOT NULL,
        source_anchor_json TEXT NOT NULL DEFAULT '{}',
        citation_urls_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        created_by TEXT NOT NULL,
        extraction_run_id TEXT,
        canvas_node_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_claim_candidates_thread_source_status ON claim_candidates(thread_id, source_node_id, status);
      CREATE INDEX IF NOT EXISTS idx_claim_candidates_project_updated ON claim_candidates(project_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_claim_candidates_source_path ON claim_candidates(source_document_path);
      INSERT INTO schema_version (version, applied_at) VALUES (14, datetime('now'));
    `);
  }

  const version15 = db.prepare(`SELECT version FROM schema_version WHERE version = 15`).get();
  if (!version15) {
    if (!columnExists(db, "plan_runs", "origin")) {
      db.exec(`ALTER TABLE plan_runs ADD COLUMN origin TEXT`);
    }
    if (!columnExists(db, "plan_runs", "complexity_json")) {
      db.exec(`ALTER TABLE plan_runs ADD COLUMN complexity_json TEXT NOT NULL DEFAULT '{}'`);
    }
    if (!columnExists(db, "plan_runs", "budget_json")) {
      db.exec(`ALTER TABLE plan_runs ADD COLUMN budget_json TEXT NOT NULL DEFAULT '{}'`);
    }
    if (!columnExists(db, "plan_runs", "preflight_json")) {
      db.exec(`ALTER TABLE plan_runs ADD COLUMN preflight_json TEXT NOT NULL DEFAULT '{}'`);
    }
    db.exec(`INSERT INTO schema_version (version, applied_at) VALUES (15, datetime('now'))`);
  }

  const version16 = db.prepare(`SELECT version FROM schema_version WHERE version = 16`).get();
  if (!version16) {
    if (!columnExists(db, "runs", "client_request_id")) {
      db.exec(`ALTER TABLE runs ADD COLUMN client_request_id TEXT`);
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_thread_client_request ON runs(thread_id, client_request_id) WHERE client_request_id IS NOT NULL`);
    db.exec(`INSERT INTO schema_version (version, applied_at) VALUES (16, datetime('now'))`);
  }

  const version18 = db.prepare(`SELECT version FROM schema_version WHERE version = 18`).get();
  if (!version18) {
    if (!columnExists(db, "agent_clarifications", "resume_state")) {
      db.exec(`ALTER TABLE agent_clarifications ADD COLUMN resume_state TEXT NOT NULL DEFAULT 'not_resumable'`);
    }
    if (!columnExists(db, "agent_clarifications", "resume_attempts")) {
      db.exec(`ALTER TABLE agent_clarifications ADD COLUMN resume_attempts INTEGER NOT NULL DEFAULT 0`);
    }
    if (!columnExists(db, "agent_clarifications", "last_resume_error")) {
      db.exec(`ALTER TABLE agent_clarifications ADD COLUMN last_resume_error TEXT`);
    }
    if (!columnExists(db, "agent_clarifications", "resumed_runtime_run_id")) {
      db.exec(`ALTER TABLE agent_clarifications ADD COLUMN resumed_runtime_run_id TEXT`);
    }
    db.exec(`INSERT INTO schema_version (version, applied_at) VALUES (18, datetime('now'))`);
  }
}

function columnExists(db: DatabaseSync, table: string, column: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((row) => row.name === column);
}

function tableExists(db: DatabaseSync, table: string) {
  return Boolean(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table));
}
