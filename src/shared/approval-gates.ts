/**
 * Unattended approval policy (rail-chrome-v2 phase 4, design item 3).
 *
 * A pending approval gate carries a TTL. If the human does not answer in time
 * the gate resolves to `held` — the safe default: the action does NOT proceed,
 * a `policy` entry lands in the timeline, and the gate can be reopened from the
 * session panel. Shared so the server's sweeper and the client's countdown read
 * one clock.
 */

export const DEFAULT_GATE_TTL_MS = 5 * 60_000;
export const MIN_GATE_TTL_MS = 1_000;
export const MAX_GATE_TTL_MS = 24 * 60 * 60_000;

export function clampGateTtlMs(value: unknown, fallback = DEFAULT_GATE_TTL_MS): number {
  const ms = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return fallback;
  return Math.min(MAX_GATE_TTL_MS, Math.max(MIN_GATE_TTL_MS, Math.floor(ms)));
}

/** Milliseconds until a gate auto-holds (0 when expired, null when it has no TTL). */
export function gateRemainingMs(gate: { expiresAt: string | null }, now = Date.now()): number | null {
  if (!gate.expiresAt) return null;
  const expires = Date.parse(gate.expiresAt);
  if (!Number.isFinite(expires)) return null;
  return Math.max(0, expires - now);
}

/** `M:SS` for the gate countdown ("auto-holds in 4:31"). */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
