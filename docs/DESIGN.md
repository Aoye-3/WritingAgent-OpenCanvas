# FacetWrite DESIGN.md

## 1. Design Intent

FacetWrite is a research prototype for comparing faceted prompt engineering with traditional free-text chat. OpenCanvas is the primary visible product surface: a canvas-first AI creation workspace where generated writing artifacts, notes, references, roles, and Agent collaboration become spatial and editable. The interface should feel like a calm professional canvas tool, not a marketing website and not a pure chatbot.

The first visual priority is canvas dominance. When a user enters the Workspace, the board should occupy the majority of attention and screen area. Project/task briefs and AI collaboration remain available, but their default posture is lightweight rails that can expand when needed.

The design must clearly separate five layers:

- `Task Layer`: choose what kind of text to generate.
- `Facet Layer`: configure task-specific structured inputs.
- `Context Layer`: configure background, knowledge sources, and reference materials.
- `Canvas Layer`: arrange, edit, connect, and inspect writing artifacts.
- `Output Layer`: preview, refine, and copy generated text when outside the spatial board flow.

The user should always understand:

- what they are generating,
- what information the AI will use,
- how the prompt is being formed,
- where the generated output appears,
- which canvas surface is currently editable or selected.

## 2. Product Personality

### 2.1 Keywords

- Structured
- Calm
- Clear
- Controllable
- Research-oriented
- Workspace-like
- Lightweight intelligence
- Spatial
- Canvas-first

### 2.2 Design Dials

- Design variance: `6/10`
  - Familiar productivity layout with a stronger infinite-canvas identity and floating tool surfaces.
- Motion intensity: `5/10`
  - Motion should clarify drawer, rail, dock, selected-tool, popover, and empty-state transitions. It may feel lively, but it must remain functional.
- Visual density: `7/10`
  - The workspace is information-rich, but the default screen should reserve most visual weight for the canvas.

## 3. Reference Systems

### 3.1 Primary Local References

- `Jasper Canvas`
  - Use as reference for the left drawer, canvas workspace, bottom floating command/context bar, and agent-style configuration.
- `Khanmigo Tools`
  - Use as reference for task-card entry and task-specific form flow.

### 3.2 DESIGN.md Inspiration References

- `claude`
  - Useful for calm AI interaction, prompt/result clarity, and readable conversational surfaces.
- `voltagent`
  - Useful for AI agent/workspace state visibility and tool-context separation.
- `linear.app`
  - Useful for dense but clean productivity UI, restraint, focus states, and low-noise control surfaces.
- `notion`
  - Useful for document-like output preview, editable text areas, and lightweight workspace metaphors.
- `figma`
  - Useful for infinite-canvas chrome, floating tool palettes, precise selection states, and direct manipulation.
- `miro`
  - Useful for collaborative board affordances, light blueprint surfaces, and visual creation tools.
- `vercel`
  - Useful for compact control surfaces, ring-border depth, and restrained developer-tool polish.

### 3.3 Adaptation Rule

Do not copy Jasper, Khanmigo, Claude, Linear, Notion, Figma, Miro, or Vercel directly. Combine their functional patterns into a research-specific product:

- Jasper contributes workspace mechanics.
- Khanmigo contributes task-card entry.
- Claude contributes calm AI result readability.
- Linear contributes density and precision.
- Notion contributes document preview behavior.
- Figma and Miro contribute the canvas-first interaction language.
- Vercel contributes compact tool chrome and refined border/shadow treatment.

### 3.4 Coherence Rule

FacetWrite must feel like one product, not a collage of references. References should influence structure and interaction logic, but the final interface must use one shared visual language:

- One layout grammar: compact top bar, left rail/drawer, canvas-first board, right rail/drawer, floating tool dock.
- One component grammar: 8px radius, 1px borders, restrained shadows, compact controls, larger radii only for floating docks.
- One color grammar: neutral workspace surfaces with blue as the only primary action color.
- One typography grammar: practical sans-serif hierarchy, no decorative display typography.
- One motion grammar: short functional transitions for rails, drawers, tool selection, popovers, empty states, and loading states.

