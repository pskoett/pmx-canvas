import type { CanvasNodeState } from '../types';
import { useState } from 'preact/hooks';
import { activeBoardId, boardList, openBoard } from '../state/boards-store';
import { updateNodeFromClient } from '../state/intent-bridge';
import { IconExternalLink } from '../icons';

/** Target identity is the durable board id; a missing target can be relinked. */
export function BoardNode({ node }: { node: CanvasNodeState }) {
  const boardId = typeof node.data.boardId === 'string' ? node.data.boardId : '';
  const target = boardList.value.find((board) => board.id === boardId);
  const [relinking, setRelinking] = useState(false);
  const [error, setError] = useState('');
  return (
    <div class="board-node">
      {target ? (
        <div class="home-thumb" aria-hidden="true">
          <div class="home-thumb-inner">
            {(target.preview ?? []).map((rect, index) => (
              <span
                key={index}
                class={`home-thumb-card${rect.pinned ? ' is-pinned' : ''}`}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                }}
              />
            ))}
          </div>
        </div>
      ) : (
        <div class="board-node-missing">Board not found</div>
      )}
      <div class="board-node-content">
        <strong class="board-node-title">{target?.name ?? String(node.data.title || 'Linked board')}</strong>
        <div class="board-node-meta">
          {target
            ? `Board · ${target.nodeCount} nodes${target.pin ? ' · pinned, so it travels with you' : ''}`
            : 'The linked board is no longer available.'}
        </div>
        {target?.summary && <p class="board-node-summary">{target.summary}</p>}
        {!!target?.pinnedTitles?.length && (
          <p class="board-node-meta">Pinned: {target.pinnedTitles.map((pin) => pin.title).join(', ')}</p>
        )}
        {!!target?.backlinks?.length && (
          <p class="board-node-meta">
            Linked from: {[...new Set(target.backlinks.map((link) => link.title))].join(', ')}
          </p>
        )}
        {relinking && (
          <select
            aria-label="Link to board"
            class="board-node-relink"
            value=""
            onChange={async (event) => {
              const id = event.currentTarget.value;
              if (!id) return;
              setError('');
              const result = await updateNodeFromClient(node.id, {
                data: { boardId: id },
                expectedBoardId: activeBoardId.value,
              });
              if (result.ok) setRelinking(false);
              else setError('Could not relink this card. Try again.');
            }}
          >
            <option value="" disabled>
              Choose board…
            </option>
            {boardList.value
              .filter((board) => board.id !== activeBoardId.value)
              .map((board) => (
                <option key={board.id} value={board.id}>
                  {board.name}
                </option>
              ))}
          </select>
        )}
        {error && (
          <div role="status" class="board-node-meta">
            {error}
          </div>
        )}
      </div>
      <button
        class="board-node-open"
        type="button"
        onClick={() => (target ? void openBoard(target.id) : setRelinking(!relinking))}
      >
        {target ? 'Open board' : 'Link to board…'}
        {target && <IconExternalLink size={14} />}
      </button>
    </div>
  );
}
