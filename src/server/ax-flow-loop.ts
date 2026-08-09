/**
 * Server-side bounded loop for materialized AX flows.
 *
 * A flow's loop lives on the CANVAS, not in a panel: the anchor step node carries
 * `data.axFlow.loop` (see shared/ax-flow.ts), so it survives a browser refresh, an
 * iframe reload, and a server restart — where a panel-driven loop dies with its
 * document. The driver is `canvasState`'s work-item change hook: whenever a step's
 * work item reaches `done`, the next step is opened; when the LAST step finishes,
 * the next run starts — until the run cap is reached or a human presses Stop.
 *
 * Bounds (non-negotiable, enforced here rather than trusted from node data):
 *   - advances only while `loop.running` is true
 *   - stops at `maxRuns`, itself clamped to AX_FLOW_LOOP_HARD_CAP (20)
 *   - a `blocked`/`cancelled` step halts advancement (the loop waits, it does not
 *     skip); a step whose work item no longer exists stops the loop outright
 *   - re-entrancy: every write this module makes fires the same work-item change
 *     hook, so `advancing` drops the nested call. State is recomputed from scratch
 *     on each pass, so dropping nested calls loses nothing.
 */
import { AX_FLOW_LOOP_HARD_CAP, readAxFlow, type AxFlowLoopState, type AxFlowStamp } from '../shared/ax-flow.js';
import type { PmxAxWorkItem } from './ax-state.js';
import { emitCanvasLayoutUpdate } from './canvas-operations.js';
import { canvasState, type CanvasNodeState } from './canvas-state.js';
import { refreshWorkboardNodes } from './workboard.js';

/** Re-entrancy guard: true while an advance pass is writing. */
let advancing = false;

/** Persist a new loop state on the anchor node (durable: this is what Stop writes). */
function writeLoopState(node: CanvasNodeState, flow: AxFlowStamp, loop: AxFlowLoopState): void {
  const current = canvasState.getNode(node.id);
  if (!current) return;
  canvasState.updateNode(node.id, { data: { ...current.data, axFlow: { ...flow, loop } } });
}

/**
 * Advance one flow by at most one step (or one run boundary). Returns true when
 * anything changed, so the caller knows whether to broadcast a layout update.
 */
function advanceFlow(node: CanvasNodeState, flow: AxFlowStamp, byId: Map<string, PmxAxWorkItem>): boolean {
  const items = flow.steps.map((step) => byId.get(step.workItemId));
  if (items.some((item) => !item)) {
    // The flow was partially dismantled (work items cleared/deleted). Stop rather
    // than keep a loop armed against state it can no longer drive.
    writeLoopState(node, flow, { ...flow.loop, running: false });
    return true;
  }
  const statuses = items as PmxAxWorkItem[];
  // A blocked/cancelled step is a deliberate halt — hold position, stay armed.
  if (statuses.some((item) => item.status === 'blocked' || item.status === 'cancelled')) return false;

  const openIndex = statuses.findIndex((item) => item.status !== 'done');
  if (openIndex >= 0) {
    // Every earlier step is done by construction. Open this one exactly once:
    // an already in-progress step is the loop's own previous advance.
    if (statuses[openIndex].status !== 'todo') return false;
    canvasState.updateWorkItem(statuses[openIndex].id, { status: 'in-progress' }, { source: 'system' });
    return true;
  }

  // Every step is done — one full run just completed.
  const maxRuns = Math.min(flow.loop.maxRuns, AX_FLOW_LOOP_HARD_CAP);
  const run = flow.loop.run + 1;
  if (run >= maxRuns) {
    // The cap is reached WITH this run recorded: no run `maxRuns + 1` is opened.
    writeLoopState(node, flow, { running: false, run, maxRuns });
    return true;
  }
  // Write the counter before re-opening the steps, so a crash mid-pass can never
  // replay a run for free.
  writeLoopState(node, flow, { running: true, run, maxRuns });
  for (const step of flow.steps) {
    canvasState.updateWorkItem(step.workItemId, { status: 'todo' }, { source: 'system' });
  }
  canvasState.updateWorkItem(flow.steps[0].workItemId, { status: 'in-progress' }, { source: 'system' });
  return true;
}

/**
 * Advance every running flow loop on the canvas. Safe to call on any work-item
 * change: flows that are not running, not ready, or already advanced are no-ops.
 */
export function advanceAxFlowLoops(): void {
  if (advancing) return;
  advancing = true;
  try {
    const anchors = canvasState
      .getLayout()
      .nodes.map((node) => ({ node, flow: readAxFlow(node.data) }))
      .filter((entry): entry is { node: CanvasNodeState; flow: AxFlowStamp } => entry.flow?.loop.running === true);
    if (anchors.length === 0) return;
    const byId = new Map(canvasState.getWorkItems().map((item) => [item.id, item]));
    let changed = false;
    // Suppressed: loop bookkeeping (status chips, the run counter) is automatic
    // and must not fill undo history — same contract as the live workboard.
    canvasState.withSuppressedRecording(() => {
      for (const { node, flow } of anchors) {
        if (advanceFlow(node, flow, byId)) changed = true;
      }
    });
    if (changed) emitCanvasLayoutUpdate();
  } finally {
    advancing = false;
  }
}

// canvasState exposes ONE work-item listener slot, so this module owns the
// composition: the live workboard refresh first (unchanged behaviour), then the
// flow advance. Importing workboard also guarantees ordering — its own
// registration runs while this module is still evaluating, so this one wins.
canvasState.setWorkItemsChangedListener(() => {
  refreshWorkboardNodes();
  advanceAxFlowLoops();
});
