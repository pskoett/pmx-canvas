# Handoff: PMX Canvas — Rail + Session Chrome (v2)

> **For the implementing agent (Claude Code):** work inside the `pmx-canvas` repo; this folder is the design source of truth. Read this README fully before writing code — especially "Implementation Notes", the "Addendum" sections, and "Suggested order" (step 1 ships standalone). Open the `.dc.html` files in a browser (≥1440px wide) as the live reference; screenshots are quick orientation only.

## Overview
A UI/UX overhaul of the PMX Canvas workbench. Two things change:

1. **Chrome restructure** — the floating HUD pill cluster is replaced by a persistent **52px left tool rail** + **44px slim top bar**, freeing canvas real estate and giving every node kind a discoverable creation affordance.
2. **Agent presence as conditional surfaces** — when an agent session is attached, three surfaces appear (agent cursor + phase chip on canvas, a right-side **Session panel** with approval gates, a bottom **Command bar** with pinned-context chips and a budget meter). When no session is attached, all three are absent and the board is a plain general-purpose canvas.

The second point is the load-bearing design rule: **PMX Canvas is not an agent tool that also does diagrams.** It is a general-purpose spatial canvas that an agent can attach to. Every agent surface must unmount cleanly.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to copy. They are single-file HTML documents that render a React tree; they are not importable modules and share no build with `pmx-canvas`.

The task is to **recreate these designs inside the existing `pmx-canvas` app** — React + TypeScript, Vite, the existing `src/client/canvas/` component conventions, `src/client/theme/tokens.ts`, and `src/client/global.css`. Do not port HTML. Read the prototypes for layout, measurement, color, and behavior; implement with the codebase's own patterns.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii, and interaction states are final and were derived from the app's own tokens. Recreate them precisely. Where a value below conflicts with `tokens.ts`, **the token wins** — the prototype hardcodes hex only because it cannot import the theme.

---

## Screens / Views

### 1. Focus Session (agent attached)
File: `PMX Canvas v2 - Focus Session.dc.html`

**Purpose:** The user supervises an agent working on the board — watching what it touches, vetoing intents before they land, approving gated work items, and steering with pinned context.

**Layout (1440×860 reference):**
- Root: `display:flex`, full viewport, `overflow:hidden`, background `#081524`.
- **Left rail** — `width:52px`, `flex-shrink:0`, `background:#0a1729`, `border-right:1px solid #1b2c44`, `z-index:60`, vertical flex, `gap:4px`, `padding:10px 0`, `overflow-y:auto`.
- **Center column** — `flex:1; min-width:0`, vertical flex.
  - **Top bar** — `height:44px`, `padding:0 14px`, `background:rgba(10,23,41,0.92)`, `backdrop-filter:blur(12px)`, `border-bottom:1px solid #1b2c44`, `z-index:55`, `overflow:hidden`, `min-width:0`.
  - **Canvas viewport** — `flex:1`, `position:relative`, `overflow:hidden`. Dot grid: `radial-gradient(circle, rgba(75,188,255,0.08) 1px, transparent 1px)` at `background-size:24px 24px`, over a subtle top-down `linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0))`.
  - **Command bar** — bottom of center column, above the canvas's own z-stack.
- **Session panel** — right sibling of the center column, `width:320px`, `flex-shrink:0`, `background:#0a1729`, `border-left:1px solid #1b2c44`.

**Components:**

*Left rail buttons* — every button `36×36`, `border-radius:8px`, `border:1px solid transparent`, `background:none`, `color:#8ea3bd`, `cursor:pointer`, icon `15×15` stroke `1.5`, `flex-shrink:0`.
- Hover: `background:rgba(255,255,255,0.06); color:#e6eef7`.
- Active/selected: `background:rgba(75,188,255,0.12); border-color:rgba(75,188,255,0.3); color:#4BBCFF`; hover on active `background:rgba(75,188,255,0.2)`.
- Order: brand mark (36×36, `#4BBCFF`) → divider → **tools**: Select (V), Pan (Space), Connect (C) → divider → **node palette**: Markdown (M), Image (I), File (Shift+F), Webpage (W), HTML surface (H), Group (G), Annotate (A) → spacer `flex:1` → **utilities**: Snapshots, Theme, Shortcuts (?).
- Dividers: `width:24px; height:1px; background:#1b2c44`.
- Every button carries a `title` with the shortcut in parens — the rail is the shortcut discovery surface.

