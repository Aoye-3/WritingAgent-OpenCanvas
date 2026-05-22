import type { AgentRuntimeAdapter } from "../../agentRuntimeAdapter.js";
import { toolCatalog, type ToolRef } from "../../tools/catalog.js";
import { buildAgentBackendSubagentConfig, type AgentBackendSubagentConfig } from "./taskAgentMapping.js";
import { getAgentBackendConfigOverview, type AgentBackendConfigOverview } from "./proxy.js";
import { getAgentBackendRuntimeConfig, type AgentBackendRuntimeConfig } from "./config.js";
import { getAgentBackendRuntimeStatus, type AgentBackendRuntimeStatus } from "./status.js";

export type AgentBackendToolBridgeState = "agent_backend_builtin" | "facetwrite_bridge" | "pending_bridge" | "control_plane";

export type AgentBackendToolBridgeStatus = {
  name: ToolRef;
  label: string;
  bridgeState: AgentBackendToolBridgeState;
  target: string;
  executionBoundary: string;
  approvalBoundary?: string;
};

export type AgentBackendAgentMapping = {
  agentCardId: string;
  title: string;
  subagent: AgentBackendSubagentConfig;
  contractState: "active_runtime" | "mapped_metadata" | "fallback_only";
};

export type AgentBackendDashboard = {
  runtime: AgentBackendRuntimeStatus;
  config: AgentBackendConfigOverview;
  leadAgent: {
    assistantId: string;
    role: "agent_backend_execution_runtime";
  };
  agentMappings: AgentBackendAgentMapping[];
  toolBridgeStatus: AgentBackendToolBridgeStatus[];
  integrationMaturity: Array<{
    label: string;
    state: "connected" | "mapped" | "verified" | "pending";
    description: string;
  }>;
};

export async function getAgentBackendDashboard(input: {
  agentRuntime: AgentRuntimeAdapter;
  config?: AgentBackendRuntimeConfig;
  fetchImpl?: typeof fetch;
}): Promise<AgentBackendDashboard> {
  const config = input.config ?? getAgentBackendRuntimeConfig();
  const [runtime, configOverview] = await Promise.all([
    getAgentBackendRuntimeStatus({ config, fetchImpl: input.fetchImpl }),
    getAgentBackendConfigOverview({ config, fetchImpl: input.fetchImpl })
  ]);

  return {
    runtime,
    config: configOverview,
    leadAgent: {
      assistantId: runtime.assistantId,
      role: "agent_backend_execution_runtime"
    },
    agentMappings: input.agentRuntime.listAgentCards().map((card) => ({
      agentCardId: card.id,
      title: card.title.en,
      subagent: buildAgentBackendSubagentConfig(card, card.settings),
      contractState: runtime.runtimeProvider === "agent-backend" && runtime.reachable ? "mapped_metadata" : "fallback_only"
    })),
    toolBridgeStatus: buildToolBridgeStatus(),
    integrationMaturity: [
      {
        label: "Runtime sidecar",
        state: runtime.reachable ? "connected" : "pending",
        description: runtime.reachable ? "AgentBackend sidecar is reachable through FacetWrite." : "FacetWrite is using fallback runtime behavior."
      },
      {
        label: "Backend auth session",
        state: runtime.authState === "authenticated" ? "verified" : "pending",
        description: runtime.authState === "authenticated" ? "FacetWrite can access protected AgentBackend APIs server-side." : "Protected AgentBackend APIs need setup or login."
      },
      {
        label: "Agent mapping",
        state: "mapped",
        description: "FacetWrite AgentCards are mapped to AgentBackend subagent metadata."
      },
      {
        label: "ToolUse bridge",
        state: "verified",
        description: "FacetWrite bridge tools are wired through the internal ToolUse endpoint, with FacetWrite approval retained for writes."
      }
    ]
  };
}

function buildToolBridgeStatus(): AgentBackendToolBridgeStatus[] {
  const definitions: Record<ToolRef, Omit<AgentBackendToolBridgeStatus, "name" | "label">> = {
    web_search: {
      bridgeState: "agent_backend_builtin",
      target: "AgentBackend built-in web_search tool",
      executionBoundary: "Live search is executed by AgentBackend when the runtime sidecar is connected; FacetWrite records AgentBackend tool events."
    },
    knowledge_base: {
      bridgeState: "facetwrite_bridge",
      target: "FacetWrite internal ToolUse bridge",
      executionBoundary: "AgentBackend calls back into FacetWrite for selected workspace context while FacetWrite owns source selection."
    },
    quick_messages: {
      bridgeState: "facetwrite_bridge",
      target: "FacetWrite internal ToolUse bridge",
      executionBoundary: "AgentBackend can normalize quick editing intent through FacetWrite's controlled ToolUse bridge."
    },
    clear_context: {
      bridgeState: "facetwrite_bridge",
      target: "FacetWrite internal ToolUse bridge",
      executionBoundary: "AgentBackend can request clear-context behavior through FacetWrite's controlled ToolUse bridge."
    },
    canvas_write: {
      bridgeState: "facetwrite_bridge",
      target: "FacetWrite internal ToolUse bridge",
      executionBoundary: "AgentBackend can propose Canvas writes through FacetWrite; FacetWrite applies them only after user approval.",
      approvalBoundary: "FacetWrite pending approval"
    }
  };

  return toolCatalog.map((tool) => ({
    name: tool.name,
    label: tool.label,
    ...definitions[tool.name]
  }));
}
