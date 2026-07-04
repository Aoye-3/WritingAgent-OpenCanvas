# FacetWrite Refactor Log

## 2026-06-07: Maintainability And Concurrency Review Planning
Scope: Inspected the FacetWrite-owned architecture and test suite, identified concurrency-risk boundaries, and created an executable review and test-supplement plan.

Findings:
- Existing route/domain/service/repository boundaries, SQLite transactions, approval-gated Canvas writes, and Agent Runtime auth-session deduplication provide a strong base.
- Highest-risk paths are Canvas approval state transitions, stale frontend async results, provider-config file writes, same-base Knowledge mutations, thread autosave ordering, and stream cancellation/finalization.
- Several large files remain review hotspots, but file size alone is not a reason to refactor.
- The current baseline passes `npm.cmd run typecheck`, 181 `npm.cmd test` checks, the production build, and all 7 Canvas Playwright tests.

Completed:
- Added `docs/superpowers/plans/2026-06-07-maintainability-concurrency-review.md`.
- Added the project-level `$review-maintainability-concurrency` shortcut Skill under `.agents/skills/`.
- Linked the plan from the technical documentation map and root README.
- Stabilized the architecture-boundary line-ending check and isolated Playwright on a non-reserved API port with enough time for Windows cold startup.

Open TODO:
- Execute the plan in priority order, starting with the mutable-workflow inventory and atomic Canvas approval transitions.
- Review `modules/agent-runtime/` separately after FacetWrite-owned concurrency invariants are covered.

Next Priority Check:
- Prove duplicate Canvas approvals and stale frontend responses are harmless before expanding product behavior.

## 2026-05-25: DOCX Knowledge Embedding Fix
Scope: Reproduced the DOCX upload path, fixed the OpenAI-compatible embedding URL used by Knowledge indexing, and verified the user's stuck DOCX item.

Findings:
- DOCX parsing was healthy: embedjs `LocalPathLoader` could extract chunks from both the repository proposal DOCX and the uploaded consent-form DOCX.
- The stored SiliconFlow embedding base URL was `https://api.siliconflow.cn`, while OpenAI-compatible embedding calls must target the `/v1` API root.
- The existing consent-form DOCX item was stuck in `processing` from the earlier failed run; after reindexing with the fixed URL path it completed and became searchable.

Completed:
- Normalized OpenAI-compatible Knowledge embedding base URLs to append `/v1` when the saved URL does not already end in an API version.
- Added DOCX Knowledge service tests covering uploaded DOCX indexing, fake OpenAI-compatible embedding requests, search retrieval, URL normalization, and failed indexing status.
- Made Knowledge base deletion tolerant of Windows/libSQL `EBUSY` vector-file handles after cache close, so cleanup does not fail user-visible deletes or smoke tests.
- Reindexed `Consent-Form-Template【IICL】.docx`; its item status is now `completed`, base status is `ready`, and search for `Informed consent form` returns DOCX chunks.

Validation:
- `node --import tsx --test server/knowledge/service.test.ts` passed with 6 tests.
- `npm.cmd test -- server/knowledge/service.test.ts` passed; the project script also ran the full server suite with 133 tests.
- `npm.cmd test` passed with 133 server tests.
- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed and retained the existing Vite main-chunk warning.
- Live DOCX smoke created an in-memory DOCX with a unique `DOCX-SMOKE-*` fact, indexed it through the configured SiliconFlow embedding API, searched the token successfully, and deleted the temporary base.
- Browser smoke against `http://127.0.0.1:3000/` confirmed Knowledge settings shows the DOCX item and renders search results from the indexed DOCX content.

## 2026-05-25: Knowledge Base Agent Readiness
Scope: Checked the current Knowledge RAG path for Agent generation, added deterministic coverage for Knowledge injection and ToolUse bridging, and exposed maintained Knowledge selection controls in Agent Settings.

Findings:
- `promptRunBuilder` already injected KnowledgeService results as `Knowledge References` when Agent knowledge was enabled and the `knowledge_base` tool was active.
- The missing risk was coverage and configuration visibility: Agent Settings did not expose selected base ids or retrieval parameters, and the ToolUse bridge did not forward `baseIds`.
- The local API had ready Knowledge Bases, but their item counts were empty during inspection, so they were not sufficient for a live model recall proof.

Completed:
- Added generation facade tests that stub a unique Knowledge fact, assert provider messages contain `Knowledge References`, assert disabled settings/tool state skip retrieval, and assert `baseIds`, `documentCount`, and `threshold` reach search.
- Added Tool Runtime tests that prove `knowledge_base` prefers KnowledgeService RAG output over context fallback and forwards selected base ids.
- Added optional `baseIds` to the `knowledge_base` tool schema and Tool Runtime call path.
- Expanded Agent Settings Knowledge UI/types to load Knowledge Bases, select all or specific bases, tune result count/threshold, and save through the existing Agent settings endpoint.
- Updated Knowledge, Agent, and Architecture docs with the current runtime behavior and test boundary.

Validation:
- `npm.cmd test -- server/services/generationService.facade.test.ts server/toolRuntime.test.ts server/routes/internalAgentBackendRoutes.test.ts` passed; this project script also runs the full `server/**/*.test.ts` suite.
- `npm.cmd test` passed with 130 server tests.
- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed and retained the existing Vite main-chunk warning.
- Playwright smoke against `http://127.0.0.1:3000/` confirmed Agent Settings -> Knowledge renders the base list, can select a base, saves through the UI, and `runtime-config` returns the selected `knowledge.baseIds`; the smoke restored the original Agent settings after verification.

Open TODO:
- Live Agent recall smoke still requires a ready Knowledge Base with indexed items plus configured embedding/chat APIs; empty bases only validate UI/API plumbing.
- Keep the thread routes test helper's bad-port retry; Node/Undici can reject randomly assigned browser-blocked ports when tests use `listen(0)`.

