# Rail + Session Chrome (v2) — Implementation Plan

Design source of truth: [`handoff/README.md`](handoff/README.md) + the `.dc.html` prototypes.
This plan maps every design item onto the existing codebase and sequences the work. The bundle
lives in `design/` (not in the npm `files` whitelist — it never ships).

## The one big engineering decision

The handoff assumes a new `SessionRegistry` must be invented beside `IntentRegistry`. **It must
not.** This repo already has the AX layer the design is unknowingly describing:

| Design concept | Existing machinery |
|---|---|
| Work items in the session panel | `PmxAxState.workItems` (`ax-state.ts`) |
| Approval gates + approve/reject | `PmxAxState.approvalGates` + gate resolution paths |
| Steering input in the command bar | AX steering messages (delivery/claim already loop-safe) |
| Timeline feed | AX timeline tables (`agent-event`, `evidence-item`, `steering-message`) |
| Agent cursor / veto | Ghost Cursor of Intent (`IntentRegistry`, `intent-store`, `IntentLayer`, veto poisoning) |
| "Undo agent op" | server mutation history (shared stack already exists) |
| Session receipt's snapshot | snapshot system |

New server surface is therefore *small*: an `agent_presence` SSE event, a `sessionActive`
definition, budget numbers, gate TTL sweep, and scope-fence enforcement. Everything else is
client rendering over state that already flows.

## Deviations from the handoff (deliberate, argue before changing)

1. **Tokens win** (handoff says so itself): every hex maps to `--c-*` custom properties so all
   nine themes keep working. The handoff's light palette informs the existing `light` theme only.
2. **No dead buttons.** "Start agent session" (quiet affordance) and the Connect (C) tool render
   only once their behavior exists (phases 5 and 8). A button that does nothing makes the quiet
   canvas worse — the design's own rule.
3. **Rail utilities keep Trace, Minimap toggle, and Arrange** — the handoff's utility list isn't
   exhaustive for this app, and dropping working affordances violates "the canvas must not get
   worse". Annotate is one rail slot with a pen/text/eraser popover (three tools exist today).
4. **Board title** = workspace basename (from `/health`); board id = session id. No board-name
   concept exists and this phase doesn't invent one.

## Phases

### Phase 1 — Shell: rail + top bar + responsive (shippable alone; handoff step 1) — BUILT
- `src/client/canvas/ToolRail.tsx` (new): brand → Select(V)/Pan(Space) → divider → node palette
  Markdown(M) · Image(I) · File(⇧F) · Webpage(W) · HTML(H) · Group(G) · Annotate(A, popover) →
  spacer → Snapshots · Theme (existing menu) · Trace · Minimap · Shortcuts(?). 52px, 36px buttons,
  tokens throughout, `title` carries the shortcut (rail = shortcut discovery surface).
- `src/client/canvas/TopBar.tsx` (new): connection dot · board title · board id
  (`.hud-collapsible`) · counts (`.hud-collapsible`) · spacer · zoom− · zoom% (click = 100%) ·
  zoom+ · fit-all. 44px, blur, `overflow:hidden`/`min-width:0` discipline, ellipsis on title.
- `App.tsx` restructure: flex root (rail + center column [top bar + canvas region]); old floating
  `Toolbar` deleted (no backwards compat). Docked pills, SelectionBar, ContextPinBar, Minimap,
  SnapshotPanel, WelcomeCard reposition inside the canvas region.
