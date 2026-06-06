import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { canvasShapes, filterCanvasShapes, type CanvasShapeCategory } from "./shapeCatalog";

const categoryLabels = {
  basic: { en: "Basic", zh: "基础" },
  flowchart: { en: "Flowchart", zh: "流程图" },
  advanced: { en: "Advanced", zh: "高级" },
} satisfies Record<CanvasShapeCategory, Record<"en" | "zh", string>>;

export function ShapeLibraryPanel({
  locale,
  recentShapeIds,
  onClose,
  onSelectShape,
}: {
  locale: "en" | "zh";
  recentShapeIds: string[];
  onClose: () => void;
  onSelectShape: (shapeId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterCanvasShapes(query, locale), [locale, query]);
  const recent = recentShapeIds.flatMap((id) => canvasShapes.filter((shape) => shape.id === id));

  return (
    <aside className="canvas-shape-library" data-testid="canvas-shape-library">
      <header>
        <strong>{locale === "zh" ? "图形" : "Shapes"}</strong>
        <button aria-label={locale === "zh" ? "关闭图形库" : "Close shape library"} type="button" onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      <label className="canvas-shape-search">
        <Search size={16} />
        <input
          aria-label={locale === "zh" ? "搜索图形" : "Search shapes"}
          value={query}
          placeholder={locale === "zh" ? "搜索图形" : "Search shapes"}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {!query && recent.length > 0 ? (
        <ShapeSection label={locale === "zh" ? "最近使用" : "Recents"} shapes={recent} locale={locale} onSelectShape={onSelectShape} />
      ) : null}
      {(["basic", "flowchart", "advanced"] as const).map((category) => {
        const shapes = filtered.filter((shape) => shape.category === category);
        return shapes.length > 0 ? (
          <ShapeSection
            key={category}
            label={categoryLabels[category][locale]}
            shapes={shapes}
            locale={locale}
            onSelectShape={onSelectShape}
          />
        ) : null;
      })}
    </aside>
  );
}

function ShapeSection({
  label,
  locale,
  shapes,
  onSelectShape,
}: {
  label: string;
  locale: "en" | "zh";
  shapes: typeof canvasShapes;
  onSelectShape: (shapeId: string) => void;
}) {
  return (
    <section className="canvas-shape-section">
      <h3>{label}</h3>
      <div className="canvas-shape-grid">
        {shapes.map((shape) => (
          <button
            aria-label={shape.label[locale]}
            key={shape.id}
            title={shape.label[locale]}
            type="button"
            onClick={() => onSelectShape(shape.id)}
          >
            <span className={`canvas-shape-preview is-${shape.className}`} />
          </button>
        ))}
      </div>
    </section>
  );
}