*Top bar (session state)* — left to right: connection dot (`8px` circle, `#2fd07f` connected / `#f4c542` reconnecting / `#ff6b6b` offline); board title (`13px/600 #e6eef7`, ellipsis, `min-width:60px`, `flex-shrink:1`); board id (`11px IBM Plex Mono #5c6b80`, `.hud-collapsible`); `flex:1` spacer; **agent chip**; `1px×20px` divider `#1b2c44`; zoom out / zoom label (`11px mono #8ea3bd`, `min-width:38px`, centered) / zoom in / fit-all.

*Agent chip* — `padding:5px 12px`, `border-radius:999px`, `flex-shrink:0`, `white-space:nowrap`, phase-colored. Phase → color + label:
- `thinking` → `#B388FF`, bg `rgba(179,136,255,0.12)`, border `rgba(179,136,255,0.35)`, label "Thinking"
- `tooling` → `#4BBCFF`, bg `rgba(75,188,255,0.12)`, border `rgba(75,188,255,0.35)`, label "Running <tool>"
- `waiting-approval` → `#f4c542`, bg `rgba(244,197,66,0.12)`, border `rgba(244,197,66,0.35)`, label "Waiting on you"
- `idle` → `#5c6b80`, no fill, border `#1b2c44`, label "Idle"
Contains a `7px` dot in the phase color (pulsing for thinking/tooling), the label at `11px/600`, and the model name in `.hud-collapsible`. **Truncation uses `text-overflow:ellipsis` on the label span, never hard clipping.**

*Agent cursor* — absolutely positioned in the canvas layer, above nodes, `pointer-events:none`. An arrow glyph in the phase color plus a phase chip offset `+14px x / +18px y`. Moves with a `transform: translate()` transition, `220ms cubic-bezier(0.22,1,0.36,1)`.

*Node shimmer* — a node currently being mutated gets a traveling highlight: `background-image: linear-gradient(100deg, transparent 20%, rgba(75,188,255,0.13) 50%, transparent 80%)`, `background-size:200% 100%`, animated `shimmer 1.6s linear infinite` from `background-position:200% 0` to `-200% 0`, plus `border-color: rgba(75,188,255,0.45)`.

*Ghost intent* — dashed outline at the proposed geometry, `border:1.5px dashed` in the intent color, `background: rgba(...,0.05)`, opacity scaled by confidence (`0.35 + confidence*0.5`), reason text beneath at `10px #8ea3bd`, and an "Esc to veto" hint on hover. **This already exists in the codebase** — see Implementation Notes.

*Session panel* — header (`44px`, matches top-bar height, `border-bottom:1px solid #1b2c44`) with title "Session" and a collapse control. Body is a vertical list of **work items**, each: status glyph (queued `#5c6b80` / running `#4BBCFF` / awaiting `#f4c542` / done `#2fd07f` / vetoed `#ff6b6b`), title `12px/600 #c7d3ea`, one-line detail `10.5px #8ea3bd`, and a monospace timestamp `9px #5c6b80`. Items with `awaiting` status render an **approval gate**: two buttons, Approve (`background:rgba(47,208,127,0.15); color:#2fd07f`) and Reject (`background:none; border:1px solid #1b2c44; color:#8ea3bd`), each `padding:4px 12px`, `border-radius:7px`, `11px/600`. Clicking either resolves the item **and** the corresponding on-canvas node state — the panel and canvas are one system, not two views.

*Command bar* — `padding:10px 14px`, `background:rgba(10,23,41,0.92)`, `backdrop-filter:blur(12px)`, `border-top:1px solid #1b2c44`. Row 1: **pinned-context chips** — `padding:3px 9px`, `border-radius:999px`, `background:rgba(75,188,255,0.1)`, `border:1px solid rgba(75,188,255,0.25)`, `10px/600 #4BBCFF`, each with an `×` to unpin. Row 2: text input (`background:#0f1d31`, `border:1px solid #1b2c44`, `border-radius:9px`, `padding:8px 12px`, `12px #e6eef7`, placeholder `#5c6b80`) + send button. Right-aligned **budget meter**: a `60×4` track (`#1b2c44`, `border-radius:2px`) with a fill that is `#2fd07f` under 70%, `#f4c542` 70–90%, `#ff6b6b` above; label in `10px mono`. **The meter and chips recompute live as pins toggle** — unpinning a chip must visibly drop the budget.

