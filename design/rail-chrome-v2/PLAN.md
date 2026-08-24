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
  tokens throughout, a hover/focus tooltip carries the shortcut (rail = shortcut discovery
  surface; it is rendered fixed beside the button because the rail's scroll clip would hide a
  CSS-only one, and there is no native `title` — it never showed in embedded browser panes).
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
| **Node card shell** (every node: titlebar, radius, shadow, body type) | Standard card shell — node surface, 12px radius, `0 4px 24px` shadow, 7×12 header with kind icon in the kind's accent, 11–12px/600 title, body 11px / 1.6 | **4a — BUILT** (type badge dropped, `data-node-type` carries the kind; ⋯ consolidation of the controls stays with phase 7) |
| **Docked CONTEXT pill** (`context-main`, top-right HUD) | Pinned-context chips in the command bar (Focus Session); on the quiet board the pin bar stays as the minimal affordance | 5 |
| **Docked STATUS pill** (`status-main`, top-left HUD) | Top-bar agent chip (done) + session panel work list / timeline (done) — the pill itself is removed with the context pill in phase 5 | 5 |
| `ContextPinBar` ("✦ N nodes in context") | Command bar chips with `×` above the floating composer; budget meter in the top bar | 5 |
| `SelectionBar` | Bottom-centre floating bar restyle (count, align, distribute, arrange, group, pin, delete) | 7 (item 13) |
| `WelcomeCard` | Centred empty state: ghost mark, "Nothing on this board yet", 2×2 starters | 7 (item 11) |
| Minimap | Minimap v2: true-scale rects, hover magnify, presence dots | 7 (item 19) |
| `ExpandedNodeOverlay` | Scrim + inset overlay with kind pill / pin / open-in-tab / provenance footer | 7 (item 16) |
| Group frame | Groups v2: dashed accent frame, name pill + count on the edge, header cluster | 7 (item 20) |
| Command palette | 560px top-anchored modal over scrim, grouped results, key hints | 7 (item 7) |
| Annotation (free-floating note) | warm tinted, italic, `rotate(-1deg)` | 4a (same CSS pass) |

### Phase 4 — Session panel — BUILT (incl. items 3 and 4)
- `SessionPanel.tsx` (320px right column): AX work items with status glyphs, approval gates
  resolving through the existing gate path (reject posts steering feedback), timeline feed,
  collapse, ≤1180 overlay drawer (item 12). Top-bar pending-gate badge. Mounts on
  `sessionActive`; the canvas region re-reports its size when the panel mounts.
- Presence now counts non-GET AX writes (work items, gates, evidence, steering) as agent
  activity, and re-emits when a gate opens/resolves (the phase derives from pending gates).
- **Item 3 — unattended approval policy:** gates carry `expiresAt` (`ttlMs`, default
  `PMX_CANVAS_GATE_TTL_MS` = 5 min); a 1s server sweeper (`ax-gate-ttl.ts`) resolves unanswered
  gates to `held` (non-approval, the action does not proceed), records a `policy` timeline
  event, and re-emits presence. The panel shows the countdown, held gates with Reopen, and the
  top-bar badge reads "1 gate · M:SS". Reopen is HTTP/SDK only (a human action).
- **Item 4 — scope fence:** `policy.scope = { nodeIds, padding }`; `executeOperation` refuses
  agent-originated layout writes outside it (403 with a reason), the human's workbench writes
  and all reads pass, batch inner ops are fenced, unknown mutating ops are refused by default.
  Drawn in the world layer from the shared geometry; the panel's scope row grants it from the
  current selection and clears it. Not done: the on-node gate countdown (the design draws it in
  the gate node; ours lives in the panel + badge) — phase 7 polish.

### Phase 5 — Command bar + session lifecycle — BUILT
- **5a — command bar (built):** replaces `ContextPinBar` while a session is attached (the quiet
  board keeps the minimal pin bar). Built to the Focus Session mockup, not the README's prose:
  a floating composer centered at the bottom of the canvas region (560px max, 12px radius, blur +
  shadow, violet bubble glyph, borderless input "Steer the agent, or ⌘K to search the board…",
  solid-accent Send) with the pinned context floating above it as gold `✦` chips + "in agent
  context" (the README's unpin `×` kept on each chip). The **budget meter lives in the top bar**
  (`Context` · 72×5 track · mono %), where the mockup places it — session-only, fed by the
  presence snapshot so it moves within a frame of a pin toggle; README tone thresholds kept
  (solid warn ≥70%, danger >90%). The selection bar lifts clear of the composer while a session
  is active. "Start agent session" in the top bar attaches a `browser`-keyed session (label
  "Agent session") — the agent's MCP/HTTP writes are attributed to it by the phase-2 rule; "End"
  in the panel header detaches. The attention toast/history now anchor to the canvas region
  (they were window-anchored and landed on the session panel).
