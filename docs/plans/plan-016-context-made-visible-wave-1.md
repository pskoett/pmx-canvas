# Plan 016 — Context made visible (wave 1)

**Status:** Slices 1–3 and 4a done (2026-10-05); 4b (tethers, drag preview, Updates entry) next.
**Date:** 2026-10-05
**Source:** [design.md](../design.md#build-plan) wave 1; vision Part 1 bet (item 4), moves 0a, 2, 7.
Drawings: [`AgentContext`](../design/AgentContext.dc.html), [`Context`](../design/Context.dc.html),
[`NearPin`](../design/NearPin.dc.html), [`BoardPins`](../design/BoardPins.dc.html),
[`Home`](../design/Home.dc.html) (Folders).

## Done when (from design.md)

From the board alone, a person can answer "did the agent read what I pinned, and is its copy
current?" The evaluation in `docs/evals/` reads the same data.

## What exists and what is missing

| Need | Today | Gap |
|---|---|---|
| Who wrote a node | `createdBy` / `lastEditedBy` per node, per-board `contentRevision` (plan 014) | none |
| What an agent read | `context_reads`: per read, which **pinned** ids were in the payload (plan 011) | every delivered node, and the content revision it had when delivered |
| Who pinned a node | `context_pins (board_id, node_id)` | who, when, and an optional why |
| Board pins | none | `board_pins`, brief tiers, `canvas_board pin/unpin` in all four layers |
| Neighbours in the brief | titles only, in `canvas://pinned-context` / `spatial-context` | the brief carries them (title + summary, reason "near <pin>") |

## Slices

Each slice is its own commit and leaves the suite green. Design ships with its function: no mark
appears before the data that backs it.

### 1. Data: what was read, at which revision, and who pinned (no UI)

Split in two: 1a (reads) is enough for read / not read / changed since read; 1b (pin attribution)
adds "pinned by the agent".

- **1a, done.** `context_reads` records every node whose serialized form was delivered (not just
  pins) and its `contentRevision` at read time, in a `read_nodes` column. Same "delivered" rule as
  plan 011 (a serialized node carrying the id; a bare id list or a title does not count). The reader
  side reports every node-shaped id it delivered (`readNodeIds`, so an MCP server attached to a
  daemon only posts the record); the server keeps the ids that are nodes on the read board and
  stamps their revisions. `ax.reads.status` (`GET /api/canvas/ax/context-status`,
  `canvas_ax_timeline { action: "read-status" }`, `PmxCanvas.getNodeReadStatus`) returns, per node,
  the latest agent read: when, by whom, at which revision.
- **1b, done.** Pins record who pinned them (`pinnedBy`, the same actor attribution as node
  authorship: a person only with the workbench token), when, and an optional `reason`
  (`canvas_pin_nodes` / `POST /api/canvas/context-pins` / `setContextPins(..., reason)`). Pins that
  stay keep their attribution; undo restores it; it persists with the board and its snapshots
  (`meta` on `context_pins` and `snapshot_pins`). Pins from before have an unknown pinner. The read
  status returns `pins` alongside `nodes`.
- `context_pins` gains `pinned_by` (actor attribution, same shape as `createdBy`), `pinned_at` and an
  optional `reason`. Pins made before this have an unknown pinner, not a guessed human.
- One server read model, `nodeContextStatus(boardId)`: per node, last read (when, by whom, revision
  read), current revision, pinned (by whom, when, why). Served over HTTP and SDK and MCP alongside
  the existing context-reads surface (four layers in step); the workbench reads it through SSE.
- **Check:** unit tests for delivered-all-nodes, revision capture, pin attribution through every
  write path (workbench → human, agent writes → agent id/source), and the status model.

### 2. Node marks: read, not read yet, changed since read, pinned by the agent, created, edited

Built to `AgentContext.dc.html`: eye + "read" (hover: who, when); eye-off + "not read" on a pin the
agent has not loaded since it was pinned; amber warn + "changed since read" when the current revision
is newer than the revision read; violet dot on the pin badge when an agent pinned it (hover: why);
"by <agent>" byline on agent-created nodes until a person edits them; violet bar + "edited" for the
session, with "see change" opening the diff and undo.
- **Check:** client tests per state; e2e at 600/1024/1920 that a pinned-then-changed node shows
  "changed since read" after an agent read, and clears after the next read.
- **Done.** Decided with the maintainer (2026-10-05): the read / not read / changed since read marks
  show on **pinned** nodes only (a full-layout read delivers every node, so marking all of them
  would cover the board); unpinned reads go to the lens (slice 3). "by <agent>" and "edited" stay
  until a person edits the node. One chip per node (`NodeContextMark`), glyph + word, explained
  on hover; agent pins get the violet dot. The workbench refetches the read status on connect, on
  pin changes and when a read lands (`context-status-changed`, sent to the browser only), and
  ignores an answer for a board it has left. Not built: "see change" (diff and undo of an agent
  edit) needs stored previous content, which revisions do not keep yet.
- **Note.** The demo board is generated through the API as agent writes, so its nodes show
  "by sdk" until edited.

### 3. After a session: the agent-activity lens and receipt

The lens from `AgentContext.dc.html`: counts (read, created, edited, pinned) and the receipt rows
with their actions (Unpin, Undo). Data from presence activity, revisions and slice 1.
- **Done.** The existing session receipt (`agent-session-ended`) gains `context`: nodes read since
  the session attached (presence now records `startedAt`), pins the agent made with their reason,
  nodes it created and edited (the pre-session snapshot diff, filtered by authorship), and pinned
  nodes changed since their latest read. A session that only read or pinned now gets a receipt.
  The receipt card shows an amber line for out-of-date pins, Read / Pinned / Created / Edited rows
  (Unpin on agent pins) and the lens switch "Dim untouched nodes". The read mark's hover says how
  many times a node was read. Reads are counted per board in the session window, not per reader:
  on a board with two agents at once, each receipt includes the other's reads.
- **Not built:** per-row Undo of an edit (needs stored previous content); the pre-session snapshot
  restore still undoes the whole session. The drawn bottom-bar placement of the lens is folded into
  the receipt card, which already sits where session results appear.

### 4. Near a pin: neighbours in the brief, and the near mark

- The brief (`canvas://context`) carries each pin's neighbours (up to 5 within 600 px, nearest
  first) as title + short summary, reason "near <pin title>", never full content; they share the
  budget after pinned cards.