If a reference pattern conflicts with product clarity, product clarity wins.

## 4. Information Architecture

```text
Home / Task Cards
  -> Canvas Workspace
      Compact Top Bar
      Left Project/Task Rail + Drawer
      Canvas Board
      Right AI Collaboration Rail + Drawer
      Floating Tool Dock
      Prompt Preview
      Refine Controls

Left App Navigation
  -> Projects
  -> Agent Settings
  -> Canvas Nodes
  -> Model Config
  -> AI Dashboard
  -> App Updates
  -> Knowledge Settings

Comparison Mode
  -> Traditional Free-text Chat
```

## 4.1 Unified Experience Principles

These principles should guide every design and implementation decision.

### Principle 1: The Workspace Is The Product

The main experience is not a landing page, a chatbot, or a gallery of cards. The product identity comes from the structured generation workspace. The Home page should lead users into the workspace quickly.

### Principle 2: Each Layer Has One Job

- Task cards choose the task.
- Left drawer defines the output request.
- Bottom context bar defines background and references.
- Right preview shows the generated artifact.

Do not duplicate the same controls across multiple layers unless there is a clear reason.

### Principle 3: Controls Should Feel Related

Inputs, chips, dropdowns, tabs, and buttons should share the same radius, border color, height, typography, and interaction states. A task card can be more expressive than a form field, but it should still belong to the same system.

### Principle 4: Variation Is Functional

Use variation to communicate role, not decoration:

- Accent colors distinguish task categories.
- Blue identifies primary actions and active states.
- Softer surfaces indicate secondary configuration.
- Document-like white space belongs to output preview.

Do not introduce new colors, shadows, or card styles just to make a section look different.

### Principle 5: The Prompt Is A First-Class Artifact

Prompt preview should visually connect the left drawer and bottom context bar to the output area. Users should feel that their structured choices are being assembled into something understandable, not disappearing into a black box.

## 5. Page Specifications

### 5.1 Home / Task Cards

Purpose:

Help users choose a text generation task without starting from a blank prompt box.

OpenCanvas homepage update:

- The Home page is a workbench surface, not a marketing hero. Keep the left app navigation unchanged and make the right main panel immediately useful.
- The top Home composer must be the same interaction family as the in-canvas AI collaboration composer. Do not maintain a second decorative prompt box with different buttons or dead controls.
- Submitting a non-empty Home composer prompt creates a new board, opens the workspace, and sends that prompt into the new board thread. Submitting with no prompt still creates a blank board.
- The Home project browser may borrow the structure of Figma Recents: light tabs, filter controls, sort control, and grid/list switching.
- Borrow the Figma Recents information architecture only. Do not copy Figma's black-and-white brand system, extreme pill geometry, negative letter spacing, or marketing typography.
- Home should use one page scrollbar. The left sidebar stays fixed, the recents filter controls can become sticky as the page scrolls, and the project grid should not introduce a nested scrollbar.
- Remove or hide ineffective actions. If a button appears on Home, it must either create a board, open a project, filter/sort/switch view, open project actions, or navigate to a working section.
- Project/recents thumbnails should prefer real cached Canvas screenshots when available, with the geometric Canvas preview as a graceful fallback. Cached screenshots are intentionally refreshed on Project leave/switch rather than in real time.

Project management table:

- `Assets` and `Updated` table headers are sortable controls with one compact badge each.
- The badge is neutral when inactive, then switches between ascending and descending on repeated clicks.
- The default table order remains most recently updated first.
- Sorting must happen after search/Agent/trash filtering so users can quickly group `0` asset Projects or older Projects, select them, and move/delete them without scanning the full list manually.

Layout:

- Top bar with product name `FacetWrite`, optional project label, and comparison mode entry.
- Main heading: `Choose a text generation task`.
- Search field aligned near the task grid.
- Task category chips if needed: `All`, `Writing`, `Education`, `Summarise`, `Rewrite`.
- Responsive card grid:
  - Desktop: 3 columns.
  - Tablet: 2 columns.
  - Mobile: 1 column.

