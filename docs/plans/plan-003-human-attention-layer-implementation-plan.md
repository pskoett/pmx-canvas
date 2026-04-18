---
title: Human Attention Layer Implementation Plan
status: draft
date: 2026-04-18
---

# Human Attention Layer Implementation Plan

## Summary

This plan turns the human attention layer design spec into a concrete build plan
for the current PMX Canvas client.

It maps the design onto the existing frontend architecture and defines:

- exact files to create or modify
- where semantic interpretation should live
- how the browser should consume authoritative server signals
- the recommended build order
- verification expectations

This is an implementation plan, not a final UX spec.

## Constraints

The implementation must preserve these rules:

- state remains server-authoritative
- no second browser-only collaboration protocol
- semantic interpretation must derive from existing SSE and layout state
- no raw pointer or selection telemetry in the human-facing semantic layer
- the same semantic model should power both:
  - CLI watcher
  - browser attention layer

## Current Frontend Anchors

The current client already has the right structural seams:

- [App.tsx](/Users/pepe/dev/pmx-canvas/src/client/App.tsx:1)
  - mounts HUD, viewport, overlays, docked panels, minimap
- [canvas-store.ts](/Users/pepe/dev/pmx-canvas/src/client/state/canvas-store.ts:1)
  - holds core canvas signals
- [sse-bridge.ts](/Users/pepe/dev/pmx-canvas/src/client/state/sse-bridge.ts:1)
  - ingests server events and updates local state
- [CanvasViewport.tsx](/Users/pepe/dev/pmx-canvas/src/client/canvas/CanvasViewport.tsx:1)
  - owns world-space rendering order
- [CanvasNode.tsx](/Users/pepe/dev/pmx-canvas/src/client/canvas/CanvasNode.tsx:1)
  - owns node-level classes and titlebar controls
- [global.css](/Users/pepe/dev/pmx-canvas/src/client/theme/global.css:1)
  - already centralizes most canvas chrome and overlay styling

These are enough to add the new UX layer without redesigning the app shell.

## Architectural Decision

### Extract shared semantic reduction

The semantic logic should **not** stay CLI-only.

The current watch reducer in [src/cli/watch.ts](/Users/pepe/dev/pmx-canvas/src/cli/watch.ts:1)
is a good MVP, but the browser should not import from `src/cli/`.

### Required refactor

Create a shared semantic module, for example:

- `src/shared/semantic-attention.ts`

This module should own:

- semantic event types
- semantic reducer
- layout diff logic
- cluster and neighborhood change detection
- shared compact label helpers if useful

The CLI watcher should then consume that shared reducer, and the browser
attention layer should consume the same reducer.

### What stays CLI-specific

Keep these in `src/cli/watch.ts`:

- SSE stream parser
- CLI output formatting
- `--events` filter parsing
- `--max-events` control flow

### Why

This prevents logic drift between:

- `pmx-canvas watch`
- the browser’s human-facing interpretation UI

That alignment is important. The human-facing layer and the agent-facing watcher
must describe the same meaning changes.

## Proposed File Changes

### New shared module

- `src/shared/semantic-attention.ts`

Responsibility:

- define shared semantic event types
- expose reducer class or reducer functions
- accept:
  - previous layout
  - next layout
  - current pin set
- return:
  - semantic events
  - derived attention state if needed

Notes:

- this should operate on shape-compatible canvas layout data only
- avoid browser APIs and avoid Node-only APIs

### New client state module

- `src/client/state/attention-store.ts`

Responsibility:

- hold browser-only attention UI signals
- expose semantic event queue/history
- hold current focus field state
- hold currently emphasized node IDs
- hold ephemeral toast state

Recommended signals:

- `attentionFeed`
- `attentionToast`
- `attentionHistory`
- `attentionFocusNodeIds`
- `attentionNeighborhoodNodeIds`
- `attentionPulseNodeIds`
- `attentionFieldVersion` or similar tick for transition timing

This should not duplicate layout state. It should only hold presentation state
derived from semantic changes.

### New client controller module

- `src/client/state/attention-bridge.ts`

Responsibility:

- receive authoritative SSE-backed layout/pin changes
- call the shared semantic reducer
- translate semantic events into browser presentation state

This module is the browser equivalent of the CLI watch command, but for UI
state instead of stdout.

Why separate it from `attention-store.ts`:

