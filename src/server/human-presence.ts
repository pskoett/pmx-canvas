import { z } from 'zod';
import {
  HUMAN_GRAB_TTL_MS,
  HUMAN_PRESENCE_TTL_MS,
  type HumanPresence,
  type HumanPresenceSnapshot,
  MAX_HUMANS,
} from '../shared/human-presence.js';
import { OperationError } from './operations/types.js';

/**
 * Registry of open workbench tabs (rail-chrome-v2 phase 8). Fed by the
 * browser's own `human.presence.set` heartbeats; broadcast as one coalesced
 * `human-presence` SSE frame on every change including expiry, so clients
 * never run their own expiry timers. `lockedNodes()` is the edit lock the
 * operation registry consults for agent writes (user wins).
 */
export const HUMAN_PRESENCE_SHAPE = {
  clientId: z.string().min(1).max(64),
  name: z.string().min(1).max(40).optional(),
  cursor: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable().optional(),
  grabbingNodeId: z.string().max(200).nullable().optional(),
  /** Explicit leave (tab closing): drop the presence now. */
  left: z.boolean().optional(),
};
const presenceSchema = z.object(HUMAN_PRESENCE_SHAPE);

interface Stored extends HumanPresence {
  lastSeenMs: number;
  grabSinceMs: number | null;
}

type Emitter = (event: string, payload: Record<string, unknown>) => void;

export class HumanPresenceRegistry {
  private readonly humans = new Map<string, Stored>();
  private emit: Emitter = () => {};
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;

  setEmitter(emitter: Emitter | null): void {
    this.emit = emitter ?? (() => {});
  }

  set(raw: unknown, now = Date.now()): HumanPresence | null {
    const parsed = presenceSchema.safeParse(raw);
    if (!parsed.success) {
      throw new OperationError(
        `Invalid human presence: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
      );
    }
    const input = parsed.data;
    if (input.left) {
      if (this.humans.delete(input.clientId)) this.scheduleEmit();
      this.maybeStopSweeper();
      return null;
    }
    const existing = this.humans.get(input.clientId);
    const stored: Stored = existing ?? {
      clientId: input.clientId,
      name: input.name ?? 'Human',
      cursor: null,
      grabbingNodeId: null,
      lastSeenAt: new Date(now).toISOString(),
      lastSeenMs: now,
      grabSinceMs: null,
    };
    stored.lastSeenMs = now;
    stored.lastSeenAt = new Date(now).toISOString();
    if (input.name) stored.name = input.name;
    if (input.cursor !== undefined) stored.cursor = input.cursor;
    if (input.grabbingNodeId !== undefined) {
      if (input.grabbingNodeId !== stored.grabbingNodeId) stored.grabSinceMs = input.grabbingNodeId ? now : null;
      else if (input.grabbingNodeId) stored.grabSinceMs = now; // renewed
      stored.grabbingNodeId = input.grabbingNodeId;
    }
    this.humans.set(input.clientId, stored);
    while (this.humans.size > MAX_HUMANS) {
      const oldest = [...this.humans.values()].sort((a, b) => a.lastSeenMs - b.lastSeenMs)[0];
      if (!oldest) break;
      this.humans.delete(oldest.clientId);
    }
    this.ensureSweeper();
    this.scheduleEmit();
    return this.publicView(stored);
  }

  snapshot(now = Date.now()): HumanPresenceSnapshot {
    this.sweep(now, { emit: false });
    return { humans: [...this.humans.values()].map((stored) => this.publicView(stored)) };
  }

  /** Nodes a human is holding right now → that human's name. The edit lock. */
  lockedNodes(now = Date.now()): Map<string, string> {
    const locked = new Map<string, string>();
    for (const human of this.humans.values()) {
      if (human.grabbingNodeId && human.grabSinceMs !== null && now - human.grabSinceMs <= HUMAN_GRAB_TTL_MS) {
        locked.set(human.grabbingNodeId, human.name);
      }
    }
    return locked;
  }

  reset(): void {
    this.humans.clear();
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.maybeStopSweeper();
  }

  private publicView(stored: Stored): HumanPresence {
    const { lastSeenMs: _lastSeenMs, grabSinceMs, ...human } = stored;
    // An expired grab reads as released even before the sweep drops it.
    const grabbing =
      human.grabbingNodeId && grabSinceMs !== null && Date.now() - grabSinceMs <= HUMAN_GRAB_TTL_MS
        ? human.grabbingNodeId
        : null;
    return { ...human, grabbingNodeId: grabbing };
  }

  private sweep(now = Date.now(), options: { emit?: boolean } = {}): void {
    let changed = false;
    for (const [key, human] of this.humans) {
      if (human.lastSeenMs + HUMAN_PRESENCE_TTL_MS <= now) {
        this.humans.delete(key);
        changed = true;
      } else if (human.grabbingNodeId && human.grabSinceMs !== null && now - human.grabSinceMs > HUMAN_GRAB_TTL_MS) {
        human.grabbingNodeId = null;
        human.grabSinceMs = null;
        changed = true;
      }
    }
    if (changed && options.emit !== false) this.scheduleEmit();
    this.maybeStopSweeper();
  }

  private scheduleEmit(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit('human-presence', this.snapshot() as unknown as Record<string, unknown>);
    }, 16);
  }

  private ensureSweeper(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), 1000);
  }

  private maybeStopSweeper(): void {
    if (this.humans.size === 0 && this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
}

export const humanPresence = new HumanPresenceRegistry();