Task cards:

- Card radius: `8px`.
- Card border: subtle 1px neutral border.
- Icon tile: small colored square, not oversized.
- Content:
  - task title,
  - one-line description,
  - optional favorite button.
- Hover state:
  - border color strengthens,
  - background slightly shifts,
  - no large movement.

Required cards:

- `Blog Post`
- `Summary`
- `Email Writer`
- `Lesson Plan`
- `Report Outline`
- `Rewrite / Polish`

Avoid:

- Landing-page hero sections.
- Big marketing slogans.
- Decorative gradients or illustration-heavy cards.
- Too many task cards in the first prototype.

### 5.2 Canvas Workspace

Purpose:

Provide a layered AI creation workspace where the Canvas Board is the primary surface and structured prompt inputs, context configuration, and AI collaboration are available on demand.

Desktop layout:

```text
+-------------------------------------------------------------+
| Compact Top Bar                                             |
+-------------------------------------------------------------+
| Canvas Board                                                |
| nodes, objects, edges, floating controls                    |
| floating left/right menus, centered dock/status             |
+-------------------------------------------------------------+
```

Layout rules:

- Top bar height: `56px` in Workspace.
- Canvas Board has no dedicated full-width title/header row; it should start immediately below the Workspace top bar.
- Default desktop state:
  - left project/task layer is a floating `44-52px` side menu over the canvas;
  - right AI collaboration layer is a floating `44-52px` side menu over the canvas;
  - Canvas Board keeps the full available width behind those overlays.
- Expanded desktop state:
  - left drawer target width: `300-340px` as a floating panel;
  - right drawer starts at `360px` as a floating panel and may be user-resized within existing constraints.
- Floating tool dock sits over the canvas near the bottom and must not force a large reserved bottom gutter.
- Bottom selection/status UI is a centered compact pill, not a full-width footer.
- Main board background: a single light blueprint grid, not stacked CSS and React Flow grids.
- Drawer and canvas chrome surfaces: white or translucent near-white with restrained borders.
- Canvas controls should be compact floating chips and icon buttons inside the board, usually top-right; avoid large descriptive text or full-width board chrome.
- Empty canvas state should be short and centered, pointing to right-click or the tool dock.

Mobile layout:

- Preserve usable single-column or stacked behavior.
- Rails may become top/bottom compact bars if there is not enough horizontal room.
- Tool dock may wrap or scroll horizontally, but controls must remain tappable.
- Primary writing and AI actions must not be hidden behind the dock.

### 5.3 Left Structured Input Drawer

Purpose:

Collect the task-specific facets that answer: “What does the user want to generate?”

Structure:

- Drawer header:
  - task icon,
  - task title,
  - favorite button,
  - close/back control.
- Section 1: `Core settings`
  - topic/source text,
  - audience,
  - tone,
  - language.
- Section 2: `Output specification`
  - length,
  - output format,
  - key points,
  - constraints.
- Section 3: `Custom instruction`
  - optional long text input.
- Sticky footer:
  - secondary `Preview Prompt`,
  - primary `Generate`.

Input rules:

- Every field must have a visible label.
- Do not rely on placeholder text as the only label.
- Required fields use an asterisk and inline helper/error text.
- Select controls should use dropdowns for long option sets.
- Tone and format may use chips/segmented controls when option count is 3-6.
- Text areas must show character count only when useful.

Validation:

- Validate on blur or submit.
- Error text appears directly under the relevant field.
- On submit error, focus the first invalid field.
- Disabled `Generate` state must be visually distinct and semantically disabled.

### 5.4 Floating Context Bar

Purpose:

Configure the background that the AI should use, separate from the task-specific form.

Collapsed state:

```text
[Context] [Knowledge] [References] [Prompt Preview]    2 contexts selected    [Expand]
```

Expanded state:

- Opens upward as a bottom sheet.
- Uses tabs:
  - `Context`
  - `Knowledge Source`
  - `Reference Material`
  - `Prompt Preview`