---

### 2. Quiet Board (no agent)
File: `PMX Canvas v2 - Quiet Board.dc.html`

**Purpose:** Proves the chrome works for the general-purpose canvas — diagramming, research, doc review, moodboards. This is the majority use case and must not feel like an agent product with the agent switched off.

**Layout:** Identical left rail and top bar. **No session panel, no command bar, no agent cursor, no budget meter.** The canvas viewport spans the full remaining width.

**Differences from Focus Session:**
- Top bar's agent chip is replaced by a quiet affordance button: `padding:5px 12px`, `border-radius:999px`, `border:1px solid #1b2c44`, `color:#8ea3bd`, dot `#5c6b80`, label "Start agent session". Hover: `border-color:rgba(179,136,255,0.4); color:#B388FF`.
- Board content demonstrates the non-agent node kinds: Markdown notes, a **Group** (dashed `1.5px rgba(75,188,255,0.35)`, `border-radius:14px`, `background:rgba(75,188,255,0.03)`, with a pill label overlapping the top edge at `top:-10px; left:14px`) containing child nodes, a Status node with three metric tiles, an Image node, a File card, a Webpage node, and a free-floating Annotation (`background:rgba(244,197,66,0.1)`, `border:1px solid rgba(244,197,66,0.35)`, italic `#f4c542`, `rotate(-1deg)`).

**Standard node card shell** (all kinds share it): `background:#0f1d31`, `border:1px solid #1b2c44`, `border-radius:12px`, `box-shadow:0 4px 24px rgba(0,0,0,0.3)`, `overflow:hidden`. Header row: `padding:7px 12px`, `background:rgba(8,21,36,0.6)`, `border-bottom:1px solid #1b2c44`, `gap:8px`; kind icon `13–14px` in the kind's accent color; title `11–12px/600 #c7d3ea` with ellipsis; trailing `⋯` menu `#5c6b80`. Body: `padding:9–12px 12–16px`, `10.5–11px`, `line-height:1.55–1.6`, `color:#c7d3ea`.

**Node kind accent colors:** Markdown `#4BBCFF` · Image `#f4c542` · File `#4BBCFF` · Webpage `#2fd07f` · Status `#2fd07f` · Group `#4BBCFF` · Annotation `#f4c542`.

---

### 3. Current UI (baseline)
File: `PMX Canvas — Current UI.dc.html` — faithful recreation of today's floating-HUD layout, included only as a before/after reference. Do not implement.

---

## Interactions & Behavior

**Zoom** — `×1.25` per step, clamped `10%–400%`, label rounded to integer percent. Fit-all frames the node bounding box with padding.

**Responsive** — the top bar is the only fragile row. Rules:
- `overflow:hidden` and `min-width:0` on the bar and every flexible child.
- Board title: `white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:60px; flex-shrink:1`.
- Agent chip: `flex-shrink:0` on the chip, ellipsis on its label span.
- Below **1180px**: hide `.hud-collapsible` elements (board id, model name) — mirrors the collapsible pattern already in the app.

**Veto** — hovering a ghost intent and pressing `Esc` vetoes it. Veto is authoritative: the linked mutation is blocked server-side, not merely hidden. Already implemented.

**Approval gates** — Approve/Reject in the session panel resolve through the same path as intent approve/veto. Rejecting must post steering feedback back to the agent (the existing `vetoGhostSteering` path).

**Pin toggling** — removing a context chip immediately recomputes the budget meter. This is the interaction that makes the meter meaningful; do not defer it to a server round-trip if a local estimate is available.

**Session attach/detach** — attaching mounts the session panel, command bar, and agent cursor layer; detaching unmounts all three and restores the quiet affordance. Transition should be a simple opacity/width settle (`180ms ease`), not a dramatic animation.

