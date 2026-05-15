import type { AgentRuntimeAdapter } from "../agentRuntimeAdapter.js";
import { toolCatalog, type ToolRef } from "../tools/catalog.js";
import { buildDeerFlowSubagentConfig, type DeerFlowSubagentConfig } from "./taskAgentMapping.js";
import { getDeerFlowConfigOverview, type DeerFlowConfigOverview } from "./proxy.js";
import { getDeerFlowRuntimeConfig, type DeerFlowRuntimeConfig } from "./config.js";
import { getDeerFlowRuntimeStatus, type DeerFlowRuntimeStatus } from "./status.js";

export type DeerFlowToolBridgeState = "mapped_metadata" | "pending_bridge" | "control_plane";

export type DeerFlowToolBridgeStatus = {
  name: ToolRef;
  label: string;
  bridgeState: DeerFlowToolBridgeState;
  target: string;
  executionBoundary: string;
  approvalBoundary?: string;
};

export type DeerFlowAgentMapping = {
  agentCardId: string;
  title: string;
  subagent: DeerFlowSubagentConfig;
  contractState: "active_runtime" | "mapped_metadata" | "fallback_only";
};

export type DeerFlowDashboard = {
  runtime: DeerFlowRuntimeStatus;
  config: DeerFlowConfigOverview;
  leadAgent: {
    assistantId: string;
    role: "deerflow_execution_runtime";
  };
  agentMappings: DeerFlowAgentMapping[];
  toolBridgeStatus: DeerFlowToolBridgeStatus[];
  integrationMaturity: Array<{
    label: string;
    state: "connected" | "mapped" | "verified" | "pending";
    description: string;
  }>;
};

export async function getDeerFlowDashboard(input: {
  agentRuntime: AgentRuntimeAdapter;
  config?: DeerFlowRuntimeConfig;
  fetchImpl?: typeof fetch;
}): Promise<DeerFlowDashboard> {
  const config = input.config ?? getDeerFlowRuntimeConfig();
  const [runtime, configOverview] = await Promise.all([
    getDeerFlowRuntimeStatus({ config, fetchImpl: input.fetchImpl }),
    getDeerFlowConfigOverview({ config, fetchImpl: input.fetchImpl })
  ]);

  return {
    runtime,
    config: configOverview,
    leadAgent: {
      assistantId: runtime.assistantId,
      role: "deerflow_execution_runtime"
    },
    agentMappings: input.agentRuntime.listAgentCards().map((card) => ({
      agentCardId: card.id,
      title: card.title.en,
      subagent: buildDeerFlowSubagentConfig(card, card.settings),
      contractState: runtime.runtimeProvider === "deerflow" && runtime.reachable ? "mapped_metadata" : "fallback_only"
    })),
    toolBridgeStatus: buildToolBridgeStatus(),
    integrationMaturity: [
      {
        label: "Runtime sidecar",
        state: runtime.reachable ? "connected" : "pending",
        description: runtime.reachable ? "DeerFlow sidecar is reachable through FacetWrite." : "FacetWrite is using fallback runtime behavior."
      },
      {
        label: "Backend auth session",
        state: runtime.authState === "authenticated" ? "verified" : "pending",
        description: runtime.authState === "authenticated" ? "FacetWrite can access protected DeerFlow APIs server-side." : "Protected DeerFlow APIs need setup or login."
      },
      {
        label: "Agent mapping",
        state: "mapped",
        description: "FacetWrite AgentCards are mapped to DeerFlow subagent metadata."
      },
      {
        label: "ToolUse bridge",
        state: "pending",
        description: "Workspace capabilities are identified for DeerFlow Tool/MCP bridging, with FacetWrite approval retained for writes."
      }
    ]
  };
}

function buildToolBridgeStatus(): DeerFlowToolBridgeStatus[] {
  const definitions: Record<ToolRef, Omit<DeerFlowToolBridgeStatus, "name" | "label">> = {
    web_search: {
      bridgeState: "pending_bridge",
      target: "DeerFlow Tool or MCP search capability",
      executionBoundary: "Search intent is currently passed in the runtime contract; direct DeerFlow search execution is a future bridge."
    },
    knowledge_base: {
      bridgeState: "pending_bridge",
      target: "DeerFlow knowledge Tool or MCP resource",
      executionBoundary: "Workspace knowledge should become a DeerFlow-readable resource while FacetWrite owns source selection."
    },
    quick_messages: {
      bridgeState: "control_plane",
      target: "FacetWrite interaction protocol",
      executionBoundary: "Quick editing phrases shape user intent before the DeerFlow run."
    },
    clear_context: {
      bridgeState: "control_plane",
      target: "FacetWrite interaction protocol",
      executionBoundary: "Context clearing is a workspace/session control before the DeerFlow run."
    },
    canvas_write: {
      bridgeState: "pending_bridge",
      target: "DeerFlow Tool proposal with FacetWrite approval",
      executionBoundary: "DeerFlow should propose Canvas writes; FacetWrite applies them only after user approval.",
      approvalBoundary: "FacetWrite pending approval"
    }
  };

  return toolCatalog.map((tool) => ({
    name: tool.name,
    label: tool.label,
    ...definitions[tool.name]
  }));
}
