# Canvas Testing Guide

## Quality Gate

Run these commands before merging Canvas changes:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e:canvas
```

The architecture and encoding guards must pass on both LF and CRLF worktrees.

## Behavior Matrix

| Area | Unit / server coverage | Browser coverage |
| --- | --- | --- |
| Nodes | create, update, delete cleanup, kind conversion, history | create kinds, edit persistence, delete, undo |
| Semantic edges | storage cleanup, mind-chain helpers | create, select, delete, mind-chain draft |
| Workflow | stage, Role edges, suggestions, migration | stage inheritance, Role suggestions |
| Visual objects | strict writes, compatible reads, CRUD, history | shape search/recents, arrows, table edit, asset upload, undo, refresh |
| Tools | creation/persistent mode rules, default drafts | toolbar activation, overlays, pane hit testing |
| Boundaries | route/domain/repository guard, encoding guard | overlays do not block pan, zoom, selection, or context menu |

## Regression Checklist

- Invalid object kind, non-finite geometry, unknown shape id, malformed table rows, and direct asset metadata writes return `400 bad_request`.
- Legacy shape data using `{ "shape": "..." }` loads as `{ "shapeId": "..." }`.
- Unknown or malformed stored objects render as safe rectangle placeholders.
- Visual arrows never create semantic edges or enter mind chains.
- Asset bytes remain thread-local and are deleted with their asset object.
- Object drag, resize, table edits, deletion, undo, and refresh persistence continue to work.
- Shape library search, recent selections, close behavior, and localized labels remain accessible.