**Animations** — shimmer `1.6s linear infinite`; agent cursor move `220ms cubic-bezier(0.22,1,0.36,1)`; phase dot pulse `1.4s ease-in-out infinite` between `opacity:1` and `0.45`; panel mount `180ms ease`.

---

## State Management

**Client (new):**
- `sessionActive: boolean` — the master gate for every agent surface. One selector; both new surfaces and the top-bar chip read it.
- `agentPhase: 'idle' | 'thinking' | 'tooling' | 'waiting-approval'` + `agentPhaseDetail?: string` (tool name).
- `agentCursor: { x, y } | null` in canvas coordinates.
- `mutatingNodeIds: Set<string>` — drives shimmer. The intent store already tracks in-flight mutations; derive from it rather than adding a parallel source.
- `workItems: WorkItem[]` — `{ id, title, detail, status, ts, nodeIds?, gateId? }`.
- `budget: { used, total }`.

**Client (existing, reuse):** `intent-store`, `intent-bridge`, viewport/zoom state, `ContextPinBar`'s pin collection, snapshot state.

**Server (new):**
- `agent_presence` SSE event: `{ sessionId, phase, detail?, focusNodeId?, cursor?: {x,y} }`. Emit at tool-call start/end — the same hook points where auto-ghost synthesis already fires.
- `session` SSE events: work-item created/updated, gate opened/resolved.
- `budget` numbers, either folded into `agent_presence` or a low-frequency dedicated event.
- A `SessionRegistry` sibling to the existing `IntentRegistry`, with the same TTL/cap discipline. Gate resolution reuses the intent approve/veto path so veto poisoning semantics stay in one place.

---

## Design Tokens

**Colors**
| Role | Hex |
|---|---|
| App background | `#081524` |
| Rail / panel / bar surface | `#0a1729` |
| Node surface | `#0f1d31` |
| Border | `#1b2c44` |
| Text primary | `#e6eef7` |
| Text secondary | `#c7d3ea` |
| Text muted | `#8ea3bd` |
| Text faint | `#5c6b80` |
| Accent / primary | `#4BBCFF` |
| Agent / thinking | `#B388FF` |
| Success / connected | `#2fd07f` |
| Warning / awaiting | `#f4c542` |
| Danger / vetoed | `#ff6b6b` |

Translucent fills follow a fixed ladder: `0.03` group wash · `0.06` hover · `0.10–0.12` chip fill · `0.15` active button · `0.25–0.35` chip border.

**Spacing** — `4 · 6 · 7 · 8 · 10 · 12 · 14 · 16 · 22` px. Rail gap `4`; bar gap `12`; node header gap `8`.

**Typography** — IBM Plex Sans (400/500/600/700) for UI, IBM Plex Mono (400/500/600) for ids, timestamps, metrics, zoom. Scale: `9` micro-label · `10` meta · `10.5–11` body/chip · `12` node title · `13` bar title · `15` node heading. Line-height `1.5–1.6` body, `1.2` headings. Headings `letter-spacing:-0.01em`; uppercase pill labels `letter-spacing:0.08em`.

**Radius** — `6` small button · `7–8` rail button / gate button · `9` input · `10` annotation/toast · `12` node card · `14` group frame · `999` pills.

**Shadow** — node `0 4px 24px rgba(0,0,0,0.3)` · minimap `0 4px 16px rgba(0,0,0,0.3)` · toast/overlay `0 12px 40px rgba(0,0,0,0.5)`.

**Sizes** — rail `52` · top bar `44` · session panel `320` · rail button `36` · minimap `150×100` · collapse breakpoint `1180`.

---

## Assets
No image assets. All icons are inline SVG, `16` viewBox, `stroke-width:1.5`, `stroke-linecap/linejoin:round`, `currentColor`. **Do not port the prototype's SVG paths** — the app already has `src/client/canvas/icons.tsx`; use or extend it. Fonts are Google Fonts IBM Plex Sans + IBM Plex Mono; the app already loads them.

---

## Implementation Notes (repo-specific)

