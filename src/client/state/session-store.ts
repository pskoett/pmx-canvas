import { computed, signal } from '@preact/signals';
import type { AxApprovalStatus, AxEventKind, AxWorkItemStatus } from '../../shared/ax-kinds.js';
import { HUMAN_STARTED_SESSION_LABEL } from '../../shared/agent-presence.js';
import { axSurfaceState } from './canvas-store';
import { requestBestEffort, requestJson, requestOk } from './intent-bridge';
import { agentActivity } from './presence-store';

// Structural views of the AX wire shapes (the client never imports server
// modules; the status/kind unions come from shared/). Only the fields the
// panel renders.
export type WorkItemStatus = AxWorkItemStatus;
export interface WorkItemView {
  id: string;
  title: string;
  status: WorkItemStatus;
  detail: string | null;
  nodeIds: string[];
  updatedAt: string;
}
export interface ApprovalGateView {
  id: string;
  title: string;
  detail: string | null;
  status: AxApprovalStatus;
  nodeIds: string[];
  createdAt: string;
  /** Unattended-approval TTL: when a pending gate auto-holds. */
  expiresAt: string | null;
}
export interface AxEventView {
  id: string;
  kind: AxEventKind;
  summary: string;
  detail: string | null;
  createdAt: string;
  /** Who recorded it — host/source label and per-agent identity. */
  source?: string | null;
  agentId?: string | null;
}
export interface AxEvidenceView {
  id: string;
  title: string;
  body: string | null;
  createdAt: string;
  source?: string | null;
  agentId?: string | null;
}
export interface AxSteeringView {
  id: string;
  message: string;
  createdAt: string;
  /** Consumer label this steer was addressed to; null/absent = broadcast. */
  target?: string | null;
  /** Who sent it — an agent label, or "browser" for the human's composer. */
  source?: string | null;
  /** Per-agent identity within the host — preferred over `source` for the row's sender. */
  agentId?: string | null;
  /** False until the target (or any consumer, for broadcasts) claims + marks it. */
  delivered?: boolean;
}

/**
 * Session panel data (rail-chrome-v2 phase 4). Nothing here is a second source
 * of truth: work items and gates come from the AX surface snapshot the SSE
 * bridge already refreshes on `ax-state-changed`; the timeline is the bounded
 * AX timeline read, refreshed on `ax-event-created` while a session is
 * attached. Gate decisions go through the existing resolve route.
 */

export interface ScopeFenceView {
  nodeIds: string[];
  padding: number;
}

interface SurfaceView {
  workItems?: WorkItemView[];
  approvalGates?: ApprovalGateView[];
  policy?: { scope?: ScopeFenceView | null };
}

function surface(): SurfaceView {
  const value = axSurfaceState.value;
  return value && typeof value === 'object' ? (value as SurfaceView) : {};
}

export const sessionWorkItems = computed<WorkItemView[]>(() => surface().workItems ?? []);
export const sessionGates = computed<ApprovalGateView[]>(() => surface().approvalGates ?? []);
export const pendingGates = computed(() => sessionGates.value.filter((gate) => gate.status === 'pending'));
/** The scope fence the human granted the session (null = unscoped). */
export const scopeFence = computed<ScopeFenceView | null>(() => {
  const scope = surface().policy?.scope;
  return scope && Array.isArray(scope.nodeIds) && scope.nodeIds.length > 0
    ? { nodeIds: scope.nodeIds, padding: typeof scope.padding === 'number' ? scope.padding : 40 }
    : null;
});

/** Grant or clear the fence: writes outside it are refused server-side; reads stay open. */
export async function setScopeFence(nodeIds: string[] | null): Promise<boolean> {
  const result = await requestOk('setScopeFence', '/api/canvas/ax/policy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: nodeIds && nodeIds.length > 0 ? { nodeIds } : null, source: 'browser' }),
  });
  return result.ok;
}

/** Auto-held gates: the policy said no on the human's behalf; they can be reopened. */
export const heldGates = computed(() => sessionGates.value.filter((gate) => gate.status === 'held'));

