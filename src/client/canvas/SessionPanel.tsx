import { useEffect, useState } from 'preact/hooks';
import { agentPhaseLabel } from '../../shared/agent-presence.js';
import { focusNode } from '../state/canvas-store';
import { activeSession } from '../state/presence-store';
import {
  type ApprovalGateView,
  pendingGates,
  refreshTimeline,
  resolveGate,
  sessionWorkItems,
  type TimelineEntry,
  type TimelineEntryKind,
  timelineEntries,
  type WorkItemStatus,
  type WorkItemView,
} from '../state/session-store';

/**
 * Session panel (rail-chrome-v2 phase 4): the attached agent's work items,
 * approval gates, and timeline — the human's supervisory surface. Mounted
 * only while a session is attached (App gates it on sessionActive). Panel and
 * canvas are one system: a gate resolved here resolves the same AX gate the
 * on-canvas node controls see.
 */

/** Design status glyphs: queued · running · awaiting · done · vetoed. */
const WORK_GLYPH: Record<WorkItemStatus, 'queued' | 'running' | 'awaiting' | 'done' | 'vetoed'> = {
  todo: 'queued',
  'in-progress': 'running',
  blocked: 'awaiting',
  done: 'done',
  cancelled: 'vetoed',
};

const TIMELINE_TONE: Record<TimelineEntryKind, string> = {
  prompt: 'accent',
  'assistant-message': 'muted',
  'tool-start': 'accent',
  'tool-result': 'ok',
  failure: 'danger',
  approval: 'warn',
  steering: 'purple',
  command: 'accent',
  note: 'muted',
  evidence: 'ok',
  steer: 'purple',
};

function clock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function WorkItemRow({ item }: { item: WorkItemView }) {
  const glyph = WORK_GLYPH[item.status] ?? 'queued';
  const nodeId = item.nodeIds[0];
  return (
    <li class={`session-item status-${glyph}`} data-work-item-id={item.id}>
      <span class="session-glyph" aria-hidden="true" />
      <div class="session-item-main">
        <button
          type="button"
          class="session-item-title"
          title={nodeId ? 'Focus the linked node' : undefined}
          disabled={!nodeId}
          onClick={() => nodeId && focusNode(nodeId)}
        >
          {item.title}
        </button>
        {item.detail && <div class="session-item-detail">{item.detail}</div>}
      </div>
      <span class="session-item-status">{glyph}</span>
      <span class="session-item-time">{clock(item.updatedAt)}</span>
    </li>
  );
}

function GateRow({ gate }: { gate: ApprovalGateView }) {
  const [busy, setBusy] = useState<'approved' | 'rejected' | null>(null);
  const decide = async (decision: 'approved' | 'rejected') => {
    setBusy(decision);
    await resolveGate(gate, decision);
    setBusy(null);
  };
  const nodeId = gate.nodeIds[0];
  return (
    <li class="session-item status-awaiting session-gate" data-gate-id={gate.id}>
      <span class="session-glyph" aria-hidden="true" />
      <div class="session-item-main">
        <button
          type="button"
          class="session-item-title"
          title={nodeId ? 'Focus the linked node' : undefined}
          disabled={!nodeId}
          onClick={() => nodeId && focusNode(nodeId)}
        >
          {gate.title}
        </button>
        {gate.detail && <div class="session-item-detail">{gate.detail}</div>}
        <div class="session-gate-actions">
          <button
            type="button"
            class="session-gate-approve"
            disabled={busy !== null}
            onClick={() => void decide('approved')}
          >
            {busy === 'approved' ? 'Approving…' : 'Approve'}
          </button>
          <button
            type="button"
            class="session-gate-reject"
            disabled={busy !== null}
            onClick={() => void decide('rejected')}
          >
            {busy === 'rejected' ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      </div>
      <span class="session-item-time">{clock(gate.createdAt)}</span>
    </li>
  );
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  return (
    <li class={`session-timeline-row tone-${TIMELINE_TONE[entry.kind] ?? 'muted'}`}>
      <span class="session-timeline-dot" aria-hidden="true" />
      <div class="session-timeline-main">
        <div class="session-timeline-head">
          <span class="session-timeline-label">{entry.label}</span>
          <span class="session-item-time">{clock(entry.createdAt)}</span>
        </div>
        <div class="session-timeline-body">{entry.body}</div>
      </div>
    </li>
  );
}

export function SessionPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const session = activeSession.value;
  const items = sessionWorkItems.value;
  const gates = pendingGates.value;
  const entries = timelineEntries.value;

  // The timeline is read on mount; the SSE bridge refreshes it on every
  // ax-event-created while a session is attached.
  useEffect(() => {
    void refreshTimeline();
  }, []);

  if (collapsed) {
    return (
      <aside class="session-panel is-collapsed" aria-label="Session (collapsed)">
        <button type="button" class="session-collapse" onClick={() => setCollapsed(false)} title="Expand session panel">
          ‹
        </button>
        <span class="session-collapsed-label">Session</span>
      </aside>
    );
  }

  return (
    <aside class="session-panel" aria-label="Session" aria-live="polite">
      <header class="session-panel-header">
        <span class="session-panel-title">Session</span>
        {session && (
          <span class={`session-live phase-${session.phase}`} title={agentPhaseLabel(session)}>
            <span class="session-live-dot" aria-hidden="true" />
            live
          </span>
        )}
        <span class="top-bar-spacer" />
        <button
          type="button"
          class="session-collapse"
          onClick={() => setCollapsed(true)}
          title="Collapse session panel"
        >
          ›
        </button>
      </header>

      <div class="session-panel-body">
        <section class="session-section">
          <h3 class="session-section-title">Work items</h3>
          {gates.length === 0 && items.length === 0 ? (
            <div class="session-empty">No work items yet — the agent's tasks and gates appear here.</div>
          ) : (
            <ul class="session-list">
              {gates.map((gate) => (
                <GateRow key={gate.id} gate={gate} />
              ))}
              {items.map((item) => (
                <WorkItemRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </section>

        <section class="session-section">
          <h3 class="session-section-title">Timeline</h3>
          {entries.length === 0 ? (
            <div class="session-empty">Nothing recorded yet.</div>
          ) : (
            <ul class="session-list session-timeline">
              {entries.map((entry) => (
                <TimelineRow key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}