- Keeps the workspace visible behind it.
- Uses a soft shadow and 1px border to indicate elevation.

Context tab:

- `Writing Style`
- `Audience Profile`
- `Use Project Context` toggle

Knowledge Source tab:

- `None`
- `Course Notes`
- `Product Information`
- `Brand Guide`
- `Uploaded / Pasted Reference`

Reference Material tab:

- `Reference title`
- `Reference content`
- `Keywords`
- `Add reference`
- list of added references with remove actions

Prompt Preview tab:

- Shows generated prompt in a readable code/text block.
- Supports:
  - `Copy Prompt`
  - `Edit Prompt Manually`
  - `Reset to Generated Prompt`

Interaction rules:

- Opening/closing uses `transform: translateY` and opacity, not height animation.
- Tab changes use a quick crossfade.
- Bottom sheet must close with `Esc`.
- Focus should move into the sheet when expanded and return to the trigger when closed.

### 5.5 Output Preview Area

Purpose:

Show generated text as a document-like artifact rather than a chat reply.

Initial state:

- Centered empty state inside a document surface.
- Message: `Complete the structured inputs and generate your text.`
- Optional small hint: `Use Preview Prompt to inspect how your choices become a prompt.`

Generated state:

- Document title area.
- Generated output body.
- Metadata row:
  - task type,
  - generated time,
  - `Generated from structured prompt`.
- Action row:
  - `Copy`
  - `Regenerate`
  - `Make shorter`
  - `Make more formal`
  - `Simplify`
  - `Convert to bullet points`

Visual behavior:

- The output surface should look like a clean document editor.
- Long text should have readable line length, not stretch edge-to-edge.
- Refinement actions should be compact buttons or chips.
- Loading state should reserve the output area to avoid layout shift.

### 5.6 Traditional Free-text Chat Interface

Purpose:

Provide a fair traditional free-text chat interface for the user study. This mode is the baseline against the faceted workspace: users type open-ended messages and receive assistant replies without structured facets, context drawers, or prompt preview.

Layout:

- Same top bar and overall page frame as the workspace.
- Centered desktop chat column with readable line length.
- Conversation transcript with user and assistant messages.
- Sticky bottom composer similar to common AI chat products.
- Composer supports multiline input, `Enter` to send, and `Shift+Enter` for a new line.
- No structured facets.
- No context bar.
- No prompt preview unless the user manually writes it.

Research fairness:

- Keep visual polish similar to the faceted interface.
- Do not intentionally make the free-text interface ugly.
- Only remove structural assistance, not basic usability.
- The comparison should be between interaction models: structured faceted input versus open-ended natural language conversation.

## 6. Component System

### 6.0 Implementation Boundary

FacetWrite maintains a lightweight in-repo UI primitive layer under `src/shared/ui/`.

Rules:

- Use these primitives for repeated controls before adding feature-local markup.
- Primitives may own structure, ARIA, variants, sizing, and shared class names.
- Primitives must not own provider, AgentBackend, Canvas approval, storage, or generation behavior.
- Feature components remain responsible for business state, API calls, and product-specific copy.
- Do not introduce large external component libraries unless a future decision explicitly replaces this boundary.

### 6.1 Buttons

Primary button:

- Used for `Generate`.
- Solid primary color.
- Height: `40-44px`.
- Radius: `8px`.
- Disabled state: lower opacity, no click action, accessible disabled attribute.

Secondary button:

- Used for `Preview Prompt`, `Copy`, `Reset`.
- White or neutral surface with border.

Tertiary/icon button:

- Used for favorite, close, expand, collapse.
- Must include `aria-label`.
- Hit target at least `44x44px`.

Workspace composer exception:

- The right AI collaboration composer may use compact `28-34px` icon buttons because it sits inside a narrow resizable drawer.
- Icon-only composer buttons still require `aria-label` and `title`.
- The send button remains the primary action and must stay right-aligned with a stable fixed size.
- Secondary actions such as Skill selection and Plan insertion should be icon-only when drawer width is tight; selected Skills are shown as chips above the textarea instead of occupying bottom-row text width.
- DeepSeek Thinking mode belongs in the composer top control row as a lightbulb icon plus current mode text. Its menu contains `Disabled`, `High`, and `Max`. The bottom tool row must not contain a separate Thinking control.