- store stays dumb and signal-based
- bridge owns interpretation and state transitions

### New UI components

- `src/client/canvas/AttentionToast.tsx`
- `src/client/canvas/AttentionHistory.tsx`
- `src/client/canvas/FocusFieldLayer.tsx`

Responsibilities:

`AttentionToast.tsx`
- renders the live semantic feedback surface
- one primary active message
- optional short queue

`AttentionHistory.tsx`
- renders the recent interpretation rail
- 3–8 recent semantic events
- click/hover affordances can be stubbed or deferred

`FocusFieldLayer.tsx`
- renders the persistent spatial emphasis behind or around:
  - pinned nodes
  - inferred neighborhood nodes

This should be world-space aware and tied to current node geometry.

### Existing file updates

#### `src/client/state/sse-bridge.ts`

Changes:

- add support for `context-pins-changed` to `EVENT_HANDLERS`
- call into `attention-bridge.ts` whenever:
  - `canvas-layout-update` is applied
  - `context-pins-changed` arrives

Recommended rule:

- let current layout/state update first
- then feed the normalized next state into the attention bridge

Do not render semantic UI straight from raw SSE handler bodies.

#### `src/client/state/canvas-store.ts`

Changes:

- none for core layout semantics unless a tiny helper export is useful
- do not bloat this file with attention UI state if avoidable

This file should remain the canvas truth layer, not the semantic presentation
layer.

#### `src/client/App.tsx`

Changes:

- mount the new attention UI surfaces
- recommended placement:
  - `AttentionToast` in HUD layer near toolbar or top-right rail
  - `AttentionHistory` in right-side HUD stack, visually distinct from docked
    content
  - `FocusFieldLayer` mounted adjacent to or inside `CanvasViewport`

Potential future cleanup:

- once attention history and focus field are strong enough, the current
  `ContextPinHud` and `ContextPinBar` can be reduced or removed

Do not remove them in the first pass. Build the new surfaces first, then trim.

#### `src/client/canvas/CanvasViewport.tsx`

Changes:

- render `FocusFieldLayer` in world space
- ensure rendering order keeps it:
  - above background
  - below nodes and edges, or below nodes but possibly above the base grid

Recommended order:

1. background
2. focus field
3. edges
4. nodes
5. lasso/drop/snap overlays

#### `src/client/canvas/CanvasNode.tsx`

Changes:

- add classes for semantic emphasis:
  - `attention-pulse`
  - `attention-focus-primary`
  - `attention-focus-secondary`
- keep these visually distinct from:
  - selection
  - active node
  - context-pinned

Do not overload existing `context-pinned` styling to do all the work.
Pinned-state and semantic-attention-state need to be related but not identical.

#### `src/client/theme/global.css`

Changes:

- add styles for:
  - attention toast
  - attention history rail
  - focus field region
  - node pulse states
  - reduced-motion fallbacks

This file should remain the styling center for the first pass.

Do not split CSS until the UI stabilizes.

#### `src/client/icons.tsx`

Optional:

- add 1–2 icons if needed for history labels or toast affordances

Avoid icon-heavy UI here. The semantic layer should primarily rely on text,
spacing, and motion.

## Recommended Build Phases

### Phase 0: Shared semantic extraction

Goal:

- move reducer logic out of CLI-only code into shared space

Steps:

1. create `src/shared/semantic-attention.ts`
2. move pure semantic event and diff logic there
3. update `src/cli/watch.ts` to import shared reducer
4. keep existing `cli-watch` tests green

Why first:

- it guarantees browser and CLI will use the same meaning model

### Phase 1: Browser attention state pipeline

Goal:

- let the browser compute semantic events from existing SSE/layout changes

Steps:

1. add `src/client/state/attention-store.ts`
2. add `src/client/state/attention-bridge.ts`
3. wire `context-pins-changed` into `sse-bridge.ts`
4. feed `canvas-layout-update` and pin changes into the shared reducer

Deliverable:

- internal browser attention state updates exist, even if not yet rendered

Verification:

- unit tests around attention bridge behavior
- ensure no regressions in existing SSE behavior

### Phase 2: Live semantic feedback

Goal:

- render the first visible “board understood you” surface

Steps:

1. build `AttentionToast.tsx`
2. mount it in `App.tsx`
3. style in `global.css`
4. feed semantic events into a one-item active toast queue