export interface AxTimelineView {
  events: AxEventView[];
  evidence: AxEvidenceView[];
  steering: AxSteeringView[];
}

export const axTimeline = signal<AxTimelineView>({ events: [], evidence: [], steering: [] });

export type TimelineEntryKind = AxEventKind | 'evidence' | 'steer' | 'update';

/** Timeline filter chips: a handful of human categories over the many kinds. */
export type TimelineFilter = 'all' | 'update' | 'steer' | 'assistant' | 'event' | 'evidence';
export const timelineFilter = signal<TimelineFilter>('all');

/** Which chip an entry belongs to: board writes / steering-shaped rows / evidence / the rest. */
export function timelineCategory(kind: TimelineEntryKind): Exclude<TimelineFilter, 'all'> {
  if (kind === 'update') return 'update';
  if (kind === 'steer' || kind === 'steering' || kind === 'yield') return 'steer';
  if (kind === 'assistant-message') return 'assistant';
  if (kind === 'evidence') return 'evidence';
  return 'event';
}

export interface TimelineEntry {
  id: string;
  kind: TimelineEntryKind;
  label: string;
  body: string;
  createdAt: string;
  /** Writer key for the row (agentId, else non-transport source; 'browser' = the human).
   * With several assistants on one board, a row without this is unanswerable:
   * "Assistant · 23:11" from WHOM? Null when only a bare transport is known. */
  who?: string | null;
  /** Item 10: this agent edit is the top of the shared undo stack — "↩ undo this edit". */
  undoable?: boolean;
}

/** Transport enums say nothing about WHICH agent spoke — never show them as a writer. */
const TRANSPORT_WRITERS = new Set(['api', 'mcp', 'sdk', 'cli']);

/** The row's writer key: per-agent identity first, else a non-transport source. */
export function writerKeyFor(agentId?: string | null, source?: string | null): string | null {
  if (agentId?.trim()) return agentId.trim();
  const raw = source?.trim();
  if (raw && !TRANSPORT_WRITERS.has(raw)) return raw;
  return null;
}

/** Ops that change the board (the ones an undo can revert). */
const LAYOUT_OPS =
  /^(node|edge|group|annotation|jsonrender|graph|render)\.|^arrange$|^canvas\.clear$|^snapshot\.restore$/;

/** The entry Ctrl+Z would undo next, from GET /api/canvas/history. */
export const historyTop = signal<{ id: string; actor: 'human' | 'agent'; description: string } | null>(null);
/** Agent edits undone from the panel this page-life — rendered "undone · steering sent". */
export const undoneActivityIds = signal<Set<string>>(new Set());

const EVENT_LABELS: Record<AxEventKind, string> = {
  prompt: 'Prompt',
  'assistant-message': 'Assistant',
  'tool-start': 'Tool run',
  'tool-result': 'Tool result',
  failure: 'Failure',
  approval: 'Approval',
  steering: 'Steering',
  command: 'Command',
  note: 'Note',
  policy: 'Policy',
  yield: 'Yield',
};

/**
 * One reverse-chronological feed out of the three timeline tables plus the
 * agent's board writes (the presence activity feed), so the panel shows what
 * the agent DID between its tool runs and gates. The newest agent write gets
 * the undo affordance when it is also the top of the shared undo stack.
 */
