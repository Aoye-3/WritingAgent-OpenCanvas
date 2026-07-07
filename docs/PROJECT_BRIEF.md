# FacetWrite Project Brief

## Naming
OpenCanvas is the external product name for users and should be the primary visible brand. FacetWrite remains a small technical lineage mark in the brand lockup and the internal engineering name used by code, API boundaries, data paths, and existing architecture docs.

## Product
FacetWrite is a local-first writing workspace for human-AI collaboration. It combines structured writing tasks, configurable Agent cards, a document Canvas, chat-based collaboration, project/thread history, and local provider settings.

The app is currently an MVP focused on Agent-assisted writing workflows rather than a general research agent platform.

## Target Users
- Students and educators drafting educational materials, summaries, outlines, and lesson plans.
- Writers who want structured AI assistance with visible context, drafts, and version history.
- Local-first builders testing Agent, Tool, and Canvas workflows before introducing cloud collaboration.

## Current Capabilities
- Start, Home, Projects, Agent Settings, AI Dashboard, App Updates, Knowledge Settings, and Workspace views.
- Local UI asset library under `public/assets/ui/`, with shared frontend references in `src/shared/brandAssets.ts`; see `docs/UI_ASSETS.md`.
- AI Dashboard view for Agent Runtime status, authenticated sidecar visibility, Skills/MCP overview, Agent mapping, and ToolUse bridge progress.
- App Updates view for desktop Shell/source-checkout updates. It previews and applies the allowlisted Source Git update path while protecting local Projects, secrets, Knowledge, Memory, uploads, thumbnails, SQLite files, and runtime caches.
- Neutral ChatAgent profile with compatibility aliases for historical task-card ids.
- Agent settings for prompt, tools, Skills, Knowledge, Memory, and MCP references. Model identity is selected per Thread from Model Config, not owned by Agent settings.
- Provider support through Model Config entries for DeepSeek, OpenAI, OpenAI-compatible providers, and explicit local Mock demonstration only.
- FacetWrite-owned Agent Runtime is the only real generation subsystem. The current runtime implementation is the AgentBackend adapter talking to a project-managed LangGraph-compatible Python Gateway; Docker is an explicit isolation/deployment mode.
- SQLite-backed threads, messages, runs, prompt versions, output versions, tool events, Agent settings, Canvas nodes, and Canvas write requests.
- Project management for local threads, including custom thread titles, recent-project rename, project-list rename, trash/restore, batch move to trash, and batch hard delete from trash.
- Canvas write workflow where the Agent can propose writes, selected assistant-response snippets can be annotated/highlighted, and user confirmation applies the write through the existing approval backend before Canvas content changes.

## MVP Boundaries
- The app is local-first and stores runtime data under `.facetwrite/`.
- Agent cards are predefined in code; the current UI edits settings for existing cards.
- `web_search`, `knowledge_base`, and `canvas_write` are in progressive Agent Runtime ToolUse/MCP bridging; not every configured capability is proven consumed by the runtime yet.
- Canvas write requests are internal ToolUse operations, not direct model-side mutations. The current UI may auto-submit approval after explicit user confirmation, but the Agent never writes Canvas silently.
- Knowledge settings and ingestion are current product surfaces; generation can use selected Knowledge Bases through FacetWrite-owned retrieval and the Agent Runtime bridge.

## Do Not Do Yet
- Do not expose high-risk tools that mutate user data without explicit approval.
- Do not describe FacetWrite as a competing main Agent runtime when the internal Agent Runtime is enabled; FacetWrite is the workspace/control plane.
- Do not treat archived research or historical plans as current implementation truth.
- Do not replace SQLite or introduce a large ORM before storage boundaries are intentionally refactored.
- Do not turn `README.md` into the main architecture document.
