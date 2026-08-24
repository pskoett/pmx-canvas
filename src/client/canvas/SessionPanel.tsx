import { useEffect, useState } from 'preact/hooks';
import { useNow } from './use-now';
import { agentPhaseLabel } from '../../shared/agent-presence.js';
import { formatCountdown, gateRemainingMs } from '../../shared/approval-gates.js';
import { focusNode, selectedNodeIds } from '../state/canvas-store';
import { activeSession } from '../state/presence-store';
import {
  type ApprovalGateView,
  endSession,
  heldGates,
  pendingGates,
  refreshTimeline,
  reopenGate,
  resolveGate,
  scopeFence,
  setScopeFence,
  sessionWorkItems,
  type TimelineEntry,
  type TimelineEntryKind,
  type TimelineFilter,
  timelineEntries,
  timelineFilter,
  undoAgentEdit,
  undoneActivityIds,
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

const TIMELINE_FILTERS: Array<{ id: TimelineFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'update', label: 'Updates' },
  { id: 'steer', label: 'Steer' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'event', label: 'Events' },
  { id: 'evidence', label: 'Evidence' },
];

const TIMELINE_TONE: Record<TimelineEntryKind, string> = {
  policy: 'warn',
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
  update: 'purple',
  yield: 'warn',
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

function GateRow({ gate, now }: { gate: ApprovalGateView; now: number }) {
  const [busy, setBusy] = useState<'approved' | 'rejected' | null>(null);
  const decide = async (decision: 'approved' | 'rejected') => {
    setBusy(decision);
    await resolveGate(gate, decision);
    setBusy(null);
  };
  const nodeId = gate.nodeIds[0];
  const remaining = gateRemainingMs(gate, now);
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
        {remaining !== null && (
          <div class="session-gate-ttl" data-testid="gate-countdown">
            auto-holds in {formatCountdown(remaining)} if unanswered
          </div>
        )}
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

function HeldGateRow({ gate }: { gate: ApprovalGateView }) {
  const [busy, setBusy] = useState(false);
  return (
    <li class="session-item status-vetoed session-gate-held" data-gate-id={gate.id}>
      <span class="session-glyph" aria-hidden="true" />
      <div class="session-item-main">
        <span class="session-item-title">{gate.title}</span>
        <div class="session-item-detail">Auto-held — no answer in time, the action did not proceed.</div>
        <div class="session-gate-actions">
          <button
            type="button"
            class="session-gate-reject"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void reopenGate(gate).finally(() => setBusy(false));
            }}
          >
            {busy ? 'Reopening…' : 'Reopen'}
          </button>
        </div>
      </div>
      <span class="session-item-status">held</span>
    </li>
  );
}

/**
 * Scope row under the header: the fence the human granted, or the affordance
 * to grant one from the current selection. The server refuses agent writes
 * outside it; reads stay open.
 */
function ScopeRow() {
  const fence = scopeFence.value;
  const selected = selectedNodeIds.value.size;
  const [busy, setBusy] = useState(false);
  const apply = (nodeIds: string[] | null) => {
    setBusy(true);
    void setScopeFence(nodeIds).finally(() => setBusy(false));
  };
  return (
    <div class={`session-scope${fence ? ' is-fenced' : ''}`} data-testid="session-scope">
      <span class="session-scope-dot" aria-hidden="true" />
      {fence ? (
        <>
          <span class="session-scope-text">
            Scoped to <strong>{fence.nodeIds.length}</strong> node{fence.nodeIds.length === 1 ? '' : 's'} · writes
            outside are blocked
          </span>
          <button type="button" class="session-scope-action" disabled={busy} onClick={() => apply(null)}>
            Clear
          </button>
        </>
      ) : (
        <>
          <span class="session-scope-text">Unscoped — the agent may write anywhere</span>
          <button
            type="button"
            class="session-scope-action"
            disabled={busy || selected === 0}
            title={selected === 0 ? 'Select nodes on the canvas first' : 'Fence the agent to the selected nodes'}
            onClick={() => apply([...selectedNodeIds.value])}
          >
            Fence to selection{selected > 0 ? ` (${selected})` : ''}
          </button>
        </>
      )}
    </div>
  );
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const undone = undoneActivityIds.value.has(entry.id);
  return (
    <li class={`session-timeline-row tone-${TIMELINE_TONE[entry.kind] ?? 'muted'}`}>
      <span class="session-timeline-dot" aria-hidden="true" />
      <div class="session-timeline-main">
        <div class="session-timeline-head">
          <span class="session-timeline-label">{entry.label}</span>
          <span class="session-item-time">{clock(entry.createdAt)}</span>
        </div>
        <div class="session-timeline-body">{entry.body}</div>
        {/* Item 10: one shared undo stack — the agent's latest edit can be
            undone from here; the agent hears about it as steering. */}
        {entry.undoable && !undone && (
          <button
            type="button"
            class="session-timeline-undo"
            data-testid="timeline-undo"
            onClick={() => void undoAgentEdit(entry)}
          >
            ↩ undo this edit
          </button>
        )}
        {undone && <div class="session-timeline-undone">undone · steering sent</div>}
      </div>
    </li>
  );
}

export function SessionPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const session = activeSession.value;
  const items = sessionWorkItems.value;
  const gates = pendingGates.value;
  const held = heldGates.value;
  const entries = timelineEntries.value;
  const now = useNow();

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
    <aside class="session-panel" aria-label="Session">
      <header class="session-panel-header">
        <span class="session-panel-title">Session</span>
        {session && (
          <span class={`session-live phase-${session.phase}`} title={agentPhaseLabel(session)}>
            <span class="session-live-dot" aria-hidden="true" />
            live
          </span>
        )}
        <span class="top-bar-spacer" />
        {session && (
          <button
            type="button"
            class="session-end"
            title="End this session — a receipt and a snapshot of the board follow"
            onClick={() => void endSession(session)}
          >
            End
          </button>
        )}
        <button
          type="button"
          class="session-collapse"
          onClick={() => setCollapsed(true)}
          title="Collapse session panel"
        >
          ›
        </button>
      </header>

      <ScopeRow />

      <div class="session-panel-body">
        <section class="session-section">
          <h3 class="session-section-title">Work items</h3>
          {gates.length === 0 && held.length === 0 && items.length === 0 ? (
            <div class="session-empty">No work items yet — the agent's tasks and gates appear here.</div>
          ) : (
            <ul class="session-list" aria-live="polite" aria-label="Work items and gates">
              {gates.map((gate) => (
                <GateRow key={gate.id} gate={gate} now={now} />
              ))}
              {held.map((gate) => (
                <HeldGateRow key={gate.id} gate={gate} />
              ))}
              {items.map((item) => (
                <WorkItemRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </section>

        <section class="session-section">
          <h3 class="session-section-title">Timeline</h3>
          <div class="session-timeline-filters" role="group" aria-label="Filter timeline">
            {TIMELINE_FILTERS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                class={`activity-filter${timelineFilter.value === chip.id ? ' is-active' : ''}`}
                aria-pressed={timelineFilter.value === chip.id}
                onClick={() => {
                  timelineFilter.value = chip.id;
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>
          {entries.length === 0 ? (
            <div class="session-empty">
              {timelineFilter.value === 'all' ? 'Nothing recorded yet.' : 'Nothing of this kind yet.'}
            </div>
          ) : (
            <ul class="session-list session-timeline" aria-live="polite" aria-label="Timeline">
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
