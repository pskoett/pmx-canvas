import { useEffect, useRef } from 'preact/hooks';
import type { AgentPresence } from '../../shared/agent-presence.js';
import { vetoGhostIntent } from '../state/intent-bridge';
import { type ClientIntent, intents, removeIntent } from '../state/intent-store';
import {
  activityFeedOpen,
  activityFilter,
  agentActivity,
  agentPresences,
  externalWriterPresences,
  relativeAge,
  sessionActive,
  writerColor,
  writerInitial,
  writersSheetOpen,
} from '../state/presence-store';
import { scopeFence, pendingGates, startSession } from '../state/session-store';
import { sessionId } from '../state/canvas-store';
import { useFocusTrap } from './use-focus-trap';
import { useNow } from './use-now';

/**
 * External Steering surfaces (rail-chrome-v2 phase 6, design items 1, 9, 17):
 * an external agent writes to the board with NO session attached. The chrome
 * stays quiet; the only additions are a passive top-bar indicator (writers +
 * op count), a click-to-open activity feed with per-writer filters and inline
 * Veto on pending intents, and a connected-writers sheet that is pure
 * visibility — pmx-canvas is local-first, veto/ghosting is the safety model,
 * not permissions. Every surface here mounts only while external writers are
 * live and no session is attached.
 */

function Avatar({ presence, size = 18 }: { presence: Pick<AgentPresence, 'sessionId' | 'label'>; size?: number }) {
  return (
    <span
      class="writer-avatar"
      style={{ background: writerColor(presence.sessionId), width: `${size}px`, height: `${size}px` }}
      aria-hidden="true"
    >
      {writerInitial(presence.label)}
    </span>
  );
}

/** Top-bar indicator: avatar cluster, "3 writers", op count, pulsing dot. */
export function ExternalWriterIndicator() {
  const writers = externalWriterPresences.value;
  if (sessionActive.value || writers.length === 0) return null;
  const ops = writers.reduce((sum, writer) => sum + writer.opCount, 0);
  const label = writers.length === 1 ? writers[0]!.label : `${writers.length} writers`;
  const open = activityFeedOpen.value;
  return (
    <button
      type="button"
      class="external-indicator"
      data-testid="external-indicator"
      aria-expanded={open}
      title={`${writers.length} external writer${writers.length === 1 ? '' : 's'} on this board — click for activity`}
      onClick={() => {
        activityFeedOpen.value = !open;
      }}
    >
      <span class="external-indicator-avatars">
        {writers.slice(0, 3).map((writer) => (
          <Avatar key={writer.sessionId} presence={writer} />
        ))}
      </span>
      <span class="external-indicator-label">{label}</span>
      <span class="external-indicator-ops hud-collapsible-text">
        {ops} op{ops === 1 ? '' : 's'}
      </span>
      <span class="external-indicator-dot" aria-hidden="true" />
    </button>
  );
}

function opGlyph(op: string): { glyph: string; tone: string } {
  if (op === 'node.add' || op === 'jsonrender.add' || op === 'graph.add' || op === 'group.create') {
    return { glyph: '+', tone: 'ok' };
  }
  if (op === 'node.remove' || op === 'edge.remove' || op === 'canvas.clear') return { glyph: '×', tone: 'danger' };
  if (op === 'edge.add') return { glyph: '⟶', tone: 'accent' };
  if (op.startsWith('ax.')) return { glyph: '◆', tone: 'purple' };
  return { glyph: '✎', tone: 'accent' };
}

/** Pending explicit intents from external writers — the rows that carry an inline Veto. */
function pendingProposals(): ClientIntent[] {
  return [...intents.value.values()].filter((intent) => !intent.auto && intent.phase === 'forming');
}

