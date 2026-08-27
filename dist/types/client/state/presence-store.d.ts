import type { PmxAxIntent } from '../../shared/ax-intent.js';
import { type AgentActivityEntry, type AgentPresence, type AgentPresenceSnapshot, type ContextBudget } from '../../shared/agent-presence.js';
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
/** Recent agent writes, newest first — the External Steering activity feed. */
export declare const agentActivity: import("@preact/signals-core").Signal<AgentActivityEntry[]>;
/** External Steering chrome (phase 6): the feed popover and the writers sheet. */
export declare const activityFeedOpen: import("@preact/signals-core").Signal<boolean>;
export declare const writersSheetOpen: import("@preact/signals-core").Signal<boolean>;
/** Feed filter: a writer's sessionId, or null for all. */
export declare const activityFilter: import("@preact/signals-core").Signal<string | null>;
export declare function writerColor(sessionId: string): string;
/** Avatar initial: first letter of the label, upper-cased. */
export declare function writerInitial(label: string): string;
/** Compact relative age for feed rows and the writers sheet: now · 12s · 4m · 2h. */
export declare function relativeAge(iso: string, now?: number): string;
/** Master gate for every agent surface: an attached session exists. */
export declare const sessionActive: import("@preact/signals-core").ReadonlySignal<boolean>;
/** Live writers with no attached session — the External Steering mode. */
export declare const externalWriterPresences: import("@preact/signals-core").ReadonlySignal<AgentPresence[]>;
/**
 * Connected agents the human can ADDRESS from the composer: every live
 * presence (attached sessions first). `label` is the display name; `value` is
 * the CONSUMER key the steer must be targeted at — the identity the agent
 * claims deliveries with. For an adapter session that is its source key
 * (Copilot attaches as source "copilot" labelled "GitHub Copilot"); for an
 * adopted human-started session the sessionId is "browser", so the writer's
 * label IS its consumer key. Addressing the display label instead would
 * produce steering nobody can ever claim. The un-adopted placeholder is
 * excluded: no consumer will ever claim as "Agent session".
 */
export declare const steerableAgents: import("@preact/signals-core").ReadonlySignal<{
    value: string;
    label: string;
    attached: boolean;
    steerable: boolean;
}[]>;
/** The attached session's presence (first if several hosts attached). */
/** Every attached session, in presence order — the top bar shows one chip each. */
export declare const attachedSessions: import("@preact/signals-core").ReadonlySignal<AgentPresence[]>;
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