### 6.2 Cards

Use cards only for:

- task cards,
- empty states,
- document preview surface,
- reference material items,
- modal/sheet content.

Do not nest cards inside cards unless the inner item is a repeated list item with a clear purpose.

### 6.3 Forms

Form groups:

- Use section labels.
- Keep related fields together.
- Use helper text for abstract fields such as `Knowledge Source`.

Field heights:

- Text input: `40-44px`.
- Select: `40-44px`.
- Textarea: minimum `96px`.

Errors:

- Error text below field.
- Error border uses semantic danger color.
- Error must include recovery guidance.

### 6.4 Tabs

Used in bottom context sheet.

Rules:

- Active tab has text contrast and subtle background.
- Use underline or filled pill, not both.
- Keyboard navigation should support arrow keys where practical.

### 6.5 Chips

Used for compact option sets:

- tone,
- output format,
- task category,
- refine actions.

Rules:

- Selected chips must include both color/background and text/outline change.
- Do not use color alone.

### 6.6 Drawers and Sheets

Left drawer:

- Persistent on desktop.
- Collapsible only if screen width requires it.

Bottom sheet:

- Collapsed by default.
- Expanded for context/reference configuration.
- Has clear close/expand control.
- Uses accessible focus management.

### 6.7 Prompt Preview Block

The prompt preview block is a core research component.

Rules:

- Use monospace or code-like styling only for the prompt content.
- Keep prompt readable; line-wrap long content.
- Show a small label: `Generated Prompt`.
- If manually edited, show status: `Edited manually`.
- If facets changed after preview, show warning: `Prompt preview may be out of date.`

## 7. Visual System

### 7.1 Color Roles

Use semantic tokens. Do not hardcode raw colors inside individual components.

Recommended light theme:

```text
--color-bg: #F6F7F9
--color-surface: #FFFFFF
--color-surface-subtle: #F1F4F8
--color-border: #D8DEE8
--color-border-strong: #B8C2D0
--color-text: #172033
--color-text-muted: #667085
--color-primary: #2563EB
--color-primary-hover: #1D4ED8
--color-primary-soft: #DBEAFE
--color-success: #11845B
--color-warning: #B76E00
--color-danger: #C2413A
--color-focus: #7AA2FF
```

Accent colors for task icons:

```text
--accent-blue: #DBEAFE
--accent-green: #DCFCE7
--accent-orange: #FFEDD5
--accent-violet: #EDE9FE
--accent-rose: #FFE4E6
```

Color rules:

- Blue is reserved for primary actions and active states.
- Green, orange, violet, and rose are secondary accents for task identity only.
- Error, warning, and success colors must include text/icon support.
- Avoid purple-blue gradient-heavy AI styling.
- Avoid beige/brown-heavy palettes.

### 7.2 Typography

Recommended system stack:

```css
font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

Fallback if Inter is unavailable:

```css
font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

Type scale:

```text
Display / page title: 28-32px / 1.2 / 700
Section title: 20-24px / 1.25 / 650
Panel title: 16-18px / 1.35 / 650
Body: 14-16px / 1.5 / 400
Label: 13-14px / 1.4 / 600
Helper text: 12-13px / 1.4 / 400
Button: 14px / 1.2 / 600
Prompt/code: 13-14px / 1.55 / 400
```

Typography rules:

- Body text should not be smaller than `14px` on desktop.
- Mobile body text should be at least `16px` for form inputs.
- Avoid negative letter spacing.
- Long generated text should use comfortable line height.
- Keep document output line length around `65-75` characters on desktop.

### 7.3 Spacing

Use a 4/8px spacing system:

```text
4, 8, 12, 16, 20, 24, 32, 40, 48
```

Rules:

