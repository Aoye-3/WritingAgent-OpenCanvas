import type { AgentRuntimeAdapter } from "../agentRuntimeAdapter.js";
import { toolCatalog, type ToolRef } from "../tools/catalog.js";
import { buildDeerFlowSubagentConfig, type DeerFlowSubagentConfig } from "./taskAgentMapping.js";
import { getDeerFlowConfigOverview, type DeerFlowConfigOverview } from "./proxy.js";
import { getDeerFlowRuntimeConfig, type DeerFlowRuntimeConfig } from "./config.js";
import { getDeerFlowRuntimeStatus, type DeerFlowRuntimeStatus } from "./status.js";

export type DeerFlowToolBridgeState = "deerflow_builtin" | "facetwrite_bridge" | "pending_bridge" | "control_plane";

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
        state: "verified",
        description: "FacetWrite bridge tools are wired through the internal ToolUse endpoint, with FacetWrite approval retained for writes."
      }
    ]
  };
}

function buildToolBridgeStatus(): DeerFlowToolBridgeStatus[] {
  const definitions: Record<ToolRef, Omit<DeerFlowToolBridgeStatus, "name" | "label">> = {
    web_search: {
      bridgeState: "deerflow_builtin",
      target: "DeerFlow built-in web_search tool",
      executionBoundary: "Live search is executed by DeerFlow when the runtime sidecar is connected; FacetWrite records DeerFlow tool events."
    },
    knowledge_base: {
      bridgeState: "facetwrite_bridge",
      target: "FacetWrite internal ToolUse bridge",
      executionBoundary: "DeerFlow calls back into FacetWrite for selected workspace context while FacetWrite owns source selection."
    },
    quick_messages: {
      bridgeState: "facetwrite_bridge",
      target: "FacetWrite internal ToolUse bridge",
      executionBoundary: "DeerFlow can normalize quick editing intent through FacetWrite's controlled ToolUse bridge."
    },
    clear_context: {
      bridgeState: "facetwrite_bridge",
      target: "FacetWrite internal ToolUse bridge",
      executionBoundary: "DeerFlow can request clear-context behavior through FacetWrite's controlled ToolUse bridge."
    },
    canvas_write: {
      bridgeState: "facetwrite_bridge",
      target: "FacetWrite internal ToolUse bridge",
      executionBoundary: "DeerFlow can propose Canvas writes through FacetWrite; FacetWrite applies them only after user approval.",
      approvalBoundary: "FacetWrite pending approval"
    }
  };

  return toolCatalog.map((tool) => ({
    name: tool.name,
    label: tool.label,
    ...definitions[tool.name]
  }));
}
