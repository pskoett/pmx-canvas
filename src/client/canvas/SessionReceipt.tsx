import { useState } from 'preact/hooks';
import { dismissSessionReceipt, sessionReceipt } from '../state/session-store';

/**
 * Session receipt (rail-chrome-v2 phase 5, design item 2): a dismissible card
 * at the canvas region's top-right after a session ends — what the session did
 * (items / done / vetoed), the pre-session snapshot (taken at attach, so View
 * diff shows the session's changes and a restore undoes them), and History
 * (the snapshots panel). Client-side state, cleared on dismiss.
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

export function SessionReceipt({ onOpenSnapshots }: { onOpenSnapshots: () => void }) {
  const receipt = sessionReceipt.value;
  const [diff, setDiff] = useState<DiffSummary | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  if (!receipt) return null;

  const viewDiff = async () => {
    if (!receipt.snapshot) return;
    setLoadingDiff(true);
    try {
      const response = await fetch(`/api/canvas/snapshots/${encodeURIComponent(receipt.snapshot.id)}/diff`, {
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
          {receipt.endedBy === 'human'
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
          ×
        </button>
      </div>
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
      <div class="session-receipt-note">
        {receipt.snapshot
          ? 'A snapshot of the board from before this session is saved — restore it to undo the session.'
          : receipt.unchanged
            ? 'This session changed nothing on the board — no snapshot kept.'
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
