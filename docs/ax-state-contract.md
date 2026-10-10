# AX state contract (authoritative)

The agent-experience (AX) state is split into **three partitions** with distinct
storage and lifecycle rules. This document is the authoritative spec for the
snapshot-vs-audit boundary; it is the documented module boundary for
`AxStateManager` (`src/server/ax-state-manager.ts`), which `CanvasStateManager`
holds and delegates to.

| Partition | Members | Storage | Snapshotted | Cleared by `canvas_view { action: "clear" }` | Cleared by `restore` |
|-----------|---------|---------|:-----------:|:-------------------------:|:--------------------:|
| **Canvas-bound** | `focus`, `workItems`, `approvalGates`, `reviewAnnotations`, `elicitations`, `modeRequests`, `policy` | in-memory `_axState` + one JSON blob in the `ax_state` table | ✅ | ✅ | ✅ (replaced by the snapshot's AX) |
| **Timeline (audit-only)** | `agent-event`, `evidence-item`, `steering-message` | `ax_events` / `ax_evidence` / `ax_steering` tables, 500-row retention, sequential ids | ❌ | ❌ | ❌ |
| **Host/session** | `host-capability` | `ax_host_capabilities` table | ❌ | ❌ | ❌ |

**Rules.** Canvas-bound state travels with the canvas (snapshot / restore / clear);
timeline and host data are diagnostic and survive all three. Timeline rows are
append-only, retention-bounded (`AX_TIMELINE_RETENTION = 500` per table), and
read via `canvas_ax_timeline { action: "read" }` / `canvas://ax-timeline`. The
host-capability row is reported by adapters and read via `canvas_ax_state {
action: "get" }`.

## Read surfaces

- **Canvas-bound:** `canvas_ax_state { action: "get" }`, `canvas://ax`, `canvas://ax-context`, `canvas://ax-work`
- **Timeline:** `canvas_ax_timeline { action: "read" }`, `canvas://ax-timeline`, `canvas://ax-pending-steering`, `canvas://ax-delivery`
- **Host:** `canvas_ax_state { action: "get" }`

## Node-deletion semantics (soft-orphan + audit)

When a node is removed, the canvas-bound partition is re-normalized against the
surviving node set (`AxStateManager.revalidateAfterNodeRemoval`):

- **Work items / approval gates / elicitations / mode requests** that referenced
  the deleted node keep the item but **strip the dangling node id** ("re-anchored").
  The data semantics are soft-orphan: the work is not destroyed.
- **Node-anchored review annotations** (`anchorType: 'node'`) for the deleted node
  are **dropped entirely** ("removed") — they are meaningless without their node.

This re-normalization was previously **silent**. It now records exactly one
auditable **timeline** event when (and only when) something was actually affected:

```
kind:    'note'
source:  'system'
summary: 'Node "<title>" deleted — re-anchored N AX item(s),
          removed M node-anchored review annotation(s). [(focus anchor cleared)]'
data:    {
  systemEvent:      'ax-node-orphan',
  removedNodeId:    '<node id>',
  reanchoredIds:    [ ...work/gate/elicitation/mode ids... ],
  removedReviewIds: [ ...review annotation ids... ],
  reanchoredFocus:  <boolean>,   // true if focus.nodeIds referenced the deleted node
}
```

The audit lives in the **timeline** (audit partition) — correct per the contract:
it is diagnostic continuity, not canvas-bound state, so it survives clear/restore
and is not part of any snapshot. `recordAxEvent` is timeline-only and does not
re-enter the canvas-bound normalization path, so there is no recursion.

The audit is scoped to `removeNode` (the live, observable change). `restore`
replaces the whole canvas wholesale and its snapshot AX was already consistent
when it was saved, so it is not audited.

**Append-only / undo semantics.** The note records a historical fact (at time T,
deleting node X re-anchored these items), not current state. It is **not rolled
back on undo** and **not duplicated on redo**: undo restores the canvas-bound AX
state (the re-anchoring is reversed in the live state) but leaves the note as a
record; redo replays `removeNode` inside suppressed recording
(`_suppressRecordingDepth > 0`), which re-runs the re-normalization but does
**not** append a second note. Consumers should read `reanchoredIds` /
`removedReviewIds` against the *current* canvas-bound state, not assume the
referenced items are still re-anchored.

## Agent presence (contract)

Presence is the shape behind every agent surface in the rail chrome: the agent
cursor and phase chip, the session panel, the command bar and the external
steering indicator. It is **derived, in-memory and never persisted** — not a
fourth partition, and not a second source of truth for work items, gates or
steering, which stay in the AX state above. The shared shape lives in
`src/shared/agent-presence.ts` (server and client import the same types and
constants, so they cannot drift); the registry is `src/server/agent-presence.ts`.

- **Sources.** Agent-originated mutations through `executeOperation` (no
  workbench marker), `ax.activity.ingest` kinds (`session-start` /
  `session-end` attach and detach; `tool-start` / `tool-result` / `failure` /
  `error` drive the phase), and an explicit `ax.presence.set` for adapters with
  richer hooks (`thinking`, cursor, focus).
- **Modes.** `sessionActive` = any presence with `attached: true`. No presences →
  quiet board; live but unattached writers → external steering (passive
  indicator only); an attached session → the session panel and command bar.
  Presence cursors render for every live writer regardless.
- **Phase.** An agent mutation or `tool-start` → `tooling` (detail = op or tool
  name), settling to `idle` after `PRESENCE_TOOLING_SETTLE_MS`; `thinking` only
  via the explicit set, settling after `PRESENCE_THINKING_SETTLE_MS`. A cursor
  update that moves the cursor restarts the settle window of a live explicit
  `tooling`; a stationary cursor or focus heartbeat does not, and neither
  extends `thinking`. An idle writer that reported a cursor keeps painting it.
  An attached session with a pending approval gate reads as `waiting-approval`.
- **Lifetime.** Unattached writers fade `PRESENCE_ACTIVITY_TTL_MS` after their
  last write; attached sessions expire after `PRESENCE_ATTACHED_IDLE_TTL_MS`
  without activity; `session-end` or an explicit `attached: false` removes the
  presence immediately; at most `MAX_PRESENCES`, oldest evicted. Expiry emits,
  so clients never run their own ticker.
- **Transport.** One SSE frame, `agent-presence`, carries the full snapshot on
  every change, including the last `MAX_ACTIVITY_ENTRIES` agent writes with a
  one-line summary. An attached presence also carries `session`
  (`{ startedAt, read, created, edited, pinned }`, card ids on the open board
  since it attached, counting every agent there, like the receipt): the agent
  chip's "2 read · 1 edited" and the live lens. A recorded read re-emits the
  frame. `GET /api/canvas/ax/presence` for the connect-time read;
  `POST /api/canvas/ax/presence` (`canvas_ax_state { action: "set-presence" }`)
  for explicit updates.
