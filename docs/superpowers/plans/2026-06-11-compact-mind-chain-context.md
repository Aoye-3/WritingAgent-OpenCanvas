# Compact Mind Chain Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach Canvas mind chains as compact hidden composer context and allow bounded vertical textarea resizing.

**Architecture:** Keep the formatted chain in `WorkspaceView` state as a typed attachment. Render only a compact removable chip in `AICollaborationDrawer`; pass the full text through `GenerateRequest.contextValues.canvasMindChain`, leaving `chatInstruction` and visible user messages unchanged.

**Tech Stack:** React 19, TypeScript, CSS, Node test runner, Playwright.

---

### Task 1: Define and route mind-chain attachment data

**Files:**
- Modify: `shared/canvasMindChain.ts`
- Modify: `src/features/workspace/components/DocumentCanvas.tsx`
- Modify: `src/features/workspace/components/WorkspaceMainCanvas.tsx`
- Modify: `src/features/workspace/WorkspaceView.tsx`
- Test: `server/canvasMindChain.test.ts`

- [ ] Add a failing test asserting the formatter returns both formatted text and node count.
- [ ] Run `npm test -- server/canvasMindChain.test.ts` and confirm the new assertion fails.
- [ ] Add a typed `CanvasMindChainContext` formatter and route it into `WorkspaceView` state.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Render compact hidden context and send it separately

**Files:**
- Modify: `src/features/workspace/components/AICollaborationPanel.tsx`
- Modify: `src/features/workspace/components/AICollaborationDrawer.tsx`
- Modify: `src/app/hooks/useGenerationRun.ts`
- Modify: `src/features/workspace/WorkspaceView.tsx`
- Test: `tests/e2e/canvas.spec.ts`

- [ ] Replace the old textarea-content assertions with failing checks for an empty textarea and a compact mind-chain chip.
- [ ] Add checks that the chip can be removed and that sending retains pure user-visible text.
- [ ] Implement attachment rendering, removal, successful-send clearing, and `contextValues.canvasMindChain` request routing.
- [ ] Run the focused Canvas Playwright test and confirm it passes.

### Task 3: Bound vertical composer resizing and verify the change

**Files:**
- Modify: `src/app/styles.css`
- Test: `tests/e2e/canvas.spec.ts`

- [ ] Add a failing computed-style assertion for vertical resize and a bounded maximum height.
- [ ] Add minimal chip styling and textarea `max-height`/overflow rules.
- [ ] Run `npm run typecheck`, focused unit tests, and the focused Playwright test.
- [ ] Inspect the rendered composer at desktop size and confirm no overlap with the tool row.
