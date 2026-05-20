# FacetWrite Knowledge Base

FacetWrite Knowledge Base is a server-owned RAG capability for local project context. It uses Cherry Studio's mature embedjs dependency stack as the engine while keeping FacetWrite's product boundary, Canvas model, and Agent runtime ownership.

## Runtime
- RAG engine: `@cherrystudio/embedjs`.
- Vector database: `@cherrystudio/embedjs-libsql`.
- Embeddings: OpenAI-compatible via `@cherrystudio/embedjs-openai`, or Ollama via `@cherrystudio/embedjs-ollama`.
- Loaders: text, JSON, uploaded local files, URL/Web, and sitemap.
- Runtime files: `.facetwrite/knowledge/<baseId>/vectors.db`.
- Main metadata tables: `knowledge_bases`, `knowledge_items`, and `knowledge_item_events`.

## Supported Sources
- `text` and `note`: indexed from inline text.
- `url`: loaded through the Web loader.
- `sitemap`: loaded through the Sitemap loader.
- `file`: loaded from a browser-selected upload encoded as `fileBase64` plus `fileName`.

The current UI is a layered management surface: a left Knowledge Base list, source-type tabs, an upload/import panel, indexed item list, and search test panel.

## Generation Flow
1. Agent settings enable knowledge through `settings.knowledge.enabled`.
2. `promptRunBuilder` searches selected `knowledge.baseIds`; if none are selected, all bases are eligible.
3. Results are injected into the user message as explicit Knowledge References.
4. The run records a `knowledge_search_completed` tool event with source metadata and scores.
5. Provider fallback and DeerFlow bridge tools reuse the same `KnowledgeService.search` path.

## Provider Direction
The current MVP reuses existing provider environment settings for embeddings. The next provider iteration should follow Cherry Studio's provider registry approach:

- one registry for provider metadata, docs links, base URL defaults, and model capabilities;
- model capability flags for chat, embedding, rerank, vision, tool use, reasoning, and web search;
- provider-specific base URL normalization behind the adapter layer;
- settings UI that edits provider records instead of scattering provider-specific logic across product features.

## Rerank
The API stores rerank provider/model/base URL settings and attempts a generic rerank call when enabled. If rerank fails, search falls back to vector similarity order and records `knowledge_rerank_failed`.

## Safety
- Knowledge search never exposes API keys in API responses.
- Failed provider errors are redacted when they look credential-related.
- OpenAI-compatible embeddings fail fast when `OPENAI_API_KEY` is missing instead of sending a placeholder key downstream.
- File imports no longer accept arbitrary local paths by default. The supported path is browser upload to `.facetwrite/knowledge/uploads/<baseId>/`, capped at 20MB per file.
- Local path import is only available for trusted self-use when `KNOWLEDGE_ALLOW_LOCAL_FILE_PATHS=true` and the resolved file is inside one of the `KNOWLEDGE_ALLOWED_IMPORT_ROOTS` directories.
- URL and sitemap imports only accept `http` and `https` schemes.
- Knowledge references are runtime context and citation metadata; they do not mutate Canvas unless a separate Canvas write proposal is approved.

## Dependency Audit
Knowledge MVP uses the Cherry Studio embedjs package family. After upgrading embedjs packages to `0.1.34` and adding safe npm overrides for `fast-xml-parser`, `file-type`, `js-yaml`, and `mammoth`, `npm audit --omit=dev` reports 18 remaining high vulnerabilities. These all originate from the upstream LangChain/LangSmith dependency chain used by `@cherrystudio/embedjs*`.

We intentionally do not override `langsmith` to `0.6.x` in this pass because `@langchain/core@0.3.80` declares `langsmith@^0.3.67`; forcing a cross-line override could silently break the RAG runtime. The runtime exposure is reduced by upload path isolation, URL scheme validation, credential redaction, and keeping Knowledge Base processing server-owned.
