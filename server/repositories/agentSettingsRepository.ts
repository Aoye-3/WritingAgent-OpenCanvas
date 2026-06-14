import type { DatabaseSync } from "node:sqlite";
import type { AgentSettings } from "../agentCards.js";
import { nowIso, parseJson } from "./storageRepositoryUtils.js";

export class AgentSettingsRepository {
  constructor(private db: DatabaseSync, private withTransaction: <T>(work: () => T) => T) {}

  getAgentSettings(agentCardId: string) {
    const row = this.db.prepare(`SELECT payload_json as payloadJson FROM agent_settings WHERE agent_card_id = ?`).get(agentCardId) as { payloadJson: string } | undefined;
    return row ? parseJson(row.payloadJson) as Partial<AgentSettings> : undefined;
  }

  saveAgentSettings(agentCardId: string, settings: AgentSettings) {
    const now = nowIso();
    this.withTransaction(() => {
      this.db
        .prepare(
          `INSERT INTO agent_settings (agent_card_id, payload_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(agent_card_id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`
        )
        .run(agentCardId, JSON.stringify(settings), now);
    });
  }
}