- **Coordinate correctness** (the structural risk): new `canvasArea()` helper returning the canvas
  region's rect (container ref, window fallback). Swap into: `zoomByFactor` anchor + `focusNode`
  centring (`canvas-store.ts:383,483,646`), `reportClientViewportSize` (`intent-bridge.ts:393` —
  the server's fit must fit the *canvas region*, not the window), `fitAll` callers, Minimap
  container dims. Pointer math already element-relative (`use-pan-zoom` uses
  `getBoundingClientRect`) — untouched.
- Pan tool: rail-selected mode that makes background drag pan (Space keeps working).
- Responsive: ≤1180px hides `.hud-collapsible`; existing ≤900/720 rules re-homed to the new bar.
- Tests: e2e toolbar tests (~theme menu, tooltip, collapse, anchoring at `tests/e2e/canvas.pw.ts`)
  move to the new chrome guarding the *same properties*; new unit tests for `canvasArea` math
  (zoom anchors at canvas centre, fit clears rail/bar — architecture rule 9); browser screenshots
  at 1440 and <1180 across ≥3 themes.

### Phase 2 — Presence contract (spec before surfaces) — BUILT (see "Phase 2 contract" below)
- `agent_presence` SSE: `{ sessionId, phase, detail?, focusNodeId?, cursor? }` emitted from the
  same hook points as auto-ghost synthesis. Shared shape in `src/shared/`.
- `sessionActive` derivation (client signal): host-capability/agent-event recency + explicit
  attach; one selector gates every agent surface.
- Budget numbers: pinned-context token estimate (server already computes context size) as
  `{ used, total }`, folded into presence or low-frequency event.

### Phase 3 — AgentPresenceLayer (cursor, phase chip, shimmer) — BUILT
- New `AgentPresenceLayer.tsx` sibling of `IntentLayer` (veto logic untouched). Cursor glide
  220ms cubic-bezier, phase chip, shimmer on mutating nodes (derived from intent-store's
  in-flight set — no parallel source). Top-bar agent chip (phase-colored). Reduced-motion:
  disable glide/shimmer/pulse.

### Visual fidelity checklist (what still looks like the old UI, and which phase replaces it)

Tracked explicitly after review feedback ("the context node is still the old style"). Each row
is a visible element on today's board that does not yet match the prototypes.

| Old-style element today | Design replacement | Phase |
|---|---|---|
| **Node card shell** (every node: titlebar, radius, shadow, body type) | Standard card shell — node surface, 12px radius, `0 4px 24px` shadow, 7×12 header with kind icon in the kind's accent, 11–12px/600 title, ⋯ trailing menu, body 10.5–11px / 1.55–1.6 | **4a** — CSS-only, pulled forward; first thing in phase 4 |
| **Docked CONTEXT pill** (`context-main`, top-right HUD) | Pinned-context chips in the command bar (Focus Session); on the quiet board the pin bar stays as the minimal affordance | 5 |
| **Docked STATUS pill** (`status-main`, top-left HUD) | Top-bar agent chip (done) + session panel work list / timeline | 4 |
| `ContextPinBar` ("✦ N nodes in context") | Command bar row 1 chips with `×`, budget meter | 5 |
| `SelectionBar` | Bottom-centre floating bar restyle (count, align, distribute, arrange, group, pin, delete) | 7 (item 13) |
| `WelcomeCard` | Centred empty state: ghost mark, "Nothing on this board yet", 2×2 starters | 7 (item 11) |
| Minimap | Minimap v2: true-scale rects, hover magnify, presence dots | 7 (item 19) |
| `ExpandedNodeOverlay` | Scrim + inset overlay with kind pill / pin / open-in-tab / provenance footer | 7 (item 16) |
| Group frame | Groups v2: dashed accent frame, name pill + count on the edge, header cluster | 7 (item 20) |
| Command palette | 560px top-anchored modal over scrim, grouped results, key hints | 7 (item 7) |
| Annotation (free-floating note) | warm tinted, italic, `rotate(-1deg)` | 4a (same CSS pass) |

### Phase 4 — Session panel
- `SessionPanel.tsx` (320px right column): AX work items with status glyphs, approval gates
  resolving through the existing gate path (reject posts `vetoGhostSteering` feedback), timeline
  feed. Gate TTL + auto-hold + top-bar escalation badge (item 3). Scope fence rendering +
  server-side mutation check (item 4). ≤1180: overlay drawer (item 12).

### Phase 5 — Command bar + session lifecycle
- `ContextPinBar` evolves into the command bar: pin chips with unpin ×, steering input (posts AX
  steering), budget meter recomputing locally on pin toggle. "Start agent session" affordance
  appears (attach flow now exists); detach → auto-snapshot + receipt card (item 2); session
  history drawer unifying snapshots + receipts (item 8).

### Phase 6 — External steering surfaces
- Top-bar passive indicator (writer count + op count) + activity feed popover with per-writer
  filters and inline Veto on pending auto-ghosts (items 1, 9). Connected-writers sheet — pure
  visibility, no permissions (item 17).

### Phase 7 — Canvas quality wave (independent items, any order)
- Groups v2: membership only via release-pill, collapse chip, auto-grow, frame-move semantics,
  G/Shift+G (item 20 — the largest single item).
- Minimap v2: true-scale rects, hover magnify, presence dots (item 19).
- Selection bar restyle on existing handlers (item 13). Expanded-node overlay restyle (item 16).
- Empty state replacing WelcomeCard, dark+light (item 11). Command palette restyle/grouping (7).
- Degraded-connection banner mapped to the existing resync/snapshot-fallback path (item 14).
- Per-entry undo of agent ops through shared history + steering feedback (item 10).
- A11y sweep: focus-visible rings, focus traps, `aria-live` on gates/timeline, roving tabindex
  (item 18 — partially delivered inside each phase, swept here).

### Phase 8 — Multi-client presence (needs sync infra that doesn't exist yet)
- Human collaborator cursors (item 5), user-wins yield + requeue (item 6), edge-creation drag +
  the rail's Connect tool (item 15). These need client-presence broadcast and edit-lock
  semantics — scoped last deliberately.

## Verification bar (every phase)
`bun run typecheck` · `bun run build` · `bun run lint` · `bun run test` · `bun run test:client` ·
`PMX_CANVAS_DISABLE_BROWSER_OPEN=1 bun x playwright test` · real-browser screenshot of the actual
change (architecture rules 3/9; assert the user-visible effect, not the server number) · quiet
board stays byte-clean of agent chrome (handoff's load-bearing rule).

## Phase 2 contract (as built)

The handoff asks for an `agent_presence` event and separate `session`/`budget` events. What exists
already decides the shape:

- **AX changes already stream** (`ax-state-changed`, `ax-event-created`), so the "session"
  events are covered — no duplicate stream.
- **`session-start` / `session-end` already exist** as `ax.activity.ingest` kinds, and
  `tool-start` / `tool-result` / `failure` / `error` carry the phase. Presence is DERIVED from
  that feed plus agent-originated mutations (`executeOperation` already knows workbench-vs-agent
  origin via `suppressAutoGhost`), plus an explicit `ax.presence.set` for adapters with richer
  hooks (`thinking`, cursor, focus).

Shared shape — `src/shared/agent-presence.ts`:

```ts
type AgentPhase = 'idle' | 'thinking' | 'tooling' | 'waiting-approval';
interface AgentPresence {
  sessionId: string;        // agentId ?? source — the writer key
  source: PmxAxSource;      // host label (copilot, codex, mcp, api, cli, …)
  agentId: string | null;
  label: string;
  phase: AgentPhase;
  detail: string | null;    // tool / op name while tooling
  focusNodeId: string | null;
  cursor: { x: number; y: number } | null;   // world coordinates
  attached: boolean;        // session-start seen (or explicit attach) and no session-end
  opCount: number;          // agent writes observed — feeds the external-steering indicator
  lastSeenAt: string;
}
interface ContextBudget { used: number; total: number }   // token estimate of canvas://pinned-context
interface AgentPresenceSnapshot { presences: AgentPresence[]; budget: ContextBudget; sessionActive: boolean }
```

- **`sessionActive` = any presence with `attached: true`.** This is what maps the design's three
  modes: no presences → Quiet Board; live but unattached writers → External Steering (passive
  indicator only); an attached session → Focus Session (panel + command bar).
- **Phase derivation:** agent mutation or `tool-start` → `tooling` (detail = op / tool name),
  decaying to `idle` after 4 s of quiet; `tool-result`/`failure`/`error` → `idle`; an attached
  session with a pending approval gate reads as `waiting-approval` at snapshot time; `thinking`
  only via explicit `ax.presence.set`.
- **Lifetime (IntentRegistry discipline):** unattached writers fade 90 s after their last write;
  attached sessions expire after 30 min without activity; `session-end` detaches immediately;
  at most 16 presences (oldest evicted). Expiry emits, so clients never need their own ticker.
- **Transport:** one SSE event, `agent-presence`, carrying the full snapshot on every change
  (small, reconnect-safe); `GET /api/canvas/ax/presence` for the connect-time read;
  `POST /api/canvas/ax/presence` for explicit updates. MCP: `canvas_ax_state` actions
  `presence` / `set-presence`. Kebab-case event name follows the repo's existing events.
- **Budget:** `used` = estimated tokens (chars / 4) of the `pinned-context.get` payload;
  `total` = `PMX_CANVAS_CONTEXT_BUDGET_TOKENS` (default 32000). Recomputed on every snapshot,
  and the client recomputes locally on pin toggles in phase 5.