export function mergeTimeline(
  timeline: AxTimelineView,
  limit = 40,
  writes: Array<{ id: string; at: string; op: string; summary: string; sessionId?: string; label?: string }> = [],
  top: { actor: 'human' | 'agent' } | null = null,
  filter: TimelineFilter = 'all',
): TimelineEntry[] {
  const newestWrite = writes.find((write) => LAYOUT_OPS.test(write.op));
  const entries: TimelineEntry[] = [
    ...writes.map((write) => ({
      id: `update-${write.id}`,
      kind: 'update' as const,
      label: 'Update',
      body: write.summary,
      createdAt: write.at,
      // Activity entries are already attributed server-side — the sessionId is
      // the identity key (hue-stable across chrome), the label its display name.
      who: write.sessionId ?? null,
      ...(top?.actor === 'agent' && newestWrite?.id === write.id ? { undoable: true } : {}),
    })),
    ...timeline.events.map((event) => ({
      id: `event-${event.id}`,
      kind: event.kind,
      label: EVENT_LABELS[event.kind] ?? event.kind,
      body: event.detail ? `${event.summary} — ${event.detail}` : event.summary,
      createdAt: event.createdAt,
      who: writerKeyFor(event.agentId, event.source),
    })),
    ...timeline.evidence.map((item) => ({
      id: `evidence-${item.id}`,
      kind: 'evidence' as const,
      label: 'Evidence',
      body: item.body ? `${item.title} — ${item.body}` : item.title,
      createdAt: item.createdAt,
      who: writerKeyFor(item.agentId, item.source),
    })),
    ...timeline.steering.map((steer) => {
      // Sender shown for agent-sent steering ("claude-code → copilot · …") so
      // inter-agent coordination is legible; the human's own rows stay clean.
      // Prefer the per-agent identity: transport enums ("api", "mcp") tell the
      // human nothing about WHICH agent spoke.
      const from = steer.agentId ?? (steer.source && steer.source !== 'browser' ? steer.source : null);
      const to = steer.target ? `→ ${steer.target} · ` : from ? '→ all · ' : '';
      // Steering is pull-based: an addressed steer sits queued until the
      // target agent next runs against the canvas. Say so — a silent queued
      // row reads as "nothing happened".
      const waiting = steer.target && steer.delivered === false ? ` — waiting for ${steer.target} to pick it up` : '';
      return {
        id: `steer-${steer.id}`,
        kind: 'steer' as const,
        label: 'Steer',
        body: `${from ? `${from} ` : ''}${to}${steer.message}${waiting}`,
        createdAt: steer.createdAt,
        who: writerKeyFor(steer.agentId, steer.source),
      };
    }),
  ];
  // Filter BEFORE the cap so "Steer" shows up to `limit` steers, not just the
  // ones that survived a cap over the mixed feed.
  const kept = filter === 'all' ? entries : entries.filter((entry) => timelineCategory(entry.kind) === filter);
  kept.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return kept.slice(0, limit);
}

export const timelineEntries = computed(() =>
  mergeTimeline(axTimeline.value, 40, agentActivity.value, historyTop.value, timelineFilter.value),
);

export async function refreshTimeline(): Promise<void> {
  const [data, history] = await Promise.all([
    requestJson<Partial<AxTimelineView> | null>('refreshTimeline', '/api/canvas/ax/timeline?limit=40', null),
    requestJson<{ top?: { id: string; actor: 'human' | 'agent'; description: string } | null } | null>(
      'refreshHistoryTop',
      '/api/canvas/history',
      null,
    ),
  ]);
  if (history) historyTop.value = history.top ?? null;
  if (!data) return;
  axTimeline.value = {
    events: Array.isArray(data.events) ? data.events : [],
    evidence: Array.isArray(data.evidence) ? data.evidence : [],
    steering: Array.isArray(data.steering) ? data.steering : [],
  };
}

/**
 * Undo the agent's latest edit through the ONE shared undo stack (the same
 * POST /api/canvas/undo Ctrl+Z uses), then tell the agent: steering feedback
 * goes out through the same path a veto takes.
 */
export async function undoAgentEdit(entry: TimelineEntry): Promise<boolean> {
  const result = await requestOk('undoAgentEdit', '/api/canvas/undo', { method: 'POST' });
  if (!result.ok) return false;
  undoneActivityIds.value = new Set([...undoneActivityIds.value, entry.id]);
  await requestBestEffort('undoAgentEditSteering', '/api/canvas/ax/steer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Undid your edit: ${entry.body} — it was reverted on the board.`,
      source: 'browser',
    }),
  });
  void refreshTimeline();
  return true;
}

/** Ctrl+Z / Ctrl+Shift+Z: whichever op is top of the shared stack, agent or human. */
export async function undoFromKeyboard(redo = false): Promise<boolean> {
  const result = await requestOk(redo ? 'redo' : 'undo', redo ? '/api/canvas/redo' : '/api/canvas/undo', {
    method: 'POST',
  });
  if (result.ok) void refreshTimeline();
  return result.ok;
}