## 2026-05-25: Canvas Health Check And E2E Coverage
Scope: Confirmed the current branch was already pushed, ran a focused code-health scan, and tightened Canvas browser regression coverage without expanding into large refactors.

Findings:
- `git push origin HEAD` returned `Everything up-to-date`; `codex/canvas-node-settings` was already synchronized with `origin`.
- The largest remaining maintainability hotspots are still `src/app/styles.css`, `server/storage.ts`, `server/domains/model-config/providerApiConfigService.ts`, `server/knowledge/service.ts`, and several feature-level UI containers. These are known decomposition candidates, not blockers for this pass.
- Current source/test/doc scan found no remaining mojibake patterns in maintained `src/`, `server/`, `shared/`, `docs/`, or `tests` files touched by this pass.
- Production build still emits the existing Vite chunk-size warning for the main JS bundle; no code-splitting change was made in this narrow health pass.

Completed:
- Removed mojibake fallback label matching from Canvas E2E and kept the selectors tied to real English/Chinese labels.
- Added Canvas E2E coverage for title/content blur persistence, node kind conversion preserving content and geometry, and directed mind-chain behavior after an edge is deleted.
- Updated Canvas documentation to describe the expanded browser regression coverage.

Validation:
- `npm.cmd run test:e2e:canvas` passed with 3 tests after the E2E update.

Open TODO:
- Treat `src/app/styles.css` size and the large storage/knowledge/model-config service files as future scoped refactors, not opportunistic cleanup.
- Consider route-level code splitting or explicit chunk configuration in a separate frontend performance pass.
- Continue replacing historical mojibake labels in older UI fallback data when those files are already being touched for product work.

