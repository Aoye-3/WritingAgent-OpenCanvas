import { useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { AppView } from "../../app/App";
import { StarIcon } from "../../shared/icons";
import { Topbar } from "../../shared/Topbar";
import type { AgentCard, AgentCardField, AgentValues, CanvasNode, CanvasWriteRequest, StoredOutputVersion, StoredToolEvent } from "../agents/types";
import type { CanvasNodeDraft, CanvasNodePatch } from "../canvas/canvasClient";
import type { CollaborationMessage, GenerateRequest, GenerateResponse } from "../generation/types";
import { useI18n } from "../i18n/I18nProvider";
import { AICollaborationDrawer } from "./components/AICollaborationDrawer";
import { WorkspaceUtilityBar } from "./components/WorkspaceUtilityBar";
import { DocumentCanvas } from "./components/DocumentCanvas";

const RIGHT_DRAWER_MIN_WIDTH = 360;
const RIGHT_DRAWER_MAX_WIDTH = 720;

type WorkspaceViewProps = {
  activeAgent: AgentCard;
  activeView: AppView;
  collaborationMessages: CollaborationMessage[];
  editableOutput: string;
  generation: GenerateResponse | null;
  isChatSending: boolean;
  isGenerating: boolean;
  outputVersions: StoredOutputVersion[];
  activeVersionId?: string;
  canvasNodes: CanvasNode[];
  canvasWriteRequests: CanvasWriteRequest[];
  selectedCanvasNodeId?: string;
  toolEvents: StoredToolEvent[];
  onApproveCanvasWriteRequest: (requestId: string) => Promise<void>;
  onChatSend: (text: string, modelOverrides?: GenerateRequest["modelOverrides"]) => Promise<void>;
  onCreateCanvasNode: (draft: CanvasNodeDraft) => Promise<void>;
  onDeleteCanvasNode: (nodeId: string) => Promise<void>;
  onEditableOutputChange: (value: string) => void;
  onGenerate: () => Promise<void>;
  onGoHome: () => void;
  onOpenSettings: () => void;
  onAgentValuesChange: (values: AgentValues) => void;
  onRejectCanvasWriteRequest: (requestId: string) => Promise<void>;
  onRequestCanvasWriteFromMessage: (text: string) => Promise<void>;
  onRestoreVersion: (version: StoredOutputVersion) => void;
  onSelectCanvasNode: (nodeId?: string) => void;
  onToolStateChange: (toolState: GenerateRequest["toolState"]) => void;
  onUpdateCanvasNode: (nodeId: string, patch: CanvasNodePatch) => Promise<void>;
  promptPreview: string;
  agentValues: AgentValues;
  toolState: GenerateRequest["toolState"];
};

export function WorkspaceView({
  activeAgent,
  activeView,
  collaborationMessages,
  generation,
  isChatSending,
  canvasNodes,
  canvasWriteRequests,
  selectedCanvasNodeId,
  toolEvents,
  onApproveCanvasWriteRequest,
  onChatSend,
  onCreateCanvasNode,
  onDeleteCanvasNode,
  onGoHome,
  onOpenSettings,
  onAgentValuesChange,
  onRejectCanvasWriteRequest,
  onRequestCanvasWriteFromMessage,
  onSelectCanvasNode,
  onToolStateChange,
  onUpdateCanvasNode,
  promptPreview,
  agentValues,
  toolState
}: WorkspaceViewProps) {
  const { locale, t } = useI18n();
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [rightDrawerWidth, setRightDrawerWidth] = useState(RIGHT_DRAWER_MIN_WIDTH);

  const updateValue = (id: string, value: string) => {
    onAgentValuesChange({ ...agentValues, [id]: value });
  };

  const providerLabel = generation
    ? generation.usedMock
      ? t("workspace.mockNotice")
      : generation.provider
    : t("workspace.generatedFromPrompt");

  const startRightDrawerResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = rightDrawerWidth;
    const maxWidth = Math.max(RIGHT_DRAWER_MIN_WIDTH, Math.min(RIGHT_DRAWER_MAX_WIDTH, window.innerWidth - 520));
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      const nextWidth = Math.min(maxWidth, Math.max(RIGHT_DRAWER_MIN_WIDTH, startWidth + delta));
      setRightDrawerWidth(nextWidth);
    };

    const stopResize = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  };

  const workspaceGridStyle = {
    "--ai-drawer-width": `${rightDrawerWidth}px`
  } as CSSProperties;

  return (
    <section className="view view-workspace" id="workspace-view" aria-label={`${activeAgent.title[locale]} workspace`}>
      <Topbar
        activeView={activeView}
        contextLabel={`${activeAgent.title[locale]} / Local thread`}
        onGoHome={onGoHome}
        onOpenSettings={onOpenSettings}
        actions={
          <>
            <span className="provider-chip">{providerLabel}</span>
            <button className="button button-secondary" type="button" onClick={() => document.querySelector(".prompt-card")?.scrollIntoView({ behavior: "smooth", block: "nearest" })}>
              {t("app.previewPrompt")}
            </button>
          </>
        }
      />

      <div
        className="layered-workspace-grid"
        data-left-collapsed={leftCollapsed}
        data-right-collapsed={rightCollapsed}
        style={workspaceGridStyle}
      >
        <aside className="input-drawer" aria-label="AgentCard structured input drawer" data-collapsed={leftCollapsed}>
          {leftCollapsed ? (
            <button className="drawer-rail drawer-rail-left" type="button" onClick={() => setLeftCollapsed(false)} aria-label={locale === "zh" ? "展开 AgentCard 输入" : "Expand AgentCard inputs"}>
              <span>{activeAgent.title[locale].slice(0, 1)}</span>
              <small>AgentCard</small>
              <b>&gt;</b>
            </button>
          ) : null}

          <div className="drawer-expanded-content" aria-hidden={leftCollapsed}>
            <div className="drawer-header">
              <div>
                <p className="eyebrow">AgentCard</p>
                <h2>{activeAgent.title[locale]}</h2>
              </div>
              <div className="drawer-header-actions">
                <button className="icon-button" type="button" aria-label={`Favorite ${activeAgent.title[locale]}`}>
                  <StarIcon />
                </button>
                <button className="icon-button" type="button" onClick={() => setLeftCollapsed(true)} aria-label={locale === "zh" ? "收起左侧栏" : "Collapse left drawer"}>
                  <span aria-hidden="true">&lt;</span>
                </button>
              </div>
            </div>

            <div className="agent-capability-box">
              <span>{activeAgent.skillRefs.join(", ")}</span>
              <p>{activeAgent.description[locale]}</p>
            </div>

            <form className="facet-form">
              <fieldset>
                <legend>{t("workspace.coreSettings")}</legend>
                {activeAgent.fields.slice(0, 4).map((field) => renderField(field, agentValues, updateValue, locale))}
              </fieldset>

              <fieldset>
                <legend>{t("workspace.outputSpec")}</legend>
                {activeAgent.fields.slice(4, 7).map((field) => renderField(field, agentValues, updateValue, locale))}
              </fieldset>

              <fieldset>
                <legend>{t("workspace.customInstruction")}</legend>
                {activeAgent.fields.slice(7).map((field) => renderField(field, agentValues, updateValue, locale))}
              </fieldset>
            </form>

            <div className="drawer-footer">
              <button className="button button-secondary" type="button" onClick={() => onAgentValuesChange(activeAgent.defaultValues)}>
                {t("workspace.clear")}
              </button>
            </div>
          </div>
        </aside>

        <main className="output-area canvas-output-area" aria-label="Document canvas">
          <DocumentCanvas
            nodes={canvasNodes}
            providerLabel={providerLabel}
            selectedNodeId={selectedCanvasNodeId}
            onCreateNode={onCreateCanvasNode}
            onDeleteNode={onDeleteCanvasNode}
            onSelectNode={onSelectCanvasNode}
            onUpdateNode={onUpdateCanvasNode}
          />
        </main>

        <AICollaborationDrawer
          allowedTools={activeAgent.toolRefs}
          canvasWriteRequests={canvasWriteRequests}
          collapsed={rightCollapsed}
          isSending={isChatSending}
          messages={collaborationMessages}
          modelSettings={activeAgent.settings?.model}
          onApproveWriteRequest={onApproveCanvasWriteRequest}
          onRejectWriteRequest={onRejectCanvasWriteRequest}
          onRequestWriteMessage={onRequestCanvasWriteFromMessage}
          onSend={onChatSend}
          onResizeStart={startRightDrawerResize}
          onToggleCollapsed={() => setRightCollapsed((value) => !value)}
          onToolStateChange={onToolStateChange}
          toolEvents={toolEvents}
          toolState={toolState}
        />
      </div>

      <WorkspaceUtilityBar promptPreview={generation?.prompt ?? promptPreview} />
    </section>
  );
}

