import { useRef, useState } from 'preact/hooks';
import { activeBoardId, boardList } from '../state/boards-store';
import { requestJson } from '../state/intent-bridge';
import { canvasAreaCenter } from './canvas-area';
import { viewport } from '../state/canvas-store';
import { useFocusTrap } from './use-focus-trap';

export function BoardLinkDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  useFocusTrap(dialogRef, true, { initial: searchRef });
  const choices = boardList.value.filter(
    (board) => board.id !== activeBoardId.value && board.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const create = async (boardId: string) => {
    const target = boardList.value.find((board) => board.id === boardId);
    if (!target) return setError('That board is no longer available.');
    const center = canvasAreaCenter();
    const v = viewport.value;
    const result = await requestJson<{ ok?: boolean }>(
      'createBoardLink',
      '/api/canvas/node',
      {},
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'board',
          title: target.name,
          x: Math.round((center.x - v.x) / v.scale - 180),
          y: Math.round((center.y - v.y) / v.scale - 100),
          width: 360,
          height: 200,
          data: { boardId },
        }),
      },
    );
    if (!result.ok) return setError('Could not create the board link.');
    onClose();
  };
  return (
    <div class="text-prompt-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        class="text-prompt board-link-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-link-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="board-link-title">Link to a board</h2>
        <input
          ref={searchRef}
          type="search"
          class="text-prompt-input"
          aria-label="Find a board to link"
          placeholder="Find a board…"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        {error && (
          <div role="alert" class="board-copy-error">
            {error}
          </div>
        )}
        <ul class="board-link-results">
          {choices.map((board) => (
            <li key={board.id}>
              <button type="button" onClick={() => void create(board.id)}>
                <span>{board.name}</span>
                <small>{board.nodeCount} nodes</small>
              </button>
            </li>
          ))}
          {choices.length === 0 && (
            <li class="board-copy-status">
              {boardList.value.length <= 1
                ? 'Create another board first, then link it here.'
                : 'No boards match your search.'}
            </li>
          )}
        </ul>
        <div class="text-prompt-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
