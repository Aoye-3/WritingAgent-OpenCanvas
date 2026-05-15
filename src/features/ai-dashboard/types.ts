import type { ToolRef } from "../agents/types";
import type { DeerFlowConfigOverview, DeerFlowRuntimeStatus } from "../settings/types";

export type DeerFlowToolBridgeStatus = {
  name: ToolRef;
  label: string;
  bridgeState: "mapped_metadata" | "pending_bridge" | "control_plane";
  target: string;
  executionBoundary: string;
  approvalBoundary?: string;
};

export type DeerFlowAgentMapping = {
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
