import { useEffect, useState } from 'preact/hooks';
import { toggleContextPin } from '../state/canvas-store';
import {
  activityLensNodeIds,
  dismissSessionReceipt,
  type ReceiptNode,
  type SessionContextActivity,
  sessionReceipt,
  setActivityLens,
} from '../state/session-store';
import { IconClose, IconPin } from '../icons';
import { GLYPHS } from './NodeContextMark';
import { workbenchFetch } from '../state/workbench-transport';

/**
 * Session receipt (rail-chrome-v2 phase 5, design item 2): a dismissible card
 * at the canvas region's top-right after a session ends — what the session did
 * (items / done / vetoed), the pre-session snapshot (taken at attach, so View
 * diff shows the session's changes and a restore undoes them), and History
 * (the snapshots panel). Client-side state, cleared on dismiss (see
 * applySessionReceipt for which endings show at all and how a burst merges
 * into one card).
 */

export interface DiffSummary {
  added: number;
  removed: number;
  modified: number;
}

/** The wire shape is SnapshotDiffResult (addedNodes/removedNodes/modifiedNodes/addedEdges/removedEdges). */
export function summarizeDiff(diff: unknown): DiffSummary | null {
  if (!diff || typeof diff !== 'object') return null;
  const d = diff as Record<string, unknown>;
  const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0);
  return {
    added: count(d.addedNodes) + count(d.addedEdges),
    removed: count(d.removedNodes) + count(d.removedEdges),
    modified: count(d.modifiedNodes),
  };
}

const titles = (nodes: ReceiptNode[]) => nodes.map((node) => node.title).join(', ');

/**
 * What the session did with context (docs/design/AgentContext.dc.html): an
 * amber line for pins it read that changed since, one row per kind of touch,
 * and the lens switch that dims every node the session did not touch.
 */
function ReceiptContext({ context, label }: { context: SessionContextActivity; label: string }) {
  const rows: Array<{ key: keyof SessionContextActivity; name: string; glyph: keyof typeof GLYPHS | 'pin' }> = [
    { key: 'read', name: 'Read', glyph: 'eye' },
    { key: 'pinned', name: 'Pinned', glyph: 'pin' },
    { key: 'created', name: 'Created', glyph: 'spark' },
    { key: 'edited', name: 'Edited', glyph: 'pen' },
  ];
  const present = rows.filter((row) => context[row.key].length > 0);
  if (present.length === 0 && context.changedSinceRead.length === 0) return null;
  const lensOn = activityLensNodeIds.value !== null;
  return (
    <div class="session-receipt-context" data-testid="session-receipt-context">
      {context.changedSinceRead.length > 0 && (
        <div class="session-receipt-warn">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={GLYPHS.warn} />
          </svg>
          <span>
            {titles(context.changedSinceRead)} changed after {label} read{' '}
            {context.changedSinceRead.length === 1 ? 'it' : 'them'}.
          </span>
        </div>
      )}
      {present.map((row) => (
        <div key={row.key} class="session-receipt-context-row" data-row={row.key}>
          <div class="session-receipt-context-head">
            {row.glyph === 'pin' ? (
              <IconPin />
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={GLYPHS[row.glyph]} />
              </svg>
            )}
            <span class="session-receipt-context-name">{row.name}</span>
            <span class="session-receipt-context-count">{context[row.key].length}</span>
            {row.key === 'pinned' && (
              <button
                type="button"
                class="session-receipt-mini"
                onClick={() => {
                  for (const node of context.pinned) toggleContextPin(node.id);
                }}
              >
                Unpin
              </button>
            )}
          </div>
          <div class="session-receipt-context-items">
            {row.key === 'pinned'
              ? context.pinned.map((node) => (node.reason ? `${node.title} — “${node.reason}”` : node.title)).join('; ')
              : titles(context[row.key])}
          </div>
        </div>
      ))}
      <button
        type="button"
        role="switch"
        aria-checked={lensOn}
        class={`session-receipt-lens${lensOn ? ' is-on' : ''}`}
        onClick={() => setActivityLens(!lensOn)}
      >
        <span class="session-receipt-lens-track" aria-hidden="true">
          <span class="session-receipt-lens-knob" />
        </span>
        Dim untouched nodes
      </button>
    </div>
  );
}

