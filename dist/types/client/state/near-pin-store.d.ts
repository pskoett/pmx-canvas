/**
 * Near a pin (docs/design/NearPin.dc.html): each pinned node pulls up to five
 * unpinned nodes within 600 px into the agent's brief as title + short
 * summary. Same rule as the server's brief (`findNeighborhoods`), so the mark
 * claims exactly what the agent receives.
 */
export interface NearPin {
    pinNodeId: string;
    pinTitle: string;
    distance: number;
}
/** Unpinned node id → the pins it is near, nearest first. */
export declare const nearPins: import("@preact/signals-core").ReadonlySignal<Map<string, NearPin[]>>;
