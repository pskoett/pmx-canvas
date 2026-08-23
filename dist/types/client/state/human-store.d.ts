import { type HumanPresence, type HumanPresenceSnapshot } from '../../shared/human-presence.js';
export declare const humanClientId: string;
export declare const humanName: import("@preact/signals-core").Signal<string>;
export declare const humans: import("@preact/signals-core").Signal<HumanPresence[]>;
export declare const otherHumans: import("@preact/signals-core").ReadonlySignal<HumanPresence[]>;
/** Nodes a human took over mid-edit → that human's name, shown as the yield pill for a moment. */
export declare const yieldedNodes: import("@preact/signals-core").Signal<Map<string, string>>;
export declare function applyHumanSnapshot(snapshot: Partial<HumanPresenceSnapshot> | null | undefined): void;
/** Report the pointer in world coordinates (throttled); null when it leaves the canvas. */
export declare function reportHumanCursor(cursor: {
    x: number;
    y: number;
} | null): void;
/** Hold / release a node (drag, rename): the edit lock agents must respect. */
export declare function reportHumanGrab(nodeId: string | null): void;
export declare function markYielded(nodeId: string, name: string): void;
/**
 * User wins (item 6): the human grabbed a node the agent is mid-edit on. Every
 * explicit intent targeting it is vetoed through the normal veto path (the
 * agent hears it as steering), a Yield entry lands in the timeline, and the
 * node wears a "took over — agent yielded" pill for a moment.
 */
export declare function takeOverNode(nodeId: string, title: string): void;
/** Announce this tab and keep it alive; renews a held grab. Call once per connection. */
export declare function startHumanPresence(): () => void;
export declare function resetHumanPresence(): void;
