import { type AgentPhase, type AgentPresence, type AgentPresenceSnapshot, type ContextBudget } from '../shared/agent-presence.js';
import type { PmxAxActivityKind } from './ax-state.js';
type PresenceEmitter = (event: string, payload: Record<string, unknown>) => void;
export interface PresenceTouch {
    source: string;
    agentId?: string | null;
    label?: string;
    phase?: AgentPhase;
    detail?: string | null;
    focusNodeId?: string | null;
    cursor?: {
        x: number;
        y: number;
    } | null;
    attached?: boolean;
    /** Count this touch as an agent write. */
    op?: boolean;
}
/** Token estimate of the pinned-context payload — the same serialization the MCP resource ships. */
export declare function estimateContextBudget(): ContextBudget;
export declare class AgentPresenceRegistry {
    private readonly presences;
    private emit;
    private sweepTimer;
    private emitTimer;
    /** Inject the workbench SSE emitter (server.ts wires this at module load). */
    setEmitter(emitter: PresenceEmitter | null): void;
    /**
     * Attribute a transport-labelled, agent-less write to the one attached
     * session, so the session's cursor and phase follow its own work no matter
     * which transport carried it. Ambiguous (several sessions) or identified
     * (agentId / host label) writes keep their own key.
     */
    private attributedKey;
    /** Touch a writer: upsert, bump lastSeen, apply the patch. Derived `tooling` decays on its own. */
    touch(input: PresenceTouch, now?: number): AgentPresence;
    /** Explicit update from an adapter / MCP client (validated). */
    set(raw: unknown, fallbackSource: string): AgentPresence;
    /** Map an AX activity ingest onto presence — the feed that already exists. */
    observeActivity(kind: PmxAxActivityKind, input: {
        source: string;
        agentId?: string | null;
        title: string;
    }, now?: number): void;
    /** Remove a writer (session-end). */
    detach(sessionId: string): boolean;
    snapshot(now?: number): AgentPresenceSnapshot;
    /** Test / shutdown hook. */
    reset(): void;
    private publicView;
    private hasPendingGate;
    private evictOverflow;
    private sweep;
    /** Coalesce bursts (batch churn) into one frame per tick. */
    private scheduleEmit;
    private ensureSweeper;
    private maybeStopSweeper;
}
/** Process-wide singleton, shared across HTTP handlers, MCP ops, and the SDK. */
export declare const agentPresence: AgentPresenceRegistry;
export {};
