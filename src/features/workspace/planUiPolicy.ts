import type { GenerateRequest } from "../generation/types";

type ToolState = NonNullable<GenerateRequest["toolState"]>;
export type PlanRequestPhase = { kind: "chat" | "planning" | "execution" };

const internalComposerTools = new Set(["artifact_stage", "canvas_write", "clear_context"]);

export function visibleComposerTools(tools: string[]) {
  return tools.filter((tool) => !internalComposerTools.has(tool));
}

export function buildRequestToolState(current: ToolState | undefined, phase: PlanRequestPhase): ToolState {
  if (phase.kind === "planning") {
    return {
      ...current,
      knowledge_base: false,
      quick_messages: false,
      canvas_write: false,
      web_search: false,
      artifact_stage: false,
      plan_clarification_submit: true,
      plan_revision_submit: true
    };
  }
  if (phase.kind === "execution") {
    return {
      ...current,
      quick_messages: false,
      canvas_write: false,
      artifact_stage: true,
      web_search: true
    };
  }
  return { ...current, quick_messages: true, canvas_write: true };
}
