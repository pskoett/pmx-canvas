/**
 * Agent presence — the contract behind every agent surface in the rail chrome
 * (rail-chrome-v2 phase 2). Shared by server and client so the two cannot
 * drift. See design/rail-chrome-v2/PLAN.md, "Phase 2 contract".
 *
 * Presence is DERIVED from feeds that already exist (AX activity ingest,
 * agent-originated mutations) plus an explicit set for adapters with richer
 * hooks. Nothing here is a second source of truth for work items, gates, or
 * steering — those stay in the AX state.
 */
export type AgentPhase = 'idle' | 'thinking' | 'tooling' | 'waiting-approval';
export declare const AGENT_PHASES: readonly AgentPhase[];
export interface AgentPresence {
    /** Writer key: `agentId` when the host supplies one, else the source label. */
    sessionId: string;
    /** Host label (copilot, codex, mcp, api, cli, …). */
    source: string;
    agentId: string | null;
    /** Display name. */
    label: string;
    phase: AgentPhase;
    /** Tool or operation name while `tooling`. */
    detail: string | null;
    focusNodeId: string | null;
    /** World coordinates. */
    cursor: {
        x: number;
        y: number;
    } | null;
    /** A session is attached: `session-start` (or explicit attach) seen and no `session-end`. */
    attached: boolean;
    /** Agent writes observed for this writer — feeds the external-steering indicator. */
    opCount: number;
    lastSeenAt: string;
}
export interface ContextBudget {
    /** Estimated tokens of the pinned-context payload. */
    used: number;
    total: number;
}
export interface AgentPresenceSnapshot {
    presences: AgentPresence[];
    budget: ContextBudget;
    /** True when any presence is attached — the master gate for agent chrome. */
    sessionActive: boolean;
}
/** Unattached writers fade this long after their last write. */
export declare const PRESENCE_ACTIVITY_TTL_MS = 90000;
/** Attached sessions expire after this much quiet without a `session-end`. */
export declare const PRESENCE_ATTACHED_IDLE_TTL_MS: number;
/** `tooling` decays to `idle` after this much quiet. */
export declare const PRESENCE_TOOLING_SETTLE_MS = 4000;
export declare const MAX_PRESENCES = 16;
/** Default `budget.total` when `PMX_CANVAS_CONTEXT_BUDGET_TOKENS` is unset. */
export declare const CONTEXT_BUDGET_DEFAULT_TOKENS = 32000;
/**
 * Source labels that name a TRANSPORT, not an agent. A write arriving under
 * one of these while exactly one session is attached is the attached agent's
 * own work reaching the board through that transport (Copilot/Codex/Claude
 * Code all write via MCP or HTTP while their host holds the session).
 */
export declare const TRANSPORT_SOURCES: readonly string[];
/** The one selector every agent surface reads. */
export declare function isSessionActive(presences: readonly AgentPresence[]): boolean;
/** Writers that are live but not attached — the External Steering mode. */
export declare function externalWriters(presences: readonly AgentPresence[]): AgentPresence[];
/** Rough token estimate for a JSON payload (chars / 4) — good enough for a meter. */
export declare function estimateTokens(text: string): number;
/** Chip label per phase — shared by the top-bar chip and the on-canvas cursor chip. */
export declare function agentPhaseLabel(presence: Pick<AgentPresence, 'phase' | 'detail'>): string;
