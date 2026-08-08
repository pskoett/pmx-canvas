/**
 * Live AX work-item board, materialized as a json-render node.
 *
 * `buildWorkboardSpec` is the pure spec builder (status columns of work-item
 * cards); `renderWorkboard` is the operation core (create-or-rebuild the
 * single `data.workboard === true` json-render node); `refreshWorkboardNodes`
 * is the live-refresh hook this module registers on `canvasState` so every
 * addWorkItem/updateWorkItem rebuilds the board from the fresh work-item list
 * through the SAME spec/update path the operation uses.
 *
 * The refresh runs inside `withSuppressedRecording` so live board rebuilds do
 * not spam undo/redo history (persistence and SSE emits are unaffected).
 */
import type { JsonRenderSpec } from '../json-render/server.js';
import type { PmxAxWorkItem } from './ax-state.js';
export declare const WORKBOARD_NODE_TITLE = "Work Board";
export declare const WORKBOARD_NODE_SIZE: {
    width: number;
    height: number;
};
/**
 * Build the workboard json-render spec from a work-item list: one column per
 * status (todo → in-progress → blocked → done → cancelled; empty statuses are
 * omitted), each item a Card with an agentId Badge and detail Text when
 * present. An empty list renders a single muted "No work items" text block.
 */
export declare function buildWorkboardSpec(workItems: PmxAxWorkItem[]): JsonRenderSpec;
/**
 * Operation core for `render.workboard`: rebuild the existing workboard node
 * in place, or create one (tagged `data.workboard: true`) when none exists.
 */
export declare function renderWorkboard(input?: {
    x?: number;
    y?: number;
}): {
    ok: true;
    id: string;
    created: boolean;
    itemCount: number;
};
/**
 * Live refresh: rebuild every workboard node's spec from the current work-item
 * list. Registered below as the canvasState work-item change listener. Node
 * updates never touch work items, so this cannot recurse.
 */
export declare function refreshWorkboardNodes(): void;
