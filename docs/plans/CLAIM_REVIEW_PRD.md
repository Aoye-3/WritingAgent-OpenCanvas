# Claim Review PRD

## 1. Document Information

- Version: v0.1
- Status: Draft
- Date: 2026-06-24
- Product area: OpenCanvas research workflow
- Related user story: As a researcher, I want to manage separate AI responses so that I can combine them into a cohesive, aggregate account.
- Related surfaces: Markdown document preview, right AI collaboration drawer, Canvas nodes, Canvas context menu

## 2. Background And Goal

### Background

OpenCanvas already supports long-task generation, Skill-driven research workflows, progressive Canvas delivery, structured Agent clarification, and Markdown `file_document` preview nodes. After a long research task produces a complete Markdown document, the next product gap is helping the researcher turn that long-form output back into manageable research units.

The current preview is useful for reading the full document, but it does not yet help the user extract, review, organize, and recombine claims from separate AI responses. The next step should make the first generated document actionable: users should be able to identify candidate claims, verify them against source context, and convert selected claims into Canvas material for later synthesis.

### User Problem

Researchers often receive multiple AI-generated responses or document drafts. Each response may contain useful claims, repeated points, weak claims, unsupported claims, and conflicting interpretations. Without a structured review surface, users must manually copy text into notes, remember where it came from, and later reconcile duplicates or contradictions.

### Product Goal

Provide a lightweight Claim review workflow that starts from the Markdown preview and helps users:

- see AI-extracted candidate claims;
- inspect each claim in its original document context;
- edit, create, or delete selected claims;
- preserve evidence and source context;
- create useful Canvas nodes only after user review.

### Success Metrics

- Users can extract at least one reviewed Claim from a generated Markdown preview without leaving the workspace.
- Users can create or delete multiple selected candidate Claims in a single review session.
- Created Claim nodes retain a link back to the source document path and source text location.
- Canvas remains controlled: AI candidate extraction does not directly flood the board with nodes.
- Users can send selected Claims to the right collaboration drawer or create Canvas nodes for synthesis.

## 3. Scope

### In Scope For This Phase

- A: Markdown preview inline context
  - Select text in the Markdown preview.
  - Open a context action for selected text.
  - Create a candidate Claim from selected text.
  - Highlight or scroll to the original source range for a Claim.

- B: Right-side Claim review queue
  - Run AI-assisted Claim extraction against the current Markdown preview.
  - Show candidate Claims in a review queue.
  - Let users edit candidate Claims.
  - Let users create Canvas nodes from selected Claims without an intermediate acceptance state.
  - Let users delete selected candidates through the persistent Claim Delete API.
  - Preserve source document metadata for created Claim nodes.

### Out Of Scope For This Phase

- C: Canvas Claim Inbox where AI directly creates a spatial cluster of candidate nodes.
- Fully automatic knowledge graph creation.
- Automatic duplicate merging across all project history.
- Citation manager replacement, bibliography export, or formal reference formatting.
- Multi-user review, comments, or assignment.
- Rewriting the full Markdown preview editor.

### Assumptions And Constraints

- AI-originated Canvas mutations must remain reviewable and controlled.
- Direct user actions, such as selecting text and creating a node, may use existing Canvas create flows.
- The Markdown preview remains the full-document reading surface; Canvas nodes remain the modular working surface.
- The first version should reuse existing Canvas node kinds where possible. A dedicated `claim` node kind is a follow-up decision, not required for MVP.

## 4. Users And Scenarios

### Target User

Researcher using OpenCanvas to run AI-assisted literature review, source synthesis, paper comparison, or research memo generation.

### Core Scenario

1. The user asks the Agent to produce a literature review or research document.
2. OpenCanvas creates a Markdown `file_document` preview node.
3. The user opens the Markdown preview.
4. The user asks OpenCanvas to extract candidate Claims, or manually selects text and creates a Claim candidate.
5. Candidate Claims appear in the right-side review queue.
6. The user edits candidates, locates them in the source document, creates selected nodes, or deletes selected candidates.
7. Selected Claims can be converted into Canvas nodes or sent to the AI drawer for synthesis.

