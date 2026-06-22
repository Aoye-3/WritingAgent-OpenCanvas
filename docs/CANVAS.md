# FacetWrite Canvas

## Plan Artifacts

Approved PlanRuns have a create-only Artifact path:

```text
approved PlanRun + running PlanStep
 -> artifact_stage with stable artifactId
 -> FacetWrite validation and persistence
 -> immediate idempotent node/asset creation
 -> optional artifact-link edge
```

Text artifacts create `document`, `reference`, or `note` nodes. Web images must resolve to public HTTP(S) addresses and pass redirect, MIME, and size validation before becoming existing Canvas `asset` objects. Source URL, page URL, caption, and alt metadata are preserved. Assistant conversation text is independent and is never copied automatically.

## Naming
OpenCanvas is the external product name for the AI canvas workspace and should be the primary visible brand. This document keeps the FacetWrite name for internal Canvas APIs, storage, and runtime ownership because those boundaries are not being renamed in this pass.

## Purpose
The Canvas is the visual workspace where generated or user-authored writing artifacts become editable nodes. It is a product surface owned by FacetWrite, not by AgentBackend or the provider runtime.

The Canvas has two separate responsibilities:

- Present and edit local node state in the browser.
- Apply low-risk AI creates/appends directly and keep destructive replacements/deletes behind approval.

## Frontend Architecture
`src/features/workspace/components/DocumentCanvas.tsx` is the Canvas V2 container. It uses `@xyflow/react` as the pan/zoom/drag engine and keeps the existing FacetWrite Canvas API as the persistence boundary.

Current frontend responsibilities:

- Map persisted `CanvasNode` records into React Flow nodes through `components/canvas/flowMapping.ts`.
- Keep status node, context menu, selection bar, and selected-node workflow chrome in `components/canvas/CanvasChrome.tsx`.
- Compose common node frame behavior from `components/canvas/CanvasNodeFrame.tsx`.
- Render directed edges through `components/canvas/CanvasCurveEdge.tsx`.
- Format explicit user-sent mind chains through the shared pure helper in `shared/canvasMindChain.ts`.
- Render node bodies through the kind-based renderer boundary in `components/canvas/renderers/`.
- Support viewport pan, wheel pan, Ctrl-wheel zoom, reset, selection, context-menu creation, node dragging, edge-based node resizing, title editing, content editing, and deletion.
- Persist single-node position after drag stop through `PATCH /api/threads/:threadId/canvas/nodes/:nodeId`.
- Persist multi-selected node positions after drag stop through `PATCH /api/threads/:threadId/canvas/node-positions` so a group move performs one backend write and one project-surface refresh.
- Persist node size after resize stop through the same PATCH endpoint.
- Persist title/content only on blur, not on every keystroke.

React Flow is only a view/interaction layer. It must not become the source of truth for node persistence.

Common node behavior is intentionally separated from node-kind content rendering. Selection, deletion, resize edges, drag handle, and the punched-hole link port live in the shared node frame. `note`, `document`, and `reference` rendering live in separate renderer entry points, even when they share Markdown-capable text rendering, so future kind-specific behavior does not leak into the common frame.

Canvas state is also split by responsibility. `src/app/hooks/useCanvasState.ts` is the public composition hook, `useCanvasActions.ts` owns API operation orchestration, `useCanvasHistory.ts` owns the session undo stack, and pure history helpers live in `shared/canvasHistory.ts` for backend-compatible unit tests. Small action-state helpers live under `src/app/hooks/canvasActions/` so failure-prone state transitions can be tested without rendering React Flow.

Future FigJam-style toolbar modes and contextual quick-bar actions should reuse these Canvas API and state boundaries. Direct user edits may call Canvas CRUD endpoints. Agent-originated creates/appends use the server-controlled low-risk commit path; destructive edits continue through approval-aware write requests.

## Floating Toolbar And Saved Objects

The floating toolbar owns the active Canvas tool. Select and pan are persistent navigation modes; creation tools create one item and return to select. Escape also returns to select. The right-click menu remains a node-creation shortcut.

Saved visual and structural objects use `canvas_objects` instead of `canvas_nodes` or `canvas_edges`:

- `arrow`: a free visual arrow with Canvas-coordinate endpoints. It does not bind to nodes or enter mind chains.
- `shape`: registry-backed Basic, Flowchart, and Advanced visual objects.
- `table`: a lightweight editable string grid without formulas.
- `asset`: an image preview or local file card backed by the thread upload directory.

