---
title: Human Attention Layer Design Spec
status: draft
date: 2026-04-18
---

# Human Attention Layer Design Spec

## Summary

This spec defines the **human-facing UX layer** that should sit on top of the
semantic watcher model already established for agents.

The goal is simple:

> The human side of PMX Canvas should feel as good as, and ideally better than,
> the agent side.

Today the product has the right semantic model for the agent:

- server-authoritative context pins
- spatial semantics
- semantic watch output

But the human UI still behaves mostly like a capable canvas editor with a few
agent-oriented affordances.

This spec changes that. It defines a visible, tastefully dramatic
**Agent Attention Layer** so the human can see:

- what they changed
- what the system understood
- how that changed the agent’s attention

## Product Thesis

PMX Canvas should not feel like “a node editor with agent integrations.”

It should feel like:

> a human command surface for shaping agent attention through space.

That means the interface must do three things well:

1. Show **human authorship**
2. Show **system interpretation**
3. Show **agent consequence**

The product is successful when the human can rearrange, pin, group, or connect
nodes and immediately feel:

> “The board understood me.”

## Design Direction

### Concept

**Editorial Mission Control**

This is the target mood and visual language.

Not cyberpunk.
Not terminal cosplay.
Not generic dark-glass developer tooling.

Instead:

- refined
- information-dense but calm
- high-contrast and intentional
- spatially expressive
- visibly interpretive

The canvas should feel like an operations desk for thought, where every gesture
has consequence and every consequence is made legible.

### Human Role

The human is not “using a tool.”

The human is:

- curating focus
- staging evidence
- composing relationships
- steering the agent’s working memory

The interface should center that role at all times.

### Agent Role

The agent is powerful, but visually secondary.

The UI should not feel like “the AI did something.” It should feel like:

> “The system reflected the meaning of my edit.”

## Design Goals

- Make context curation visually primary
- Make semantic interpretation visible within one beat of the user action
- Suppress raw noise and show only meaningful changes
- Create trust by exposing what changed for the agent
- Preserve the canvas as the main stage; feedback must clarify the board, not
  compete with it

## Non-Goals

- Do not expose raw watcher output directly in the UI
- Do not show every drag or selection event
- Do not add “AI personality” chrome for its own sake
- Do not turn the canvas into a chat app or notification center
- Do not create a second state model separate from server-authoritative canvas
  state

## Core UX Model

Every meaningful human action should pass through this loop:

1. The human changes the canvas
2. The canvas interprets the semantic change
3. The UI acknowledges the interpretation
4. The updated agent attention state becomes visible

This loop must feel immediate, calm, and consequential.

## Primary UI Addition: Agent Attention Layer

Add a thin but highly legible UI layer above the existing canvas.

This layer has three parts:

1. Live Semantic Feedback
2. Persistent Focus Field
3. Recent Interpretation History

These three surfaces are enough for MVP-level human UX without redesigning the
entire product.

---

## 1. Live Semantic Feedback

### Purpose

Provide immediate acknowledgment that a human action changed the system’s
understanding.

This is the “the board saw you” layer.

### UI Form

A compact semantic feedback ribbon or toast that appears in the upper-right or
upper-center region, close to existing HUD chrome but visually distinct from
toolbar controls.

### Content Rules

The feedback must be:

- short
- semantic
- plainspoken
- visually anchored to the affected canvas region when possible

It must not be:

- verbose
- technical
- log-like
- raw event vocabulary

### Example Messages

- `Pinned context updated`
- `Bug report is now in focus`
- `Cluster formed around auth work`
- `auth.ts entered bug-report neighborhood`
- `Relationship added between incident note and auth.ts`
- `Pinned neighborhood expanded`

### Message Structure

Each message should contain:

- a semantic label
- optional affected object names
- optional direction of change

Examples:

- `Context updated: Bug report, auth.ts`
- `Cluster formed: auth.ts, session.ts, incident note`
- `Neighborhood changed around Bug report`

### Timing

- show within 150–250ms after the semantic change is known
- visible for 1.8s to 2.8s depending on message length
- fade out softly if not interacted with

### Interaction

Optional for later:

- hover can freeze the message
- clicking a message can focus or frame the relevant nodes

### Visual Style