export function SessionReceipt({ onOpenSnapshots }: { onOpenSnapshots: () => void }) {
  const receipt = sessionReceipt.value;
  const [diff, setDiff] = useState<DiffSummary | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  // A new or merged receipt: the old diff no longer describes it.
  useEffect(() => setDiff(null), [receipt]);
  if (!receipt) return null;

  const viewDiff = async () => {
    if (!receipt.snapshot) return;
    setLoadingDiff(true);
    try {
      const response = await workbenchFetch(`/api/canvas/snapshots/${encodeURIComponent(receipt.snapshot.id)}/diff`, {
        headers: { 'x-pmx-workbench': '1' },
      });
      if (response.ok) {
        const body = (await response.json()) as { diff?: unknown };
        setDiff(summarizeDiff(body.diff) ?? { added: 0, removed: 0, modified: 0 });
      }
    } finally {
      setLoadingDiff(false);
    }
  };

  const ended = new Date(receipt.endedAt);
  const endedLabel = Number.isNaN(ended.getTime())
    ? ''
    : `${String(ended.getHours()).padStart(2, '0')}:${String(ended.getMinutes()).padStart(2, '0')}`;

  return (
    <div class="session-receipt" data-testid="session-receipt" role="status">
      <div class="session-receipt-head">
        <span class="session-receipt-dot" aria-hidden="true" />
        <span class="session-receipt-title">
          {receipt.sessions > 1
            ? `${receipt.sessions} sessions ended`
            : receipt.endedBy === 'human'
              ? 'Session ended by you'
              : receipt.endedBy === 'idle-timeout'
                ? 'Session ended — idle timeout'
                : receipt.endedBy === 'agent'
                  ? 'Session ended by the agent'
                  : 'Session ended'}
          {endedLabel ? ` · ${endedLabel}` : ''}
        </span>
        <button
          type="button"
          class="session-receipt-close"
          onClick={dismissSessionReceipt}
          aria-label="Dismiss receipt"
        >
          <IconClose />
        </button>
      </div>
      {receipt.sessions > 1 && <div class="session-receipt-who">{receipt.labels.join(', ')}</div>}
      <div class="session-receipt-tiles">
        <div class="session-receipt-tile">
          <span class="session-receipt-tile-label">Items</span>
          <span class="session-receipt-tile-value">{receipt.counts.items}</span>
        </div>
        <div class="session-receipt-tile">
          <span class="session-receipt-tile-label">Done</span>
          <span class="session-receipt-tile-value tone-ok">{receipt.counts.done}</span>
        </div>
        {/* Three different outcomes, shown only when present — a cancelled
            duplicate is not a rejection, and neither is an unanswered gate. */}
        {receipt.counts.cancelled > 0 && (
          <div class="session-receipt-tile">
            <span class="session-receipt-tile-label">Cancelled</span>
            <span class="session-receipt-tile-value tone-muted">{receipt.counts.cancelled}</span>
          </div>
        )}
        {receipt.counts.rejected > 0 && (
          <div class="session-receipt-tile">
            <span class="session-receipt-tile-label">Rejected</span>
            <span class="session-receipt-tile-value tone-danger">{receipt.counts.rejected}</span>
          </div>
        )}
        {receipt.counts.held > 0 && (
          <div class="session-receipt-tile">
            <span class="session-receipt-tile-label">Held</span>
            <span class="session-receipt-tile-value tone-warn">{receipt.counts.held}</span>
          </div>
        )}
      </div>
      <ReceiptContext context={receipt.context} label={receipt.labels.join(', ')} />
      <div class="session-receipt-note">
        {receipt.sessions > 1
          ? 'History has each session’s diff and the snapshot from before it.'
          : receipt.snapshot
            ? 'A snapshot of the board from before this session is saved — restore it to undo the session.'
            : receipt.context.created.length === 0 && receipt.context.edited.length === 0
              ? 'The board itself did not change — nothing to restore.'
              : 'The board was empty when the session started — nothing to restore.'}
      </div>
      {diff && (
        <div class="session-receipt-diff" data-testid="session-receipt-diff">
          This session: {diff.added} added · {diff.removed} removed · {diff.modified} modified
        </div>
      )}
      <div class="session-receipt-actions">
        {/* No snapshot → no diff will ever exist for this receipt; a forever-
            disabled button is noise (the note above says why). */}
        {receipt.snapshot && (
          <button type="button" class="session-receipt-primary" disabled={loadingDiff} onClick={() => void viewDiff()}>
            {loadingDiff ? 'Comparing…' : 'View diff'}
          </button>
        )}
        <button
          type="button"
          class="session-receipt-secondary"
          title="Open the History drawer — saved boards and past sessions"
          onClick={onOpenSnapshots}
        >
          History
        </button>
      </div>
    </div>
  );
}