**Already shipped — do not rebuild.** The ghost-intent system is complete: server `IntentRegistry` with TTL/count caps and veto poisoning (a vetoed intent id blocks the linked mutation), auto-ghost synthesis for agent mutations that arrive without an explicit `canvas_intent` signal (with exemptions for batch churn and stream appends), full SSE wiring, client `intent-store` / `intent-bridge`, Esc-to-veto on hover, and `vetoGhostSteering` feedback to the agent. The prototypes' ghost treatment is *behind* the real implementation — trust the code.

**Files to touch**
- `src/client/App.tsx` — chrome restructure; the largest single diff.
- `src/client/canvas/ContextPinBar.tsx` — evolves into the command bar.
- `src/client/canvas/SelectionBar.tsx`, `SnapshotPanel.tsx` — reposition within the new chrome; behavior unchanged.
- `src/client/canvas/IntentLayer.tsx` — sibling for the new presence layer; do not modify its veto logic.
- `src/client/theme/tokens.ts`, `src/client/global.css` — add rail/bar/panel surface tokens and the shimmer keyframe.
- `src/shared/canvas-node-kind.ts` — source of truth for the rail's node palette; iterate it rather than hardcoding a list.
- `src/shared/ax-state-contract.ts` (+ host adapter) — the two new event shapes.

**New files**
- `src/client/canvas/ToolRail.tsx`
- `src/client/canvas/TopBar.tsx`
- `src/client/canvas/AgentPresenceLayer.tsx`
- `src/client/canvas/SessionPanel.tsx`
- server: `SessionRegistry` beside `IntentRegistry`

**Suggested order**
1. Rail + top bar + responsive rules (frontend only, shippable alone — the Quiet Board is a complete deliverable).
2. Spec and land the two SSE event shapes (`agent_presence`, session/budget). Both new surfaces depend on them; specify before building either.
3. `AgentPresenceLayer` — cursor, phase chip, shimmer.
4. `SessionPanel` + `SessionRegistry` + gate resolution.
5. Command bar evolution of `ContextPinBar` + budget meter.
6. Gate everything from step 3 on `sessionActive` and verify the Quiet Board state is byte-for-byte clean of agent chrome.

**Rough sizing** — ~1.5–2 weeks for one developer familiar with the codebase; roughly 85% frontend. The server work is confined to the two event shapes and `SessionRegistry`.

**The rule to hold onto:** if a change makes the canvas worse when no agent is attached, it's the wrong change.

---

## Addendum — Gap coverage (v2.1)

Six gaps closed after design review; all are reflected in the prototypes.

1. **External Steering mode** (new file: `PMX Canvas v2 - External Steering.dc.html`) — the third mode: an external agent (e.g. Claude Code via MCP) writes to the board with NO session attached. Chrome stays quiet; the only additions are (a) a passive top-bar indicator pill (violet `#B388FF` tint, pulsing dot, writer name + op count) and (b) a click-to-open activity feed popover (304px, anchored under the indicator) listing recent ops, with a pending auto-ghost row carrying an inline Veto button. Auto-ghosts render on canvas exactly as in-session ghosts (server-side auto-ghost synthesis already ships). No session panel, no command bar. A "Start session" affordance sits beside the indicator for upgrading to a full session.
2. **Session receipt** (Quiet Board) — on detach, a dismissible receipt card (290px, top-right) shows items/done/vetoed counts, notes the auto-snapshot taken at detach, and offers View diff / Full log. Implementation: tie session end to the existing snapshot system; the receipt is client-side state cleared on dismiss.
3. **Unattended approval policy** (Focus Session) — gates carry a TTL (countdown shown in the gate node: "auto-holds in M:SS if unanswered") and an amber escalation badge in the top bar ("1 gate · M:SS") while any gate is pending. On expiry the gate resolves to **auto-held** (safe default: the action does NOT proceed), a Policy entry lands in the timeline, and the gate can be reopened from the session panel. TTL discipline mirrors IntentRegistry's.
4. **Scope fencing** (Focus Session) — a session can be granted a region: dashed violet fence (`1.5px dashed rgba(179,136,255,0.4)`, radius 16) with an "Agent scope" pill on the top edge and "writes outside are blocked · reads allowed" on the bottom edge. The session panel shows a scope row under its header. Server-side: a nodeId-set / region check on mutations, rejecting writes outside the fence.
5. **Human + agent presence coexistence** (Focus Session) — human collaborator cursors (green `#2fd07f`, name tag) share the canvas with the agent cursor (violet, phase chip). One presence layer, two render styles; humans never get phase chips.
6. **Concurrent-edit rule** (Focus Session) — user wins. When a human grabs a node the agent is editing, the agent yields, the change is requeued, a "took over — agent yielded" pill marks the node, and a Yield entry lands in the timeline. Feedback posts through the existing `vetoGhostSteering` path.

