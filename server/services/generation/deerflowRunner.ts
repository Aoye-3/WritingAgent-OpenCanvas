import type { AgentRuntimeConfig } from "../agentDefinitionService.js";
import type { GenerateRequest } from "../../contracts/generation.js";
import { getDeerFlowRuntimeConfig, type DeerFlowRuntimeConfig } from "../../deerflow/config.js";
import { runDeerFlowAgent } from "../../deerflow/client.js";
import type { ChatMessage } from "../../providerRuntime.js";
import type { ToolEventRecord } from "../../toolRuntime.js";

export type DeerFlowRunnerInput = {
  payload: GenerateRequest;
  threadId: string;
  runtimeConfig: AgentRuntimeConfig;
  messages: ChatMessage[];
  prompt: string;
  onToolEvent?: (event: ToolEventRecord) => void;
};

export type DeerFlowRunnerDeps = {
  getRuntimeConfig?: () => DeerFlowRuntimeConfig;
  runAgent?: typeof runDeerFlowAgent;
};

export async function runDeerFlowGeneration(input: DeerFlowRunnerInput, deps: DeerFlowRunnerDeps = {}) {
  const config = (deps.getRuntimeConfig ?? getDeerFlowRuntimeConfig)();
  if (!config.enabled) return undefined;

  const run = await (deps.runAgent ?? runDeerFlowAgent)({
    config,
    threadId: input.threadId,
    agentCard: input.runtimeConfig.agentCard,
    settings: input.runtimeConfig.settings,
    messages: input.messages,
    prompt: input.prompt,
    allowedToolRefs: input.runtimeConfig.enabledTools,
    toolState: input.payload.toolState,
    selectedCanvasNodeId: input.payload.selectedCanvasNodeId,
    contextValues: input.payload.contextValues,
    chatInstruction: input.payload.chatInstruction ?? input.payload.freeTextPrompt,
    onToolEvent: input.onToolEvent
  });

  if (!run.text) {
    throw new Error("DeerFlow returned an empty response");
  }

  return run;
}
