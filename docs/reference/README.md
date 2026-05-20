# FacetWrite Reference Archive

This folder contains background material, research, and historical plans. These files are valuable context, but they are not the source of truth for the current implementation.

Use the maintained project documents first:

- `../PROJECT_BRIEF.md`
- `../ARCHITECTURE.md`
- `../API.md`
- `../DATABASE.md`
- `../AGENT.md`
- `../DECISIONS.md`
- `../REFACTOR_LOG.md`
- `../SECURITY.md`

## Folders
- `product-research/`: PRDs and product framing notes.
- `competitor-research/`: Jasper and Cherry analysis.
- `AgentBackend-research/`: AgentBackend architecture analysis and integration thinking.
- `historical-plans/`: Previous review and implementation plans.

Duplicate research copies that previously lived in `Plan/` were removed from the project root after their canonical versions were placed here.

## External Source Checkouts

Full third-party source trees belong under ignored `reference/sources/*`, not in tracked runtime paths. They are code references only:

- Do not import, build, or script against `reference/sources/*` from FacetWrite production/runtime code.
- When a mature external implementation is useful, copy the needed component, pattern, or contract into a FacetWrite-owned module and adapt it there.
- Do not rewrite mature capabilities from scratch just to avoid attribution; use reference code to move the MVP quickly, then make FacetWrite-specific adaptations in owned modules such as `AgentBackend/` and `server/agentBackend/*`.
- Record clone date, remote URL, and commit hash in maintained docs when the upstream version matters.

Current upstream reference source:

- `reference/sources/deer-flow/`
- Remote: `https://github.com/bytedance/deer-flow`
- Cloned for reference on 2026-05-20
- Commit: `9b19cca91c7d33dee2d39607edf19be3ef2e9558`

## Rule
Reference files can explain why an idea exists. Current behavior must be verified against code and the maintained technical docs.
