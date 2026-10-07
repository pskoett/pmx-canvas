import type { CanvasNodeState } from '../types';
import { boardList, openBoard } from '../state/boards-store';
import { IconExternalLink } from '../icons';

/** Native text-only cross-board link. Target identity is the durable board id. */
export function BoardNode({ node }: { node: CanvasNodeState }) {
  const boardId = typeof node.data.boardId === 'string' ? node.data.boardId : '';
  const target = boardList.value.find((board) => board.id === boardId);
  return (
    <div class="board-node">
      <div class="board-node-content">
        <div class="board-node-label">Linked board</div>
        <strong class="board-node-title">{target?.name ?? 'Missing board'}</strong>
        <div class="board-node-meta">
          {target
            ? `${target.nodeCount} nodes${target.pin ? ' · pinned, so it travels with you' : ''}`
            : boardId || 'No target id'}
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
      </div>
      <button
        class="board-node-open"
        type="button"
        disabled={!target}
        onClick={() => target && void openBoard(target.id)}
      >
        {target ? 'Open board' : 'Target unavailable'}
        {target && <IconExternalLink size={14} />}
      </button>
    </div>
  );
}