- **5b — session receipt (item 2) (built):** the snapshot is taken at ATTACH, not detach — a
  detach-time snapshot would equal the current board and View diff would be empty. Named
  `Before session · <label> · HH:MM`, skipped on an empty board. On detach (explicit, activity
  `session-end`, or idle expiry) the server emits `agent-session-ended` `{ label, endedAt,
  counts: { items, done, vetoed }, snapshot }`; the client shows the dismissible receipt with
  View diff (`snapshots/:id/diff`) and Full log (snapshots panel; the unified history drawer is
  item 8, later). No agent `sessionId` in the payload — the SSE envelope reserves that key
  (LRN-20260823-003).
- **Hardening landed with 5a/5b (from the simplify/harden audits):** the scope fence is
  human-owned — `ax.policy.set` with `scope` from a non-workbench caller is 403 and the MCP
  `set-policy` action no longer takes `scope`; fence checks cover group membership
  (`node.add`/`node.update` children), `jsonrender.stream` by `nodeId`, and fail closed on
  search-resolved edge endpoints; the SDK enforces the same fence through `assertInsideFence`
  (its methods bypass the registry); restored pending gates with an elapsed TTL get a fresh
  clock; presence re-emits through one `canvasState.onChange` subscription instead of
  per-site refresh calls; the Copilot extension's shutdown detach is bounded (800 ms).
- **5c — retire the docked pills (built, own commit):** the HUD pill layer and `DockedNode` are
  gone; nothing is seeded on first run (`ensureDefaultDockedNodes` / `hasPersistedState`
  deleted); `dockPosition` is removed from the model end to end — server state, SQLite columns
  (existing DBs keep a dead `dock_position` column; no migration, per the no-compat rule), the
  HTTP/MCP `node.update` input, the CLI `--dock-position` flag, the SDK, the client types/store/
  bridges, the validator's `hiddenEdgeEndpoints` rule, the context-menu dock items, and the
  `hud-left/right` + docked-node + context-dock CSS. Legacy host events (`canvas-status`,
  `execution-phase`, `context-cards`, `aux-open`) keep creating `status-main` / `context-main`,
  now as ordinary expanded cards. The attention history lost its "collapse the context panel"
  coupling. Demo fixture regenerated through the API.

### Phase 6 — External steering surfaces — BUILT
- Top-bar passive indicator (avatar cluster, writer label or count, op total, pulsing dot) +
  activity feed popover (304px under the indicator; per-writer filter chips; rows with op glyph,
  summary, writer in its identity color, relative age; footer Writers / Start session ↗) +
  connected-writers sheet (scrim + 400px card: agent sessions with their steering config,
  external writers with transport + last write; local-first note). Items 1, 9, 17.
- **Data:** one new field, `activity`, on the presence snapshot — derived from the presence
  touch every agent write already makes (`describeWrite` turns op + input/result into a
  sentence; titles read after the op ran), bounded to 50, re-attributed when a shadow writer
  folds into a session, kept after a writer fades. No second log.
- **Deviation, per the plan's own rule ("trust the code over the prototypes' ghost
  treatment"):** auto-ghosts settle immediately and are not vetoable, so the feed's vetoable
  rows are pending EXPLICIT intents (`canvas_intent`), vetoed through the existing
  `vetoGhostIntent` path; settled auto-ghosts appear as activity rows.
- **Fixed on the way:** an explicit `attached: false` left the session as an unattached writer
  for the 90 s activity TTL — it now removes the presence like `session-end` does. Per-writer
  colors come from the accent set, violet first, stable for the page's life.

