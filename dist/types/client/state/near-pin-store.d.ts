/**
 * Near a pin (docs/design/NearPin.dc.html): each pinned node pulls up to five
 * unpinned nodes within 600 px into the agent's brief as title + short
 * summary. Same rule as the server's brief (`findNeighborhoods`), so the mark
 * claims exactly what the agent receives.
 */
export interface NearPin {
    pinNodeId: string;
    pinTitle: string;
}
/**
 * Unpinned node id → the pins it is near, nearest first. Every drag frame
 * moves a node, so the result keeps its identity while no node's set of pins
 * changes: the chips subscribed to it re-render only when a neighbourhood does.
 */
export declare const nearPins: import("@preact/signals-core").ReadonlySignal<Map<string, NearPin[]>>;
/** The node under the pointer: a hovered pin draws its neighbours (NearPin.dc.html §2). */
export declare const hoveredNodeId: import("@preact/signals-core").Signal<string | null>;
/** A near node whose pins the human asked to see from its chip ("Show pins"). */
export declare const shownPinsFor: import("@preact/signals-core").Signal<string | null>;
/**
 * Pins drawn with tethers and the 600 px radius: the pin being dragged,
 * hovered or selected, or the pins of the near node whose chip said "Show
 * pins". Dragging an unpinned node rings only its nearest pin (§3).
 */
export declare const tetherFocus: import("@preact/signals-core").ReadonlySignal<{
    pinIds: string[];
    ringOnly: boolean;
}>;
/** The moment it changes (§3): the chip pulses once on a drop inside, fades on a drop outside. */
export declare const nearChange: import("@preact/signals-core").Signal<{
    nodeId: string;
    kind: "in" | "out";
    pins: NearPin[];
} | null>;
export declare function noteNearAtGrab(nodeId: string): void;
export declare function settleNearAfterDrop(nodeId: string): void;
export declare function clearNearChange(nodeId: string): void;
/**
 * The open near chip's card (§2), drawn over the canvas because a node paints
 * contained. `at` is the chip's screen rect when it opened; the card closes
 * when the view moves rather than chase a stale anchor.
 */
export declare const nearCard: import("@preact/signals-core").Signal<{
    nodeId: string;
    at: {
        left: number;
        right: number;
        bottom: number;
    };
    view: string;
} | null>;
export declare function openNearCard(nodeId: string, chip: Element, view: string): void;
/** Leaving the chip for the card must not close it: close after a short grace. */
export declare function closeNearCardSoon(): void;
export declare function keepNearCard(): void;