Selection may include multiple content nodes and visual objects, or a semantic edge. The Agent toolbar action summarizes the selected items into the collaboration composer; it does not directly mutate layout or bypass Canvas write approval.

The Shape tool opens a searchable categorized library. Shape definitions live in a frontend registry so the library preview and saved-object renderer use the same stable shape ids. The initial library includes Basic, Flowchart, and Advanced groups plus recent selections.

Visual-object contracts live in `shared/canvasObjects.ts`. Object writes are strictly validated while stored legacy rows are normalized on read. The frontend and server must not introduce independent copies of object-kind, geometry, or data types.

Tool lifecycle:

- Select, pan, and Agent remain active until the user changes tools.
- Node and visual-object creation tools return to Select after one successful action.
- Shape selection keeps the Shape tool active until the user places the chosen shape or closes the library.
- Asset selection opens the file input; cancel and completion both return to Select.

Object create, geometry/data update, and delete participate in session undo. Asset upload participates as a create operation and can be undone by deleting the new asset. Deleted asset bytes are removed immediately and are not restored by undo.

To add a new visual-object kind:

1. Extend the discriminated union, validator, compatible normalizer, and default draft in `shared/canvasObjects.ts`.
2. Add repository/storage tests for valid writes, invalid writes, and compatible reads.
3. Add a focused object renderer instead of adding type-specific UI to `DocumentCanvas`.
4. Add toolbar behavior and Playwright coverage, then update API and Canvas documentation.

## Node Model
The current content node kinds remain:

```ts
type CanvasNodeKind = "document" | "note" | "reference";
```

Role is now also a first-class Canvas function node:

```ts
type CanvasNodeKind = "document" | "note" | "reference" | "role";
```

The three kinds now have distinct product/runtime semantics:

- `note`: user sticky note for thinking. It is excluded from default AI context and only reaches the collaboration drawer when the user explicitly sends a mind chain.
- `document`: AI output document. New AI Canvas output and approved `canvas_write` creates default to this kind; Agents may edit it through the approval path.
- `reference`: source/reference material. It participates in default AI context.
- `role`: workflow control node. It stores `metadata.workflowRole` and affects content only through directed edges.

Nodes can be converted between these three kinds through Canvas node actions that call the existing node PATCH path. Conversion preserves title, content, geometry, metadata, and connections. The Canvas node settings page is intentionally type-only documentation and does not read or mutate current project nodes.

Canvas V2 intentionally does not add `form` nodes yet. Future node kinds should be added in this order:

1. Extend the frontend and backend `CanvasNodeKind`.
2. Update backend validation and default title behavior.
3. Update the `canvas_write` tool schema only if Agents are allowed to propose that node kind.
4. Add a dedicated frontend renderer.
5. Add migration notes only if existing stored rows need conversion.

The renderer has an unknown-kind fallback so older or future local data can still render safely as a text node instead of breaking the board.

## Node Geometry
Persisted geometry fields are:

- `x`
- `y`
- `width`
- `height`

Dragging updates `x/y`. Resizing may update all four fields because resizing from north or west handles changes the node origin as well as its size.

Text nodes start in an automatic layout mode: when content enters or changes through persisted Canvas state, the frontend measures the text area and grows the node height so the content is visible as a full information block. Once the user resizes the node, the frontend writes `metadata.canvasLayout.sizeMode = "manual"` with the resize patch and stops automatic height changes for that node. Manual nodes keep internal scrolling if the user chooses a smaller reading frame.

The UI clamps node size with frontend minimum/maximum dimensions. These constraints are presentation rules, not database constraints.

Current default content-node sizes are deliberately wider than the minimum size constraints so generated Markdown is readable without immediate manual resizing:

- Manual Canvas creation defaults in `canvasCreation.ts`: `document` 640x260, `reference` 420x190, `note` 380x190, and `role` 340x190.
- Direct multi-node Canvas delivery defaults in `server/services/canvasDeliveryPlanner.ts`: `outline` 520x260, `body` 640x520, and `sources` 520x320.

The backend direct-delivery planner persists those dimensions in the created node draft. Retrying the same stable delivery id updates existing delivery nodes with the current title, content, position, size, kind, and metadata, so old narrow nodes do not keep stale geometry after a layout contract change.

Generic long-task progressive delivery also writes stable `整体概述` / `Overview` and `正文` / `Body` nodes in batch-delivery mode. Evidence events create separate `研究摘录` / `进度摘录` reference nodes. Body checkpoints update the same stable body node only up to the Project or one-run `bodyDraftWriteLimit`; after synthesis starts, further tool events stay in the run trace and do not create more intermediate Canvas nodes. When the Agent returns final assistant text, generic progressive delivery replaces the stable body draft and emits `canvas_delivery_body_final_committed`. Explicit direct Canvas delivery still uses the structured delivery planner and keeps its heading-based body nodes; the generic final-body replacement is skipped for those runs.

