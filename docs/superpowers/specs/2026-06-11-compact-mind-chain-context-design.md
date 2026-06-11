# Compact Mind Chain Context Design

## Goal

Represent a Canvas mind chain as compact composer context instead of inserting its full text into the chat textarea. Keep the context available to the agent while preserving a clean user-authored message. Allow the textarea to be resized vertically.

## Interaction

- Sending a Canvas mind chain to chat attaches it to the AI composer without changing the textarea value.
- The composer shows one compact chip above the textarea: `思维链 · N 节点` / `Mind chain · N nodes`.
- The chip contains a small remove action. Removing it clears the pending mind-chain context.
- The full mind-chain text is not rendered in the composer and has no expanded preview.
- A newly attached mind chain replaces the previous pending mind chain.
- The textarea keeps its normal minimum height and supports vertical drag resizing with a bounded maximum height.
- After a successful send, the attached mind chain is cleared. If sending fails, it remains attached so the user can retry.

## Data Flow

1. `DocumentCanvas` formats the selected directed chain and reports both the formatted text and node count.
2. `WorkspaceView` stores this as pending composer context rather than as a composer draft string.
3. `AICollaborationDrawer` renders only the compact chip and keeps the textarea state independent.
4. On submit, the visible user text is passed as `chatInstruction`. The hidden mind-chain text is passed separately through `contextValues.canvasMindChain`.
5. Optimistic and persisted user messages therefore contain only the user's typed instruction, while prompt construction still gives the agent the complete mind chain.

## Component Changes

- Replace the current `inputDraft` handoff with a typed pending mind-chain context object containing `text` and `nodeCount`.
- Extend the chat send callback with optional request context instead of concatenating context into the visible instruction.
- Add a compact removable context chip to `AICollaborationDrawer`.
- Add scoped composer CSS for the chip and explicit textarea resize bounds.

## Accessibility

- The chip has a readable label containing its node count.
- The remove button has a localized accessible name.
- Native textarea vertical resizing remains available to pointer users.

## Verification

- Unit/component-level checks verify hidden context is sent through `contextValues` while the visible instruction remains unchanged.
- Canvas end-to-end coverage verifies attaching a chain leaves the textarea empty, shows the compact chip, supports removal, and clears the chip after a successful send.
- Browser verification confirms the textarea can be dragged vertically without covering the tool row or escaping the composer.

## Scope

This change does not add multiple simultaneous context attachments, context previews, persistence of unsent attachments across reloads, or changes to Canvas chain formatting.