- Component internal padding: `12-16px`.
- Panel padding: `20-24px`.
- Section gap inside drawer: `24px`.
- Form field gap: `12-16px`.
- Page gutter desktop: responsive `24-72px`, with a capped content width so wide screens feel desktop-native without becoming loose.
- Mobile gutter: `16px`.

### 7.4 Radius and Elevation

Radius:

- Small controls: `6px`.
- Cards/panels/buttons: `8px`.
- Bottom sheet: `16px` top corners maximum.

Elevation:

- Prefer borders over shadows for normal surfaces.
- Use shadow only for floating bottom sheet, popovers, and modals.
- Shadow should be soft and low-opacity.

Example:

```text
panel border: 1px solid var(--color-border)
floating shadow: 0 16px 40px rgba(15, 23, 42, 0.14)
```

## 8. Interaction Rules

### 8.1 Navigation

- Back behavior must be predictable.
- Returning from workspace to Home should preserve selected/search state where feasible.
- App-level management pages live in the shared left navigation. `App Updates` is a Harness/App Shell page, not a Project Settings panel, because applying updates affects the application shell rather than the active Project.
- Switching to Comparison Mode should be explicit.
- If there are unsaved changes, show a confirm dialog before reset or leaving.

### 8.2 Generation Flow

```text
Fill facets -> Preview Prompt -> Generate -> Output Preview -> Refine
```

Rules:

- `Preview Prompt` is recommended but not always required.
- `Generate` should show loading state immediately.
- Prevent duplicate submission while generating.
- If generation fails, show a clear error with retry.
- If facets/context change after generation, show `Inputs changed since last generation`.

### 8.3 Context Bar Flow

```text
Collapsed -> Expand -> Choose tab -> Add context/reference -> Update prompt preview -> Collapse
```

Rules:

- Collapsed state must summarize selected context.
- Expanded state must not feel like a separate page.
- Context changes should update prompt preview state.
- Reference addition/removal should have immediate visual feedback.

### 8.4 Refinement Flow

Refine actions operate on the current output:

- `Make shorter`
- `Make longer`
- `Make more formal`
- `Simplify`
- `Convert to bullet points`

Rules:

- Refinement should show a loading state on the clicked action.
- The output area should preserve previous result until new result appears.
- User should be able to copy the current visible result.

## 9. States

Every major component must support these states:

- Default
- Hover
- Focus
- Active/selected
- Disabled
- Loading
- Empty
- Error
- Success

Required page states:

- Home empty search state.
- Workspace initial empty output state.
- Drawer validation error state.
- Context bar no reference state.
- Prompt preview out-of-date state.
- Output generation loading state.
- Output generation error state.
- Free-text empty state.

## 10. Accessibility Requirements

Follow WCAG-oriented basics:

- Text contrast:
  - normal text at least 4.5:1;
  - large text at least 3:1.
- Keyboard:
  - all inputs, buttons, tabs, drawer controls, and bottom sheet controls reachable by keyboard.
- Focus:
  - visible focus ring for all interactive elements.
  - focus ring color uses `--color-focus`.
- Labels:
  - every input has a visible label.
  - icon-only buttons have `aria-label`.
- Motion:
  - support `prefers-reduced-motion`.
  - reduced motion should remove non-essential transitions.
- Color:
  - never use color as the only state indicator.
- Sheet/drawer:
  - `Esc` closes temporary sheets.
  - focus returns to trigger after closing.
- Toasts/errors:
  - use polite live regions for important feedback where possible.

## 11. Responsive Behavior

### 11.1 Breakpoints

```text
Mobile: 0-767px
Tablet: 768-1023px
Desktop: 1024-1439px
Wide: 1440px+
```

### 11.2 Desktop

- Home content uses a wider capped container, around `1280-1360px`, with a 3-column card grid that fills desktop space instead of reading like a mobile column.
- Persistent left drawer.
- Wide output preview.
- Bottom context bar floats over workspace with safe bottom spacing.
- Free-text chat uses a centered transcript column, around `900-980px`, with a sticky bottom composer.

### 11.3 Tablet