Canvas delivery is gated by the server-owned `TaskHandlingPolicy`. Only `long_task`, `plan_execution`, and `explicit_canvas` requests may create or update Canvas nodes. `simple_chat` and `plan_intake` remain conversation-only even when Skills or thinking mode are enabled; short answers and Plan clarification acknowledgements must not create `Overview`, `Body`, progress, or final-body nodes.

## Node Markdown Rendering
Canvas content nodes render Markdown in read-only mode. Editing still uses the raw Markdown textarea so users can revise the source text directly.

`SourceMarkdownText` is the Canvas node renderer for selectable Markdown text. It supports compact headings, ordered and unordered lists, inline emphasis, inline code, Markdown links, and simple GitHub-style pipe tables. Each rendered text span keeps source-offset metadata so document range rewrite and inline formatting can still map a browser selection back to the original node content. Parsed Markdown blocks are memoized by source text so selection and drag re-renders do not repeatedly parse unchanged node content.

Reference and note nodes use the same read-only Markdown renderer through `EditableTextNode`, so a source list such as `- [Apple](https://example.com)` is displayed as a clickable title rather than raw `[title](url)` syntax. Table rendering is horizontally scrollable inside the node instead of expanding or clipping the card.

## Canvas Workflow
Canvas Workflow is a layer on top of Canvas V2. Canvas Mode is the user-facing workspace mode; the current implementation exposes `batch_delivery` as the first mode. Stage remains mode-specific project state for batch delivery, while Role is represented as an independent Canvas function node. Workflow control capabilities should be modeled as nodes and relationships when they need spatial behavior or targeted influence, instead of being stacked into ordinary content-node UI.

Workflow responsibilities are deliberately split:

- Canvas Spatial layer owns React Flow, node and edge rendering, drag, zoom, resize, selection, and connection behavior. It must not decide writing-stage rules.
- Canvas Workflow layer owns the project mode, batch-delivery stage, node stage metadata, Role function nodes, Role-to-content edges, and suggestions.
- Agent Orchestration layer converts Workflow state into runtime context and approval-aware operations.
- Suggestion UI layer renders node suggestions and exposes accept, ignore, and convert-to-node actions.

The project/thread has exactly one current Canvas mode:

```ts
type CanvasWorkflowMode = "batch_delivery";
```

In `batch_delivery` mode, the project/thread has exactly one current batch stage:

```ts
type CanvasWorkflowStage = "inspiration" | "research" | "structure" | "writing" | "polish" | "publish";
```

The frontend displays Canvas Mode as the primary toolbar selector. A new Canvas node inherits the current batch stage into `metadata.workflow.stage`. Users can override an individual node's batch step without changing the project stage.

Roles are suggestion perspectives, not Agent cards and not content-node decorations. A Role is a `role` Canvas node whose role data lives in `metadata.workflowRole`:

```ts
{
  roleId: string;
  label: string;
  prompt: string;
  description?: string;
}
```

A Role applies only through a directed edge from the Role node to a content node:

```text
Role node -> document | note | reference
```

Reverse edges, content-to-content edges, and Role-to-Role edges do not grant a Role perspective. Ordinary content nodes keep `metadata.workflow.stage`, but new logic must not use `metadata.workflow.roles` as the source of Role membership. Legacy `metadata.workflow.roles` is migrated into Role nodes plus Role-to-content edges, then removed from the content node while preserving `workflow.stage`.

Suggestions are anchored to the Role node that produced the perspective while retaining the target content node id. Pending suggestions render below the Role node. Accepting a suggestion appends it to the target content node and marks it accepted. Ignoring marks it ignored. Converting creates a new Canvas node from the suggestion content and marks it accepted. These are low-risk Canvas operations; destructive replace, overwrite, and delete behavior remains outside the suggestion path.

Pure Workflow types and filters live in `shared/canvasWorkflow.ts` so frontend context selection, backend storage behavior, and tests use the same mode/stage/Role vocabulary.

## Resize Behavior
Canvas V2 uses a custom four-edge resize frame rather than the default React Flow `NodeResizer`.

Reason: In the FacetWrite workspace layout, resizing should feel like pulling the card edge, not grabbing small corner points. The custom resize frame is rendered as an outer selected-node outline around the actual node box, uses enlarged transparent edge hit targets, uses `nodrag nopan`, and updates React Flow visual state during the drag before persisting on pointer release.

