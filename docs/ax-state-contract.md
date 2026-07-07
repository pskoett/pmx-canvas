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
