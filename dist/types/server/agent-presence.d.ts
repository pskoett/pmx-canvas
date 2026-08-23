/**
 * Agent presence registry (rail-chrome-v2 phase 2).
 *
 * Lives beside IntentRegistry and follows its discipline: in-memory, TTL-swept,
 * count-capped, and emitting through an injected workbench emitter so this
 * module never imports server.ts. One `agent-presence` SSE frame carries the
 * full snapshot on every change, so a reconnecting client is never stale and
 * never needs its own expiry ticker.
 *
 * Presence is derived, not declared: agent-originated mutations (anything
 * `executeOperation` runs without the workbench marker) and AX activity
 * ingests (`tool-start`, `session-start`, …) touch a writer; adapters with
 * richer hooks may `set` a phase, cursor, or focus explicitly.
 */
import { z } from 'zod';
import { type AgentPhase, type AgentPresence, type AgentPresenceSnapshot, type ContextBudget } from '../shared/agent-presence.js';
import type { PmxAxActivityKind } from './ax-state.js';
type PresenceEmitter = (event: string, payload: Record<string, unknown>) => void;
/** A legal writer label: short, alphanumeric/dash, letter-first (header and env values). */
export declare const SOURCE_LABEL_RE: RegExp;
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
/**
 * The one validation schema for an explicit presence update. The HTTP/MCP op
 * spreads these fields into its tool shape so the two cannot drift.
 *
 * Identity note: presence is a UX signal, not an authenticated identity — any
 * local process can assert any `source`/`agentId` (the single-workspace trust
 * model). It shows the human WHO claims to be working; it grants no write
 * capability that the caller did not already have.
 */
export declare const PRESENCE_SET_SHAPE: {
    source: z.ZodOptional<z.ZodString>;
    agentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    label: z.ZodOptional<z.ZodString>;
    phase: z.ZodOptional<z.ZodEnum<{
        idle: "idle";
        thinking: "thinking";
        tooling: "tooling";
        "waiting-approval": "waiting-approval";
    }>>;
    detail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    focusNodeId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    cursor: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strip>>>;
    attached: z.ZodOptional<z.ZodBoolean>;
};
/** Token estimate of the pinned-context payload — the same serialization the MCP resource ships. */
export declare function estimateContextBudget(): ContextBudget;
/** Returns the id of the pre-session snapshot the server took, if any. */
type SessionStartListener = (presence: AgentPresence) => string | null;
type SessionEndListener = (presence: AgentPresence, startSnapshotId: string | null) => void;
export declare class AgentPresenceRegistry {
    private readonly presences;
    private emit;
    /** Single slots (like the emitter): server.ts owns the pre-session snapshot + receipt. */
    private onSessionStart;
    private onSessionEnd;
    private sweepTimer;
    private emitTimer;
    /** Inject the workbench SSE emitter (server.ts wires this at module load). */
    setEmitter(emitter: PresenceEmitter | null): void;
    /**
     * Fires when a session attaches (false → true). The listener may snapshot the
     * board and return the snapshot id; the receipt at session end diffs against it.
     */
    setSessionStartListener(listener: SessionStartListener | null): void;
    /**
     * Fires once when an ATTACHED session ends — by `session-end`, by an explicit
     * `attached: false`, or by the idle-TTL sweep — with the presence as it was
     * and the pre-session snapshot id. Unattached writers fading away never fire it.
     */
    setSessionEndListener(listener: SessionEndListener | null): void;
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
    /**
     * Re-emit the snapshot after something the phase is DERIVED from changed
     * (a gate opened or resolved) without any writer being touched.
     */
    refresh(): void;
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
