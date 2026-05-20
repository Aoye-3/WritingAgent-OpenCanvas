# FacetWrite Project Brief

## Product
FacetWrite is a local-first writing workspace for human-AI collaboration. It combines structured writing tasks, configurable Agent cards, a document Canvas, chat-based collaboration, project/thread history, and local provider settings.

The app is currently an MVP focused on Agent-assisted writing workflows rather than a general research agent platform.

## Target Users
- Students and educators drafting educational materials, summaries, outlines, and lesson plans.
- Writers who want structured AI assistance with visible context, drafts, and version history.
- Local-first builders testing Agent, Tool, and Canvas workflows before introducing cloud collaboration.

## Current Capabilities
- Start, Home, Projects, Agent Settings, AI Dashboard, Knowledge Settings, and Workspace views.
- AI Dashboard view for AgentBackend runtime status, authenticated sidecar visibility, Skills/MCP overview, Agent mapping, and ToolUse bridge progress.
- Predefined Agent cards for blog posts, summaries, emails, lesson plans, report outlines, and rewrite/polish.
- Agent settings for model, prompt, tools, knowledge, memory, and quick messages.
- Provider support through DeepSeek, OpenAI, OpenAI-compatible, and mock fallback paths.
- AgentBackend Docker sidecar integration as the preferred AI execution/runtime plane when enabled, with the TypeScript provider runtime kept as fallback.
- SQLite-backed threads, messages, runs, prompt versions, output versions, tool events, Agent settings, Canvas nodes, and Canvas write requests.
- Project management for local threads, including custom thread titles, recent-project rename, project-list rename, trash/restore, batch move to trash, and batch hard delete from trash.
- Canvas write workflow where the Agent can propose writes, selected assistant-response snippets can be annotated/highlighted, and user confirmation applies the write through the existing approval backend before Canvas content changes.

## MVP Boundaries
- The app is local-first and stores runtime data under `.facetwrite/`.
- Agent cards are predefined in code; the current UI edits settings for existing cards.
- `web_search`, `knowledge_base`, and `canvas_write` are in progressive AgentBackend ToolUse/MCP bridging; not every configured capability is proven consumed by AgentBackend yet.
- Canvas write requests are internal ToolUse operations, not direct model-side mutations. The current UI may auto-submit approval after explicit user confirmation, but the Agent never writes Canvas silently.
- Knowledge settings exist as a product surface, but full knowledge ingestion is outside the current documented MVP.

## Do Not Do Yet
- Do not expose high-risk tools that mutate user data without explicit approval.
- Do not describe FacetWrite as a competing main Agent runtime when AgentBackend is enabled; FacetWrite is the workspace/control plane.
- Do not treat archived research or historical plans as current implementation truth.
- Do not replace SQLite or introduce a large ORM before storage boundaries are intentionally refactored.
- Do not turn `README.md` into the main architecture document.
