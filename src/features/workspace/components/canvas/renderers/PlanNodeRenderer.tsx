import type { CanvasNode } from "../../../../agents/types";

export function PlanNodeRenderer({ node }: { node: CanvasNode }) {
  const projection = planProjection(node.metadata);
  if (projection?.steps.length) {
    const current = projection.steps.find((step) => step.id === projection.currentStepId);
    return (
      <div className="canvas-plan-node">
        <p>Status: {projection.status}{current ? ` | Current: ${current.title}` : ""}</p>
        {projection.artifactCount ? <p>Artifacts: {projection.artifactCount} committed</p> : <p>Artifacts: none yet</p>}
        {projection.steps.map((step) => (
          <div className="canvas-plan-step" data-completed={step.status === "completed" || step.status === "skipped"} key={step.id}>
            <span>{step.status === "completed" || step.status === "skipped" ? "✓" : step.status === "running" ? "…" : "•"}</span>
            <span>{step.title}{step.status === "failed" && step.error ? ` (${step.error})` : ""}</span>
          </div>
        ))}
        {projection.statusMessage ? <p>{projection.statusMessage}</p> : null}
      </div>
    );
  }

  const lines = node.content.split("\n").filter(Boolean);
  return (
    <div className="canvas-plan-node">
      {lines.map((line, index) => {
        const match = line.match(/^\[(x| )\]\s+(.+)$/i);
        if (match) {
          const completed = match[1].toLowerCase() === "x";
          return <div className="canvas-plan-step" data-completed={completed} key={`${index}-${line}`}><span>{completed ? "✓" : "•"}</span><span>{match[2]}</span></div>;
        }
        if (line.startsWith("# ")) return null;
        return <p key={`${index}-${line}`}>{line}</p>;
      })}
    </div>
  );
}

type PlanProjection = {
  status: string;
  currentStepId?: string;
  statusMessage?: string;
  artifactCount: number;
  steps: Array<{ id: string; title: string; status: string; error?: string }>;
};

function planProjection(metadata: unknown): PlanProjection | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const projection = (metadata as { planProjection?: unknown }).planProjection;
  if (!projection || typeof projection !== "object" || Array.isArray(projection)) return undefined;
  const value = projection as Record<string, unknown>;
  const steps = Array.isArray(value.steps)
    ? value.steps.map((step) => {
      const item = step && typeof step === "object" && !Array.isArray(step) ? step as Record<string, unknown> : {};
      return {
        id: typeof item.id === "string" ? item.id : "",
        title: typeof item.title === "string" ? item.title : "",
        status: typeof item.status === "string" ? item.status : "pending",
        error: typeof item.error === "string" ? item.error : undefined
      };
    }).filter((step) => step.id && step.title)
    : [];
  return {
    status: typeof value.status === "string" ? value.status : "",
    currentStepId: typeof value.currentStepId === "string" ? value.currentStepId : undefined,
    statusMessage: typeof value.statusMessage === "string" ? value.statusMessage : undefined,
    artifactCount: typeof value.artifactCount === "number" ? value.artifactCount : 0,
    steps
  };
}