### v2.2 additions

7. **Command palette (⌘K)** (Quiet Board) — modal over a scrim (`rgba(4,10,18,0.55)`), 560px, top-anchored at 56px. Search input; grouped results (Actions with shortcut kbds, Jump to, recent files); footer key hints. ⌘K toggles, Esc closes. Selected row: `background:rgba(75,188,255,0.12)`.
8. **Session history** (Quiet Board) — right drawer (300px, z above canvas) unifying snapshots and session receipts in one reverse-chronological list; session entries carry View diff / Restore pre-state. Opened from the receipt's "Full log" or the rail's Snapshots button. Rule: session detach always writes a snapshot, so the two histories are one timeline.
9. **Multi-writer external steering** (External Steering) — indicator becomes an avatar cluster ("3 writers · 21 ops"); the activity feed gets per-writer filter chips (All / claude-code / research-bot / mcp-sync) and each row is attributed. Writer identity colors: assign per-writer from the accent set, agent-violet first.
10. **Undo semantics for agent ops** (Focus Session) — one shared undo stack. Agent Update entries in the timeline expose "↩ undo this edit"; undoing marks the entry, reverts the op, and posts steering feedback (same `vetoGhostSteering` path). Ctrl+Z applies to whichever op is top of the shared stack, agent or human.
11. **Empty state + light theme** (new file: `PMX Canvas v2 - Empty Board.dc.html`, dark + light stacked) — centered onboarding: ghost mark, "Nothing on this board yet", 2×2 starter actions (New note M, Drop files, Paste link ⌘V, Start agent session), shortcut hint line. Light palette: bg `#eef3f9`, surface `#ffffff`, rail `#f7fafd`, border `#d3deea`, text `#14243a`, muted `#51657c`, faint `#8799ad`, accent `#0E7DC2`, success `#1ba765`, warning `#c28a12`, agent `#7a52c4`. Same geometry/type scale as dark; only tokens change.
12. **Session panel <1180px** (Focus Session) — the 312px panel switches to a fixed overlay drawer (top:44px, right:0, shadow `-16px 0 40px rgba(0,0,0,0.5)`) via the same 1180px breakpoint; canvas reclaims full width beneath it.

### v2.3 additions

13. **Selection bar** (Quiet Board) — multi-select shows per-node outlines (`1.5px solid #4BBCFF`, corner handles, soft outer glow) and a floating bottom-center bar: count, align left/top, distribute, auto-arrange, Group (G), Pin to agent context, delete. Restyle of the existing `SelectionBar.tsx` — reuse its handlers and `auto-arrange.ts`.
14. **Degraded connection states** (Quiet Board, `connection` tweak: connected / reconnecting / resyncing) — the top-bar dot recolors (`#2fd07f` / `#f4c542` / `#4BBCFF`) and a full-width banner slots under the top bar: reconnecting = amber, "edits queue locally", retry count; resyncing = blue, "resyncing from snapshot — cursor went stale", progress bar. Maps to the existing seq-cursor resync + snapshot fallback path.
15. **Edge creation** (External Steering) — drag from a port: source port ring, dashed `#4BBCFF` preview curve following the cursor, target port highlighted (ring + dot), hint pill "release to connect · esc cancels · L labels".
16. **Expanded node view** (Focus Session — expand icon on Delivery Control Room) — scrim + inset overlay (36/48px margins): header with kind pill, pin state, "Open in tab", close; body renders the surface at full size; footer strip with fixture provenance. Esc/scrim closes.
17. **Connected writers sheet** (External Steering — "Writers" in the feed footer) — NOT access control. pmx-canvas is local-first: any local process may connect and write; there are no roles, invites, or allow-lists. The sheet is pure visibility: session agents (with their steering config, e.g. "scoped + gated") and external MCP writers with transport + last-write time. Veto/ghosting is the safety model, not permissions.
18. **Accessibility & reduced motion (implementation spec)** — `prefers-reduced-motion`: disable shimmer, cursor glide, dot pulse, ring pulse (keep static color states); focus: `:focus-visible` ring `2px #4BBCFF` offset 2px on all rail/bar/gate controls; keyboard: roving tabindex across nodes (arrow keys traverse spatial neighbors), Enter opens, Esc closes overlays top-most-first; overlays (palette, expanded node, writers sheet) trap focus and restore it on close; live regions: gate requests and timeline appends announce via `aria-live="polite"`; hit targets ≥36px pointer, ≥44px touch.