### User Stories

- As a researcher, I want AI to propose Claims from a generated document so that I do not need to manually scan and copy every important argument.
- As a researcher, I want to inspect each Claim in its original context so that I can decide whether the Claim is accurate and worth keeping.
- As a researcher, I want to edit AI-extracted Claims before creating nodes so that the resulting research account reflects my judgment.
- As a researcher, I want created Claim nodes to preserve evidence context so that later synthesis does not lose traceability.
- As a researcher, I want to delete unwanted candidates so that AI output does not clutter my workspace.

## 5. Functional Requirements

### 5.1 Markdown Preview Claim Context

- Entry:
  - User opens a `file_document` Canvas node through `Preview Markdown`.
  - The preview panel displays the full Markdown document.

- Selection action:
  - When the user selects text inside the Markdown preview, OpenCanvas shows a small contextual action menu.
  - Required actions:
    - `Create Claim candidate`
    - `Create excerpt node`
    - `Send selection to chat`
  - `Create Claim candidate` creates a pending item in the Claim review queue, not an immediate Canvas node.
  - `Create excerpt node` creates a normal Canvas node from the selected text using direct user action rules.

- Source anchoring:
  - A Claim candidate created from selected text must store:
    - source document virtual path;
    - source file name;
    - selected text;
    - best-effort source range or anchor;
    - surrounding context excerpt.
  - When the user clicks a Claim in the review queue, the preview scrolls to the related source area and visually highlights it.

- Empty and error states:
  - If no text is selected, selection actions are hidden.
  - If source anchoring fails, the Claim can still be created with selected text and document path, with a visible `Source location unavailable` note.

### 5.2 AI Claim Extraction

- Entry:
  - The Markdown preview header or right review queue exposes `Extract Claims`.
  - The action runs against the currently open Markdown preview document.

- Extraction output:
  - AI returns a bounded list of candidate Claims.
  - Each candidate should include:
    - `claimText`;
    - `evidenceText` or source excerpt;
    - source document path;
    - optional citation/source link if present in the Markdown;
    - status defaulting to `pending_review`;
    - confidence or review hint if available.

- Extraction guardrails:
  - The first version should prefer fewer, higher-signal Claims over exhaustive extraction.
  - Extraction must not directly create Canvas nodes.
  - Extraction must not overwrite the original Markdown document.
  - Extraction results are review artifacts, not final research conclusions.

- Loading and failure:
  - While extraction is running, the queue shows a loading state.
  - If extraction fails, show a retry action and preserve any existing reviewed Claims.

### 5.3 Claim Review Queue

- Location:
  - The review queue appears beside the Markdown preview as an adjacent review panel.
  - The queue should not cover the Markdown preview content.

- Queue item fields:
  - Stable display title such as `摘要 1`, `摘要 2`, `摘要 3`
  - Compact Claim text preview
  - Source document file name
  - Optional tags or type hints

- Supported statuses:
  - `pending_review`
  - `accepted`
  - `rejected`
  - `needs_more_evidence`
  - `edited`

- Item actions:
  - `Edit`
  - `Show in document`
  - `Create Canvas node`
  - `Delete`
  - `Send to chat`

- Editing:
  - Users can edit Claim text before creating a node.
  - Editing a Claim marks it as `edited`.
  - Evidence text remains stored for source fallback and highlight matching, but is not shown as a persistent card block.
  - The user can cancel edit without losing the original candidate.

- Batch actions:
  - `Create selected`
  - `Delete selected`
  - Batch actions require explicit user selection; no automatic create-all on extraction completion.

### 5.4 Canvas Node Creation From Selected Claims

- Entry:
  - User chooses `Create Canvas node` on a Claim, or `Create selected` for checked candidates.

