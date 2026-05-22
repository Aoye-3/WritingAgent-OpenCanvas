# FacetWrite Canvas

## Naming
OpenCanvas is the external product name for the AI canvas workspace and should be the primary visible brand. This document keeps the FacetWrite name for internal Canvas APIs, storage, and runtime ownership because those boundaries are not being renamed in this pass.

## Purpose
The Canvas is the visual workspace where generated or user-authored writing artifacts become editable nodes. It is a product surface owned by FacetWrite, not by AgentBackend or the provider runtime.

The Canvas has two separate responsibilities:

- Present and edit local node state in the browser.
- Apply AI-proposed writes only after FacetWrite records a pending write request and the user confirms it.

## Frontend Architecture
`src/features/workspace/components/DocumentCanvas.tsx` is the Canvas V2 renderer. It uses `@xyflow/react` as the pan/zoom/drag engine and keeps the existing FacetWrite Canvas API as the persistence boundary.

Current frontend responsibilities:

- Map persisted `CanvasNode` records into React Flow nodes.
- Render node bodies through a kind-based renderer boundary.
- Support viewport pan, wheel pan, Ctrl-wheel zoom, reset, selection, context-menu creation, node dragging, node resizing, title editing, content editing, and deletion.
- Persist node position after drag stop through `PATCH /api/threads/:threadId/canvas/nodes/:nodeId`.
- Persist node size after resize stop through the same PATCH endpoint.
- Persist title/content only on blur, not on every keystroke.

React Flow is only a view/interaction layer. It must not become the source of truth for node persistence.

## Node Model
The current node kinds remain:

```ts
type CanvasNodeKind = "document" | "note" | "reference";
```

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

## Resize Behavior
Canvas V2 uses a custom eight-handle resize frame rather than the default React Flow `NodeResizer`.

Reason: In the FacetWrite workspace layout, resize handles must be easy to hit without visually muddying the content frame. The custom resize frame is rendered as an outer selected-node outline around the actual node box, uses enlarged transparent hit targets with small visible handles, uses `nodrag nopan`, and updates React Flow visual state during the drag before persisting on pointer release.

Resize rules:

- Resize handles show only on the selected node.
- The selected outline and visible handles sit outside the actual node box.
- The visible handle is intentionally smaller than the actual pointer hit target.
- Dragging a corner changes width and height.
- Dragging an edge changes one dimension.
- Dragging north or west handles also changes `x` or `y`.
- During resize, React Flow node dragging, pane dragging, and position-change application are temporarily disabled for that gesture.
- Resize marks the node as manual layout in metadata so later auto-expansion does not fight the user's chosen frame.
- Persistence happens once on pointer release.

## Canvas Write Safety
Agent and AgentBackend output must never mutate Canvas nodes directly.

The only safe write path is:

```text
Agent/provider/AgentBackend intent
 -> canvas_write tool or explicit user write action
 -> canvas_write_requests row with status "pending"
 -> user confirmation or same-run explicit write intent
 -> approve endpoint
 -> canvas_nodes mutation
```

Frontend Canvas features such as drag, resize, title edit, and content edit are direct user edits and may call Canvas node CRUD endpoints directly. AI-originated content changes must stay behind the write-request approval path.

## API Boundary
Canvas V2 uses the existing API shape:

- `GET /api/threads/:threadId/canvas`
- `POST /api/threads/:threadId/canvas/nodes`
- `PATCH /api/threads/:threadId/canvas/nodes/:nodeId`
- `DELETE /api/threads/:threadId/canvas/nodes/:nodeId`
- `POST /api/threads/:threadId/canvas/write-requests`
- `POST /api/threads/:threadId/canvas/write-requests/:requestId/approve`
- `POST /api/threads/:threadId/canvas/write-requests/:requestId/reject`

No schema migration was required for Canvas V2 because `canvas_nodes` already stores position, size, kind, content, title, and metadata.

## Styling And Hit Testing
Canvas styles live in `src/app/styles.css`.

Important class roles:

- `.canvas-viewport`: React Flow host viewport.
- `.canvas-flow`: React Flow instance.
- `.canvas-node`: FacetWrite node shell.
- `.canvas-node-drag-handle`: header area used for node dragging.
- `.canvas-node-resize-frame`: selected-node resize outline rendered outside the actual node box.
- `.canvas-node-resize-handle`: resize controls.
- `.canvas-menu`: right-click creation menu.

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
- Canvas renders in the workspace.
- Background right-click menu creates `document`, `note`, and `reference` nodes.
- Node drag persists `x/y`.
- Node resize persists `x/y/width/height`.
- Title/content edit persists after blur.
- Delete removes the node.
- `canvas_write` still creates pending requests only.
- Approval still applies writes through the backend approve path.
- QA nodes created during browser tests are deleted.