### Phase 7 — Canvas quality wave — BUILT (7a–7d)
- **7a (built):** empty state replacing WelcomeCard (item 11 — four live starter actions: the
  M note, a file picker onto the viewport's import path (`import-files.ts`, shared with the drop
  zone), the webpage prompt, Start agent session; the vestigial client-side `status-main` seeding
  at connect is gone so a fresh board never flashes a status card); command palette restyle
  (item 7 — 560px at 56px, search row, Actions with kbds then Jump to with kind icons, footer
  hints, Start agent session off-session only); selection bar restyle (item 13 — floating
  bottom-center in the canvas region: count · align left/top · distribute · auto-arrange ·
  Group · Connect · Pin · delete · ×, accent outline + corner handles on selected nodes; the
  geometry actions live in the store and persist like a drag); degraded-connection banner
  (item 14 — `degradedState` derives reconnecting from a dropped transport with the bridge's
  retry count/delay, and resyncing from a post-reconnect snapshot apply; the top-bar dot
  follows; worded truthfully: edits still save over HTTP, the board may be stale); expanded
  node view (item 16 — scrim + 36/48px inset INSIDE the canvas region, header with kind
  icon/pill/pin state/Open in tab, footer with provenance + close hint). The attention
  toast/tab now stack below modal overlays.
- **7b (built):** Minimap v2 (item 19 — a DOM render from the store, not a canvas drawing:
  168×112 anchored in the canvas region at z 60, node rects in kind colors, groups and the
  scope fence as dashed outlines, selection outlines mirrored, pulsing presence dots for
  attached sessions, the viewport frame with a grab cursor, zoom % in the corner; hover
  magnifies ×1.7 from the bottom-right; click jumps, drag pans — hit-testing reads the rendered
  size so the magnified map maps correctly). History drawer (item 8 — the snapshot popover
  became a 300px right drawer in the canvas region: snapshots + sessions in one
  reverse-chronological list; a session's entry IS its `Before session · …` snapshot, with View
  diff inline and Restore pre-state; manual snapshots keep Restore/Delete; the save form stays;
  opened from the rail's Snapshots button or the receipt's Full log).
- **7c (built) — Groups v2 (item 20):** the frame's name pill + child count and the action
  cluster (auto-arrange children via `group.add childLayout`, collapse, ⋯ menu: rename /
  ungroup / pin all to context) sit ON the top edge (the edge row is the whole-frame
  drag handle; groups drop their connection ports, which sat exactly where the row now is, and
  drop paint containment so the row can hang outside). Membership feedback lives in the store:
  `trackDragMembership` runs on every drag move, sets `dragDropTarget` (the frame brightens,
  a release pill under the node says "release to add to <group> · esc keeps it out" or the
  inverse), and membership changes ONLY on release while the pill shows — Esc during the drag
  suppresses it for that drag. A fit-mode parent grows live as a child is dragged against it
  (the server re-fits on persist). Collapsing a group persists and renders a chip (chevron,
  name, kind dots, count); its children are hidden and edges to them draw to the chip. G groups
  a ≥2 selection (else a new frame), Shift+G ungroups every group the selection touches.
  Ungroup *dissolves* the frame — children released (into the enclosing group when nested),
  frame gone, one undo step — and it is ONE server operation (`group.remove` →
  `canvasState.ungroupNodes` → `removeNode`) for the human's menu / Shift+G / context menu and
  the agent's `canvas_group { action: "ungroup" }` alike, so the two sides cannot drift. The
  old "release children, keep the empty frame" survives only as the internal membership step
  `releaseGroupChildren` behind PATCH `children`. Delete/Backspace remove the selection (else
  the focused node). `bringToFront` keeps a group below its own children.
- **7d (built) — shared undo (item 10):** history entries carry an `actor` (`executeOperation`
  sets human/agent from the workbench marker around each op; SDK writes default to agent) and
  `GET /api/canvas/history` exposes `top` (what Ctrl+Z undoes next). The session panel merges
  the agent's board writes (presence activity) into the timeline as Update rows; the newest
  board write shows "↩ undo this edit" only while an agent edit tops the stack. Undo goes
  through the one shared `POST /api/canvas/undo`, marks the row "undone · steering sent", and
  posts steering ("Undid your edit: …"). Ctrl+Z / Ctrl+Shift+Z work the same stack, agent or
  human. A new agent write refreshes the panel's view of the stack.
- **7d (built) — a11y sweep (item 18):** one `:focus-visible` ring (2px accent, 2px offset) on
  every rail/bar/panel/overlay control; nodes are focusable with roving tabindex (the active node
  is the tab stop), arrow keys move focus to the nearest node in a 90° cone, Enter opens focus
  mode; `useFocusTrap` on the palette, the expanded node (restores to the node it opened from —
  its world element is remounted on close) and the writers sheet; `aria-live="polite"` on the
  gates/work-item list and the timeline; Esc closes overlays top-most first (already);
  reduced motion disables the new pulses, shimmer, glide, progress and panel transitions.