export function ActivityFeed() {
  const open = activityFeedOpen.value;
  const writers = externalWriterPresences.value;
  const now = useNow(open ? 10_000 : 0);
  // Esc closes the top-most surface: the sheet first, then the feed.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (writersSheetOpen.value) writersSheetOpen.value = false;
      else activityFeedOpen.value = false;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open || sessionActive.value || writers.length === 0) return null;

  const filter = activityFilter.value;
  const proposals = pendingProposals().filter((intent) => !filter || (intent.source ?? '') === filter);
  const rows = agentActivity.value.filter((entry) => !filter || entry.sessionId === filter);
  const filterChip = (id: string | null, label: string) => (
    <button
      type="button"
      class={`activity-filter${filter === id ? ' is-active' : ''}`}
      style={id ? { '--writer': writerColor(id) } : undefined}
      aria-pressed={filter === id}
      onClick={() => {
        activityFilter.value = id;
      }}
    >
      {label}
    </button>
  );

  return (
    <div class="activity-feed" data-testid="activity-feed" role="dialog" aria-label="External activity">
      <div class="activity-feed-head">
        <span class="external-indicator-dot" aria-hidden="true" />
        <div class="activity-feed-titles">
          <div class="activity-feed-title">
            External activity — {writers.length} writer{writers.length === 1 ? '' : 's'}
          </div>
          <div class="activity-feed-sub">via MCP · no session attached</div>
        </div>
        <button
          type="button"
          class="activity-feed-close"
          aria-label="Close activity feed"
          onClick={() => {
            activityFeedOpen.value = false;
          }}
        >
          ×
        </button>
      </div>
      <div class="activity-filters">
        {filterChip(null, 'All')}
        {writers.map((writer) => filterChip(writer.sessionId, writer.label))}
      </div>
      <div class="activity-rows">
        {proposals.map((intent) => (
          <div key={intent.id} class="activity-row is-pending" data-testid="activity-proposal">
            <span class="activity-glyph tone-purple" aria-hidden="true">
              ▢
            </span>
            <div class="activity-main">
              <div class="activity-text">
                Proposing: <b>{intent.label?.trim() || `${intent.kind} intent`}</b>
              </div>
              <div class="activity-meta">
                {intent.reason?.trim() || 'Intent signalled — a real veto window before the mutation'}
                {intent.source ? ` · ${intent.source}` : ''}
              </div>
              <div class="activity-actions">
                <button
                  type="button"
                  class="activity-veto"
                  onClick={() => {
                    void vetoGhostIntent(intent).then((ok) => {
                      if (ok) removeIntent(intent.id);
                    });
                  }}
                >
                  Veto
                </button>
                <span class="activity-hint">or hover ghost + Esc</span>
              </div>
            </div>
            <span class="activity-age">now</span>
          </div>
        ))}
        {rows.length === 0 && proposals.length === 0 && <div class="activity-empty">No writes yet.</div>}
        {rows.map((entry) => {
          const { glyph, tone } = opGlyph(entry.op);
          return (
            <div key={entry.id} class="activity-row" data-testid="activity-row" data-op={entry.op}>
              <span class={`activity-glyph tone-${tone}`} aria-hidden="true">
                {glyph}
              </span>
              <div class="activity-main">
                <div class="activity-text">{entry.summary}</div>
                <div class="activity-writer" style={{ color: writerColor(entry.sessionId) }}>
                  {entry.label}
                </div>
              </div>
              <span class="activity-age">{relativeAge(entry.at, now)}</span>
            </div>
          );
        })}
      </div>
      <div class="activity-feed-foot">
        <span class="activity-feed-note">All writes ghost first · Esc vetoes</span>
        <button
          type="button"
          class="activity-feed-link"
          onClick={() => {
            writersSheetOpen.value = true;
          }}
        >
          Writers
        </button>
        <button
          type="button"
          class="activity-feed-link is-accent"
          onClick={() => {
            activityFeedOpen.value = false;
            void startSession();
          }}
        >
          Start session ↗
        </button>
      </div>
    </div>
  );
}

function sessionConfig(): string {
  const parts: string[] = [];
  if (scopeFence.value) parts.push('scoped');
  if (pendingGates.value.length > 0) parts.push('gated');
  return parts.length > 0 ? parts.join(' + ') : 'open';
}

/** Connected writers — pure visibility, no permissions. */
export function WritersSheet() {
  const open = writersSheetOpen.value;
  const now = useNow(open ? 10_000 : 0);
  const sheetRef = useRef<HTMLDivElement>(null);
  useFocusTrap(sheetRef, open);
  if (!open) return null;
  const sessions = agentPresences.value.filter((presence) => presence.attached);
  const external = agentPresences.value.filter((presence) => !presence.attached);
  const close = () => {
    writersSheetOpen.value = false;
  };
  return (
    <>
      <div class="writers-scrim" onClick={close} aria-hidden="true" />
      <div
        ref={sheetRef}
        class="writers-sheet"
        data-testid="writers-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Connected writers"
      >
        <div class="writers-head">
          <span class="writers-title">Connected writers</span>
          <span class="writers-board">{sessionId.value.slice(0, 12)}</span>
          <button type="button" class="activity-feed-close" aria-label="Close writers" onClick={close}>
            ×
          </button>
        </div>
        <div class="writers-body">
          <div class="writers-section">Agent sessions</div>
          {sessions.length === 0 && <div class="writers-empty">None attached — start one from the top bar.</div>}
          {sessions.map((presence) => (
            <div key={presence.sessionId} class="writers-row">
              <Avatar presence={presence} size={20} />
              <span class="writers-name">{presence.label}</span>
              <span class="writers-config">{sessionConfig()}</span>
            </div>
          ))}
          <div class="writers-section">External writers · MCP</div>
          {external.length === 0 && <div class="writers-empty">No external writers right now.</div>}
          {external.map((presence) => (
            <div key={presence.sessionId} class="writers-row">
              <Avatar presence={presence} size={20} />
              <span class="writers-name is-mono">{presence.label}</span>
              <span class="writers-meta">
                {presence.source !== presence.label ? `${presence.source} · ` : ''}wrote{' '}
                {relativeAge(presence.lastSeenAt, now)} ago
              </span>
            </div>
          ))}
        </div>
        <div class="writers-foot">
          <span class="writers-note">
            Local-first: any process on this machine can connect and write. Every write ghosts first — veto is the
            control, not permissions.
          </span>
          <button type="button" class="writers-done" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </>
  );
}