- thin panel, not a chunky notification card
- high contrast against the background
- restrained glow
- typography stronger than body text but quieter than a headline
- should feel editorial, not OS-native

### Motion

- slide in 8–12px
- slight opacity fade
- no bounce
- no springy overshoot
- affected nodes can receive a synchronized single pulse

---

## 2. Persistent Focus Field

### Purpose

Show what is currently active in the agent’s working set.

This replaces the weak “count pill + bottom bar” experience with something that
feels spatial and meaningful.

### UX Principle

Context is not just a set of pinned nodes.

Context is a **field**:

- explicit pinned nodes
- nearby inferred neighbors
- visible composition of the current working set

### UI Form

A subtle but persistent spatial treatment applied directly on the canvas:

- pinned nodes get the strongest emphasis
- inferred neighbors get a secondary emphasis
- the region connecting them reads as one focus field

### Behavior

When the pinned set changes:

- the field re-forms around the new working set
- affected nodes transition into or out of the field
- neighboring implied context becomes gently visible

### Visual Treatment

Pinned nodes:

- strong but tasteful border/accent
- brighter titlebar or node badge state
- shallow halo or inner edge

Neighborhood nodes:

- softer edge treatment
- low-opacity background wash or region highlight
- clearly related, but visually subordinate to explicit pins

Field region:

- very low-opacity pooled wash
- no cartoon blob
- should feel like air pressure or magnetic attention, not paint

### What It Solves

- answers “what matters right now?”
- makes the agent working set visible at a glance
- lets the human understand whether a rearrangement changed semantic proximity

### What To Avoid

- giant glowing blobs
- constant pulsation
- ambiguous selection-like styling
- making context state look identical to regular UI focus or hover

---

## 3. Recent Interpretation History

### Purpose

Give the human a compact “audit trail of meaning,” not a raw log.

This creates trust and recoverability.

### UI Form

A docked, compact side panel or vertical strip:

- title: `What Changed`
- 3–8 recent semantic events
- newest first

This should be visually distinct from status/trace panels.

### Content

Entries should be written as semantic summaries, for example:

- `Now in context: Bug report, auth.ts`
- `Cluster formed around auth work`
- `Connected incident note to auth.ts`
- `Pinned neighborhood expanded`

### Entry Structure

Each entry may include:

- short semantic title
- optional one-line detail
- optional timestamp or “just now”

### Interaction

Optional for later:

- click entry to frame affected nodes
- hover entry to highlight affected nodes on canvas

### Visual Style

- slim editorial rail, not a developer console
- entries separated by rhythm and spacing, not heavy borders
- readable at a glance
- should feel like an annotated margin, not a log file

### Suppression Rules

This panel must remain curated.

Do not include:

- duplicate events
- movement without semantic change
- raw pin count updates without object names when names are available

---

## Semantic Event Taxonomy For Human UI

The UI should render a small, human-readable vocabulary.

### v1 Event Types

- `Context Updated`
- `Cluster Formed`
- `Cluster Changed`
- `Neighborhood Changed`
- `Relationship Added`
- `Group Created`
- `Items Removed`

### Mapping Guidance

`context-pin`
- usually map to `Context Updated`

`connect`
- map to `Relationship Added`

`group`
- map to `Group Created` or `Group Updated`

`remove`
- map to `Items Removed`

`move-end`
- map to:
  - `Cluster Formed`
  - `Cluster Changed`
  - `Neighborhood Changed`
  depending on reason

### Copy Rules

- use nouns the human recognizes from the board
- prefer titles over IDs
- never surface internal event names directly
- avoid “agent” in every sentence
- the copy should sound like the board speaking, not the transport layer

Good:

- `Cluster formed around auth.ts`
- `Context updated: Bug report, auth.ts`

Bad:

- `move-end event detected`
- `context-pin delta applied`
- `layout diff processed`

---

## Visual Hierarchy

### Hierarchy Levels

1. Canvas nodes and spatial composition
2. Focus Field
3. Live Semantic Feedback
4. Interpretation History
5. Utility chrome and toolbar controls

This is deliberate.

The semantic layer should outrank utility chrome, but not overpower the board.

### Why

The human should read the board first, then the semantic interpretation, then
the controls.

Today the utility chrome is too prominent relative to the product’s real value.

---

