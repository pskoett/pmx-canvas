import type { PmxAxIntent } from '../../shared/ax-intent.js';
/**
 * Client-side store for the Ghost Cursor of Intent. Ghosts are ephemeral
 * presence pushed over SSE (`ax-intent` / `ax-intent-clear`); this store mirrors
 * them into a signal the IntentLayer renders, tracks a short exit phase so
 * settle/dissolve can animate, and prunes anything the server's TTL frame did
 * not reach (SSE backstop). Nothing here is ever persisted.
 */
export type IntentPhase = 'forming' | 'settling' | 'dissolving';
export interface ClientIntent extends PmxAxIntent {
    phase: IntentPhase;
    /** The real node a settled intent became — seeds the settle morph. */
    settledNodeId?: string;
}
export declare const intents: import("@preact/signals-core").Signal<Map<string, ClientIntent>>;
/** The ghost currently hovered — drives Esc-to-veto. */
export declare const hoveredIntentId: import("@preact/signals-core").Signal<string | null>;
/** A live `ax-intent` frame: (re)place the ghost in its forming state. */
export declare function upsertIntent(intent: PmxAxIntent): void;
export declare function removeIntent(id: string): void;
/** Resolve a ghost into a real node — the settle morph, then removal. */
export declare function settleIntent(id: string, settledNodeId?: string): void;
/** Dissolve a ghost (expired / vetoed / evicted / abandoned), then remove it. */
export declare function dissolveIntent(id: string): void;
export declare function resetIntents(): void;
