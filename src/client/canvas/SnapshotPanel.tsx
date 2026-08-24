import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  type CanvasSnapshotInfo,
  deleteSnapshot,
  listSnapshots,
  requestJson,
  restoreSnapshot,
  saveSnapshot,
} from '../state/intent-bridge';
import { type DiffSummary, summarizeDiff } from './SessionReceipt';

/**
 * History drawer (rail-chrome-v2 phase 7, design item 8): snapshots and
 * session receipts in one reverse-chronological list. A session's entry IS
 * the snapshot the server took when it attached ("Before session · <label> ·
 * HH:MM"), so the two histories are one timeline: session entries carry View
 * diff (the session's own changes) and Restore pre-state; manual snapshots
 * keep Restore / Delete. Opened from the rail's Snapshots button or the
 * receipt's Full log. The root keeps the `.snapshot-panel` hook.
 */

const SESSION_PREFIX = 'Before session · ';

function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** "Before session · Copilot · 14:00" → "Copilot". */
function sessionLabel(name: string): string | null {
  if (!name.startsWith(SESSION_PREFIX)) return null;
  const rest = name.slice(SESSION_PREFIX.length);
  const cut = rest.lastIndexOf(' · ');
  return cut > 0 ? rest.slice(0, cut) : rest;
}

export function SnapshotPanel({
  open,
  onClose,
  anchorRef,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: { current: HTMLButtonElement | null };
}) {
  const [snapshots, setSnapshots] = useState<CanvasSnapshotInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [confirming, setConfirming] = useState<{ id: string; action: 'restore' | 'delete' } | null>(null);
  const [diffs, setDiffs] = useState<Record<string, DiffSummary | 'loading'>>({});
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listSnapshots().then((list) => {
      setSnapshots(list);
      setLoading(false);
    });
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const panel = panelRef.current;
      const anchor = anchorRef.current;
      if (panel && !panel.contains(e.target as Node) && anchor && !anchor.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleSave = useCallback(async () => {
    const name = nameInput.trim();
    if (!name) return;
    setSaving(true);
    const result = await saveSnapshot(name);
    setSaving(false);
    if (result.ok && result.snapshot) {
      setSnapshots((prev) => [result.snapshot!, ...prev]);
      setNameInput('');
    }
  }, [nameInput]);

  const handleRestore = useCallback(
    async (id: string) => {
      setConfirming(null);
      setRestoringId(id);
      const result = await restoreSnapshot(id);
      setRestoringId(null);
      if (result.ok) onClose();
    },
    [onClose],
  );

  const handleDelete = useCallback(async (id: string) => {
    const result = await deleteSnapshot(id);
    if (result.ok) setSnapshots((prev) => prev.filter((s) => s.id !== id));
    setConfirming(null);
  }, []);

  const viewDiff = useCallback(async (id: string) => {
    setDiffs((prev) => ({ ...prev, [id]: 'loading' }));
    const body = await requestJson<{ diff?: unknown }>(
      'snapshotDiff',
      `/api/canvas/snapshots/${encodeURIComponent(id)}/diff`,
      {},
    );
    setDiffs((prev) => ({ ...prev, [id]: summarizeDiff(body.diff) ?? { added: 0, removed: 0, modified: 0 } }));
  }, []);

  if (!open) return null;

  const actions = (snap: CanvasSnapshotInfo, restoreLabel: string) =>
    confirming?.id === snap.id ? (
      <>
        <button
          type="button"
          class={`snapshot-action-btn ${confirming.action === 'delete' ? 'snapshot-action-confirm' : 'snapshot-action-restore'}`}
          onClick={() => (confirming.action === 'delete' ? handleDelete(snap.id) : handleRestore(snap.id))}
          title={confirming.action === 'delete' ? 'Confirm delete' : 'Confirm restore'}
          disabled={restoringId !== null}
        >
          {confirming.action === 'delete' ? 'Delete' : restoringId === snap.id ? 'Restoring…' : 'Confirm'}
        </button>
        <button
          type="button"
          class="snapshot-action-btn"
          onClick={() => setConfirming(null)}
          title="Cancel"
          disabled={restoringId !== null}
        >
          Cancel
        </button>
      </>
    ) : (
      <>
        <button
          type="button"
          class="snapshot-action-btn snapshot-action-restore"
          onClick={() => setConfirming({ id: snap.id, action: 'restore' })}
          title="Restore this snapshot — replaces the current canvas (undoable)"
          disabled={restoringId !== null}
        >
          {restoringId === snap.id ? 'Restoring…' : restoreLabel}
        </button>
        <button
          type="button"
          class="snapshot-action-btn snapshot-action-delete"
          onClick={() => setConfirming({ id: snap.id, action: 'delete' })}
          title="Delete this snapshot"
          aria-label="Delete snapshot"
          disabled={restoringId !== null}
        >
          ✕
        </button>
      </>
    );

  return (
    <div ref={panelRef} class="snapshot-panel" data-testid="history-drawer" role="dialog" aria-label="History">
      <div class="snapshot-panel-header">
        <span class="snapshot-panel-title">History</span>
        <span class="snapshot-panel-sub">snapshots + sessions</span>
        <span class="snapshot-panel-spacer" />
        <button type="button" class="snapshot-panel-close" onClick={onClose} title="Close" aria-label="Close history">
          ×
        </button>
      </div>

      <div class="snapshot-save-form">
        <input
          ref={inputRef}
          type="text"
          class="snapshot-name-input"
          value={nameInput}
          onInput={(e) => setNameInput((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
          }}
          placeholder="Save a snapshot as…"
          aria-label="Snapshot name"
          maxLength={80}
          disabled={saving}
        />
        <button type="button" class="snapshot-save-btn" onClick={handleSave} disabled={!nameInput.trim() || saving}>
          {saving ? '…' : 'Save'}
        </button>
      </div>
      <div class="snapshot-restore-note">Restoring replaces the current canvas. You can undo it if needed.</div>

      <div class="snapshot-list">
        {loading && <div class="snapshot-empty">Loading…</div>}
        {!loading && snapshots.length === 0 && (
          <div class="snapshot-empty">
            No history yet. Save a snapshot, or start an agent session — it snapshots for you.
          </div>
        )}
        {/* Boards the human saved on purpose come first; the automatic
            pre-session snapshots live under their own header — mixing them
            buried the deliberate saves under session churn. */}
        {!loading &&
          [
            ...snapshots.filter((snap) => sessionLabel(snap.name) === null),
            ...(snapshots.some((snap) => sessionLabel(snap.name) !== null)
              ? [{ id: '__sessions-header__' } as (typeof snapshots)[number]]
              : []),
            ...snapshots.filter((snap) => sessionLabel(snap.name) !== null),
          ].map((snap) => {
            if (snap.id === '__sessions-header__') {
              return (
                <div key={snap.id} class="snapshot-section-header" data-testid="history-sessions-header">
                  Sessions
                </div>
              );
            }
            const label = sessionLabel(snap.name);
            const diff = diffs[snap.id];
            if (label !== null) {
              return (
                <div key={snap.id} class="snapshot-item is-session" data-testid="history-session">
                  <div class="snapshot-item-head">
                    <span class="snapshot-session-dot" aria-hidden="true" />
                    <span class="snapshot-item-name">Agent session — {label}</span>
                    <span class="snapshot-item-time">{timeLabel(snap.createdAt)}</span>
                  </div>
                  <div class="snapshot-item-meta">
                    snapshot at session start · {snap.nodeCount} node{snap.nodeCount !== 1 ? 's' : ''}
                    {diff && diff !== 'loading' && (
                      <span class="snapshot-item-diff">
                        {' '}
                        · since: {diff.added} added · {diff.removed} removed · {diff.modified} modified
                      </span>
                    )}
                  </div>
                  <div class="snapshot-item-actions is-session">
                    <button
                      type="button"
                      class="snapshot-action-btn snapshot-action-diff"
                      disabled={diff === 'loading'}
                      onClick={() => void viewDiff(snap.id)}
                    >
                      {diff === 'loading' ? 'Comparing…' : 'View diff'}
                    </button>
                    {actions(snap, 'Restore pre-state')}
                  </div>
                </div>
              );
            }
            return (
              <div key={snap.id} class="snapshot-item" data-testid="history-snapshot">
                <div class="snapshot-item-head">
                  <span class="snapshot-item-glyph" aria-hidden="true">
                    ◫
                  </span>
                  <span class="snapshot-item-name">{snap.name}</span>
                  <span class="snapshot-item-time">{timeLabel(snap.createdAt)}</span>
                </div>
                <div class="snapshot-item-meta">
                  {snap.nodeCount} node{snap.nodeCount !== 1 ? 's' : ''}
                  {snap.edgeCount > 0 ? ` · ${snap.edgeCount} edge${snap.edgeCount !== 1 ? 's' : ''}` : ''}
                  {' · '}
                  {timeAgo(snap.createdAt)}
                </div>
                <div class="snapshot-item-actions">{actions(snap, 'Restore')}</div>
              </div>
            );
          })}
      </div>
      <div class="snapshot-panel-foot">Every agent session start writes a snapshot automatically.</div>
    </div>
  );
}