## Motion System

### Principle

Use motion to confirm interpretation, not decorate the interface.

### v1 Motion Moments

#### Semantic acknowledgment

- feedback ribbon slides/fades in
- one clean transition, then settles

#### Affected node pulse

- one synchronized pulse on nodes affected by the semantic change
- duration: 500–900ms

#### Focus Field re-form

- soft transition of wash/halo around pinned region
- no hard cut unless removing many nodes at once

#### Relationship reveal

- a new edge can draw once or brighten briefly

### Motion Characteristics

- confident
- low-frequency
- low-amplitude
- non-bouncy
- more “instrument panel” than “playful app”

### Accessibility

Respect reduced motion:

- no travel animations
- replace with opacity changes or instant state shifts

---

## Typography Direction

### Principle

The semantic layer needs stronger character than the current generic technical
chrome, but it should remain sober.

### Recommendation

Use contrast between:

- utilitarian UI copy for controls
- more editorial, high-contrast typography for semantic acknowledgments

The result should feel like:

- controls are functional
- interpretation is authored

### Tone

- concise
- formal but warm
- no robotic phrasing
- no marketing slogans

---

## Color Direction

### Principle

Meaning states need a distinct palette from generic interaction states.

### Proposed Semantic Palette Roles

Interaction:

- cool electric blue/cyan

Curated human context:

- warm amber/gold

Inferred neighborhood:

- pale mineral wash, lower saturation

Success/completion:

- green, reserved for actual outcome states

### Why

This separates:

- “I clicked something”
from
- “the board understood something”

That distinction is crucial.

---

## Empty State Rewrite

### Current Problem

The current empty state teaches mechanics:

- search
- create
- shortcuts
- pan/zoom

That is useful but insufficient.

### New Empty State Goal

Teach the collaboration ritual.

### New Empty State Message

The empty state should explain:

1. Add or drop nodes
2. Arrange related things near each other
3. Pin what matters most
4. Watch the board reflect the active context

### Example Structure

Headline:

- `Shape What The Agent Sees`

Body:

- `Lay out notes, files, and evidence. Bring related nodes together. Pin what matters. The canvas will show the current focus and how your edits changed it.`

Action hints:

- `Create a note`
- `Drop files or URLs`
- `Pin important nodes`

The empty state should invite a workflow, not just describe controls.

---

## Suppression Rules

These rules are required to keep the human UX high quality.

### Never Surface

- raw drag frames
- selection changes
- no-op movement
- repeated identical semantic updates
- transport-level or server-level terminology

### Only Surface When Meaning Changed

- cluster membership changed
- pinned neighborhood changed
- context set changed
- relationship structure changed
- group meaning changed

### Coalescing Rules

When multiple semantic changes happen in one short burst:

- combine them into one visible acknowledgment when possible
- prefer one good message over three mediocre ones

Example:

Bad:

- `Context updated`
- `Neighborhood changed`
- `Cluster changed`

Better:

- `Context updated: Bug report now anchors auth cluster`

---

## MVP Scope

### Must Ship

- Live Semantic Feedback surface
- Persistent Focus Field for pinned context + neighborhood
- Recent Interpretation History panel
- copy and event mapping rules
- motion rules for semantic acknowledgment

### Can Wait

- click-to-focus from history entries
- deeper event filtering preferences
- custom semantic themes
- replay mode or timeline scrubbing

---

## Success Criteria

The design is successful when a human can truthfully say:

- `I can tell what the agent is focused on.`
- `When I rearrange nodes, I can see whether it mattered.`
- `The board reflects my intent, not just my clicks.`
- `The collaboration loop feels immediate and trustworthy.`
- `The canvas feels like a shared thinking surface, not just an editor.`

## Implementation Notes For Future Build

When implementation starts:

- reuse server-authoritative semantic events and layout semantics
- do not invent a second browser-only protocol
- prefer one reusable semantic feedback system over ad hoc toasts
- ensure all semantic UI states degrade cleanly under reduced motion
- build the semantic layer to be visually lightweight but semantically strong

## Final Principle

If there is a tie between “more control chrome” and “clearer human semantic
feedback,” prefer the semantic feedback.

That is the differentiator.

PMX Canvas wins when the human can shape the agent’s attention with visible,
confident consequence.