19. **Minimap v2** (all boards) — true-scale node map (each node rendered as a scaled rect in its kind color; groups/fences as dashed outlines), viewport frame with grab cursor, zoom % in the corner, presence dots (pulsing violet where an agent is proposing/editing), selection outlines mirrored. 168×112 resting; hovering magnifies the whole map ×1.7 from the bottom-right corner (160ms ease) — glanceable when idle, legible on approach. Click jumps the viewport; dragging the frame pans. Implementation: render from the store's node list (position × scale factor), not hand-drawn.

20. **Groups v2** (Quiet Board) — the interaction overhaul, not just the restyle:
   - **Header affordances** on the frame edge: name pill + child count, and an action cluster (auto-arrange children via `auto-arrange.ts`, collapse, ⋯ menu: rename / ungroup / pin all to context).
   - **Explicit membership feedback** — dragging a node over a group brightens the frame (`rgba(75,188,255,0.8)` border, deeper wash, 150ms ease) and shows a release pill: "release to add to <group> · esc keeps it out". Membership changes ONLY on release with that pill showing — never silently by geometry.
   - **Collapse** — a collapsed group renders as a compact chip: expand chevron, name, kind-colored dots + node count. Collapsing preserves child layout for restore.
   - **Auto-grow** — a group fits its children with 22px padding; dragging a child against the frame grows it rather than clipping. Dragging a child fully out shows the inverse pill ("release to remove").
   - **Move semantics** — dragging the frame moves all children; dragging a child never moves the frame.
   - **Keyboard** — G groups the selection, Shift+G ungroups, header buttons are tabbable.

New client state: `gateTtl`, `scopeFence: {nodeIds | rect} | null`, human presence from the existing sync layer. New server checks: fence enforcement on mutation, gate TTL sweep in `SessionRegistry`.

---

## Files
| File | Role |
|---|---|
| `PMX Canvas v2 - Focus Session.dc.html` | Target design, agent session attached |
| `PMX Canvas v2 - Quiet Board.dc.html` | Target design, no agent — the general-purpose case + session receipt |
| `PMX Canvas v2 - External Steering.dc.html` | Target design, external writers via MCP, no session — multi-writer indicator + filterable activity feed |
| `PMX Canvas v2 - Empty Board.dc.html` | Empty-state onboarding, dark + light themes stacked |
| `PMX Canvas — Current UI.dc.html` | Today's UI, before/after reference only |
| `support.js` | Runtime for the three HTML files; not part of the design |
| `screenshots/00-current-ui-baseline.png` | Today's UI |
| `screenshots/01-focus-session.png` | v2, agent session attached (fence, gate TTL, human cursor) |
| `screenshots/02-quiet-board.png` | v2, no agent (selection, groups v2, receipt) |
| `screenshots/03-external-steering.png` | v2, external MCP writers, no session |
| `screenshots/04-empty-board-dark.png` | v2, empty state, dark |
| `screenshots/05-empty-board-light.png` | v2, empty state, light |

Screenshots are preview-viewport captures and are cropped at the right edge — they show the chrome and node treatment, not full board extent. **The `.dc.html` files are authoritative**; open them in a browser at ≥1440px wide for the complete layout.

Open any `.dc.html` directly in a browser to view it.
