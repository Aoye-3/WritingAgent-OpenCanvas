import type { CanvasNode } from "../../../../agents/types";

export function PlanNodeRenderer({ node }: { node: CanvasNode }) {
  const lines = node.content.split("\n").filter(Boolean);
  return (
    <div className="canvas-plan-node nodrag">
      {lines.map((line, index) => {
        const match = line.match(/^\[(x| )\]\s+(.+)$/i);
        if (match) {
          const completed = match[1].toLowerCase() === "x";
          return <div className="canvas-plan-step" data-completed={completed} key={`${index}-${line}`}><span>{completed ? "✓" : "○"}</span><span>{match[2]}</span></div>;
        }
        if (line.startsWith("# ")) return null;
        return <p key={`${index}-${line}`}>{line}</p>;
      })}
    </div>
  );
}