- Node behavior:
  - MVP should create existing Canvas node kinds rather than introducing a new node kind immediately.
  - Claim Review creates compact `document` nodes by default.
  - Node titles use the same stable display name shown in the drawer, such as `摘要 1`.
  - Node content contains only the selected Claim text.
  - Source path, source anchor, and candidate id stay in node metadata for traceability and source highlight.
  - Evidence excerpts, source path, citation URLs, and review status must not be written into the visible node body by default.

- Layout:
  - Single-node creation places the node near the source `file_document` node when possible.
  - Batch creation places nodes in a readable vertical stack near the source document node or current viewport center.

- Safety:
  - Creating nodes from selected Claims is a direct user action.
  - Extraction alone must not create Canvas nodes.
  - Deleting a Claim candidate removes the persisted `claim_candidates` row but does not delete any already-created Canvas node.

### 5.5 Chat And Synthesis Integration

- `Send to chat` sends one Claim or selected Claims to the right collaboration composer.
- The sent context should include:
  - Claim text;
  - evidence excerpts;
  - source document path;
  - current review status.
- The action should not auto-send the message.
- Follow-up prompts may ask the Agent to synthesize selected or created Claim nodes into a cohesive account.

## 6. UX And Content Requirements

### Information Architecture

- Markdown preview remains the reading surface.
- Claim review queue is the decision surface.
- Canvas is the organization and synthesis surface.
- Right AI drawer remains the conversation and follow-up instruction surface.

### Recommended MVP Interaction

1. User opens Markdown preview.
2. User clicks `Extract Claims`.
3. Right drawer switches to `Claims` review mode or shows a Claim review section.
4. User clicks `定位原文` / `Show source` on a candidate Claim.
5. Markdown preview scrolls to and highlights the source context.
6. User edits the Claim when needed.
7. User creates selected Claim nodes or deletes selected candidates.
8. User sends selected Claims to chat for aggregate synthesis.

### Required UI States

- No preview open: Claim extraction unavailable.
- Preview open, no extraction run: show `Extract Claims`.
- Extraction running: show loading skeleton or progress.
- Extraction failed: show retry and error summary.
- No candidates found: show empty state with manual selection hint.
- Candidates pending: show queue with review actions.
- Claims selected: show selected count plus create/delete actions.
- Source unavailable: show Claim but disable `Show in document` or show fallback message.

### Copy Guidelines

- Prefer `Claim` for the structured research unit.
- Prefer `Evidence` for supporting excerpt/source context.
- Prefer `Needs evidence` over vague labels such as `Unclear`.
- Avoid implying AI extraction is authoritative. Use `Candidate Claim` before the user creates a node or deletes the candidate.

## 7. Data, Analytics, And Interfaces

### Candidate Claim Data Model

Minimum candidate fields:

```ts
type ClaimCandidate = {
  id: string;
  threadId: string;
  sourceNodeId: string;
  sourceDocumentPath: string;
  sourceFileName: string;
  claimText: string;
  originalClaimText?: string;
  evidenceText: string;
  sourceAnchor?: {
    startOffset?: number;
    endOffset?: number;
    headingPath?: string[];
    textFingerprint?: string;
  };
  citationUrls?: string[];
  status: "pending_review" | "accepted" | "rejected" | "needs_more_evidence" | "edited";
  createdBy: "ai" | "user_selection";
  createdAt: string;
  updatedAt: string;
};
```

### Analytics Events

- `claim_extraction_started`
- `claim_extraction_completed`
- `claim_extraction_failed`
- `claim_candidate_created_from_selection`
- `claim_candidate_status_changed`
- `claim_candidate_edited`
- `claim_candidate_show_source_clicked`
- `claim_canvas_node_created`
- `claim_sent_to_chat`

### Interface Dependencies

- Markdown preview API for reading full document content.
- Existing Canvas node create API.
- Existing right drawer composer state.
- Agent Runtime or backend extraction service for candidate Claim extraction.

