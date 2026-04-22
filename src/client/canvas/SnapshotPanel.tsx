import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  listSnapshots,
  saveSnapshot,
  restoreSnapshot,
  deleteSnapshot,
  type CanvasSnapshotInfo,
} from '../state/intent-bridge';

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
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load snapshots when panel opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listSnapshots().then((list) => {
      setSnapshots(list);
      setLoading(false);
    });
  }, [open]);

  // Focus input on open
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

  // Escape to close
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

  const handleRestore = useCallback(async (id: string) => {
    setConfirming(null);
    setRestoringId(id);
    const result = await restoreSnapshot(id);
    setRestoringId(null);
    if (result.ok) onClose();
  }, [onClose]);

  const handleDelete = useCallback(async (id: string) => {
    const result = await deleteSnapshot(id);
    if (result.ok) {
      setSnapshots((prev) => prev.filter((s) => s.id !== id));
    }
    setConfirming(null);
  }, []);

  if (!open) return null;

  // Position below toolbar button
  const anchorRect = anchorRef.current?.getBoundingClientRect();
  const left = anchorRect ? Math.max(8, anchorRect.left - 120) : 100;
  const top = anchorRect ? anchorRect.bottom + 8 : 48;

  return (
    <div
      ref={panelRef}
      class="snapshot-panel"
      style={{ left: `${left}px`, top: `${top}px` }}
    >
      {/* Header */}
      <div class="snapshot-panel-header">
        <span class="snapshot-panel-title">Snapshots</span>
        <button
          type="button"
          class="snapshot-panel-close"
          onClick={onClose}
          title="Close"
        >
          {'\u00d7'}
        </button>
      </div>

      {/* Save form */}
      <div class="snapshot-save-form">
        <input
          ref={inputRef}
          type="text"
          class="snapshot-name-input"
          value={nameInput}
          onInput={(e) => setNameInput((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
          placeholder="Snapshot name..."
          maxLength={80}
          disabled={saving}
        />
        <button
          type="button"
          class="snapshot-save-btn"
          onClick={handleSave}
          disabled={!nameInput.trim() || saving}
        >
          {saving ? '...' : 'Save'}
        </button>
      </div>

      <div class="snapshot-restore-note">
        Restoring replaces the current canvas. You can undo it if needed.
      </div>

      {/* Snapshot list */}
      <div class="snapshot-list">
        {loading && (
          <div class="snapshot-empty">Loading...</div>
        )}

        {!loading && snapshots.length === 0 && (
          <div class="snapshot-empty">
            No snapshots yet. Save one to capture the current canvas state.
          </div>
        )}

        {!loading && snapshots.map((snap) => (
          <div key={snap.id} class="snapshot-item">
            <div class="snapshot-item-info">
              <span class="snapshot-item-name">{snap.name}</span>
              <span class="snapshot-item-meta">
                {snap.nodeCount} node{snap.nodeCount !== 1 ? 's' : ''}
                {snap.edgeCount > 0 ? ` \u00b7 ${snap.edgeCount} edge${snap.edgeCount !== 1 ? 's' : ''}` : ''}
                {' \u00b7 '}
                {timeAgo(snap.createdAt)}
              </span>
            </div>
            <div class="snapshot-item-actions">
              {confirming?.id === snap.id ? (
                <>
                  <button
                    type="button"
                    class={`snapshot-action-btn ${confirming.action === 'delete' ? 'snapshot-action-confirm' : 'snapshot-action-restore'}`}
                    onClick={() => confirming.action === 'delete' ? handleDelete(snap.id) : handleRestore(snap.id)}
                    title={confirming.action === 'delete' ? 'Confirm delete' : 'Confirm restore'}
                    disabled={restoringId !== null}
                  >
                    {confirming.action === 'delete'
                      ? 'Delete'
                      : restoringId === snap.id
                        ? 'Restoring...'
                        : 'Confirm'}
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
                    title="Restore this snapshot"
                    disabled={restoringId !== null}
                  >
                    {restoringId === snap.id ? 'Restoring...' : 'Restore'}
                  </button>
                  <button
                    type="button"
                    class="snapshot-action-btn snapshot-action-delete"
                    onClick={() => setConfirming({ id: snap.id, action: 'delete' })}
                    title="Delete this snapshot"
                    disabled={restoringId !== null}
                  >
                    {'\u2715'}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