/**
 * Resolve a gate through the existing AX path. A rejection also posts steering
 * feedback so the agent learns WHY its next turn — the same `vetoGhostSteering`
 * contract ghost vetoes use.
 */
export async function resolveGate(gate: ApprovalGateView, decision: 'approved' | 'rejected'): Promise<boolean> {
  const result = await requestOk('resolveGate', `/api/canvas/ax/approval/${encodeURIComponent(gate.id)}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, source: 'browser' }),
  });
  if (!result.ok) return false;
  if (decision === 'rejected') {
    await requestBestEffort('rejectGateSteering', '/api/canvas/ax/steer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Rejected gate "${gate.title}" — do not proceed with it.`, source: 'browser' }),
    });
  }
  return true;
}

/** Reopen an auto-held gate so it can be answered (fresh TTL). */
export async function reopenGate(gate: ApprovalGateView): Promise<boolean> {
  const result = await requestOk('reopenGate', `/api/canvas/ax/approval/${encodeURIComponent(gate.id)}/reopen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'browser' }),
  });
  return result.ok;
}

/** Post a steering message the agent reads on its next turn. */
export async function sendSteering(message: string, target?: string | null): Promise<boolean> {
  const result = await requestOk('sendSteering', '/api/canvas/ax/steer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // `target` addresses one connected agent (its consumer label); omitted = broadcast.
    body: JSON.stringify({ message, source: 'browser', ...(target ? { target } : {}) }),
  });
  return result.ok;
}

// ── Session lifecycle (rail-chrome-v2 phase 5) ────────────────

/** Attach a human-started session; the agent's writes are attributed to it. */
export async function startSession(): Promise<boolean> {
  const result = await requestOk('startSession', '/api/canvas/ax/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'browser', label: HUMAN_STARTED_SESSION_LABEL, attached: true, phase: 'idle' }),
  });
  return result.ok;
}

/** End the attached session (whoever attached it) — the server answers with a receipt. */
export async function endSession(session: { source: string; agentId: string | null }): Promise<boolean> {
  const result = await requestOk('endSession', '/api/canvas/ax/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: session.source, agentId: session.agentId, attached: false, endedBy: 'human' }),
  });
  return result.ok;
}

export interface SessionReceipt {
  label: string;
  endedAt: string;
  /** Why it ended — the receipt should answer this, not leave the human asking. */
  endedBy?: 'human' | 'agent' | 'idle-timeout';
  /** The session changed nothing on the board (its pre-session snapshot was dropped). */
  unchanged?: boolean;
  counts: { items: number; done: number; vetoed: number };
  snapshot: { id: string; name: string } | null;
}

/** The last ended session's receipt (design item 2); client-side, cleared on dismiss. */
export const sessionReceipt = signal<SessionReceipt | null>(null);

export function applySessionReceipt(data: Record<string, unknown>): void {
  const counts = data.counts as Partial<SessionReceipt['counts']> | undefined;
  const snapshot = data.snapshot as SessionReceipt['snapshot'] | undefined;
  if (typeof data.label !== 'string' || typeof data.endedAt !== 'string') return;
  sessionReceipt.value = {
    label: data.label,
    endedAt: data.endedAt,
    endedBy:
      data.endedBy === 'human' || data.endedBy === 'agent' || data.endedBy === 'idle-timeout'
        ? data.endedBy
        : undefined,
    unchanged: data.unchanged === true,
    counts: {
      items: Number(counts?.items ?? 0) || 0,
      done: Number(counts?.done ?? 0) || 0,
      vetoed: Number(counts?.vetoed ?? 0) || 0,
    },
    snapshot:
      snapshot && typeof snapshot.id === 'string' ? { id: snapshot.id, name: String(snapshot.name ?? '') } : null,
  };
}

export function dismissSessionReceipt(): void {
  sessionReceipt.value = null;
}

export function resetSessionStore(): void {
  historyTop.value = null;
  undoneActivityIds.value = new Set();
  sessionReceipt.value = null;
  axTimeline.value = { events: [], evidence: [], steering: [] };
  timelineFilter.value = 'all';
}
