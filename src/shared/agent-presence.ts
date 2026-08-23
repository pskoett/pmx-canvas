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

export const AGENT_PHASES: readonly AgentPhase[] = ['idle', 'thinking', 'tooling', 'waiting-approval'];

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
  cursor: { x: number; y: number } | null;
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
export const PRESENCE_ACTIVITY_TTL_MS = 90_000;
/** Attached sessions expire after this much quiet without a `session-end`. */
export const PRESENCE_ATTACHED_IDLE_TTL_MS = 30 * 60_000;
/** `tooling` decays to `idle` after this much quiet. */
export const PRESENCE_TOOLING_SETTLE_MS = 4_000;
export const MAX_PRESENCES = 16;
/** Default `budget.total` when `PMX_CANVAS_CONTEXT_BUDGET_TOKENS` is unset. */
export const CONTEXT_BUDGET_DEFAULT_TOKENS = 32_000;

/**
 * Source labels that name a TRANSPORT, not an agent. A write arriving under
 * one of these while exactly one session is attached is the attached agent's
 * own work reaching the board through that transport (Copilot/Codex/Claude
 * Code all write via MCP or HTTP while their host holds the session).
 */
export const TRANSPORT_SOURCES: readonly string[] = ['api', 'mcp', 'sdk', 'cli'];

/** The one selector every agent surface reads. */
export function isSessionActive(presences: readonly AgentPresence[]): boolean {
  return presences.some((presence) => presence.attached);
}

/** Writers that are live but not attached — the External Steering mode. */
export function externalWriters(presences: readonly AgentPresence[]): AgentPresence[] {
  return presences.filter((presence) => !presence.attached);
}

/** Rough token estimate for a JSON payload (chars / 4) — good enough for a meter. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Chip label per phase — shared by the top-bar chip and the on-canvas cursor chip. */
export function agentPhaseLabel(presence: Pick<AgentPresence, 'phase' | 'detail'>): string {
  switch (presence.phase) {
    case 'thinking':
      return 'Thinking';
    case 'tooling':
      return presence.detail ? `Running ${presence.detail}` : 'Working';
    case 'waiting-approval':
      return 'Waiting on you';
    default:
      return 'Idle';
  }
}
