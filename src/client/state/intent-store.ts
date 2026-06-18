import { signal } from '@preact/signals';
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

export const intents = signal<Map<string, ClientIntent>>(new Map());
/** The ghost currently hovered — drives Esc-to-veto. */
export const hoveredIntentId = signal<string | null>(null);

const SETTLE_MS = 480;
const DISSOLVE_MS = 320;

const exitTimers = new Map<string, ReturnType<typeof setTimeout>>();
let pruneTimer: ReturnType<typeof setInterval> | null = null;

function writeIntents(next: Map<string, ClientIntent>): void {
  intents.value = next;
  ensurePrune();
}

function clearExitTimer(id: string): void {
  const timer = exitTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    exitTimers.delete(id);
  }
}

/** A live `ax-intent` frame: (re)place the ghost in its forming state. */
export function upsertIntent(intent: PmxAxIntent): void {
  clearExitTimer(intent.id);
  const next = new Map(intents.value);
  next.set(intent.id, { ...intent, phase: 'forming' });
  writeIntents(next);
}

export function removeIntent(id: string): void {
  clearExitTimer(id);
  if (!intents.value.has(id)) return;
  const next = new Map(intents.value);
  next.delete(id);
  writeIntents(next);
}

function setPhase(id: string, phase: IntentPhase, ms: number, settledNodeId?: string): void {
  const current = intents.value.get(id);
  if (!current || current.phase === phase) return;
  const next = new Map(intents.value);
  next.set(id, { ...current, phase, ...(settledNodeId ? { settledNodeId } : {}) });
  writeIntents(next);
  clearExitTimer(id);
  exitTimers.set(id, setTimeout(() => removeIntent(id), ms));
}

/** Resolve a ghost into a real node — the settle morph, then removal. */
export function settleIntent(id: string, settledNodeId?: string): void {
  setPhase(id, 'settling', SETTLE_MS, settledNodeId);
}

/** Dissolve a ghost (expired / vetoed / evicted / abandoned), then remove it. */
export function dissolveIntent(id: string): void {
  setPhase(id, 'dissolving', DISSOLVE_MS);
}

export function resetIntents(): void {
  for (const timer of exitTimers.values()) clearTimeout(timer);
  exitTimers.clear();
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
  hoveredIntentId.value = null;
  intents.value = new Map();
}

// SSE backstop: if a clear frame is dropped, expired forming ghosts still go
// away on their own TTL. Runs only while ghosts are present.
function ensurePrune(): void {
  if (pruneTimer || intents.value.size === 0) return;
  pruneTimer = setInterval(() => {
    const now = Date.now();
    for (const intent of intents.value.values()) {
      if (intent.phase === 'forming' && intent.expiresAt <= now) {
        dissolveIntent(intent.id);
      }
    }
    if (intents.value.size === 0 && pruneTimer) {
      clearInterval(pruneTimer);
      pruneTimer = null;
    }
  }, 1000);
  (pruneTimer as { unref?: () => void }).unref?.();
}
