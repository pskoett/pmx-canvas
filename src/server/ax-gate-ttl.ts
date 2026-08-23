/**
 * Unattended-approval sweeper (rail-chrome-v2 phase 4, design item 3).
 *
 * A pending gate the human has not answered by `expiresAt` resolves to
 * `held` — the safe default: the awaiting agent is released with a
 * non-approval, the action does NOT proceed, and a `policy` event lands in
 * the timeline so both sides can see why. The gate can be reopened from the
 * session panel. Same discipline as IntentRegistry's sweeper: a 1s unref'd
 * interval that only runs while a server is up, emitting through an injected
 * workbench emitter so this module never imports server.ts.
 */
import { formatCountdown } from '../shared/approval-gates.js';
import { agentPresence } from './agent-presence.js';
import { canvasState } from './canvas-state.js';

type GateEmitter = (event: string, payload: Record<string, unknown>) => void;

let sweepTimer: ReturnType<typeof setInterval> | null = null;
let emit: GateEmitter = () => {};

/** Hold every pending gate whose TTL has elapsed. Returns the gates it held. */
export function sweepExpiredGates(now = Date.now()): string[] {
  const held: string[] = [];
  for (const gate of canvasState.getAxState().approvalGates) {
    if (gate.status !== 'pending' || !gate.expiresAt) continue;
    const expires = Date.parse(gate.expiresAt);
    if (!Number.isFinite(expires) || expires > now) continue;
    const ttl = Math.max(0, expires - Date.parse(gate.createdAt));
    const resolved = canvasState.resolveApproval(gate.id, 'held', {
      resolution: `auto-held: no answer within ${formatCountdown(ttl)}`,
      source: 'system',
    });
    if (!resolved) continue;
    held.push(gate.id);
    const event = canvasState.recordAxEvent(
      {
        kind: 'policy',
        summary: `Auto-held "${gate.title}" — no answer within ${formatCountdown(ttl)}; the action did not proceed.`,
        detail: 'Reopen it from the session panel to answer.',
        nodeIds: gate.nodeIds,
        data: { gateId: gate.id, policy: 'unattended-approval', outcome: 'held' },
      },
      { source: 'system' },
    );
    emit('ax-state-changed', { approvalGate: resolved });
    emit('ax-event-created', { event });
  }
  if (held.length > 0) agentPresence.refresh();
  return held;
}

export function startGateTtlSweeper(emitter: GateEmitter): void {
  emit = emitter;
  if (sweepTimer) return;
  sweepTimer = setInterval(() => sweepExpiredGates(), 1000);
  (sweepTimer as { unref?: () => void }).unref?.();
}

export function stopGateTtlSweeper(): void {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  emit = () => {};
}