This is the first user-visible win and should ship before the full history rail.

Why:

- immediate feedback gives the fastest improvement to human trust

### Phase 3: Focus field

Goal:

- make the active agent working set visible on the board

Steps:

1. build `FocusFieldLayer.tsx`
2. derive primary and secondary node IDs from attention state
3. render pooled spatial emphasis in `CanvasViewport.tsx`
4. add node-level emphasis classes in `CanvasNode.tsx`

This phase makes context feel like a working set rather than metadata.

This is the most important visual feature after the toast.

### Phase 4: Interpretation history rail

Goal:

- provide recoverable trust and recent semantic memory

Steps:

1. build `AttentionHistory.tsx`
2. mount it in right HUD stack in `App.tsx`
3. add event coalescing and limit logic in `attention-bridge.ts`

This can initially be read-only.

Hover/focus affordances can be added later.

### Phase 5: Cleanup and simplification

Goal:

- reduce redundant older pin UI once the new surfaces are proven

Candidates:

- shrink or remove `ContextPinHud.tsx`
- shrink or remove `ContextPinBar.tsx`

Do this only after:

- focus field is stable
- attention history is readable
- semantic toast carries the acknowledgment burden

## State Flow

Recommended browser flow:

1. SSE event arrives in `sse-bridge.ts`
2. layout/pin state is normalized into `canvas-store`
3. `attention-bridge.ts` receives the new authoritative state
4. shared semantic reducer compares previous vs next state
5. browser attention store updates:
   - toast
   - history
   - focus field node IDs
   - pulse node IDs

This keeps the attention layer downstream of the authoritative canvas state.

## UI Placement Recommendations

### AttentionToast

Preferred placement:

- top-right, near but not inside the toolbar cluster

Reason:

- visible immediately after interaction
- close to existing chrome
- does not obstruct canvas center

### AttentionHistory

Preferred placement:

- right-side HUD column, above or below docked context/ledger nodes depending on
  actual density

Reason:

- the right side already reads as “stateful reference area”
- users can scan history there without masking the board

### FocusFieldLayer

Preferred placement:

- world space, inside the canvas viewport

Reason:

- context needs to feel spatial, not dashboarded

## Styling Guidance For Implementation

### Keep

- existing dark technical shell as base
- the current node/chrome system as scaffolding

### Add

- stronger semantic hierarchy
- a distinct palette for:
  - curated context
  - inferred neighborhood
  - semantic acknowledgment

### Avoid

- overloading selection styling
- overusing bright accent everywhere
- generic toast library aesthetics
- “AI neon” visuals

## Animation Plan

### v1 Required motion

- toast enter/exit
- one-shot node pulse
- focus field re-form transition

### v1 Not required

- timeline scrubbing
- multi-stage choreography
- particle or ambient decorative systems

### Reduced motion

Every semantic effect should have a reduced-motion fallback:

- swap movement for opacity
- swap pulses for single-step state emphasis

## Testing Strategy

### Unit

Add tests for:

- shared semantic reducer after extraction
- attention bridge:
  - converts semantic events to store state
  - coalesces/suppresses duplicate updates

### Browser smoke

After client implementation:

- `bun run build`
- `bun run test:web-canvas`

Add at least one browser test covering:

1. pin node
2. observe semantic toast
3. observe focus field or history update

### Manual validation

Use headed browser validation for UX checks when reviewing motion and emphasis.

Suggested flows:

1. pin a node
2. move a related node nearby
3. group two nodes
4. connect two nodes
5. remove a node

For each:

- semantic acknowledgment appears
- affected nodes are visually emphasized
- history rail updates
- no noisy duplicate feedback

## Sequencing Recommendation

If only one piece can be built first:

1. shared semantic extraction
2. live semantic feedback toast
3. focus field
4. history rail

That order gives the best human UX return per unit of implementation effort.

## MVP Completion Criteria

The first implementation pass is complete when:

- browser derives semantic events from existing authoritative state
- human sees immediate semantic acknowledgment after meaningful canvas changes
- active context is visible spatially on the board
- recent semantic changes are inspectable in a lightweight panel
- no raw move/select noise is surfaced

## Final Rule

If implementation choices force a tradeoff, prefer:

- clearer semantic consequence
over
- more control chrome

The whole point of this layer is to make the human feel that the canvas is a
shared thinking instrument, not just a board editor.
