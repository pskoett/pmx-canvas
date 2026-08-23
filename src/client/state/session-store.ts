import { computed, signal } from '@preact/signals';
import { axSurfaceState } from './canvas-store';

// Structural views of the AX wire shapes (the client never imports server
// modules). Only the fields the panel renders.
export type WorkItemStatus = 'todo' | 'in-progress' | 'blocked' | 'done' | 'cancelled';
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
  status: 'pending' | 'approved' | 'rejected';
  nodeIds: string[];
  createdAt: string;
}
export type AxEventKind =
  | 'prompt'
  | 'assistant-message'
  | 'tool-start'
  | 'tool-result'
  | 'failure'
  | 'approval'
  | 'steering'
  | 'command'
  | 'note';
export interface AxEventView {
  id: string;
  kind: AxEventKind;
  summary: string;
  detail: string | null;
  createdAt: string;
}
export interface AxEvidenceView {
  id: string;
  title: string;
  body: string | null;
  createdAt: string;
}
export interface AxSteeringView {
  id: string;
  message: string;
  createdAt: string;
}

/**
 * Session panel data (rail-chrome-v2 phase 4). Nothing here is a second source
 * of truth: work items and gates come from the AX surface snapshot the SSE
 * bridge already refreshes on `ax-state-changed`; the timeline is the bounded
 * AX timeline read, refreshed on `ax-event-created` while a session is
 * attached. Gate decisions go through the existing resolve route.
 */

interface SurfaceView {
  workItems?: WorkItemView[];
  approvalGates?: ApprovalGateView[];
}

function surface(): SurfaceView {
  const value = axSurfaceState.value;
  return value && typeof value === 'object' ? (value as SurfaceView) : {};
}

export const sessionWorkItems = computed<WorkItemView[]>(() => surface().workItems ?? []);
export const sessionGates = computed<ApprovalGateView[]>(() => surface().approvalGates ?? []);
export const pendingGates = computed(() => sessionGates.value.filter((gate) => gate.status === 'pending'));

export interface AxTimelineView {
  events: AxEventView[];
  evidence: AxEvidenceView[];
  steering: AxSteeringView[];
}

export const axTimeline = signal<AxTimelineView>({ events: [], evidence: [], steering: [] });

export type TimelineEntryKind = AxEventKind | 'evidence' | 'steer';

export interface TimelineEntry {
  id: string;
  kind: TimelineEntryKind;
  label: string;
  body: string;
  createdAt: string;
}

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
};

/** One reverse-chronological feed out of the three timeline tables. */
export function mergeTimeline(timeline: AxTimelineView, limit = 40): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...timeline.events.map((event) => ({
      id: `event-${event.id}`,
      kind: event.kind,
      label: EVENT_LABELS[event.kind] ?? event.kind,
      body: event.detail ? `${event.summary} — ${event.detail}` : event.summary,
      createdAt: event.createdAt,
    })),
    ...timeline.evidence.map((item) => ({
      id: `evidence-${item.id}`,
      kind: 'evidence' as const,
      label: 'Evidence',
      body: item.body ? `${item.title} — ${item.body}` : item.title,
      createdAt: item.createdAt,
    })),
    ...timeline.steering.map((steer) => ({
      id: `steer-${steer.id}`,
      kind: 'steer' as const,
      label: 'Steer',
      body: steer.message,
      createdAt: steer.createdAt,
    })),
  ];
  entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return entries.slice(0, limit);
}

export const timelineEntries = computed(() => mergeTimeline(axTimeline.value));

export async function refreshTimeline(): Promise<void> {
  try {
    const response = await fetch('/api/canvas/ax/timeline?limit=40', { headers: { 'x-pmx-workbench': '1' } });
    if (!response.ok) return;
    const data = (await response.json()) as Partial<AxTimelineView>;
    axTimeline.value = {
      events: Array.isArray(data.events) ? data.events : [],
      evidence: Array.isArray(data.evidence) ? data.evidence : [],
      steering: Array.isArray(data.steering) ? data.steering : [],
    };
  } catch (error) {
    console.error('[session-store] refreshTimeline failed', error);
  }
}

/**
 * Resolve a gate through the existing AX path. A rejection also posts steering
 * feedback so the agent learns WHY its next turn — the same `vetoGhostSteering`
 * contract ghost vetoes use.
 */
export async function resolveGate(gate: ApprovalGateView, decision: 'approved' | 'rejected'): Promise<boolean> {
  try {
    const response = await fetch(`/api/canvas/ax/approval/${encodeURIComponent(gate.id)}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pmx-workbench': '1' },
      body: JSON.stringify({ decision, source: 'browser' }),
    });
    if (!response.ok) return false;
    if (decision === 'rejected') {
      await fetch('/api/canvas/ax/steer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-pmx-workbench': '1' },
        body: JSON.stringify({ message: `Rejected gate "${gate.title}" — do not proceed with it.`, source: 'browser' }),
      }).catch(() => {});
    }
    return true;
  } catch (error) {
    console.error('[session-store] resolveGate failed', error);
    return false;
  }
}

export function resetSessionStore(): void {
  axTimeline.value = { events: [], evidence: [], steering: [] };
}