Resize rules:

- Resize edges show only on the selected node.
- The selected outline and edge hit targets sit outside the actual node box.
- The current resize handles are `n`, `e`, `s`, and `w`; point/corner handles are intentionally not rendered.
- Dragging east or west changes width.
- Dragging north or south changes height.
- Dragging north or west also changes `x` or `y`.
- During resize, React Flow node dragging, pane dragging, and position-change application are temporarily disabled for that gesture.
- Resize marks the node as manual layout in metadata so later auto-expansion does not fight the user's chosen frame.
- Persistence happens once on pointer release.

## Canvas Write Safety
Agent and AgentBackend output must never mutate Canvas nodes outside the product-controlled Canvas tool path.

The only safe write path is:

```text
explicit Canvas action recognized by the server
 -> canvas_write forced once
 -> create/append: validated direct commit with real projectId and nodeId
 -> replace/replace_range/delete: pending approval
 -> structured committed/pending/failed event
 -> Canvas refresh and accurate conversation feedback
```

Frontend Canvas features such as drag, resize, title edit, and content edit are direct user edits and may call Canvas node CRUD endpoints directly. AI-originated content changes must stay behind the operation-level Canvas tool policy.

## Directed Edges And Mind Chains
Canvas supports directed node edges stored separately from nodes. A connection from A to B means `A -> B` for mind-chain ordering. Edges are user-authored Canvas structure, not Agent-owned state.

Each node renders a common link port at the top-right corner of the node chrome. The port is styled like a punched hole in a physical board: the background shows through the hole, and clicking/dragging from it starts a directed connection. This port is part of the common node frame, not a document/note/reference renderer.

Edges can be selected on the Canvas. Selecting an edge shows a delete action in the Canvas selection bar; double-click delete remains available as a shortcut.

When the user right-clicks a connected node and chooses to send the mind chain, the frontend walks to the start of the directed chain, follows outgoing edges, and writes an ordered summary into the right AI collaboration composer. This does not auto-send the message. Because this action is explicit user intent, `note` nodes included in that chain may be sent even though notes are excluded from default AI context.

Agent context uses Workflow filters before the runtime sees Canvas data. The default order is selected/specified chain, current or user-specified batch-delivery stage, then Role nodes connected to the selected/filtered content nodes. Only prompts from `Role -> content` edges enter the runtime as advice perspectives. The Agent should not default to reading the entire Canvas. If no explicit chain is sent, the frontend still excludes notes and narrows by the current batch-delivery stage.

Deleting a node removes attached edges. Deleting an edge does not modify either node.

## Undo
Canvas keeps a session-local undo stack for user Canvas operations: create, delete, edit, drag, resize, kind conversion, edge create, and edge delete. Multi-node drags are recorded as one grouped position inverse so undo restores the whole moved selection together. The stack is not persisted across page refresh.

The default stack depth is 20 operations. Users can change it in Project Settings through the Canvas undo cache setting. The persisted setting is read from `/api/settings/canvas`.

Undo entries should be recorded as inverse operations before the API mutation is applied. The pure inverse-patch and stack-depth helpers live in `shared/canvasHistory.ts`; React state ownership stays in `useCanvasHistory.ts`.

## API Boundary
Canvas V2 uses the existing API shape:

- `GET /api/threads/:threadId/canvas`
- `POST /api/threads/:threadId/canvas/nodes`
- `PATCH /api/threads/:threadId/canvas/nodes/:nodeId`
- `DELETE /api/threads/:threadId/canvas/nodes/:nodeId`
- `POST /api/threads/:threadId/canvas/edges`
- `DELETE /api/threads/:threadId/canvas/edges/:edgeId`
- `POST /api/threads/:threadId/canvas/write-requests`
- `POST /api/threads/:threadId/canvas/write-requests/:requestId/approve`
- `POST /api/threads/:threadId/canvas/write-requests/:requestId/reject`
- `PUT /api/threads/:threadId/canvas/workflow`
- `PATCH /api/threads/:threadId/canvas/nodes/:nodeId/workflow`
- `POST /api/threads/:threadId/canvas/suggestions`
- `POST /api/threads/:threadId/canvas/suggestions/:suggestionId/accept`
- `POST /api/threads/:threadId/canvas/suggestions/:suggestionId/ignore`
- `POST /api/threads/:threadId/canvas/suggestions/:suggestionId/convert-to-node`
- `GET /api/settings/canvas`
- `PUT /api/settings/canvas`
- `GET /api/projects/:projectId/runtime-settings`
- `PUT /api/projects/:projectId/runtime-settings`

