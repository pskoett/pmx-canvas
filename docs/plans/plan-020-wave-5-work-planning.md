# Plan 020: Wave 5, work planning and Move to new board

**Status (2026-10-27):** annotation parity is delivered; deliberate work-card authoring
is implemented, verified and owner-approved with option A's in-card editor.
Live-task views, relations/group navigation and board moves remain planned as separate increments.
This replaces step 4's automatic work-item-to-card conversion and make/inline-board
pairing in [plan 019](plan-019-post-0.9-roadmap.md). 0.12 is a proposed release number,
not authorization to publish. Annotation contract changes are recorded in the Unreleased
changelog and transport docs; verification evidence will accompany the implementation.

**Decision source:** [Wave 5 planning conversation](https://ampcode.com/threads/T-01a17bd4-a7c9-714d-93a1-434f88c3bed7).
Visual authority remains [design.md](../design.md), especially
[Uses](../design/Uses.dc.html), [Flows](../design/Flows.dc.html) and
[Relations](../design/Relations.dc.html). The owner reaffirmed Uses' Agent flow,
Dependencies and Decision drawings; the existing group/relation drawings remain the references.

## Agreed outcomes and boundaries

- Humans and agents can plan work together using ordinary cards and relations: work steps,
  progress, dependencies, alternatives, conditions and illustrated loops.
- Showing work is deliberate. The agent can choose to present useful work without a separate
  human request for every card. Creating a task, receiving an event or starting a session does
  not automatically populate the canvas.
- Agents can use the same pen, text annotations and whole-mark eraser as humans. They can
  point things out, circle a concern or write a question beside alternatives when useful,
  alongside existing cards, relations and ghost feedback. Marks are ordinary board content,
  not session records, approval gates or automatically generated commentary.
- Canvas nodes and edges own the authored plan. Existing session records own running session
  work. Only a card deliberately representing a session task needs a reference to that record;
  do not create hidden sessions or convert every card when a session starts.
- A linked task has one authoritative live status. The card and panel present that state,
  rather than keeping two independently editable copies. Ordinary card status is authored data.
- Questions and alternatives can use existing card types. Defer a general `ask` node until a
  concrete interaction needs it. Ordinary planning cards do not approve/reject native-agent work.
  Existing PMX session controls and protections remain available; hiding session UI does not
  cancel pending gates or bypass a fence. The native agent host retains its own approvals.
- Keep `policy`, `host-capability`, the named command registry, steering, delivery and fleet
  behavior. Preserve explicit ghost previews, veto behavior and automatic ghosts unchanged.
- **Move to new board** is available from a multi-selection and a group's **⋯** menu. It moves,
  rather than copies, the selected cards and leaves a portal on the source board. Both human
  and agent transports must support the operation under the existing write protections.
- Opening a group is navigation within its existing board. Breadcrumbs and outside-link stubs
  show its context; opening/closing the group never creates a board or changes card ownership.
- No reverse move, **Move into this board**, inline-board operation, arbitrary board merge,
  execution scheduler, new journal, concurrent-board runtime or hosted-account work in Wave 5.
  Existing selective-copy behavior is not a substitute for the move and remains separate.

## What the current code already provides

| Owner | Reuse and gap |
|---|---|
| `src/client/nodes/StatusNode.tsx`, `StatusSummary.tsx` | Existing status rendering supports phase, detail and progress. Add deliberate human authoring and match the work-step drawing; do not invent a second task node type. |
| `src/shared/relations.ts` | Research, Dependencies, Decision and Flow vocabularies already exist, including `next`, `if-fails` and `loop`. Complete their interaction/visual treatment instead of building a workflow language. |
| `src/server/ax-interaction.ts`, `ax-flow-loop.ts`, `src/client/nodes/AxStepControls.tsx` | Explicit AX flows already materialize work and can execute bounded loops. An ordinary drawn loop must not acquire those execution semantics or AX stamps. |
| `src/server/canvas-state.ts`, `workboard.ts` | Work updates already mirror `axWorkStatus` and refresh requested workboards. Reuse the existing ownership/listener path for optional live views; no competing single-slot listener. |
| `src/server/operations/ops/boards.ts`, `CanvasStateManager.createBoardFromBoard` | Existing copy creates fresh IDs, resets parts of work state and copies selected assets. A move must not reuse this copy-then-delete path. |
| `src/shared/memory-graph.ts`, `src/server/memory-graph.ts` | Identities are `(boardId, cardId)`. Card IDs alone are not globally unique. Reuse the graph projection for relations and navigation. |
| `src/server/canvas-db.ts`, `knowledge-lifecycle.ts`, `context-reads.ts` | Persistence, review audit and read receipts have different lifetimes. Moving must preserve their meaning without inventing a fresh validation or read. |
| `src/server/mutation-history.ts`, `CanvasStateManager.restoreSnapshot` | Undo uses in-memory closures; snapshots can restore a board's old contents. A cross-board move needs an explicit history boundary, not independent source/destination undo. |
| `src/server/operations/ops/annotation.ts`, `src/server/index.ts`, `src/client/canvas/AnnotationLayer.tsx` | HTTP and SDK already create freehand/text marks; MCP exposes removal but not creation. Share the existing annotation model and renderer. SDK currently bypasses operation validation; parity must cover behavior, not just tool names. |

## Slice 1: author plans and show progress without Sessions

**Current increment:** existing `status` nodes opt in with `data.workState`; detail
and nullable progress remain separate. [WorkCards](../design/WorkCards.dc.html)
records the selected in-card Save/Cancel editor. Creation and editing use ordinary
node operations. Optional live-task views (steps 4–5) are deferred to the next increment.

**Owners:** `StatusNode.tsx`, `StatusSummary.tsx`, `ContextMenu.tsx`, `SelectionBar.tsx`,
`src/client/state/node-factory.ts`, `intent-bridge.ts`, `src/server/canvas-schema.ts`,
`operations/ops/nodes.ts`, `src/shared/relations.ts` and their current styles.

Before adding UI, draw any missing authoring, live-link and move-dialog states in
`docs/design/` and record their decisions in `docs/design.md`. Reuse the approved drawings'
layout/tokens; do not treat their static work-step examples as specifications for missing controls.

1. Define one structured authored work-state field on the existing status card, using the
   existing work vocabulary (`todo`, `in-progress`, `blocked`, `done`, `cancelled`) where
   applicable. Keep text/detail and optional progress separate. Do not infer work state from
   arbitrary phase text or a card title. Final field names belong to the implementation contract.
2. Add human creation/editing through existing canvas menus and in-flow controls; use the same
   node mutations for the agent. Show completed/current/next steps using the established shell,
   glyphs and tokens. Preserve existing non-work uses of status cards without a legacy shim.
3. Build plans from ordinary status, markdown, file, diff and other appropriate existing nodes.
   Store dependencies, conditions and loops as authored relations with reasons. A question or
   rejected alternative is planning content, not permission to run a command.
4. Starting/stopping a session does not change the authored plan. Provide an explicit path for
   presenting an existing session task, reusing existing task identifiers and attribution.
   Distinguish authored fields from live task fields in the renderer and write route.
5. Resolve linked live state from its authoritative record. If a persisted display cache is
   needed by existing render/export paths, label it as derived and refresh it from the record;
   do not treat it as independently writable. Missing/ended session references must not silently
   become actionable approvals or restart tasks. Removing a presentation does not cancel work.

**Verification:** with Sessions off, human and agent can create/edit the four-step plan shown
in Uses, connect a failure return path and an intentional loop, reload, and continue editing.
Assert no session/task/approval records or loop execution were created by ordinary planning.
Then explicitly link a real session task: status updates appear consistently in card and panel;
starting a session alone creates no cards and leaves the standalone plan unchanged.
Existing AX execution, workboard, ghost and gate tests remain controls, not features to remove.

### Agent pen, text and eraser parity

**Owners:** `src/server/operations/ops/annotation.ts`, `operations/composites.ts`,
`src/server/index.ts`, `canvas-state.ts`, `canvas-serialization.ts`, the existing CLI
operation dispatch and `src/client/canvas/AnnotationLayer.tsx` / `CanvasViewport.tsx`.

1. Expose creation through an existing MCP composite and CLI operation path. Use the same
   server-owned freehand points, text, color and width as the human tools, in canvas world
   coordinates. Derive bounds on the server and align SDK validation with the operation.
   Do not simulate pointer gestures or add a separate agent drawing store or shape language.
2. Keep erasing equivalent to the human tool: remove a whole mark by its ID, not part of a
   stroke or the card beneath it. Both human and agent can erase marks from the shared layer,
   subject to existing write protections. Keep compact annotation summaries discoverable;
   provide an explicit geometry read if needed, rather than adding all points to default context.
3. Preserve shared persistence, SSE, Undo and ghost feedback. Check scope/lock behavior for
   board-space marks explicitly rather than assuming node-only guards cover them. Repeated
   creation with the same explicit ID and content must not duplicate a mark or Undo entry;
   conflicting content must not silently overwrite a human's mark. Define repeated removal
   consistently across transports and document any change to the current not-found response.
4. Use annotations for informal questions and emphasis. A written question does not suspend
   execution or create a pending request, and erasing a mark does not answer or approve it.
   Humans can reply in the external agent host's composer, such as Amp, Claude Code or Codex,
   whichever agent they use with the canvas. No PMX composer, card or canvas reply is required.
   The host agent receives the reply and uses its existing canvas tools to act on it;
   PMX does not need to capture or synchronize the host conversation.
   Board text and cards remain optional ways to respond. Native-host approvals and optional
   PMX session controls remain separate. Keep canvas ink distinct from
   AX review annotations, which already have their own contract.

**Verification:** with Sessions off, the agent draws around one card and writes a question
beside two alternatives. The human answers in the external host's composer and the agent
revises the board without using PMX's composer or requiring a reply card or session.
Also exercise the optional board reply path:
the human adds a text reply and erases an agent mark; the agent reads
the reply and erases a specified human mark without changing nearby marks or underlying cards.
Check real MCP/CLI/HTTP/SDK behavior, persisted reload, Undo, retries and rejected writes.
Inspect placement at fractional zoom and after pan/Fit, including text contrast across themes.
No work item, approval, automatic mark feed or implicit answer detection is created.

## Slice 2: relations and group navigation

**Owners:** `EdgeLayer.tsx`, `ContextMenu.tsx`, `CrossBoardReferences.tsx`,
`src/client/state/relation-store.ts`, `GroupNode.tsx`, `CanvasViewport.tsx`, `App.tsx`,
`src/server/memory-graph.ts`, `operations/ops/memory-graph.ts` and the shared relation model.

1. Complete the compact inline edge editor, parallel-pair counts, dependency cycle/affected
   counts, Show lineage and Show on canvas. Reuse current per-board vocabularies and query
   semantics. Preserve authored labels, reasons, direction and attribution.
2. Treat an intentional `loop`/`if-fails` flow as a valid illustrated plan. Do not run generic
   cycle warnings across every edge kind. Dependency warnings and source-staleness warnings
   use their actual semantics; disconnected and merely cited nodes are negative controls.
3. Render stale-lineage warnings on the affected edges from existing provenance qualification,
   not a second freshness clock. Keep relation meaning, warning glyph/word and agent authorship
   distinguishable, including where the historical drawings predate current token decisions.
4. Add group drill-in as view state: nested breadcrumb path, parent camera/selection return,
   local focus and outside endpoint stubs. Use the same stored nodes and edges, not copied
   layouts or new boards. Edits inside the focused view target the original nodes.
5. Outside stubs navigate to the real target and are not editable duplicates. Reconcile a
   removed/moved focused group and a board switch without leaving a stale drill-in path.
   Keep full-board reads distinct from a filtered human view; drill-in must not silently pin,
   unpin, acknowledge a read or hide information from the agent's public read contract.

**Verification:** render dependency and decision examples plus the deliberate flow loop;
exercise keyboard and pointer editing, nested drill-in, Esc/breadcrumb return and outside links.
Assert board count and ownership are unchanged by navigation, mutations persist on the source
board, and the agent reads the authored relations. Inspect labels at fractional zoom and Fit.

## Slice 3: implement one atomic Move to new board operation

**Owners:** `CanvasStateManager`, `canvas-db.ts`, `operations/ops/boards.ts`,
`canvas-operations.ts`, `src/server/index.ts`, `server.ts`, `src/mcp/server.ts`,
the existing CLI board commands, board store, selection bar and group menu.
Extend the existing registry/transport mapping, not a client-side sequence of create/copy/delete.

### Proposed operation contract

These are implementation proposals, not already shipped API names:

- A `board.move-selection` operation targets the explicit active source board and a nonempty
  set of node IDs, with a new board name, expected source revision and durable request ID.
  A group's menu supplies its root ID; the server expands descendants and deduplicates overlapping
  selections. Keep the moved group frame and its identity rather than silently discarding it.
- Preview and commit share selection, reference and permission validation. Preview creates
  nothing and emits no mutation/ghost events. Commit revalidates immediately before writing.
- Return the destination board ID, portal ID and moved identities. Repeating the same request
  returns the original result, including after restart; reusing its ID with different input
  is a conflict. Check recorded success before rejecting the now-stale source revision.
- Human UI asks for the name, explains that this is a move, then opens the destination after
  success. A delayed response must not navigate over a newer human board choice. Agent mutation
  returns the destination without silently moving the human's camera; opening remains explicit.
- Default the new board to the source folder, theme and relation vocabulary. Preserve relative
  geometry. Place the source portal at the removed selection/group location. Preview must name
  any README, pin, lifecycle, live-session or runtime-content effects before commit.

### Persistence and identity invariants

| Data | Required result |
|---|---|
| Cards and groups | Same card IDs in the fresh destination; preserved content revisions, attribution, explicit lifecycle and nested membership. Keep board revision counters safe for subsequent writes without stamping the move as a content edit. Remove moved members from source parents without deleting unrelated siblings. Source IDs that happen to match IDs on another board remain unrelated. |
| Relations | Move source-owned edges with their source card. Rewrite local/cross-board endpoints correctly on every affected board, including incoming edges from a third board. Preserve edge identity, kind, reason and authored meaning; regenerate computed projections. |
| Wiki links, provenance and other references | Retarget stored board-qualified bindings, source observations, anchored references and tour targets where supported. Preserve recorded source revisions and timestamps; a location change is not a content refresh. Inventory references explicitly, not a recursive replacement of every matching string. |
| Review and retirement | Preserve access to the same audit history and original event attribution/location evidence. Record the relocation without validating, restoring retirement or resetting due clocks. Do not clone review events as new checks. |
| Pins and read receipts | Move card-pin membership and attribution with the cards. Do not mark destination content as newly read or auto-pin every moved card. Source-board context and README changes must be visible; do not silently pin the new board to compensate. |
| README and inherited policy | If the source README moves, clear its old designation and designate it on the destination. Inherit source folder policy by default; explicitly account for board-specific effective policy so the move cannot make due content fresh. |
| Blobs, attachments and viewers | Preserve owned bytes, references and supported reload behavior, including imported-document metadata and spec versions. Never use the copy path's node-type exclusions to silently omit a selected card. |
| Sessions and runtime handles | Moving a presentation does not move authority, cancel a task or approve a gate. Resolve board-qualified live references explicitly. Preflight must refuse the entire move with an actionable reason if a live runtime binding cannot safely relocate; no silent detach or partial move. |

Perform destination creation, source removal, portal creation, reference/audit updates and the
retry result in one SQLite transaction through `CanvasStateManager`. Account for pending
debounced saves and all other library writers so a stale save cannot resurrect moved cards or
overwrite a reference rewrite. Publish memory/SSE/catalog changes only after commit. Recover
from commit-before-notification interruption by reading committed state, not rerunning effects.
Do not add another state manager or general lock/journal framework.

### Engineering checkpoints before this slice ships

These are not additional approved product features. Resolve and document them during the
state/DB design review before implementing the move UI:

1. **Undo and old snapshots:** propose an explicit move boundary. No single-board Undo or
   snapshot restore may recreate a moved identity in its old board or erase updated references.
   Prefer a clear refusal for restores crossing that boundary over a hidden reverse operation.
   Document the user-facing recovery path and affected history before accepting this limitation;
   do not silently discard all snapshots or introduce general durable Undo in this wave.
2. **Audit location:** choose the smallest durable relocation representation that keeps old
   board-qualified receipts/reviews interpretable and current card history reachable. Preserve
   historical events, not rewritten claims that the card was always on the destination.
3. **Runtime-bound cards and live tasks:** inventory every existing node type, attachment and
   session binding. State which can move directly and which must be made quiescent first.
   Any proposed unsupported case needs an explicit scope decision, not an unreported omission.
4. **Revision guards:** a source revision alone cannot protect third-board incoming links or
   reviews. Validate all affected state at commit under the existing owner and serialize the
   transaction against concurrent library writers. Do not overwrite a newer human edit.

**Verification:** use disposable A/B/C boards with repeated card IDs on unrelated boards,
nested groups, asymmetric inbound/outbound links, provenance, due and retired cards, pins,
attachments and an explicitly linked session task. Move both a multi-selection and a whole
group. Check the live portal, destination paint, outside navigation and all persisted records
after restart. Inject failure before commit and after commit/before response; retry concurrently
with the same ID and confirm one destination, one portal and no duplicate audit events.
Exercise stale preview, foreign-board writes, fences, human locks, failed runtime preflight,
pre-move Undo/restore, and late SSE/save responses as negative cases.

## Slice 4: transport parity, documentation and acceptance

- Keep one mutation contract across HTTP, SDK, MCP and CLI, including validation errors, retry
  identity, group expansion and scope checks. Schema discovery/help must describe the real
  operation. Do not add a standalone MCP tool when an existing composite action fits.
- Update `docs/http-api.md`, `docs/mcp.md`, `docs/cli.md`, `docs/node-types.md` and
  `docs/api-stability.md` as applicable. Update bundled skill/reference instructions for
  deliberate presentation and the new move action, preserving the ghost-cursor default.
  Skill edits need their required scoped approval before implementation. Do not edit the README.
- Extend `tests/acceptance/guide.ts`: rows 06 (boards), 09 (cross-board connections),
  12 (relations), 15–17 (lifecycle), 22–23 (protection/persistence), 25 (ghost/gates),
  26 (annotations), 27–28 (nodes/creation) and 30 (work surfaces), checking current row IDs before editing.
  Add criteria and matching tests for standalone planning, valid loops, drill-in and move
  recovery, plus agent/human annotation parity. Keep explicit AX execution tests separate
  from inert planning tests.
- Extend existing `tests/unit/boards*.test.ts`, `canvas-state.test.ts`,
  `relation-revisions.test.ts`, `ax-state-manager.test.ts`, `workboard.test.ts`,
  `tests/client/status-node.test.tsx`, `selection-bar.test.tsx`, and
  `tests/e2e/boards.pw.ts`, `canvas.pw.ts`, `reference-pane.pw.ts` where they own the behavior.
  Add a focused test file only if the new public contract has no appropriate existing owner.
- Rebuild the demo through `scripts/generate-demo-board.ts` when rendering/primitive output
  changes. Include an authored loop and dependency examples; no real work data in fixtures.

## Verification and delivery gates

For implementation, run targeted tests per slice, then the combined checks from the
`pmx-canvas-testing` skill. Expected command set:

```bash
bun run typecheck
bun run lint
bun run test
bun run test:client
bun run test:web-canvas:headed
bun run acceptance
bun run test:e2e-cli
```

Browser commands rebuild first. Before manual portal acceptance, run `bun run build`, restart
the supervised canvas service and verify its workspace/version/bundle with `pmx_canvas_health`.
Exercise the populated board with real pointer and keyboard input; capture and inspect menus,
editing, drill-in and move results at 600/1024/1920 px and all nine themes. Cover pan, fractional
zoom, Fit, expand/close, reload and unsaved drafts. Use WebKit for any affected iframe/scaling
path and state native-host limitations separately. DOM data and agent handshakes alone are not
visual or native-host acceptance.

Before handoff, run the feature's oracle review and resolve findings. Before pushing, show the
owner changes to `canvas-state.ts`, `canvas-db.ts`, `workbench-auth.ts` if touched, and any
breaking public-contract changes. This plan does not authorize pushing, migrations on a shared
database, release publication or deployment. Journal/hosting/evaluations retain plan 019's order.

## Definition of done

A human and agent can build and revise the illustrated plan without Sessions; intentional
loops stay inert; an explicitly linked session task has one live state; navigation retains
outside context; and Move to new board preserves identity and audit through retries/restart.
Both can draw, write questions and erase marks through the same annotation layer.
No automatic work-card feed, no approval UI added to ordinary cards and no reverse move.
Evidence includes commands, observed results and inspected UI captures, with unavailable checks
and any approved restrictions stated. Passing this document's checks has not yet been claimed.
