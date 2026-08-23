/**
 * Unattended approval policy (rail-chrome-v2 phase 4, design item 3).
 *
 * A pending approval gate carries a TTL. If the human does not answer in time
 * the gate resolves to `held` — the safe default: the action does NOT proceed,
 * a `policy` entry lands in the timeline, and the gate can be reopened from the
 * session panel. Shared so the server's sweeper and the client's countdown read
 * one clock.
 */
export declare const DEFAULT_GATE_TTL_MS: number;
export declare const MIN_GATE_TTL_MS = 1000;
export declare const MAX_GATE_TTL_MS: number;
export declare function clampGateTtlMs(value: unknown, fallback?: number): number;
/** Milliseconds until a gate auto-holds (0 when expired, null when it has no TTL). */
export declare function gateRemainingMs(gate: {
    expiresAt: string | null;
}, now?: number): number | null;
/** `M:SS` for the gate countdown ("auto-holds in 4:31"). */
export declare function formatCountdown(ms: number): string;
