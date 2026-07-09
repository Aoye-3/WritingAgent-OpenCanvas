# ADR: Render Skill Selection In A Shared Dialog Layer

## Status

Accepted

## Date

2026-07-09

## Context

FacetWrite exposes per-message Skill selection from both the Home composer and the Canvas workspace toolbar. The same `SkillFolderPicker` content is reused in two different layout contexts:

- the composer sits inside card, drawer, and page layouts that may clip descendants with `overflow`;
- the Canvas toolbar sits inside the board shell, near draggable Canvas layers and right-side drawer surfaces;
- the Skill management view can be wider and taller than a local toolbar popover because it has folder, Skill list, and detail columns.

The previous implementation rendered the picker as local absolute menus: `.composer-skill-menu` in the composer and `.board-skill-menu` in the Canvas toolbar. Raising `z-index` was not enough because clipping and stacking contexts were created by ancestors outside the menu itself. This caused the expanded Skill panel to be cropped or visually hidden on both Home and Canvas.

## Decision

Render all Skill selection surfaces through a shared `SkillPickerDialog` mounted with a React portal to `document.body`.

The dialog owns only presentation and dismissal behavior:

- it renders the existing `SkillFolderPicker` unchanged;
- the Home composer and Canvas toolbar pass the same catalog, folder, enabled, disabled, and toggle props as before;
- the dialog layer uses fixed positioning and `z-index: var(--z-modal)`;
- it supports backdrop click, Escape, and an explicit close button;
- the dialog body scrolls inside the viewport instead of letting ancestor containers clip the picker.

`AIComposer` and `WorkspaceUtilityBar` should open the shared dialog directly. They must not reintroduce local `.composer-skill-menu` or `.board-skill-menu` popovers.

## Alternatives Considered

### Increase local menu z-index

Rejected. A higher z-index cannot escape ancestor clipping, local stacking contexts, or Canvas/drawer overflow constraints.

### Keep separate Home and Canvas menu implementations

Rejected. The two surfaces use the same Skill selection contract, and duplicate menu containers already drifted in behavior and dimensions. A shared dialog keeps dismissal, sizing, and scroll behavior consistent.

### Move Skill business logic into the dialog

Rejected. `SkillFolderPicker` remains the behavior owner for folder expansion, Skill toggling, management actions, and read-only state. The dialog is only the viewport-safe shell.

## Consequences

- Skill selection is no longer clipped by composer cards, drawers, Canvas containers, or toolbar parents.
- The same dismissal behavior applies on Home and Canvas.
- `SkillPickerDialog` becomes the required presentation wrapper for any new Skill picker entry point.
- Tests should assert that `AIComposer` and `WorkspaceUtilityBar` use `SkillPickerDialog`, the old local menu classes are absent, and `SkillFolderPicker` remains the shared content component.
- Browser verification should include Home and Canvas opening paths, Escape/close dismissal, internal scrolling, and Skill checkbox toggling.
