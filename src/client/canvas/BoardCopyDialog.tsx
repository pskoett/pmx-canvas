import { useEffect, useRef, useState } from 'preact/hooks';
import {
  createBoardFrom,
  openBoard,
  previewBoardCopy,
  type BoardCopyPreview,
  type BoardSummary,
} from '../state/boards-store';
import { useFocusTrap } from './use-focus-trap';

export function BoardCopyDialog({ board, onClose }: { board: BoardSummary; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<BoardCopyPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState(`${board.name} copy`);
  const [includeReadme, setIncludeReadme] = useState(true);
  const [includeStructure, setIncludeStructure] = useState(true);
  const [openAfter, setOpenAfter] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useFocusTrap(dialogRef, true, { initial: nameRef });

  useEffect(() => {
    let active = true;
    void previewBoardCopy(board.id).then((result) => {
      if (!active) return;
      if (!result || !Array.isArray(result.cards)) return setError('Could not load reusable cards. Try again.');
      setPreview(result);
      setSelected(new Set(result.cards.filter((card) => card.reusable).map((card) => card.id)));
    });
    return () => {
      active = false;
    };
  }, [board.id]);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (!name.trim() || !preview) return;
    setSaving(true);
    setError('');
    const created = await createBoardFrom({
      sourceBoardId: board.id,
      name: name.trim(),
      ...(board.category ? { category: board.category } : {}),
      nodeIds: [...selected],
      includeReadme,
      includeStructure,
    });
    setSaving(false);
    if (!created) return setError('Could not create the board. Try a different name.');
    if (openAfter) await openBoard(created.id);
    onClose();
  };

  return (
    <div class="text-prompt-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        class="text-prompt board-copy-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-copy-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit}>
          <h2 id="board-copy-title">Create from {board.name}</h2>
          <label class="board-copy-field">
            Board name
            <input
              ref={nameRef}
              class="text-prompt-input"
              value={name}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </label>
          {!preview && !error && (
            <div class="board-copy-status" role="status">
              Loading reusable cards…
            </div>
          )}
          {error && (
            <div class="board-copy-error" role="alert">
              {error}
            </div>
          )}
          {preview && (
            <fieldset class="board-copy-cards">
              <legend>Cards to copy</legend>
              {preview.cards.filter((card) => card.reusable).length === 0 ? (
                <div class="board-copy-status">No reusable cards on this board.</div>
              ) : (
                preview.cards
                  .filter((card) => card.reusable)
                  .map((card) => (
                    <label class="board-copy-card" key={card.id}>
                      <input
                        type="checkbox"
                        checked={selected.has(card.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          e.currentTarget.checked ? next.add(card.id) : next.delete(card.id);
                          setSelected(next);
                        }}
                      />
                      <span>
                        <strong>{card.title || 'Untitled card'}</strong>
                        <small>{card.type}</small>
                      </span>
                    </label>
                  ))
              )}
            </fieldset>
          )}
          <div class="board-copy-options">
            <label>
              <input
                type="checkbox"
                checked={includeStructure}
                onChange={(e) => setIncludeStructure(e.currentTarget.checked)}
              />{' '}
              Preserve groups and connections
            </label>
            <label>
              <input
                type="checkbox"
                checked={includeReadme}
                disabled={!preview?.readmeNodeId}
                onChange={(e) => setIncludeReadme(e.currentTarget.checked)}
              />{' '}
              Include README
            </label>
            <label>
              <input type="checkbox" checked={openAfter} onChange={(e) => setOpenAfter(e.currentTarget.checked)} /> Open
              the new board after creating
            </label>
          </div>
          <p class="board-copy-note">
            Only selected cards and structure are copied. Asks, history, and context pins start clear.
          </p>
          <div class="text-prompt-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={!preview || !name.trim() || saving}>
              {saving ? 'Creating…' : 'Create board'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