Next Priority Check:
- Run the full verification sequence before committing this pass: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run build`, and `npm.cmd run test:e2e:canvas`.

## 2026-05-20: Internal Agent Runtime Module Boundary
Scope: Promoted the previously tracked `AgentBackend/` subtree into a formal internal Agent Runtime module and added a stable FacetWrite runtime port.

Completed:
- Moved tracked AgentBackend source to `modules/agent-runtime/` while preserving Git rename history.
- Added `npm run agent-runtime:up/status/down` and kept `agent-backend:*` as compatibility aliases.
- Added `server/runtime/agentRuntimePort.ts`, `server/runtime/agentBackendAdapter/`, and `server/runtime/index.ts`.
- Added preferred `/api/agent-runtime/*` and `/api/internal/agent-runtime/tool-call` routes while keeping `/api/agent-backend/*` compatibility aliases.
- Updated frontend runtime status/dashboard calls to prefer Agent Runtime endpoints.
- Updated maintained runtime docs and added the new `docs/AGENT_RUNTIME_RUNBOOK.md`.

Validation:
- `npm.cmd run typecheck` passed after the runtime port and route migration.

Open TODO:
- Continue deeper storage, Knowledge, Canvas, and collaboration-drawer decomposition after this boundary pass.
- Run Docker sidecar acceptance with `npm run agent-runtime:up` after Docker is available.

## 2026-05-20: Modular Domain Boundary Checkpoint
Scope: Committed the dirty AgentBackend/model-config baseline, then started the current branch's architecture收束 pass on top of that checkpoint.

Completed:
- Created checkpoint commit `143540a` for the pre-existing AgentBackend rename and model/API binding baseline before further edits.
- Added `server/domains/generation/index.ts` as the public generation domain entry while keeping `server/services/generationService.ts` as a compatibility export.
- Added `server/domains/knowledge/` public entry plus model-config resolver helpers for embedding/rerank binding lookup.
- Kept model-config ownership under `server/domains/model-config/` and documented `server/services/modelListService.ts` / `server/services/providerApiConfigService.ts` as compatibility exports.
- Split frontend provider catalog/configured model API calls into `src/features/model-config/modelConfigClient.ts`; Agent and Knowledge settings now consume that client instead of the generic settings client.

Validation:
- `npm.cmd run typecheck` passed after backend domain boundary changes.
- `npm.cmd run typecheck` passed after frontend client split.

Open TODO:
- Run targeted model-config, generation, and knowledge tests, then the full suite.
- Continue migrating deeper Knowledge CRUD/indexing internals into focused domain modules after this low-risk boundary pass.

## 2026-05-18: Right-side AI Chat Real Streaming
Scope: Replaced the collaboration drawer's fake post-hoc chunking with real streaming status/token flow and updated maintained technical docs.

Findings:
- `/api/generate/stream` previously waited for `generateAndRecord` to finish and then sliced the final text into chunks, so the frontend still had a visible empty wait.
- DeerFlow already exposed useful SSE message chunks internally, while the provider fallback needed a streaming Chat Completions path.

Completed:
- Added provider streaming support behind `server/providerRuntime.ts` and `server/agentRunLoop.ts`.
- Forwarded DeerFlow assistant message chunks through the FacetWrite stream path.
- Added `status` SSE events and temporary assistant status/typewriter UI in the right-side collaboration drawer.
- Preserved final normalization, SQLite recording, ToolUse events, and Canvas write approval semantics.
- Updated `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/AGENT.md`, `docs/DEERFLOW_RUNTIME_RUNBOOK.md`, `docs/SECURITY.md`, and `docs/DECISIONS.md`.
- Confirmed `npm.cmd run typecheck` and `npm.cmd test` pass.

Open TODO:
- Validate with a live provider key and live DeerFlow sidecar in the browser to confirm perceived latency and real network chunk timing.
- Consider moving the typewriter queue into a reusable hook if another surface adopts streaming.

Next Priority Check:
- Browser-verify `http://localhost:5175/` chat streaming with a long prompt, desktop and narrow viewport, and console health.

## 2026-05-18: UI Primitive Layer And Workspace Layout Split
Scope: Started the all-app frontend layout and component-system pass after Canvas V2 stabilization.

Findings:
- `DESIGN.md` is now a maintained technical design document and belongs in `docs/`.
- The app needs a small FacetWrite-owned primitive layer rather than a third-party component library.
- Workspace data flow can stay intact while the left input drawer, main Canvas surface, and right AI collaboration panel become clearer layout boundaries.

Completed:
- Added `src/shared/ui/` with lightweight primitives for buttons, icon buttons, fields, segmented controls, chips, panels, tabs, drawers, dialogs, badges, and empty states.
- Migrated shared Topbar and AppSidebar to the primitive layer and repaired the most visible navigation/language Chinese labels.
- Split Workspace rendering into layout, Agent input drawer, main Canvas area, and AI collaboration panel components without changing Canvas or generation APIs.
- Updated Workspace utility bar to use shared tabs, panels, and buttons while preserving the rule that it does not inject hidden runtime context.
- Migrated Home, Projects, Start, Agent Settings, AI Dashboard, Knowledge Settings, and Project Settings surfaces onto the shared primitives where it was low-risk.
- Cleaned the most visible mojibake in navigation, start/home, projects, AI dashboard, knowledge settings, and Agent Settings labels.
- Moved the maintained design guide to `docs/DESIGN.md` and left root `DESIGN.md` as a pointer.
- Updated architecture and decision docs for the new UI primitive boundary.

Open TODO:
- Continue replacing feature-specific button/field class usage as pages receive future edits.
- Finish deep mojibake cleanup in lower-traffic labels through i18n-backed copy instead of scattered hardcoded strings.
- Add browser screenshots across the documented responsive breakpoints once the app has a regular visual regression harness.

Validation:
- `npm.cmd run typecheck`
- `npm.cmd run build`
- `npm.cmd test`
- Playwright smoke: Start page loads, Home renders after Start, Projects opens from sidebar, no page errors, and no mojibake in the checked surfaces.

Next Priority Check:
- Verify Canvas hit-testing and workspace drawer interactions after every visual primitive migration.

## 2026-05-16: Project Management And CanvasWriter Confirmation
Scope: Added project title management, batch project operations, and the first CanvasWriter proposal/annotation UX.

Findings:
- Project rows are currently thread rows, so rename should update `threads.title` and keep AgentCard title as secondary metadata.
- Canvas writes should become easier to confirm, but the Agent must still be unable to silently mutate Canvas.
- Highlighting selected assistant text must be integrated into Markdown rendering rather than replacing Markdown with plain text.

Completed:
- Added thread/project rename via `PATCH /api/threads/:threadId`, with title validation, updated timestamps, and Home/Projects refresh behavior.
- Added Projects batch selection, batch move to trash, and batch hard delete from trash.
- Changed CanvasWriter UX to show write proposals with `write all`, `write annotated snippets`, and `cancel`.
- Added assistant-response text selection, temporary annotation chips, and persistent in-message highlight for annotated snippets.
- Kept `canvas_write_requests` and approve/reject APIs as the backend safety boundary; frontend confirmation auto-submits approval only after explicit user intent.
- Extended Canvas write intent recognition for Chinese and English phrases such as `写入`, `保存到画板`, `save to canvas`, and `write this`.
- Updated Markdown rendering so annotation highlights preserve headings, lists, bold, code, and links.
- Verified `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build`, and Playwright checks for annotation/highlight and no console warnings/errors.

Follow-up:
- Added composer-level annotation chips above the chat input so users can see and remove selected snippets before sending a write command.
- Updated document Canvas nodes to show full document content without an internal scroll pane, and widened zoom to 25%-300% for both overview and close inspection.
- Fixed direct-write behavior so explicit write commands auto-approve only the newly generated pending request from the same run, instead of leaving a duplicate suggestion card.
- Normalized model-requested `replace` Canvas operations to append/create unless the user explicitly asked to replace or overwrite.
- Fixed Canvas center drag blocking by making the full-size visual grid layer ignore pointer events while keeping Canvas nodes interactive.

Open TODO:
- Add dedicated frontend component tests for annotation/highlight behavior if a browser test suite becomes part of regular CI.
- Consider persisting selected write snippets only if users later need cross-refresh draft state; current annotations are intentionally temporary.
- Add a Playwright regression that checks `elementFromPoint` at a blank Canvas coordinate hits the viewport rather than decorative layers.

Next Priority Check:
- Before expanding Canvas actions beyond document write/append, document the target-node selection rule and add browser coverage for replace/append edge cases.

## 2026-05-16: DeerFlow Runtime And ToolUse Bridge Stabilization
Scope: Implemented the first stable DeerFlow primary-runtime ToolUse bridge and updated runtime acceptance docs.

Findings:
- Local acceptance should use Docker Desktop plus DeerFlow Docker Compose; Windows native `make/nginx` is a fallback development path, not the main validation path.
- DeerFlow needs FacetWrite per-run tool context so bridge calls can reuse the existing Tool catalog policy and Canvas approval boundary.
- `web_search` should remain DeerFlow built-in ToolUse, while FacetWrite local tools bridge through a controlled callback.

Completed:
- Added `/api/internal/deerflow/tool-call` with internal-source checks and reuse of `executeToolCall`, Tool policy, and Canvas pending request creation.
- Passed bridge context from FacetWrite DeerFlow run requests: allowed tool refs, effective tool state, explicit context values, selected Canvas node, and current instruction.
- Added DeerFlow `deerflow.tools.facetwrite_bridge` tools for `knowledge_base`, `clear_context`, and `canvas_write`.
- Registered FacetWrite bridge tools in DeerFlow `config.yaml` and `config.example.yaml`.
- Switched the local DeerFlow model config to `PatchedChatDeepSeek` so DeepSeek reasoning metadata survives multi-turn tool-call conversations.
- Updated AI Dashboard bridge states so FacetWrite tools show `facetwrite_bridge` and DeerFlow `web_search` shows `deerflow_builtin`.
- Added `docs/DEERFLOW_RUNTIME_RUNBOOK.md` and updated architecture, API, Agent, env, and DeerFlow troubleshooting docs.

Open TODO:
- Add higher-level UI assertions for displayed DeerFlow ToolUse events once the workspace timeline consumes DeerFlow's final `values` tool metadata directly.
- Consider adding persisted recent ToolUse bridge events to the AI Dashboard after the runtime stream shape is validated.

Next Priority Check:
- Preserve the Docker sidecar acceptance checklist from `docs/DEERFLOW_RUNTIME_RUNBOOK.md` in future runtime changes and treat Provider/Mock fallback as a failure for DeerFlow acceptance unless intentionally testing fallback.

## 2026-05-15: Maintainability Boundary Refactor
Scope: Implemented the first maintainability pass from the control-plane/execution-plane review.

Findings:
- The current code already reflects several earlier refactors: route/service split, shared frontend API client, Tool catalog/policy, runtime config, DeerFlow auth, and AI Dashboard.
- Remaining high-risk areas were App-level workflow concentration, Agent definition concentration, runtime tool policy enforcement, provider type drift, and local settings write safety.

Completed:
- Fixed frontend generation provider typing so DeerFlow responses are accepted as first-class generation results.
- Added `server/security/policies/settingsWritePolicy.ts` and tests so production runtime does not write `.env.local` unless explicitly enabled.
- Changed generation route validation failures to report `bad_request` instead of always `internal_error`.
- Split Agent definitions into `server/agents/types.ts`, `server/agents/cards/builtInCards.ts`, `server/agents/prompts.ts`, `server/agents/defaultSettings.ts`, and `server/agents/loader.ts`, with `server/agentCards.ts` kept as the compatibility export.
- Repaired built-in AgentCard Chinese copy while moving card definitions.
- Added `server/tools/toolPolicyGuard.ts` and tests for disabled or Agent-disallowed tool calls.
- Extracted `src/app/hooks/useThreadSession.ts`, `useCanvasState.ts`, `useGenerationRun.ts`, and `useProjectTrash.ts`; `App.tsx` now composes these control-plane hooks instead of owning every workflow directly.
- Preserved current API success response shape, SQLite schema, TypeScript fallback runtime, and read-only DeerFlow Dashboard boundary.

Open TODO:
- Split `ProjectSettingsPanel` and `AgentSettingsView` into smaller UI tab/form components.
- Split `server/storage.ts` only after adding facade-level regression tests.
- Split `server/services/generationService.ts` into DeerFlow runner, provider runner, mock fallback, prompt builder, and recorder modules.
- Continue DeerFlow ToolUse/MCP bridge validation for CanvasWrite, KnowledgeBase, and WebSearch.

Next Priority Check:
- Verify the new hooks with browser smoke tests around opening a new Agent, restoring a thread, generating, and approving/rejecting Canvas write requests.

## 2026-05-15: Architecture Stabilization Second Pass
Scope: Continued maintainability stabilization on the `codex/maintainability-refactor` branch.

Findings:
- `docs/plans/*` and `开发日志` still contain pre-existing or parallel edits and should stay separate from architecture-stabilization commits.
- `storage.ts` and `generationService.ts` needed facade-level tests before further splits.
- Settings pages were still carrying data loading, save logic, and tab rendering in the same components.

Completed:
- Added `docs/REFACTOR_BRANCH_INVENTORY.md` to classify in-scope architecture changes versus unrelated planning/log changes.
- Added storage facade tests covering thread directories, runs, messages, output versions, tool events, project summaries, trash/restore/delete, Canvas nodes, Canvas write approval/rejection, and Agent settings.
- Added generation facade tests covering DeerFlow, provider, mock fallback, tool context, and clear-context behavior.
- Split generation orchestration into `server/services/generation/` modules for prompt/run context, DeerFlow runner, provider runner, mock fallback, and run recording.
- Extracted SQLite initialization and schema migration to `server/db/sqlite.ts` and `server/db/schema.ts`.
- Introduced repository boundaries under `server/repositories/`, with thread and Agent settings behavior delegated behind the existing storage facade.
- Split `ProjectSettingsPanel` into `useProjectSettings`, `ProviderSettingsForm`, and `DeerFlowRuntimePanel`.
- Split `AgentSettingsView` into `useAgentRuntimeConfig` and `AgentSettingsTabs`, with clean Chinese labels for the settings UI.

Open TODO:
- Continue migrating Canvas and run persistence from the storage facade into the new repository classes.
- Add browser-level smoke coverage when Playwright or an equivalent browser test dependency is available.
- Decide whether `clear_context` should remain enabled by default for all built-in Agent cards or become an explicit per-run control.

Next Priority Check:
- Before MVP feature work, manually verify workspace generation, chat, Canvas write approval, Project Settings, Agent Settings, and AI Dashboard in the browser.

## 2026-05-15: Technical Documentation Maintenance
Scope: Refreshed maintained docs after the AI Dashboard and DeerFlow runtime control-plane implementation.

Findings:
- Core architecture, Agent, API, and decision docs already described the DeerFlow execution-plane direction.
- `PROJECT_BRIEF.md` still under-described AI Dashboard and DeerFlow as current runtime capabilities.
- `SECURITY.md` needed explicit backend-only DeerFlow session and MCP redaction rules.
- The docs set needed a lightweight entry map so future AI-assisted reviews know which file to update.

Completed:
- Added `docs/README.md` as the technical documentation map and update-rule guide.
- Updated `PROJECT_BRIEF.md` with AI Dashboard, DeerFlow runtime sidecar, and progressive ToolUse/MCP bridge status.
- Updated `SECURITY.md` with DeerFlow auth/session, protected endpoint, redaction, and approval-boundary notes.

Open TODO:
- Keep updating docs whenever CanvasWrite, KnowledgeBase, or WebSearch become verified DeerFlow Tool/MCP executions.
- Add recent run/event history documentation if the AI Dashboard begins showing persisted runtime events.

Next Priority Check:
- Before the next Agent runtime bridge, compare `AGENT.md`, `API.md`, and `SECURITY.md` against the code path being changed.

## 2026-05-15: AI Dashboard And DeerFlow Control Plane
Scope: Added a read-only AI Dashboard and DeerFlow dashboard aggregation API.

Findings:
- Dashboard aggregation initially triggered duplicate DeerFlow setup-status checks through concurrent status/config reads; DeerFlow rate-limits that endpoint.
- The DeerFlow auth helper needed an in-process pending session promise so concurrent protected requests share one setup/login flow.
- The user-facing distinction is Agent settings for concrete Agent configuration versus AI Dashboard for runtime/control-plane observability.

Completed:
- Added `GET /api/deerflow/dashboard`.
- Added dashboard payloads for runtime status, Skills/MCP overview, Lead Agent metadata, AgentCard-to-DeerFlow subagent mappings, ToolUse bridge status, and integration maturity.
- Added the `AI仪表盘` / `AI Dashboard` sidebar entry between Agent settings and Knowledge settings.
- Added the AI Dashboard page with runtime metrics, capabilities, mapping table, ToolUse bridge cards, and maturity indicators.
- Updated sidebar labels to clean current Chinese copy for the shared sidebar.
- Added unit tests for dashboard aggregation and concurrent DeerFlow auth session setup.
- Verified dashboard API returns `runtime:"deerflow"`, `reachable:true`, `authState:"authenticated"`, 21 Skills, 3 MCP servers, 6 Agent mappings, and 5 ToolUse bridge entries against the running Docker sidecar.

Open TODO:
- Add richer DeerFlow run-event and ToolUse execution visibility in the workspace.
- Bridge CanvasWrite, KnowledgeBase, and WebSearch into DeerFlow Tool/MCP execution while keeping FacetWrite approval for writes.
- Decide whether AI Dashboard should show recent run/event history after multiple Task-card validations.

Next Priority Check:
- Implement DeerFlow ToolUse / MCP execution visibility so the frontend shows actual tool calls, inputs, outputs, artifacts, and approval requests.

## 2026-05-15: AI Dashboard And DeerFlow Control Plane Plan
Scope: Saved the AI Dashboard plan before implementation.

Findings:
- Agent settings and AI Dashboard have different jobs: Agent settings grants user control over concrete Agent configuration; AI Dashboard exposes runtime status and integration maturity.
- FacetWrite should be described as workspace/control plane, while DeerFlow is the AI execution/runtime plane.
- CanvasWrite and similar capabilities should be described as progressively bridged to DeerFlow ToolUse while preserving FacetWrite approval and data boundaries.

Completed:
- Added `docs/plans/AI_DASHBOARD_DEERFLOW_CONTROL_PLANE_PLAN.md`.
- Captured the planned navigation entry, dashboard API, read-only UI, terminology shift, tests, and documentation updates.

Open TODO:
- Implement `/api/deerflow/dashboard`.
- Add the AI Dashboard frontend view and sidebar entry.
- Update technical docs after implementation.

Next Priority Check:
- Build the backend dashboard aggregation first so the UI can stay thin and read-only.

## 2026-05-15: DeerFlow Auth Session Run
Scope: Implemented backend-managed DeerFlow local-session auth and validated one real sidecar generation.

Findings:
- DeerFlow protected APIs require a session cookie and CSRF token for state-changing requests.
- DeerFlow first-boot setup can return 422 if the configured email fails DeerFlow validation; `facetwrite-local@example.com` works for local setup.
- DeerFlow `/api/v1/auth/setup-status` is rate-limited, so manual validation may need to wait for its cooldown after repeated checks.

Completed:
- Added `server/deerflow/auth.ts` for setup-status, optional initialize, login, session-cookie/CSRF extraction, in-memory cache, and one retry after 401/403.
- Routed `/api/skills`, `/api/mcp/config`, and `/api/runs/stream` through authenticated DeerFlow fetch.
- Extended `/api/deerflow/status` with `authState`.
- Updated Project Settings DeerFlow runtime display for authenticated, setup-required, auth-required, auth-failed, unreachable, and fallback states.
- Added `.env.local.example` DeerFlow auth fields.
- Added unit coverage for setup-required, auto-setup, login, safe auth errors, 401/403 retry, config proxy auth, and run stream auth headers.
- Validated Docker sidecar health, `authState:"authenticated"`, config overview, and one Summary Task-card generation returning provider `deerflow`.

Open TODO:
- Add a more user-friendly setup/reset note for DeerFlow local credentials in docs if this becomes part of regular onboarding.
- Consider exposing recent DeerFlow auth/runtime errors near generation results instead of only in Project Settings.
- Decide later whether FacetWrite needs per-user DeerFlow identity mapping.

Next Priority Check:
- Review DeerFlow stream wire shape and event semantics from several built-in Task cards before expanding ToolUse bridging.

## 2026-05-15: DeerFlow Auth Session Run Plan
Scope: Saved the automatic DeerFlow local-session auth plan before implementation.

Findings:
- DeerFlow Docker sidecar health/status is online, but protected endpoints require auth.
- DeerFlow exposes public setup/login endpoints and protected API routes behind cookie plus CSRF behavior.
- FacetWrite should keep DeerFlow session cookies server-side only.

Completed:
- Added `docs/plans/DEERFLOW_AUTH_SESSION_RUN_PLAN.md`.
- Captured the planned env configuration, backend session helper, authenticated fetch behavior, frontend status states, tests, and documentation updates.

Open TODO:
- Implement backend DeerFlow auth/session handling.
- Wire config proxy and run stream requests through authenticated fetch.
- Validate one real DeerFlow-backed Task-card generation.

Next Priority Check:
- Start with unit-tested auth/session helper behavior before wiring protected endpoints.

## 2026-05-15: DeerFlow Docker Sidecar Run
Scope: Ran the Docker sidecar path and validated the first real FacetWrite-to-DeerFlow runtime checks.

Findings:
- Workspace-local `DOCKER_CONFIG` avoids the user-level Docker config access-denied warning.
- DeerFlow Compose can start nginx/gateway/frontend through `Deerflow/docker/docker-compose-dev.yaml` with project name `deer-flow-dev`.
- A copied example `Deerflow/config.yaml` needs at least one concrete model entry; an empty/comment-only `models:` block causes gateway startup validation to fail.
- DeerFlow `/health` is public and returns healthy through nginx at `http://127.0.0.1:2026`.
- FacetWrite `/api/deerflow/status` reports `enabled:true`, `reachable:true`, and `runtimeProvider:"deerflow"` when pointed at the Docker sidecar.
- DeerFlow `/api/skills`, `/api/mcp/config`, and `/api/runs/stream` are protected in the Docker runtime. FacetWrite config proxy reports safe errors for 401, and generation reaches DeerFlow but receives HTTP 403 until auth is wired.

Completed:
- Added `.docker-codex/` to `.gitignore`.
- Generated ignored local DeerFlow config/env files needed for Docker startup without printing secrets.
- Started Docker Desktop and DeerFlow Compose services.
- Confirmed sidecar health and FacetWrite runtime status are online.
- Confirmed config proxy does not leak secrets when DeerFlow protected endpoints return auth errors.
- Attempted one Task-card generation and recorded the auth blocker instead of expanding ToolUse or bypassing DeerFlow auth.

Open TODO:
- Complete DeerFlow first-boot setup or implement a FacetWrite service-to-service auth flow for protected DeerFlow endpoints.
- Re-run `/api/deerflow/config` after auth and confirm skills/MCP overview is populated.
- Re-run one Task-card generation and confirm provider `deerflow` only after `/api/runs/stream` accepts authenticated requests.
- Add user-facing error affordance near generation results if DeerFlow is enabled but protected endpoints reject requests.

Next Priority Check:
- Decide the DeerFlow auth strategy: automated setup/login cookie/token handling in the FacetWrite adapter, or a documented DeerFlow development auth mode if the project supports one.

## 2026-05-15: DeerFlow Docker Sidecar Run Plan
Scope: Saved the Docker sidecar execution plan before implementation.

Findings:
- DeerFlow includes Docker Compose files for nginx/gateway startup.
- Docker CLI is available, but reading `C:\Users\123\.docker\config.json` reports an access-denied warning.
- FacetWrite currently reports DeerFlow disabled and uses TypeScript fallback.

Completed:
- Added `docs/plans/DEERFLOW_DOCKER_SIDECAR_RUN_PLAN.md`.
- Captured the intended Docker execution path, sidecar URL, FacetWrite env values, validation checks, and layer-boundary constraints.

Open TODO:
- Run Docker commands with a workspace-local `DOCKER_CONFIG`.
- Start DeerFlow nginx/gateway through Compose.
- Validate FacetWrite `/api/deerflow/status` and one DeerFlow-backed Task-card generation if credentials are available.

Next Priority Check:
- Generate missing DeerFlow local config files and start the Docker sidecar.

## 2026-05-15: DeerFlow Runtime Observability And Live Validation
Scope: Implemented DeerFlow runtime status/config visibility and attempted real sidecar validation.

Findings:
- FacetWrite can safely expose DeerFlow runtime status through a dedicated backend route without mixing it into provider settings validation.
- DeerFlow Skill/MCP visibility should remain read-only for now, with secret-like MCP fields redacted before reaching the UI.
- Real sidecar validation could not complete in this environment: `uv` found CPython 3.12.12 and started dependency setup, but failed while downloading/caching `langfuse==4.5.1` due to Windows cache rename permission errors (`os error 5`, access denied).

Completed:
- Added `/api/deerflow/status`.
- Added `/api/deerflow/config`.
- Added backend tests for disabled, reachable, unreachable, skills read, MCP redaction, and safe unreachable config behavior.
- Added Project Settings DeerFlow runtime visibility with status, base URL, assistant ID, skill count, and MCP server overview.
- Confirmed `npm.cmd run typecheck` and `npm.cmd test` pass before documentation review.
- Cleaned temporary `.venv` and `.uv-cache` artifacts created by the failed sidecar setup attempt.

Open TODO:
- Retry live sidecar validation in an environment where `uv` can complete dependency installation and cache writes.
- Confirm `/api/runs/stream` wire shape against a running DeerFlow backend.
- Add UI affordance for showing recent DeerFlow runtime errors near generation results if live validation reveals user-facing failure cases.

Next Priority Check:
- Fix the local DeerFlow Python/uv environment or run the sidecar in a clean container, then perform one Task-card end-to-end generation with `DEERFLOW_ENABLED=true`.

## 2026-05-15: DeerFlow Runtime Live Validation Plan
Scope: Saved the next DeerFlow runtime plan before implementation.

Findings:
- The first DeerFlow backend adapter slice is implemented and committed.
- The next priority is real sidecar validation, runtime observability, and read-only shared Skill/MCP configuration visibility.

Completed:
- Added `docs/plans/DEERFLOW_RUNTIME_LIVE_VALIDATION_PLAN.md`.
- Captured the required execution order: save plan, commit baseline, implement and validate, review, update docs, and commit implementation.

Open TODO:
- Add DeerFlow runtime status API and frontend visibility.
- Add read-only DeerFlow Skill/MCP config proxy behavior.
- Attempt real DeerFlow sidecar validation and record the result.

Next Priority Check:
- Start by implementing runtime status and safe read-only config proxy tests.

## 2026-05-15: DeerFlow Runtime Adapter First Slice
Scope: Implemented the first backend slice of the DeerFlow Agent runtime integration.

Findings:
- DeerFlow can be introduced through the stateless `/api/runs/stream` Gateway endpoint without changing the FacetWrite SQLite schema in this slice.
- The current `generationService` is the right integration point because it already owns prompt construction, thread creation, run recording, and fallback behavior.
- FacetWrite's existing `ToolEventRecord` needed to accept DeerFlow subagent events in addition to local tool-call events.

Completed:
- Added `server/deerflow/config.ts`, `server/deerflow/client.ts`, `server/deerflow/sse.ts`, and `server/deerflow/taskAgentMapping.ts`.
- Added `DEERFLOW_ENABLED`, `DEERFLOW_BASE_URL`, and `DEERFLOW_ASSISTANT_ID` runtime configuration.
- Routed generation through DeerFlow when enabled, while keeping the existing TypeScript provider runtime available when disabled.
- Mapped FacetWrite AgentCards to DeerFlow subagent metadata.
- Mapped DeerFlow custom `task_*` stream events into persisted `deerflow_*` tool events.
- Added unit tests for request construction, SSE parsing, stream reading, and Task-card subagent mapping.

Open TODO:
- Start and validate against a real DeerFlow backend process.
- Add frontend settings/status surfaces for DeerFlow availability and shared Skill/Tool config.
- Add controlled bridge behavior for DeerFlow-proposed Canvas writes rather than exposing direct database writes.
- Expand the first real Task-card run into all built-in Task cards after the end-to-end path is stable.

Next Priority Check:
- Run FacetWrite with `DEERFLOW_ENABLED=true` and verify one Task-card generation against a live DeerFlow sidecar.

## 2026-05-15: DeerFlow Agent Runtime Integration Plan
Scope: Saved the DeerFlow main-agent and FacetWrite subagent runtime integration plan for later implementation.

Findings:
- FacetWrite should pursue a serious Agent runtime by directly integrating DeerFlow as the intelligent orchestration layer, rather than only treating it as reference code.
- The preferred architecture is DeerFlow Lead Agent as the main agent, with FacetWrite Task cards mapped to configured subagents.
- FacetWrite should continue to own frontend interaction, persistence, Canvas state, and human-in-the-loop approval.

Completed:
- Added `docs/plans/DEERFLOW_AGENT_RUNTIME_INTEGRATION_PLAN.md`.
- Captured the planned DeerFlow sidecar runtime boundary, Task-card subagent mapping, shared Skill/Tool configuration, HITL rules, event streaming, documentation updates, and test plan.

Open TODO:
- Implement the DeerFlow backend adapter and environment configuration.
- Add TaskCard to DeerFlow subagent mapping.
- Wire DeerFlow streaming events into the existing FacetWrite generation/run event flow.
- Keep Canvas writes and external side effects behind pending user approval.
- Update `docs/ARCHITECTURE.md`, `docs/AGENT.md`, `docs/API.md`, `docs/DATABASE.md`, and `docs/DECISIONS.md` as implementation begins.

Next Priority Check:
- Start with one real Task-card generation loop routed through DeerFlow while keeping the current TypeScript runtime as fallback.

## 2026-05-15: Technical Documentation Architecture
Scope: Organized project documentation around current code facts and archived historical planning/research material.

Findings:
- `docs/` previously mixed current security notes with PRD, competitor analysis, DeerFlow research, and implementation plans.
- Current code has already implemented several historical plan items: route/service split, Tool catalog/policy, Agent runtime config, Provider runtime, Canvas write requests, and SQLite persistence.
- The remaining maintainability risks should be tracked as current refactor work rather than rediscovered from old plans.

Completed:
- Planned seven maintained technical documents: project brief, architecture, API, database, Agent/Tool, decisions, and refactor log.
- Classified historical research and Plan files as references instead of current implementation truth.
- Moved root PRD, duplicated `Plan/` research files, and existing `docs/` research files into `docs/reference/`.
- Preserved `SECURITY.md` as the active security document.

Open TODO:
- Fix mojibake Chinese copy in AgentCard data and any remaining UI text.
- Continue reducing `src/app/App.tsx` responsibilities by moving thread, Canvas, and generation orchestration into focused hooks.
- Split `server/storage.ts` into schema/client/repository/service layers when storage behavior changes next.
- Continue tightening runtime validation for API boundaries.

Next Priority Check:
- Audit Agent settings save/load after the new Skill catalog UI commit.
- Verify `canvas_write` cannot be enabled outside policy or applied without approve.
- Review API response consistency across frontend clients.

# 2026-06-08: Electron Development App Shell

Scope: Added the Windows source-development application shell and documented its lifecycle boundary.

Completed:
- Added single-instance Electron Splash/main windows with secure renderer settings.
- Added ordered Docker, Agent Runtime, API, and Vite readiness checks.
- Added owned-versus-reused Agent Runtime detection and idempotent full cleanup.
- Routed Windows `.cmd` child processes through `ComSpec` to avoid Node `spawn EINVAL`.
- Removed npm/cmd wrappers from shell-owned Vite and API processes so closing and restarting cannot leave the API listener behind.
- Added hidden double-click launcher, shell tests, fixed shell ports, and callback injection.
- Replaced planned Vite port `3100` with `17776` after Windows dynamically reserved `3007-3106`.
- Verified a real shell-owned startup and shutdown leaves no listeners on `17776`, `17777`, or `2026`, and no Agent Runtime containers.

Deferred:
- Packaged executable, installer, signing, and automatic updates.
- Native local Agent Runtime for machines without Docker.

## 2026-06-12 - Structured Plan Chain

- Added project-local `brainstorming` and `writing-plans` skills and forced phase loading.
- Added persisted structured Plan clarification and Codex-style choice UI.
- Added one-approval sequential execution with per-step committed Artifact enforcement.
- Removed assistant-message-level Canvas write buttons while preserving explicit and approved write paths.
- Added local Runtime source fingerprint reuse checks and metadata-aware status detection.
## 2026-06-13 - Plan Orchestration And Feedback

- Replaced broad model-driven Plan lifecycle calls with phase-scoped clarification/revision/artifact contracts.
- Added persistent Plan execution/activity state, server-owned step advancement, pause/resume, stable Artifact completion checks, and read-only Canvas Plan projections.
- Routed safe Plan/tool activity into the visible conversation timeline and removed the React multi-step execution loop.

## 2026-06-13 - Agent Canvas Write Chain

- Added deterministic Canvas action recognition and one-shot Runtime tool forcing.
- Fixed the internal Bridge to resolve the real Project from the Thread.
- Made create/append direct and idempotent while preserving destructive approval.
- Added structured Canvas lifecycle events, accurate outcome summaries, and immediate frontend refresh feedback.
- Added schema v8 orphan-request repair and stale protection.
- Replaced repeated Plan tool forcing with stable phase attempt ids and stage-specific submissions.
- Added server-created intake Plans, leased server-side sequential execution, startup recovery, compact activity rows, and visible Plan skill usage.
- Removed the legacy model-callable `plan_update` catalog and runtime branch; historical Plan events remain read-only.
- Added token-only internal Bridge authentication, sanitized Tool events, executor lease heartbeats, persistent Canvas write suggestions, and stable multi-node Artifact delivery.

## 2026-06-28 - Runtime Clarification And File Delivery Reconciliation

Scope: Fixed an Agent Runtime final-delivery failure where a run continued after a clarification event but was still recorded as waiting for user input.

Completed:
- Investigated the latest failed run and confirmed it executed search/tool work, wrote Markdown files, and called `present_files`, but retained `finishReason:"clarification_required"` because an earlier clarification event poisoned final state.
- Updated the AgentBackend stream adapter so substantive post-clarification progress clears the waiting interpretation.
- Updated generation finalization so blocking clarification requires no later progress, stream Plan postconditions receive the complete event set, and presented Markdown files can create `file_document` nodes even when assistant chat text is empty.
- Added regression coverage for clarification followed by continued tool execution and progressive file delivery.

Validation:
- `node --import tsx --test server/services/generationService.facade.test.ts server/runtime/agentBackendAdapter/client.test.ts`
- `node --import tsx --test server/planRuntime.test.ts`
- `npm.cmd run typecheck`

## 2026-06-28 - Markdown File Preview Source Thread Fix

Scope: Fixed `file_document` Markdown preview 404s when a Project-level Canvas node was opened from a different Thread than the one that generated the output file.

Completed:
- Confirmed archived Markdown files live under `.facetwrite/threads/<threadId>/user-data/outputs/`, while Canvas nodes are Project-level and can be viewed from sibling Threads.
- Added `metadata.fileDocument.threadId` to newly generated Markdown file nodes.
- Added frontend preview target resolution that uses explicit source Thread metadata and recovers legacy generated nodes from `deliveryId`.

Validation:
- `node --import tsx --test tests/frontend/fileDocumentPreviewTarget.test.ts`
- `node --import tsx --test server/services/generationService.facade.test.ts`
- `npm.cmd run typecheck`

## 2026-06-28 - Runtime Budget And Clarification Repair Maintenance

Scope: Documented and verified the low-first runtime budget profile changes and Agent-owned repair for invalid clarification option counts.

Completed:
- Changed the maintained budget defaults to low `8/2/18/80/16`, medium `12/3/24/110/22`, and high `16/4/32/140/28`.
- Kept the Project default on `low`; composer budget choices remain per-run overrides unless saved in Project runtime settings.
- Documented that `too_many_options` clarification payloads should trigger one Agent Runtime clarification-only repair pass instead of Node/frontend truncation.
- Updated Agent architecture, Runtime runbook, AgentBackend runbook, and technical decisions.

Validation:
- `npm.cmd run typecheck`
- `node --import tsx --test server/routes/threadRoutes.test.ts server/runtime/agentBackendAdapter/client.test.ts server/services/generationService.facade.test.ts`
- `npm.cmd run test`

## 2026-06-29 - Claim Review Create/Delete Flow

Scope: Simplified the Markdown Claim review queue from an accept/reject review flow into direct selected-candidate creation and deletion.

Completed:
- Replaced batch `Accept selected` / `Reject selected` with `Create selected` / `Delete selected`.
- Removed the persistent evidence block from candidate cards and promoted source highlight as the inspection interaction.
- Changed candidate cards and created Claim nodes to use stable `摘要 N` display names.
- Changed Claim node body generation to write only `claimText`; `evidenceText`, source path, and status stay out of visible node content.
- Added `DELETE /api/threads/:threadId/claims/:claimId` for persisted candidate deletion.
- Documented that deleting a Claim candidate does not delete any already-created Canvas node.
- Updated the Claim Review PRD, API, database, architecture, and decision docs to match the implemented behavior.

Validation:
- `node --import tsx --test server/claimReview.test.ts`
- `node --import tsx --test tests/frontend/claimReview.test.ts`
- `npm.cmd run typecheck`

## 2026-06-30 - Run Trace Documentation Boundary

Scope: Clarified the product and safety boundary between visible Thinking/Run Trace output, tool-event audit data, and hidden model chain-of-thought.

Completed:
- Documented that Run Trace is public execution narration, not chain-of-thought.
- Clarified that raw tool lifecycle events should be aggregated into safe user-facing timeline summaries.
- Recorded the decision that prompts, raw tool JSON, provider reasoning, credentials, and internal context must stay out of visible progress copy.

Validation:
- Documentation-only update.

## 2026-07-04 - Markdown Preview And Claim Binding Fix

Scope: Fixed wrong Markdown preview selection when fallback delivery files existed alongside real Runtime Markdown outputs, added preview document switching, and scoped Claim Review to the selected Markdown path.

Completed:
- Changed progressive Markdown finalization so readable Runtime-authored `/mnt/user-data/outputs/*.md` files win over `facetwrite-delivery-*.md` fallback files, even when artifact archiving reports failure.
- Kept fallback Markdown only for runs with no readable real Markdown delivery.
- Added a Markdown preview document picker based on current Canvas `file_document` nodes, without scanning output directories for orphan files.
- Scoped Claim listing, creation, and extraction to the active preview Thread, source node, and source document path.
- Updated Canvas, API, database, architecture, and decision docs.

Validation:
- `node --import tsx --test server/claimReview.test.ts`
- `node --import tsx --test server/services/generationService.facade.test.ts`
- `node --import tsx --test tests/frontend/claimReview.test.ts`
- `npm.cmd run typecheck`
- `npm.cmd test`
- `npm.cmd run agent:check` was requested but the repository has no `agent:check` script.
