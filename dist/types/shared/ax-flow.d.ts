/**
 * The node-data contract for a materialized AX flow.
 *
 * `ax.flow.materialize` stamps every step node with `data.axStep` and the anchor
 * (first) step with `data.axFlow`. Three consumers read those stamps and none of
 * them owns the shape, so it lives here:
 *   - the server loop (`ax-flow-loop.ts`) advances the flow from work-item changes
 *   - the browser renders native Start/Done/Blocked + Run loop/Stop controls
 *   - snapshots/restore carry the stamps as ordinary node data
 *
 * Node data is `Record<string, unknown>` on both sides, so the readers below are
 * the ONLY way to narrow it: they validate rather than cast, because a stamp can
 * also arrive from a restored snapshot or a hand-edited node.
 */
/** Hard ceiling on loop passes, whatever a node's stamped `maxRuns` claims. */
export declare const AX_FLOW_LOOP_HARD_CAP = 20;
/** One step of a flow, as recorded on the anchor node. */
export interface AxFlowStepRef {
    /** 1-based position in the flow. */
    index: number;
    nodeId: string;
    workItemId: string;
    title: string;
}
export interface AxFlowLoopState {
    /** The loop only advances while this is true; Stop persists `false`. */
    running: boolean;
    /** Completed passes. `run >= maxRuns` ends the loop. */
    run: number;
    maxRuns: number;
}
/** `data.axStep` — stamped on EVERY step node, including the anchor. */
export interface AxFlowStepStamp {
    flowId: string;
    index: number;
    total: number;
    workItemId: string;
}
/** `data.axFlow` — stamped on the anchor (first) step node only. */
export interface AxFlowStamp {
    flowId: string;
    title: string;
    steps: AxFlowStepRef[];
    loop: AxFlowLoopState;
}
/** Clamp a stamped `maxRuns` into [1, AX_FLOW_LOOP_HARD_CAP]. */
export declare function clampAxFlowMaxRuns(value: unknown): number;
/** Read `data.axStep`, or null when the node carries no valid step stamp. */
export declare function readAxStep(data: Record<string, unknown>): AxFlowStepStamp | null;
/** Read `data.axFlow`, or null when the node is not a flow anchor. */
export declare function readAxFlow(data: Record<string, unknown>): AxFlowStamp | null;
