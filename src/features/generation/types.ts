import type { Locale } from "../i18n/types";

export type GenerateRequest = {
  mode: "faceted" | "freeText" | "structured" | "chat";
  taskId?: string;
  agentCardId?: string;
  threadId?: string;
  locale: Locale;
  formValues?: Record<string, string | string[]>;
  structuredValues?: Record<string, string | string[]>;
  contextValues?: Record<string, unknown>;
  freeTextPrompt?: string;
  chatInstruction?: string;
  toolState?: Partial<Record<"web_search" | "knowledge_base" | "quick_messages" | "clear_context" | "canvas_write", boolean>>;
  systemPrompt?: string;
  selectedCanvasNodeId?: string;
};

export type GenerateResponse = {
  text: string;
  prompt: string;
  provider: "deepseek" | "openai" | "openai-compatible" | "deerflow" | "mock";
  usedMock: boolean;
  threadId: string;
  runId?: string;
  errorMessage?: string;
  events?: GenerationEvent[];
  finishReason?: string;
  usage?: unknown;
};

export type GenerationEvent = {
  eventType: string;
  payload: unknown;
};

export type CollaborationMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  usedMock?: boolean;
};