- Left drawer may reduce width to `320-360px`.
- Output preview remains visible.
- Bottom sheet uses full width with side margins.

### 11.4 Mobile

- Home cards stack vertically.
- Workspace becomes sequential:
  - task header,
  - structured form,
  - context bottom sheet,
  - output preview.
- Avoid horizontal scroll.
- Inputs use at least `44px` height.
- Floating bottom controls must not cover form fields.

## 12. Motion

Motion should communicate hierarchy and state changes. OpenCanvas may use Motion for React (`motion/react`) for layout-aware UI transitions, but motion must remain secondary to canvas usability.

Allowed:

- Rail and drawer open/close: `180-280ms`, preferably spring-based.
- Floating tool dock entrance: subtle `opacity`, `scale`, and `translateY`.
- Active tool selection: shared layout indicator or compact pill movement.
- Popover entrance/exit: `opacity` plus small `translateY`.
- Empty canvas state: short fade/float only.
- Card and node hover elevation/border: `120-160ms`.
- Loading skeleton shimmer only if generation exceeds `600ms`.

Avoid:

- Decorative bouncing that does not clarify state.
- Large parallax.
- Slow transitions over `500ms`.
- Animating width/height for large layout surfaces.
- Motion that blocks input.
- Continuous animation except small status indicators.

Reduced motion:

- Always respect `prefers-reduced-motion: reduce`.
- Disable continuous status breathing.
- Prefer instant state changes or very short opacity transitions.

Easing:

```css
--ease-standard: cubic-bezier(0.2, 0, 0, 1);
--ease-exit: cubic-bezier(0.4, 0, 1, 1);
```

Implementation notes:

- Use `transform` and `opacity` for animated movement.
- Use `layout` / `layoutId` only for small UI surfaces such as tool buttons, rails, and popovers.
- Do not animate React Flow node geometry persistence through unrelated layout effects.

## 13. Content and Microcopy

Tone:

- Clear
- Short
- Direct
- Supportive

Do:

- Use action-oriented labels.
- Explain abstract concepts only where needed.
- Keep helper text under fields.

Avoid:

- Long instructional paragraphs inside the app.
- Marketing claims.
- Ambiguous labels like `AI Magic` or `Enhance`.

Recommended labels:

- `Preview Prompt`
- `Generate`
- `Add reference`
- `Use project context`
- `Copy Prompt`
- `Edit Prompt Manually`
- `Reset to Generated Prompt`
- `Generated from structured prompt`
- `Inputs changed since last generation`

## 14. Research-Specific Design Requirements

The interface is part of an empirical study, so design must support fair observation.

Rules:

- Faceted interface and free-text interface should have comparable visual quality.
- The difference between conditions should be the presence or absence of structured prompt support.
- Do not make the free-text interface intentionally worse.
- Logically separate measured actions:
  - start task,
  - first input,
  - preview prompt,
  - click generate,
  - refine output.
- Avoid adding unnecessary features that introduce confounding variables.

Important experimental cue:

- Prompt preview must be visible enough to support perceived control and output predictability measurement.

## 15. Implementation Guardrails

### 15.1 Layout Guardrails

- Use stable dimensions for:
  - top bar,
  - left drawer,
  - bottom context bar,
  - task cards,
  - output preview.
- Reserve space for floating elements.
- Avoid layout shift during loading and validation.
- Right composer bottom-row controls must not overlap at narrow drawer widths. Keep the row ordered as tools, Skill, compact model select, Plan, and send; use `margin-left:auto` or equivalent spacing so the send button stays attached to the right edge.

### 15.2 Component Guardrails

- Use one icon set consistently, preferably Lucide or another stroke-based SVG set.
- Do not use emoji as functional icons.
- Use native form controls unless custom controls provide clear value.
- Avoid card nesting.
- Keep buttons from changing size between states.

### 15.3 CSS Token Guardrails

Define tokens for:

- color,
- spacing,
- radius,
- shadow,
- typography,
- z-index,
- motion.

Do not scatter arbitrary hex values and spacing values across components.

### 15.4 Z-Index Scale

