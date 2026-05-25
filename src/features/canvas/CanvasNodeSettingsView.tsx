import type { AppView } from "../../app/App";
import type { CanvasNodeKind } from "../agents/types";
import { AppSidebar } from "../../shared/AppSidebar";
import { useI18n } from "../i18n/I18nProvider";

type CanvasNodeSettingsViewProps = {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
};

type LocalizedText = {
  en: string;
  zh: string;
};

type CanvasNodeTypeDefinition = {
  kind: CanvasNodeKind;
  title: LocalizedText;
  summary: LocalizedText;
  contextRule: LocalizedText;
  agentRule: LocalizedText;
  conversionRule: LocalizedText;
};

const nodeTypeDefinitions: CanvasNodeTypeDefinition[] = [
  {
    kind: "note",
    title: { en: "Note", zh: "便签" },
    summary: {
      en: "Personal thinking note for the user.",
      zh: "用户自己的思维便签。"
    },
    contextRule: {
      en: "Excluded from AI context by default.",
      zh: "默认不进入 AI 上下文。"
    },
    agentRule: {
      en: "Agents do not edit it as a default output target.",
      zh: "Agent 不把它作为默认产出目标。"
    },
    conversionRule: {
      en: "Can be converted to document or reference from Canvas node actions.",
      zh: "可通过 Canvas 节点操作转换为文档或引用。"
    }
  },
  {
    kind: "document",
    title: { en: "Document", zh: "文档" },
    summary: {
      en: "AI output document and editable writing target.",
      zh: "AI 产出文档和可编辑写作目标。"
    },
    contextRule: {
      en: "Preview participates in default Canvas context.",
      zh: "预览内容默认参与 Canvas 上下文。"
    },
    agentRule: {
      en: "Agents may propose edits through write requests.",
      zh: "Agent 可通过写入请求提出编辑。"
    },
    conversionRule: {
      en: "Can be converted to note or reference without changing content.",
      zh: "可转换为便签或引用，内容保持不变。"
    }
  },
  {
    kind: "reference",
    title: { en: "Reference", zh: "引用" },
    summary: {
      en: "Reference material used to ground AI collaboration.",
      zh: "用于支撑 AI 协作的引用资料。"
    },
    contextRule: {
      en: "Included in AI context by default.",
      zh: "默认进入 AI 上下文。"
    },
    agentRule: {
      en: "Agents can read it as context but still need approval to write.",
      zh: "Agent 可读取为上下文，写入仍需确认。"
    },
    conversionRule: {
      en: "Can be converted to note or document from Canvas node actions.",
      zh: "可通过 Canvas 节点操作转换为便签或文档。"
    }
  }
];

export function CanvasNodeSettingsView({ activeView, onNavigate }: CanvasNodeSettingsViewProps) {
  const { locale } = useI18n();
  const active = activeView === "canvasNodeSettings";

  return (
    <section className="management-app canvas-node-settings" data-active={active} aria-label="Canvas node settings">
      <AppSidebar activeView={activeView} onNavigate={onNavigate} />
      <main className="management-main">
        <div className="management-header">
          <div>
            <p className="eyebrow">Canvas</p>
            <h1>{locale === "zh" ? "Canvas 节点" : "Canvas nodes"}</h1>
            <p>{locale === "zh" ? "只展示节点类型规则，和当前项目里的具体节点解耦。" : "Type rules only, separated from project node content."}</p>
          </div>
          <button className="button button-secondary" type="button" onClick={() => onNavigate("workspace")}>
            {locale === "zh" ? "回到画布" : "Back to canvas"}
          </button>
        </div>

        <CanvasNodeTypeCatalog definitions={nodeTypeDefinitions} locale={locale} />
      </main>
    </section>
  );
}

function CanvasNodeTypeCatalog({ definitions, locale }: { definitions: CanvasNodeTypeDefinition[]; locale: "en" | "zh" }) {
  return (
    <section className="canvas-type-catalog" aria-label={locale === "zh" ? "Canvas 节点类型" : "Canvas node types"}>
      {definitions.map((definition) => (
        <CanvasNodeTypeCard definition={definition} key={definition.kind} locale={locale} />
      ))}
    </section>
  );
}

function CanvasNodeTypeCard({ definition, locale }: { definition: CanvasNodeTypeDefinition; locale: "en" | "zh" }) {
  return (
    <article className={`canvas-type-card canvas-kind-${definition.kind}`}>
      <div className="canvas-type-card-header">
        <span>{definition.kind}</span>
        <h2>{definition.title[locale]}</h2>
      </div>
      <p>{definition.summary[locale]}</p>
      <dl className="canvas-type-rules">
        <div>
          <dt>{locale === "zh" ? "上下文" : "Context"}</dt>
          <dd>{definition.contextRule[locale]}</dd>
        </div>
        <div>
          <dt>{locale === "zh" ? "Agent" : "Agent"}</dt>
          <dd>{definition.agentRule[locale]}</dd>
        </div>
        <div>
          <dt>{locale === "zh" ? "转换" : "Convert"}</dt>
          <dd>{definition.conversionRule[locale]}</dd>
        </div>
      </dl>
    </article>
  );
}
