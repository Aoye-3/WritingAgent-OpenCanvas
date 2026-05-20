import type { ToolRef } from "../agents/types";
import type { AgentBackendConfigOverview, AgentBackendRuntimeStatus } from "../settings/types";

export type AgentBackendToolBridgeStatus = {
  name: ToolRef;
  label: string;
  bridgeState: "agent_backend_builtin" | "facetwrite_bridge" | "pending_bridge" | "control_plane";
  target: string;
  executionBoundary: string;
  approvalBoundary?: string;
};

export type AgentBackendAgentMapping = {
  agentCardId: string;
  title: string;
  subagent: {
    name: string;
    description: string;
    systemPrompt: string;
    tools: ToolRef[];
    skills: string[];
    model: "inherit";
    maxTurns: number;
    timeoutSeconds: number;
  };
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
