import { useEffect, useRef, useState } from 'preact/hooks';
import { normalizeBoardCategory } from '../../shared/boards.js';
import { boardList, updateBoard, type BoardSummary } from '../state/boards-store';
import { useFocusTrap } from './use-focus-trap';

/** A destination picker: select an existing folder, optionally create a child, then move. */
export function BoardFolderDialog({
  board,
  folders,
  onClose,
}: {
  board: BoardSummary;
  folders: string[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [parent, setParent] = useState(board.category ?? '');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useFocusTrap(ref, true);
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (!busy) onClose();
    };
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [busy, onClose]);

  const destination = name.trim() ? [parent, name.trim()].filter(Boolean).join('/') : parent;
  const move = async () => {
    let category: string | null;
    try {
      if (name.includes('/')) throw new Error('Use one folder name; choose its parent above.');
      category = normalizeBoardCategory(destination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    setBusy(true);
    setError('');
    await updateBoard(board.id, { category });
    if (boardList.value.find((entry) => entry.id === board.id)?.category === category) onClose();
    else setError('Could not move this board. Try again.');
    setBusy(false);
  };

  return (
    <div class="text-prompt-backdrop" onPointerDown={() => !busy && onClose()}>
      <div
        ref={ref}
        class="text-prompt home-folder-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Move ${board.name}`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div class="text-prompt-title">Move “{board.name}”</div>
        <p class="home-folder-hint">Choose a folder, or create one inside it. The board keeps its content and links.</p>
        <fieldset class="home-folder-options" disabled={busy}>
          <legend>Destination folder</legend>
          {['', ...folders].map((path) => (
            <label
              key={path}
              class="home-folder-option"
              style={{ paddingLeft: `${8 + Math.min(path.split('/').length - 1, 5) * 14}px` }}
            >
              <input
                type="radio"
                name="folder-destination"
                value={path}
                checked={parent === path}
                onChange={() => {
                  setParent(path);
                  setError('');
                }}
              />
              <span>{path || 'Home (no folder)'}</span>
            </label>
          ))}
        </fieldset>
        <label class="home-folder-new">
          New folder inside {parent || 'Home'} <span class="home-folder-hint">(optional)</span>
          <input
            class="text-prompt-input"
            aria-label="New folder name"
            placeholder="e.g. Decisions"
            maxLength={60}
            value={name}
            disabled={busy}
            onInput={(event) => {
              setName(event.currentTarget.value);
              setError('');
            }}
          />
        </label>
        <div class="home-folder-hint">
          Move to: <strong>{destination || 'Home'}</strong>
        </div>
        {error && <p role="alert">{error}</p>}
        <div class="text-prompt-actions">
          <button type="button" class="text-prompt-cancel" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            class="text-prompt-confirm"
            disabled={busy || destination === (board.category ?? '')}
            onClick={() => void move()}
          >
            {busy ? 'Moving…' : 'Move board'}
          </button>
        </div>
      </div>
    </div>
  );
}
