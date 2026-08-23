import type { PmxAxIntent } from '../../shared/ax-intent.js';
import { type AgentPresence, type AgentPresenceSnapshot, type ContextBudget } from '../../shared/agent-presence.js';
/**
 * Agent presence (rail-chrome-v2 phase 2). Fed by the server's `agent-presence`
 * SSE snapshot (every change, including TTL expiry) and the connect-time read,
 * so this store never runs its own expiry ticker.
 *
 * `sessionActive` is the ONE selector every agent surface reads — the session
 * panel, command bar, presence layer, and top-bar chip all mount on it.
 */
export declare const agentPresences: import("@preact/signals-core").Signal<AgentPresence[]>;
export declare const contextBudget: import("@preact/signals-core").Signal<ContextBudget>;
/** Master gate for every agent surface: an attached session exists. */
export declare const sessionActive: import("@preact/signals-core").ReadonlySignal<boolean>;
/** Live writers with no attached session — the External Steering mode. */
export declare const externalWriterPresences: import("@preact/signals-core").ReadonlySignal<AgentPresence[]>;
/** The attached session's presence (first if several hosts attached). */
export declare const activeSession: import("@preact/signals-core").ReadonlySignal<AgentPresence | null>;
/**
 * Nodes an agent is mutating RIGHT NOW — drives the shimmer. Derived from the
 * intent store's in-flight ghosts (move / edit / remove target an existing
 * node) rather than a parallel source; gated on `sessionActive` at the use
 * site so the quiet board never shimmers.
 */
export declare function mutatingNodeIdsFrom(intentList: Iterable<Pick<PmxAxIntent, 'kind' | 'nodeId'>>): Set<string>;
export declare const mutatingNodeIds: import("@preact/signals-core").ReadonlySignal<Set<string>>;
/**
 * Where a presence's cursor sits in WORLD coordinates: an explicit cursor
 * wins; otherwise the node the agent last touched (anchored near its title
 * bar's right end, like a collaborator hovering the node); otherwise null.
 */
export declare function presenceWorldPosition(presence: Pick<AgentPresence, 'cursor' | 'focusNodeId'>, nodeById: (id: string) => {
    position: {
        x: number;
        y: number;
    };
    size: {
        width: number;
    };
} | undefined): {
    x: number;
    y: number;
} | null;
export declare function applyPresenceSnapshot(snapshot: Partial<AgentPresenceSnapshot> | null | undefined): void;
export declare function resetPresence(): void;
