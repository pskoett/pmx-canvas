/**
 * Advance every running flow loop on the canvas. Safe to call on any work-item
 * change: flows that are not running, not ready, or already advanced are no-ops.
 */
export declare function advanceAxFlowLoops(): void;
