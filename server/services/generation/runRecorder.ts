import type { GenerateRequest, GenerateResponse } from "../../contracts/generation.js";
import type { SQLiteStorageRepository } from "../../storage.js";
import type { Provider } from "../../types.js";
import type { ToolEventRecord } from "../../toolRuntime.js";
import type { ToolState } from "../../toolRegistry.js";
import { userMessageForRun } from "./promptRunBuilder.js";

export type RecordRunInput = {
  storage: SQLiteStorageRepository;
  payload: GenerateRequest;
  threadId: string;
  agentCardId: string;
  agentTitle: string;
  configuredModelApiId?: string;
  modelId?: string;
  mode: "structured" | "chat";
  prompt: string;
  text: string;
  provider: Provider;
  usedMock: boolean;
  toolState: ToolState;
  events?: ToolEventRecord[];
  finishReason?: string;
  usage?: unknown;
  errorMessage?: string;
};

export function recordGenerationRun(input: RecordRunInput): GenerateResponse {
  const saved = input.storage.recordRun({
    threadId: input.threadId,
    agentCardId: input.agentCardId,
    configuredModelApiId: input.configuredModelApiId,
    modelId: input.modelId,
    mode: input.mode,
    prompt: input.prompt,
    output: input.text,
    provider: input.provider,
    usedMock: input.usedMock,
    errorMessage: input.errorMessage,
    userMessage: userMessageForRun(input.payload, input.agentTitle),
    toolState: input.toolState,
    events: input.events,
    finishReason: input.finishReason,
    usage: input.usage
  });

  return {
    text: input.text,
    prompt: input.prompt,
    provider: input.provider,
    usedMock: input.usedMock,
    threadId: input.threadId,
    runId: saved.runId,
    errorMessage: input.errorMessage,
    events: input.events,
    finishReason: input.finishReason,
    usage: input.usage
  };
}
