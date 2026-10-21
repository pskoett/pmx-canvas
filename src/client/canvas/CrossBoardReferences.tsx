import { activeBoardId, boardList, openMemoryTarget } from '../state/boards-store';
import { edges } from '../state/canvas-store';
import { waitForMarkdownSave } from '../nodes/MarkdownNode';
import type { CanvasNodeState } from '../types';

/** The same bounded, navigable reference list on a card and in focus mode. */
export function CrossBoardReferences({ node }: { node: CanvasNodeState }) {
  const remoteEdges = [...edges.value.values()].filter((edge) => edge.toBoardId && edge.from === node.id);
  const boardId = activeBoardId.value;
  const sourceBoard = boardList.value.find((board) => board.id === boardId);
  if (!remoteEdges.length) return null;
  return (
    <div
      class="node-memory-links"
      role="region"
      aria-label="Cross-board references"
      tabIndex={0}
      onWheel={(event) => {
        if (!event.ctrlKey && !event.metaKey) event.stopPropagation();
      }}
      onKeyDown={(event) => {
        if (
          ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', ' '].includes(
            event.key,
          )
        )
          event.stopPropagation();
      }}
    >
      {remoteEdges.map((edge) => {
        const targetBoard = boardList.value.find((board) => board.id === edge.toBoardId);
        const link = sourceBoard?.links?.find(
          (link) =>
            link.kind === 'card' &&
            link.nodeId === node.id &&
            link.boardId === edge.toBoardId &&
            link.cardId === edge.to,
        );
        return (
          <div class="node-memory-link" key={edge.id}>
            <button
              type="button"
              disabled={!targetBoard || link?.missing === true}
              onClick={async (event) => {
                event.stopPropagation();
                const focused = document.activeElement;
                if (focused instanceof HTMLElement && focused.isContentEditable) focused.blur();
                if (node.type === 'markdown' && !(await waitForMarkdownSave(boardId, node.id))) return;
                await openMemoryTarget({ boardId: edge.toBoardId!, cardId: edge.to });
              }}
            >
              ↗ {edge.label || edge.type}: {targetBoard?.name ?? 'Missing board'} /{' '}
              {link?.cardTitle ?? (link?.missing ? 'Missing card' : 'Loading card…')}
            </button>
          </div>
        );
      })}
    </div>
  );
}