### Phase 8 — Multi-client presence — BUILT
- **Sync infra (new, small):** `src/server/human-presence.ts` — an in-memory, TTL-swept registry
  of open workbench tabs mirroring the agent one: each tab reports `{ clientId, name, cursor,
  grabbingNodeId }` through `POST /api/canvas/human-presence` (throttled cursor, 3 s heartbeat,
  `left` on pagehide via sendBeacon); the server fans one coalesced `human-presence` SSE frame
  on every change. Heartbeats never count as agent activity.
- **Human cursors (item 5):** `HumanPresenceLayer` is the second render style of the presence
  layer — green arrow + name tag (" · editing" while holding a node), never a phase chip; shows
  every OTHER tab, session or not. Names come from `?name=` / localStorage, else `guest-xxxx`.
- **User wins (item 6):** a drag holds the node (`grabbingNodeId`); `executeOperation` refuses
  an agent write to a held node with 409 ("being edited by mia — requeue") until release or the
  8 s grab TTL; grabbing a node with a pending explicit agent intent vetoes it through the
  normal veto path (steering), records a `yield` timeline event (new AX event kind) and shows
  "<name> took over — agent yielded" on the node for a moment.
- **Edge creation (item 15):** the rail's Connect (C) tool drags an edge from anywhere on a
  node; during any edge drag the target lights up (ring + ports), a hint pill follows the
  cursor ("release to connect · esc cancels · L labels"), Esc cancels, L asks for a label on
  release. The preview curve now draws on a board with no edges yet (it did not).

### Phase 9 — Skills refresh (last; closes the redesign) — BUILT
Done 2026-08-23: `skills/pmx-canvas/SKILL.md` gained a consolidated **Sessions & the human**
section (the three board modes, what a session asks of the agent: detach, 403 fence, 409 edit
lock, held gates, undo steering, where steering arrives) and a browser-workflows rewrite for the
redesigned chrome (selection bar, groups v2, edges + Connect tool, History drawer, minimap,
connection banner, human cursors, keyboard); `references/full-reference.md` got the new chrome
and presence selectors (and `data-node-id`); the orchestration skill gained a Presence section
(who attaches, agentId per sub-agent, fence/409/held etiquette, where steering comes from); the
testing skill gained the presence/e2e patterns; `docs/mcp.md` / `docs/cli.md` lost the last
toolbar wording; `docs/http-api.md` documents human presence, the history actors and the
session lifecycle; CLAUDE.md/AGENTS.md describe human presence, the edit lock and the actor-
tagged undo stack. The demo fixture was regenerated through the API and the README screenshot
re-taken with the showcase seeding the board as the human (its writes no longer read as an
external agent). The 22-tool / 14-resource MCP counts are unchanged (pinned by tests).
Bring every skill in the repo up to date with everything the phases changed, so an agent
reading a skill cold gets the board as it is now, not as it was in 0.4.7:
- `skills/pmx-canvas/SKILL.md` + `references/full-reference.md`: presence/session lifecycle
  (attach → snapshot → receipt), the human-owned scope fence, unattended approvals, the command
  bar as the human's steering channel, the retired docked pills (no `dockPosition`, no
  `status-main`/`context-main` HUD semantics), rail tools and shortcuts, the tool/action
  counts and the AX capability matrix — every count and table agents read as authoritative.
- `skills/pmx-canvas-orchestration/SKILL.md`: session attach/detach as part of the choreography,
  steering delivery, fence etiquette for sub-agents (`agentId`).
- `skills/pmx-canvas-testing/SKILL.md`: the presence/session e2e patterns (reset detaches
  sessions and clears the fence as the workbench; assert SSE frames as received; the browser
  pane never fires rAF).
- The `.github/extensions/pmx-canvas` adapter docs and `docs/ax-host-adapter-contract.md`
  (detach on shutdown; presence hooks), and `docs/mcp.md` / `docs/http-api.md` / `docs/cli.md`
  cross-checked against the registry (`docs/api-stability.md` defines the surface as what
  those files document).
- Regenerate the demo board and the README screenshot last, after 5c and the phase-7 restyles.
- Verify: `bun run validate:agent-skills`, the skill-validation rules in CLAUDE.md, and a
  cold read of each skill by a fresh agent against a live board.

