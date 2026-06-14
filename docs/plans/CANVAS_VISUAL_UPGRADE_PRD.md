# OpenCanvas Canvas-First Visual Upgrade PRD

## Objective

Make the Workspace feel like a canvas-first AI creation tool. When a user enters the board, the React Flow canvas should be the dominant visual surface, with project briefs and AI collaboration available as lightweight rails instead of large default columns.

This pass improves visual hierarchy, motion, and documentation without changing Canvas persistence, Agent write policy, node data models, or React Flow interaction contracts.

## Screenshot Diagnosis

- The previous default workspace used a left project/task drawer and a right AI drawer at the same time, leaving the canvas visually compressed.
- The top bar, previous full-width canvas header, bottom dock, and selection footer all competed for space.
- Large text blocks and form surfaces carried more visual weight than the canvas itself.
- The board background felt like an empty grid rather than a deliberate infinite-canvas surface.
- Existing collapse behavior was present, but not used as the default product posture.

## Success Metrics

- Desktop default state uses narrow left and right rails, with the center canvas occupying the clear majority of horizontal space.
- The bottom tool dock floats over the canvas without forcing a large reserved bottom gutter.
- The Canvas Board has no dedicated full-width header row; controls are compact floating chips inside the board.
- The canvas remains usable with left drawer open, right drawer open, both drawers open, and both drawers collapsed.
- Empty canvas, selected nodes, runtime state, and tool selection have visible but restrained visual states.
- Motion clarifies panel transitions and tool selection without altering data flow or requiring new user preferences.

## UX Requirements

- Default Workspace state:
  - Left project/task panel starts collapsed as a floating side menu.
  - Right AI collaboration panel starts collapsed as a floating side menu.
  - The canvas is immediately usable without expanding either side.
- Drawer behavior:
  - Floating side menus expand the existing panels; no new navigation model is introduced.
  - Drawer state is local session state only in this pass.
  - Expanded drawers keep the existing forms, chat, plans, and resizing behavior.
- Canvas behavior:
  - React Flow remains the pan, zoom, drag, selection, and connection layer.
  - The board uses one blueprint grid layer only; do not combine a CSS grid with a React Flow background grid.
  - Existing context menu creation and bottom dock creation tools remain available.
  - Bottom status and selection UI should be centered and compact instead of full-width.
  - Empty state should be concise and point users toward right-click or the tool dock.
- Top chrome:
  - Workspace top bar is compact and tool-like.
  - Runtime, stage, zoom, reset, and undo controls should feel like floating status/control chips, not a full-width board header or page hero content.

## Visual Direction

- Use Figma/Miro as inspiration for the infinite-canvas feel: light blueprint grid, floating controls, direct manipulation.
- Use Linear/Vercel as inspiration for density discipline: compact chrome, precise 1px structure, restrained color.
- Keep OpenCanvas as the visible brand and FacetWrite as the smaller lineage mark.
- Keep blue as the single primary action color.
- Use 8px as the default radius, with slightly larger radii only for floating docks and rails.
- Avoid decorative hero sections, heavy gradients, oversized copy, or marketing-style cards in the Workspace.

## Motion Requirements

- Add `motion` as the only new animation dependency.
- Import Motion for React from `motion/react`.
- Use Motion for:
  - drawer rail and drawer layout transitions,
  - bottom dock entrance,
  - active tool shared layout indicator,
  - small floating popovers such as conversation history,
  - empty canvas entrance/exit.
- Use CSS for simple hover, focus, and runtime status breathing.
- Respect `prefers-reduced-motion: reduce`.
- Animate only `transform` and `opacity` for transition-heavy states.
- Do not introduce GSAP, Three.js, or ReactBits as dependencies in this pass.

## Accessibility And Responsiveness

- Preserve existing ARIA labels and button semantics.
- Tool buttons remain icon buttons with `title` and `aria-label`.
- Focus states remain visible.
- Reduced-motion users should not receive continuous or large movement.
- Narrow viewports may keep existing stacked/mobile fallbacks; the desktop canvas-first layout is the primary first-round goal.

## Acceptance Checks

- `npm run typecheck`
- `npm run build`
- `npm run test:frontend`
- `npm run test:e2e:canvas`
- Playwright visual smoke at `1536x1024` and `390x844`.
- Manual smoke:
  - enter Workspace and verify both side panels are rails by default,
  - expand/collapse each side independently,
  - use bottom dock to switch tools,
  - right-click the canvas to open creation menu,
  - create/select a node and verify selection visuals,
  - verify empty canvas text disappears once nodes exist.

## Follow-Up Backlog

- Repair existing mojibake Chinese strings across Workspace components.
- Consider persisting drawer preference only after the first visual pass is validated.
- Consider a command palette or compact canvas minimap if canvas workflows grow.
- Explore richer ReactBits-inspired effects only where they help tool comprehension.
