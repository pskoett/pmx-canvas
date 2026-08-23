/**
 * Human collaborator presence (rail-chrome-v2 phase 8, design items 5 and 6).
 * Every open workbench tab is a client; the server fans the set out over SSE
 * so tabs see each other's cursors, and an agent write to a node a human is
 * holding is refused until the grab ends (user wins). In-memory, TTL-swept,
 * never persisted — like agent presence.
 */
export interface HumanPresence {
    /** Per-tab id (sessionStorage), never an identity. */
    clientId: string;
    /** Display name shown on the cursor tag. */
    name: string;
    /** World coordinates of the pointer, null when it left the canvas. */
    cursor: {
        x: number;
        y: number;
    } | null;
    /** The node this human is dragging or editing right now. */
    grabbingNodeId: string | null;
    lastSeenAt: string;
}
export interface HumanPresenceSnapshot {
    humans: HumanPresence[];
}
/** A tab that stops reporting is gone after this. */
export declare const HUMAN_PRESENCE_TTL_MS = 30000;
/** A grab the tab stops renewing (crash, tab closed mid-drag) releases after this. */
export declare const HUMAN_GRAB_TTL_MS = 8000;
/** Cursor updates are throttled to this on the client. */
export declare const HUMAN_CURSOR_THROTTLE_MS = 80;
export declare const MAX_HUMANS = 32;