- The `NearPin.dc.html` mark: dotted "near" chip, tethers on hovering a pin, the drag preview and
  the single Updates entry that replaces "Neighborhood changed". "read" from slice 2 then also
  covers neighbours honestly (title + summary delivered).
- **4a, done.** The brief carries `near` entries right after the pinned cards (each whole or
  absent, title + summary capped at 280 characters, `near: { pinNodeId, pinTitle }`); a neighbour
  that changed since the cursor arrives in full as `changed` instead; a first read delivers every
  node in full, so it has no near entries. The client computes the same `findNeighborhoods` and
  shows the dotted "near" / "near N" chip on unpinned nodes, with the pins and distances on hover.
- **4b, next.** Tethers and the 600 px radius when hovering a pin, the drag preview, the single
  Updates entry that replaces "Neighborhood changed", the context chip's "N cards · M near" count,
  and "Pin to send content" in the chip's hover. The maintainer agreed the design (2026-10-06) on
  the condition that performance stays good:
  - **Budget.** No added work per drag frame beyond the neighbour calculation for the board
    (measured 0.8 ms at 1,000 nodes / 40 pins; guarded at < 8 ms by
    `tests/unit/near-pin-performance.test.ts`) and the dragged card against the pins (O(pins)).
  - **No fan-out.** The near map keeps its identity while no card's set of pins changes, so the
    chips re-render only when a neighbourhood does, not on every frame (done ahead of 4b, guarded
    by a client test). Distances, which change every frame, are computed only for an open hover.
  - **Lines and radius** are drawn only while a pin is hovered or selected, for that pin alone, in
    one SVG layer; nothing renders for pins at rest.
  - **Check.** A headed drag on a 300-node board with 20 pins records no long task (> 50 ms)
    attributable to near-a-pin.

### 5. Board pins

Per vision move 0a and `BoardPins.dc.html`: `board_pins` table (board, who, when); `canvas_board`
`pin`/`unpin` across PmxCanvas, HTTP, MCP and CLI; the tiered brief (active board's pins, then each
pinned board's README + pinned cards, then discovery); the context chip counts "N cards · M boards";
Home's pinned-boards section per `Home.dc.html`. Read status per board from slice 1.

### 6. The curation evaluation

`docs/evals/curation-effect.md`: one fixed task, run with the brief delivered on a curated and an
uncurated board, scored on criteria written before the first run (vision Part 1, item 4). It reads
the same `context_reads` data as slice 1 to confirm delivery before scoring effect. Running it
needs the maintainer's real agent sessions; the decision rule is the vision's.

## Out of wave 1

- "Suggested by the agent" (dashed node, accept/reject): needs agent suggestions as a function
  (vision move 3, wave 5). The drawing exists; it ships with that function.
- Home Map and Graph (wave 2).

## Defaults (change if the maintainer disagrees)

- **Read by whom.** Any agent reader on that board counts; the mark shows the most recent reader
  and time on hover. The workbench's own reads never count.
- **Changed since read** compares against the most recent read of that node by any agent.
- **Unknown pinner.** Existing pins show no agent dot; only pins attributed to an agent get it.
