import { computed, signal } from '@preact/signals';
import type { PmxAxIntent } from '../../shared/ax-intent.js';
import { intents } from './intent-store';
import {
  type AgentActivityEntry,
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
/** Recent agent writes, newest first — the External Steering activity feed. */
export const agentActivity = signal<AgentActivityEntry[]>([]);

/** External Steering chrome (phase 6): the feed popover and the writers sheet. */
export const activityFeedOpen = signal(false);
export const writersSheetOpen = signal(false);
/** Feed filter: a writer's sessionId, or null for all. */
export const activityFilter = signal<string | null>(null);

/**
 * Per-writer identity colors from the accent set, agent-violet first,
 * assigned in order of first appearance and stable for the page's life — a
 * writer that fades and returns keeps its color.
 */
const WRITER_PALETTE = ['var(--c-purple)', 'var(--c-accent)', 'var(--c-ok)', 'var(--c-warn)', 'var(--c-danger)'];
const writerColors = new Map<string, string>();
export function writerColor(sessionId: string): string {
  const known = writerColors.get(sessionId);
  if (known) return known;
  const color = WRITER_PALETTE[writerColors.size % WRITER_PALETTE.length]!;
  writerColors.set(sessionId, color);
  return color;
}

/** Avatar initial: first letter of the label, upper-cased. */
export function writerInitial(label: string): string {
  const first = label
    .trim()
    .replace(/^[^a-z0-9]+/i, '')
    .charAt(0);
  return (first || label.trim().charAt(0) || '?').toUpperCase();
}

/** Compact relative age for feed rows and the writers sheet: now · 12s · 4m · 2h. */
export function relativeAge(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 5_000) return 'now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  return `${Math.floor(ms / 3_600_000)}h`;
}

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
  if (Array.isArray(snapshot.activity)) agentActivity.value = snapshot.activity;
}

export function resetPresence(): void {
  agentPresences.value = [];
  contextBudget.value = { used: 0, total: CONTEXT_BUDGET_DEFAULT_TOKENS };
  agentActivity.value = [];
  activityFeedOpen.value = false;
  writersSheetOpen.value = false;
  activityFilter.value = null;
}
