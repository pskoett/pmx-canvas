import { computed, signal } from '@preact/signals';
import {
  HUMAN_CURSOR_THROTTLE_MS,
  type HumanPresence,
  type HumanPresenceSnapshot,
} from '../../shared/human-presence.js';
import { requestBestEffort, vetoGhostIntent } from './intent-bridge';
import { intents, removeIntent } from './intent-store';

/**
 * Human collaborator presence (rail-chrome-v2 phase 8). This tab reports its
 * cursor (throttled) and the node it is holding; the server fans every tab
 * out over `human-presence` SSE frames. `otherHumans` is what the presence
 * layer draws — never this tab's own cursor.
 */

function sessionScoped(key: string, make: () => string): string {
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const value = make();
    window.sessionStorage.setItem(key, value);
    return value;
  } catch {
    return make();
  }
}

export const humanClientId = sessionScoped(
  'pmx-canvas-human-client',
  () => `tab-${Math.random().toString(36).slice(2, 8)}`,
);

function resolveName(): string {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('name')?.trim();
    if (fromQuery) {
      window.localStorage.setItem('pmx-canvas-human-name', fromQuery);
      return fromQuery;
    }
    const stored = window.localStorage.getItem('pmx-canvas-human-name')?.trim();
    if (stored) return stored;
  } catch {
    // storage unavailable: fall through to a generated name
  }
  return `guest-${humanClientId.slice(-4)}`;
}

export const humanName = signal<string>(resolveName());
export const humans = signal<HumanPresence[]>([]);
export const otherHumans = computed(() => humans.value.filter((human) => human.clientId !== humanClientId));

/** Nodes a human took over mid-edit → that human's name, shown as the yield pill for a moment. */
export const yieldedNodes = signal<Map<string, string>>(new Map());

export function applyHumanSnapshot(snapshot: Partial<HumanPresenceSnapshot> | null | undefined): void {
  if (!snapshot || !Array.isArray(snapshot.humans)) return;
  humans.value = snapshot.humans;
}

let grabbing: string | null = null;
let lastCursor: { x: number; y: number } | null = null;
let lastSentAt = 0;
let pending: ReturnType<typeof setTimeout> | null = null;

function post(body: Record<string, unknown>): void {
  void requestBestEffort('humanPresence', '/api/canvas/human-presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: humanClientId, name: humanName.value, ...body }),
  });
}

function flushCursor(): void {
  pending = null;
  lastSentAt = Date.now();
  post({ cursor: lastCursor, grabbingNodeId: grabbing });
}

/** Report the pointer in world coordinates (throttled); null when it leaves the canvas. */
export function reportHumanCursor(cursor: { x: number; y: number } | null): void {
  lastCursor = cursor;
  const elapsed = Date.now() - lastSentAt;
  if (elapsed >= HUMAN_CURSOR_THROTTLE_MS) {
    if (pending) clearTimeout(pending);
    flushCursor();
  } else if (!pending) {
    pending = setTimeout(flushCursor, HUMAN_CURSOR_THROTTLE_MS - elapsed);
  }
}

/** Hold / release a node (drag, rename): the edit lock agents must respect. */
export function reportHumanGrab(nodeId: string | null): void {
  grabbing = nodeId;
  post({ cursor: lastCursor, grabbingNodeId: nodeId });
}

export function markYielded(nodeId: string, name: string): void {
  const next = new Map(yieldedNodes.value);
  next.set(nodeId, name);
  yieldedNodes.value = next;
  setTimeout(() => {
    const later = new Map(yieldedNodes.value);
    if (later.get(nodeId) === name) {
      later.delete(nodeId);
      yieldedNodes.value = later;
    }
  }, 6000);
}

/**
 * User wins (item 6): the human grabbed a node the agent is mid-edit on. Every
 * explicit intent targeting it is vetoed through the normal veto path (the
 * agent hears it as steering), a Yield entry lands in the timeline, and the
 * node wears a "took over — agent yielded" pill for a moment.
 */
export function takeOverNode(nodeId: string, title: string): void {
  const pendingOnNode = [...intents.value.values()].filter(
    (intent) => intent.nodeId === nodeId && !intent.auto && intent.phase === 'forming',
  );
  if (pendingOnNode.length === 0) return;
  const name = humanName.value;
  markYielded(nodeId, name);
  for (const intent of pendingOnNode) {
    void vetoGhostIntent({
      id: intent.id,
      kind: intent.kind,
      label: intent.label,
      reason: `${name} took over “${title}” mid-edit — yield and requeue the change once it is released`,
    }).then((ok) => {
      if (ok) removeIntent(intent.id);
    });
  }
  void requestBestEffort('yieldEvent', '/api/canvas/ax/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'yield',
      summary: `${name} grabbed “${title}” mid-edit — agent yielded, change requeued`,
      nodeIds: [nodeId],
      source: 'browser',
    }),
  });
}

let heartbeat: ReturnType<typeof setInterval> | null = null;

/** Announce this tab and keep it alive; renews a held grab. Call once per connection. */
export function startHumanPresence(): () => void {
  post({ cursor: lastCursor, grabbingNodeId: grabbing });
  heartbeat = setInterval(() => post({ grabbingNodeId: grabbing }), 3000);
  const leave = () => {
    try {
      navigator.sendBeacon?.(
        '/api/canvas/human-presence',
        new Blob([JSON.stringify({ clientId: humanClientId, left: true })], { type: 'application/json' }),
      );
    } catch {
      // best effort
    }
  };
  window.addEventListener('pagehide', leave);
  return () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    window.removeEventListener('pagehide', leave);
  };
}

export function resetHumanPresence(): void {
  humans.value = [];
  yieldedNodes.value = new Map();
  grabbing = null;
  lastCursor = null;
}