## 8. Non-Functional Requirements

- Performance:
  - Claim extraction should handle long Markdown documents without blocking preview scrolling.
  - Queue rendering should remain responsive with at least 50 candidates, though MVP should usually produce fewer.

- Reliability:
  - Existing candidate edits and selections must not be lost if a later extraction retry fails.
  - Source anchoring should degrade gracefully when document content changes.

- Safety:
  - AI extraction results must be treated as candidates until the user explicitly creates or deletes them.
  - No AI extraction action should directly mutate Canvas nodes.
  - Source excerpts must not expose hidden prompts, raw tool JSON, credentials, or internal runtime events.

- Accessibility:
  - Claim queue actions must be keyboard reachable.
  - Source highlight should not rely only on color.
  - Candidate selection controls must have accessible labels using the visible `摘要 N` display name.

- Localization:
  - UI copy must support English and Chinese.
  - Candidate actions and source-location copy should map cleanly across both languages.

## 9. Acceptance Criteria

### Markdown Selection

- Given a Markdown preview is open, when the user selects text, then a contextual action menu appears.
- Given selected text, when the user chooses `Create Claim candidate`, then a pending Claim appears in the review queue with the selected text and source document path.
- Given selected text, when the user chooses `Create excerpt node`, then a Canvas node is created without requiring AI extraction.

### AI Extraction

- Given a Markdown preview is open, when the user clicks `Extract Claims`, then the system creates candidate Claims without creating Canvas nodes.
- Given extraction succeeds, when candidates are shown, then each candidate has Claim text, source metadata, and a source-location action.
- Given extraction fails, when the user views the queue, then the system shows retry without deleting existing candidates.

### Review Queue

- Given candidate Claims are present, when the user selects one or more candidates, then `Create selected` and `Delete selected` act only on those checked candidates.
- Given a candidate is edited, when the user saves it, then the edited text is persisted and the original text is retained for review history.
- Given a candidate is deleted, when the queue reloads, then the deleted candidate is absent because the backend removed the persisted row.
- Given a candidate has a source anchor, when the user clicks `Show in document`, then the Markdown preview scrolls to and highlights the source area.

### Canvas Creation

- Given one or more selected Claims, when the user creates Canvas nodes, then nodes use matching `摘要 N` titles and visible content from Claim text only.
- Given nodes are created from Claims, then source document path and source anchor remain available in node metadata for traceability.
- Given extraction creates candidates, when the user takes no create action, then no Canvas nodes are created.

### Chat Integration

- Given one or more selected Claims, when the user chooses `Send to chat`, then the composer is populated but not auto-sent.

## 10. Dependencies, Risks, And Open Questions

### Dependencies

- Stable Markdown preview source text and path metadata.
- A reliable way to anchor preview selection to source Markdown.
- Existing Canvas create-node path.
- A bounded extraction prompt or backend extraction endpoint.

### Risks

- Claim extraction may overproduce low-value candidates.
- Users may confuse `Candidate Claim` with verified research truth.
- Source anchors may become stale if the underlying Markdown file is regenerated.
- Adding too many statuses too early may make review feel heavy.
- A dedicated `claim` node kind may be desirable later, but adding it too early could overfit the first design.

### Open Questions

- Should created Claims always become `document` nodes by default, or should the user choose `document` vs `reference` each time?
- Should extraction run once per document version, or should users be able to compare Claims across regenerated versions?
- Should a future evidence action trigger an Agent follow-up, or should source highlighting remain the only evidence inspection path?
- What is the maximum candidate count for the first extraction pass?

## 11. Future Considerations

- Dedicated `claim` Canvas node kind with structured fields.
- Canvas Claim Inbox for spatial review and clustering.
- Duplicate Claim detection across multiple AI responses.
- Opposing Claim discovery and relationship edges.
- Evidence strength scoring.
- Claim-to-section synthesis for final aggregate account generation.
- Export selected or created Claims as a structured research brief.
