import { signal } from '@preact/signals';
import { useRef, useState } from 'preact/hooks';
import type { BoardMoveInput, BoardMovePreview, BoardMoveResult } from '../../server/board-move.js';
import { activeBoardId, boardIncarnation, claimNavigation, openBoard } from '../state/boards-store';
import { nodes } from '../state/canvas-store';
import { requestJson } from '../state/intent-bridge';
import { hasUnsavedMarkdown } from '../nodes/MarkdownNode';
import { hasUnsavedPrompt } from '../nodes/PromptNode';
import { hasUnsavedWorkCard } from '../nodes/WorkCard';
import { useFocusTrap } from './use-focus-trap';
import { submitWithoutNavigation } from './submit-without-navigation';

type MoveSelection = {
  sourceBoardId: string;
  nodeIds: string[];
  requestId: string;
  incarnation: number;
  canNavigate: () => boolean;
};
const selection = signal<MoveSelection | null>(null);

export function openBoardMove(nodeIds: string[]): void {
  if (!activeBoardId.value || !nodeIds.length) return;
  selection.value = {
    sourceBoardId: activeBoardId.value,
    nodeIds: [...nodeIds],
    requestId: crypto.randomUUID(),
    incarnation: boardIncarnation,
    canNavigate: claimNavigation(),
  };
}

export function BoardMoveDialog() {
  const current = selection.value;
  return current ? <MoveForm key={current.requestId} selected={current} /> : null;
}

function MoveForm({ selected }: { selected: MoveSelection }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('New board');
  const [preview, setPreview] = useState<BoardMovePreview | null>(null);
  const [input, setInput] = useState<BoardMoveInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [refused, setRefused] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    if (selection.value === selected) selection.value = null;
  };
  const current = () =>
    selection.value === selected &&
    selected.incarnation === boardIncarnation &&
    activeBoardId.value === selected.sourceBoardId;
  useFocusTrap(dialogRef, true, { initial: nameRef, onEscape: close });

  const unsaved = (ids: string[]) =>
    ids.filter(
      (id) =>
        hasUnsavedMarkdown(selected.sourceBoardId, id) ||
        hasUnsavedWorkCard(selected.sourceBoardId, id) ||
        hasUnsavedPrompt(selected.sourceBoardId, id),
    );
  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy || refused || !name.trim()) return;
    if (!current()) return setError('The board changed. Close this dialog and select the cards again.');
    setBusy(true);
    setError('');
    if (!preview) {
      const board = await requestJson<{ ok: boolean; contentRevision: number } | null>(
        'moveRevision',
        `/api/canvas/boards/${encodeURIComponent(selected.sourceBoardId)}`,
        null,
      );
      if (!current()) {
        setBusy(false);
        return;
      }
      if (!board?.ok) {
        setError('Could not read the source board. Try again.');
        setBusy(false);
        return;
      }
      const next = {
        sourceBoardId: selected.sourceBoardId,
        nodeIds: selected.nodeIds,
        requestId: selected.requestId,
        name: name.trim(),
        expectedRevision: board.contentRevision,
      };
      const result = await requestJson<{ ok: boolean; preview?: BoardMovePreview; error?: string } | null>(
        'previewMove',
        '/api/canvas/boards/move-selection',
        null,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...next, preview: true }),
        },
      );
      if (current()) {
        if (result?.ok && result.preview) {
          setInput(next);
          setPreview(result.preview);
          if (unsaved(result.preview.nodeIds).length)
            setError('Save or clear the selected cards’ drafts before moving. Close and preview again.');
        } else setError(result?.error ?? 'Could not preview the move. Try again.');
      }
    } else if (input && !preview.blockers.length) {
      if (unsaved(preview.nodeIds).length) {
        setBusy(false);
        return setError('Save or clear the selected cards’ drafts before moving. Close and preview again.');
      }
      setAttempted(true);
      const result = await requestJson<
        ({ ok: true } & BoardMoveResult) | { ok: false; error?: string; blockers?: string[] } | null
      >('moveSelection', '/api/canvas/boards/move-selection', null, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (result?.ok) {
        const navigate = current() && selected.canNavigate();
        close();
        if (navigate) await openBoard(result.destinationBoardId);
      } else if (selection.value === selected) {
        if (result) {
          setRefused(true);
          setError(`${result.error ?? 'Move refused.'} ${result.blockers?.join(' ') ?? ''} Close and preview again.`);
        } else {
          setError('No reply received. Retry uses the same request and cannot create a second board.');
        }
      }
    }
    setBusy(false);
  };

  const blocked = !!preview?.blockers.length;
  return (
    <div class="text-prompt-backdrop board-move-backdrop" onMouseDown={close}>
      <div
        ref={dialogRef}
        class="text-prompt board-move-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-move-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
        }}
      >
        <form onClick={submitWithoutNavigation} onSubmit={submit}>
          <h2 id="board-move-title">Move to new board</h2>
          <p>Move the original cards, including group contents. Leave a portal on this board.</p>
          <label class="board-copy-field">
            New board name
            <input
              ref={nameRef}
              class="text-prompt-input"
              maxLength={120}
              required
              value={name}
              readOnly={!!preview || busy}
              onInput={(event) => setName(event.currentTarget.value)}
            />
          </label>
          {preview && (
            <>
              <p>
                {preview.nodeIds.length} cards · {preview.pinnedNodeIds.length} pinned ·{' '}
                {preview.affectedBoardIds.length + 1} affected boards
              </p>
              <ul class="board-move-cards">
                {preview.nodeIds.map((id) => (
                  <li key={id}>{String(nodes.value.get(id)?.data.title ?? id)}</li>
                ))}
              </ul>
              {preview.readmeNodeId && <p>The README moves with the cards.</p>}
              {!!preview.liveTaskNodeIds.length && (
                <p>{preview.liveTaskNodeIds.length} live task cards keep their original task owner.</p>
              )}
              <p>Content, relations and review history are preserved. Moving does not validate or read content.</p>
              <p class="board-move-warning">
                ⚠ History boundary: pre-move Undo/Redo is cleared on affected boards. Older snapshots remain
                inspectable, but cannot be restored across the move.
              </p>
              <p>Board-space annotations stay here. The new board opens after the move.</p>
              {blocked && (
                <div role="alert" class="board-move-warning">
                  <strong>⚠ Cannot move this selection</strong>
                  <ul>
                    {preview.blockers.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  <p>No cards moved. Close, resolve the listed bindings and preview again.</p>
                </div>
              )}
            </>
          )}
          {error && (
            <p role="alert" class="board-move-warning">
              ⚠ {error}
            </p>
          )}
          <div class="text-prompt-actions">
            <button type="button" class="text-prompt-cancel" onClick={close}>
              {blocked || refused ? 'Close' : 'Cancel'}
            </button>
            {!blocked && !refused && (
              <button type="submit" class="text-prompt-confirm" disabled={busy || !name.trim()}>
                {busy ? 'Working…' : attempted ? 'Retry move' : preview ? 'Move and open' : 'Preview move'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
