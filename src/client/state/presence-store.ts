import { computed, signal } from '@preact/signals';
import type { PmxAxIntent } from '../../shared/ax-intent.js';
import { intents } from './intent-store';
import {
  type AgentPresence,
  type AgentPresenceSnapshot,
  CONTEXT_BUDGET_DEFAULT_TOKENS,
  type ContextBudget,
  externalWriters,
  isSessionActive,
} from '../../shared/agent-presence.js';

/**
 * Agent presence (rail-chrome-v2 phase 2). Fed by the server's `agent-presence`
 * SSE snapshot (every change, including TTL expiry) and the connect-time read,
 * so this store never runs its own expiry ticker.
 *
 * `sessionActive` is the ONE selector every agent surface reads — the session
 * panel, command bar, presence layer, and top-bar chip all mount on it.
 */
export const agentPresences = signal<AgentPresence[]>([]);
export const contextBudget = signal<ContextBudget>({ used: 0, total: CONTEXT_BUDGET_DEFAULT_TOKENS });

/** Master gate for every agent surface: an attached session exists. */
export const sessionActive = computed(() => isSessionActive(agentPresences.value));

/** Live writers with no attached session — the External Steering mode. */
export const externalWriterPresences = computed(() => externalWriters(agentPresences.value));

/** The attached session's presence (first if several hosts attached). */
export const activeSession = computed<AgentPresence | null>(
  () => agentPresences.value.find((presence) => presence.attached) ?? null,
);

/**
 * Nodes an agent is mutating RIGHT NOW — drives the shimmer. Derived from the
 * intent store's in-flight ghosts (move / edit / remove target an existing
 * node) rather than a parallel source; gated on `sessionActive` at the use
 * site so the quiet board never shimmers.
 */
export function mutatingNodeIdsFrom(intentList: Iterable<Pick<PmxAxIntent, 'kind' | 'nodeId'>>): Set<string> {
  const ids = new Set<string>();
  for (const intent of intentList) {
    if (intent.nodeId && intent.kind !== 'create') ids.add(intent.nodeId);
  }
  return ids;
}

export const mutatingNodeIds = computed(() => mutatingNodeIdsFrom(intents.value.values()));

/**
 * Where a presence's cursor sits in WORLD coordinates: an explicit cursor
 * wins; otherwise the node the agent last touched (anchored near its title
 * bar's right end, like a collaborator hovering the node); otherwise null.
 */
export function presenceWorldPosition(
  presence: Pick<AgentPresence, 'cursor' | 'focusNodeId'>,
  nodeById: (id: string) => { position: { x: number; y: number }; size: { width: number } } | undefined,
): { x: number; y: number } | null {
  if (presence.cursor) return { x: presence.cursor.x, y: presence.cursor.y };
  if (!presence.focusNodeId) return null;
  const node = nodeById(presence.focusNodeId);
  if (!node) return null;
  return { x: node.position.x + Math.max(24, node.size.width - 28), y: node.position.y + 16 };
}

export function applyPresenceSnapshot(snapshot: Partial<AgentPresenceSnapshot> | null | undefined): void {
  if (!snapshot) return;
  if (Array.isArray(snapshot.presences)) agentPresences.value = snapshot.presences;
  if (snapshot.budget && Number.isFinite(snapshot.budget.used) && Number.isFinite(snapshot.budget.total)) {
    contextBudget.value = { used: snapshot.budget.used, total: snapshot.budget.total };
  }
}

export function resetPresence(): void {
  agentPresences.value = [];
  contextBudget.value = { used: 0, total: CONTEXT_BUDGET_DEFAULT_TOKENS };
}
