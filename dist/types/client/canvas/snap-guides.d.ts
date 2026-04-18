import type { CanvasNodeState } from '../types';
export interface GuideLine {
    axis: 'x' | 'y';
    pos: number;
    from: number;
    to: number;
}
export interface SnapResult {
    x: number;
    y: number;
    guides: GuideLine[];
}
/** Active guide lines to render. Null when not dragging. */
export declare const activeGuides: import("@preact/signals-core").Signal<GuideLine[] | null>;
/** Call at drag-start to pre-compute reference edges from stationary nodes. */
export declare function buildSnapCache(dragId: string, allNodes: Iterable<CanvasNodeState>): void;
/** Call at drag-end to clear the cache. */
export declare function clearSnapCache(): void;
/**
 * Snap a dragging node's proposed position to cached reference edges.
 * Must call buildSnapCache() before the first call in a drag session.
 */
export declare function snapToGuides(proposedX: number, proposedY: number, nodeW: number, nodeH: number): SnapResult;