function renderField(
  field: AgentCardField,
  values: AgentValues,
  updateValue: (id: string, value: string) => void,
  locale: "en" | "zh"
) {
  const value = String(values[field.id] ?? "");
  const placeholder = field.placeholder[locale];
  const label = field.label[locale];

  if (field.kind === "textarea") {
    return (
      <label className="field" key={field.id}>
        <span>{label} {field.required ? <strong>*</strong> : null}</span>
        <textarea placeholder={placeholder} value={value} onChange={(event) => updateValue(field.id, event.target.value)} />
      </label>
    );
  }

  if (field.kind === "select") {
    return (
      <label className="field" key={field.id}>
        <span>{label} {field.required ? <strong>*</strong> : null}</span>
        <select value={value} onChange={(event) => updateValue(field.id, event.target.value)}>
          <option value="">{placeholder}</option>
          {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    );
  }

  if (field.kind === "chips" || field.kind === "segmented") {
    const className = field.kind === "segmented" ? "segmented" : "chip-row";
    return (
      <div className="field" key={field.id}>
        <span>{label}</span>
        <div className={className} role="group" aria-label={label}>
          {field.options?.map((option) => (
            <button
              className={value === option ? (field.kind === "segmented" ? "selected" : "chip chip-selected") : field.kind === "segmented" ? "" : "chip"}
              key={option}
              onClick={() => updateValue(field.id, value === option ? "" : option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
        {!value ? <small className="field-hint">{placeholder}</small> : null}
      </div>
    );
  }

  return (
    <label className="field" key={field.id}>
      <span>{label} {field.required ? <strong>*</strong> : null}</span>
      <input placeholder={placeholder} value={value} onChange={(event) => updateValue(field.id, event.target.value)} />
    </label>
  );
}