Canvas nodes remain in `canvas_nodes`. Directed edges live in `canvas_edges`. Workflow state lives in `canvas_workflows`, and node suggestions live in `canvas_workflow_suggestions`. Canvas settings use the generic `settings` table with key `canvas`. Canvas routes call `server/domains/canvas/`; the domain service calls the storage facade; the SQL implementation lives in `server/repositories/canvasRepository.ts`. `server/storage.ts` keeps compatibility methods for existing route/service callers.

## Styling And Hit Testing
Canvas styles live in `src/app/styles.css`.

Important class roles:

- `.canvas-viewport`: React Flow host viewport.
- `.canvas-flow`: React Flow instance.
- `.canvas-node`: FacetWrite node shell.
- `.canvas-node-drag-handle`: header area used for node dragging.
- `.canvas-node-resize-frame`: selected-node resize outline rendered outside the actual node box.
- `.canvas-node-resize-handle`: transparent draggable edge controls for `n`, `e`, `s`, and `w`.
- `.canvas-menu`: right-click creation menu.
- `.canvas-node-link-port`: common top-right punched-hole link control.
- `.canvas-node-link-handle`: source/target React Flow handles inside the common link port.

Use `nodrag` on inputs and buttons that should not drag the node. Use `nopan` on resize controls so pane pan does not steal pointer events.

Any future overlay, grid, guide, marquee, toolbar, minimap, or alignment helper must be verified in-browser so it does not block:

- background right-click creation,
- pane pan/zoom,
- node selection,
- node drag,
- node resize,
- input editing.

## Validation Checklist
Before claiming Canvas work is complete, verify:

- `npm.cmd run typecheck`
- `npm.cmd run build`
- `npm.cmd test`
- `npm.cmd run test:e2e:canvas`
- Lightweight frontend tests cover API client errors, Canvas action state transitions, and React Flow mapping without starting a dev server.
- Canvas renders in the workspace.
- Background right-click menu creates `document`, `note`, `reference`, and `role` nodes.
- Node drag persists `x/y`; multi-selected node drag uses the batch position endpoint and remains undoable as one operation.
- Node resize uses draggable edges, not point handles, and persists `x/y/width/height`.
- Title/content edit persists after blur.
- Node kind conversion preserves title, content, position, and size.
- Delete removes the node.
- `canvas_write` creates/appends directly and keeps destructive operations pending.
- Directed node edges persist and can be deleted.
- Sending a mind chain populates the right collaboration composer without auto-sending, and deleted edges no longer pull disconnected nodes into that draft.
- Note nodes are excluded from default AI context.
- New nodes inherit the current batch-delivery stage.
- Node stage override persists in node metadata.
- Role nodes can be created from the Canvas menu and connected to content nodes.
- Pending Role suggestions render below the Role node, and accept/ignore/convert actions update their status.
- Agent context is filtered by selected chain, batch-delivery stage, and connected Role nodes before runtime execution.
- Canvas undo works for node and edge operations up to the configured cache depth.
- Approval still applies destructive writes through the backend approve path.
- QA nodes created during browser tests are deleted.

## Plan Artifacts

Conversation text is never automatically treated as a Canvas Artifact, and assistant messages do not expose a message-level write button. Explicit write commands, selected-text annotations, approved `canvas_write` proposals, and approved Plan `artifact_stage` deliveries remain supported. Plan artifacts use stable IDs and must belong to the currently running step.

`kind:"plan"` nodes are server-controlled read-only projections of `PlanRun`. Users may move, resize, fold, or delete a projection, but ordinary Canvas creation/edit/copy/undo paths cannot create or change its content. Deleting a projection does not cancel the Plan; the projection endpoint can recreate it.
Plan nodes are server-controlled read-only projections. They are created when a Plan becomes approval-ready and refreshed after step, Artifact, pause, failure, and completion changes. Deleting a Plan node deletes only the projection.
Direct Agent Canvas deliveries use stable delivery IDs. Structured text keeps the outline as its own summary node, then splits body nodes only at top-level Markdown H1 headings (`# Heading`). Nested H2-H6 headings remain inside the current body node, a body section remains one node even when it is long, and body text without H1 headings remains one body node. Retrying a delivery reuses existing ordered nodes and edges. Plan artifacts and ordinary Canvas write suggestions still use their own pagination behavior and may create `continues` edges.

Ordinary conversation never writes automatically. A response with at least three top-level points may display a lightweight persisted suggestion; only user acceptance commits its nodes.