```text
base: 0
sticky top bar: 20
left drawer: 30
floating context bar: 40
popover/dropdown: 60
modal/sheet overlay: 80
toast: 100
```

## 16. Anti-Patterns

Do not:

- Turn the app into a pure chat interface.
- Hide prompt preview behind too many clicks.
- Put all context and reference controls into the left drawer.
- Make Knowledge Base look like a full enterprise RAG system.
- Use a marketing landing page as the first screen.
- Use oversized hero typography inside workspace panels.
- Use heavy gradients, decorative blobs, or AI-purple visual tropes.
- Use tiny form labels or placeholder-only fields.
- Rely only on hover interactions.
- Let the bottom floating bar cover the `Generate` button.
- Add image/video generation into the core workflow.
- Make the free-text comparison interface visually worse than the faceted interface.

## 18. Design Tradeoffs

Use these tradeoffs when references or feature ideas conflict.

### 18.1 Jasper Influence vs Research Clarity

Keep:

- left drawer for structured input,
- bottom floating context bar,
- document/canvas-style output area.

Simplify:

- agent switching,
- project sharing,
- search/new asset menus,
- multi-agent or workspace collaboration.

Reason:

The research needs structured prompt construction, context configuration, and output preview. Extra Jasper-like productivity features may create noise and weaken the experimental focus.

### 18.2 Khanmigo Cards vs Canvas Workspace

Keep:

- task-card homepage,
- simple tool selection,
- concise task descriptions.

Avoid:

- making every workspace element card-based,
- using large educational-tool hero blocks inside the workspace.

Reason:

Khanmigo is useful for task entry, but the main generation experience should become a focused writing workspace after the card is selected.

### 18.3 Rich Controls vs Cognitive Load

Keep controls visible when they affect the generated prompt directly:

- topic,
- audience,
- tone,
- length,
- format,
- references,
- prompt preview.

Hide or progressively disclose advanced controls:

- citation style,
- avoid words,
- project context,
- custom constraints,
- manual prompt editing.

Reason:

The faceted interface should reduce cognitive load, not replace one blank prompt box with an overwhelming settings panel.

### 18.4 Visual Polish vs Experimental Fairness

Both the faceted interface and free-text comparison interface should look equally polished. The difference being tested is interaction structure, not visual attractiveness.

The free-text interface may be simpler, but it should still have:

- readable typography,
- clear input label,
- visible generate button,
- clean output preview,
- proper loading and error states.

### 18.5 Context Bar vs Left Drawer

Use the left drawer for task-specific intent.

Use the bottom context bar for reusable or background information.

If a field could belong to both places, choose based on the question it answers:

- “What should be generated?” -> left drawer.
- “What should the AI know before generating?” -> bottom context bar.

## 17. Page-Level Checklist

Before implementing or reviewing a page, verify:

- The page has one clear primary action.
- All controls have visible labels or accessible names.
- Text does not overflow buttons, chips, cards, or panels.
- The bottom floating bar does not cover critical content.
- The prompt preview can be found quickly.
- Empty, loading, error, and success states exist.
- Keyboard navigation works.
- Reduced motion is respected.
- Color is not the only status indicator.
- The page still works at `375px`, `768px`, `1024px`, and `1440px`.

## Plan Interaction

The first Plan response is a Codex-style choice card with 2-3 mutually exclusive options, one recommended option, and an inline Other field. Normal options submit immediately. Answered choices persist in Plan history; intake placeholder steps are not shown. The revised task board requests approval once, then reports automatic sequential progress.
## Plan Feedback Experience

The Plan experience is deliberately staged: one mandatory choice card, one approval-ready Plan board plus Canvas projection, then continuous safe activity feedback while approved steps execute. The UI shows phase, tool purpose/result summaries, Artifact commits, progress, pause, and recovery without exposing private model reasoning.

Plan activities render as compact 12px timeline rows rather than full assistant message bubbles. Skill usage is visible as a safe summary, including `brainstorming` and `writing-plans`; skill content and private prompts remain hidden.
