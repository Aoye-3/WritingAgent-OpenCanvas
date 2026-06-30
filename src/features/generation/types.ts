import type { Locale } from "../i18n/types";

export type GenerateRequest = {
  mode: "faceted" | "freeText" | "structured" | "chat";
  taskId?: string;
  agentCardId?: string;
  projectId?: string;
  threadId?: string;
  locale: Locale;
  contextValues?: Record<string, unknown>;
  freeTextPrompt?: string;
  chatInstruction?: string;
  toolState?: Partial<Record<"web_search" | "knowledge_base" | "clear_context" | "canvas_write" | "plan_update" | "plan_clarification_submit" | "plan_revision_submit" | "artifact_stage", boolean>>;
  systemPrompt?: string;
  runtimeBudgetProfile?: "low" | "medium" | "high";
  modelOverrides?: {
    thinkingMode?: "enabled" | "disabled";
    reasoningEffort?: "high" | "max" | "low" | "medium" | "xhigh";
  };
  transientSkillRefs?: string[];
  disabledSkillRefs?: string[];
  selectedCanvasNodeId?: string;
  planPhase?: "intake" | "revise" | "preflight" | "execution";
  planId?: string;
  stepId?: string;
};

export type GenerateResponse = {
  text: string;
  prompt: string;
  provider: string | "agent-backend" | "mock";
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

export type RunTimelineEvent = {
  id: string;
  threadId?: string;
  runId?: string;
  sequence: number;
  eventType: "phase_started" | "decision" | "tool_started" | "tool_completed" | "canvas_node_committed" | "artifact_committed" | "run_completed" | "run_failed";
  status: "running" | "completed" | "failed" | "waiting";
  title: string;
  summary: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};

export type StreamStatus = {
  phase: "thinking" | "searching" | "writing" | "finalizing";
  label: string;
};

export type AgentProgressEvent = {
  id: string;
  threadId?: string;
  runId?: string;
  stageId?: string;
  phase?: string;
  status?: "running" | "completed" | "failed" | "waiting";
  title?: string;
  summary: string;
  next?: string;
  interventionHint?: string;
  visibility?: "stage" | "raw";
  source?: string;
  createdAt: string;
};

export type ProgressSegment = AgentProgressEvent;

export type QueuedRunInput = {
  id: string;
  status: "queued_after_run" | "intervention_requested" | "injected" | "sent_after_run";
  createdAt: string;
};

export type CollaborationMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  reasoningText?: string;
  isReasoningStreaming?: boolean;
  timeline?: RunTimelineEvent[];
  progressSegments?: ProgressSegment[];
  queuedInput?: QueuedRunInput;
  usedMock?: boolean;
  isStreaming?: boolean;
  status?: StreamStatus["phase"] | "error" | "stopped";
  statusLabel?: string;
  createdAt?: string;
  kind?: "message" | "activity";
};