### Post-build QA pass (2026-08-23) — hands-on, human side and agent side

Driven as the human in a headed browser (every rail / top-bar / card / selection-bar / group
header / panel / receipt button, the composer, keyboard) against an agent writing over HTTP as
`claude-code` and claiming the composer's steering through `ax.delivery`. Scripts:
`scratchpad/qa-a.ts` (quiet board), `qa-b.ts` (session surfaces), `qa-c.ts` (every button +
steer loop). Defects found and fixed, each with a regression test:

- **Rail/keyboard/palette/empty-state creates landed off-screen** on a busy board (server
  auto-placement) → `createNodeInView` centres human creates in the current viewport.
- **A human-started session never captured an agent identified by a host label**
  (`PMX_CANVAS_AGENT_SOURCE=claude-code`, which the skill recommends): the writer stayed an
  "external writer" and lingered after End. A `browser` session now absorbs agent-less writes
  under any label, takes the writer's name (`HUMAN_STARTED_SESSION_LABEL`), adopts a single
  loose writer at attach, and the pre-session snapshot is renamed at end.
- **The human's own pins and annotations showed up as a phantom `api` agent** (three bare
  `fetch` calls in `canvas-store.ts` lacked the workbench marker) — they lit the External
  Steering indicator and appeared as "pin set" rows in the session timeline.
- **Pin bar and selection bar shared the bottom-centre slot**; the pin bar (window-anchored,
  z 10000) swallowed the bar's geometry buttons → region-anchored, and the bar lifts above it.
- **Ungroup left an empty frame** (the agent op's documented semantic) → human ungroup
  dissolves via `node.remove`; no Delete/Backspace shortcut existed → added; the ⋯ menu's
  redundant "Remove group" dropped.
- Shift+click extended a text selection across cards; a burst of writes replayed stale
  attention toasts for a minute (queue capped at 3); the meter read "0%" with pins (now "<1%");
  the feed subtitle was the mockup's literal "via MCP" (now derived).

### Parity round (2026-08-23, after the QA pass) — ungroup is the same action on both sides

The user's rule for this case: the human's Ungroup and the agent's `canvas_group { action: "ungroup" }`
must produce the same board. Built as ONE implementation (`group.remove` → `canvasState.ungroupNodes`
→ `removeNode`): children released (into the enclosing group when nested), frame removed, one undo
step that re-parents the children, restores the enclosing group's membership, the edges and the
pin. The human's three paths (⋯ menu, Shift+G, context menu) call that same op. Verified by
`scratchpad/qa-d.ts` (27 checks: real MCP stdio agent vs headed human — nested, collapsed chip,
Shift+G across two frames, Delete, `canvas_batch`, `canvas_node remove`, fence, member lock,
panel undo, snapshot restore both ways), plus unit/SDK/MCP/e2e parity tests. Found on the way:

- `removeNode`'s undo did not re-parent a restored group's children nor restore its pin.
- The edit lock keyed on `id/nodeId/groupId` only — an agent could dissolve a group (or
  `group.add`) while the human dragged a member; membership ops now count as writes to members.
- "Fence to selection" with a frame selected fenced the frame node only; the server now expands
  group ids to their members (nested included) when the scope is set.
- Shift+click on a title bar / group edge row started a drag instead of toggling the selection,
  so a frame could not be put into a multi-selection by clicking it at all.

### Addressed steering (2026-08-24) — pick which connected agent the composer steers

With several agents on one board the composer was a pure broadcast. Now `steerableAgents`
(presence-derived: live presences deduped by label, sessions first, the un-adopted
"Agent session" placeholder excluded — no consumer ever claims as it) feeds a target picker
that renders only when there is a real choice (≥2). The steer posts the existing `target`
field; delivery scopes it (and a consumer-less claim now sees broadcasts ONLY — it used to
leak addressed steering). A picked agent that detaches or expires falls back to "All agents"
at render time — presence is the truth for who can still claim. The panel's Steer rows read
"→ copilot · message". Verified: client picker tests, HTTP scoping tests, and an e2e where
only the addressed consumer's claim returns the message. The session timeline also gained
kind filter chips (All / Updates / Steer / Events / Evidence — user request while driving the
session from the board): the filter applies BEFORE the 40-row cap so sparse kinds are never
starved by a burst of Updates; steering-shaped events (`steering`, `yield`) count as Steer.

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
