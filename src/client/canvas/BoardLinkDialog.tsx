import { useEffect, useRef, useState } from 'preact/hooks';
import { activeBoardId, boardList, loadBoards, openMemoryTarget } from '../state/boards-store';
import { createEdgeFromClient, requestJson, updateNodeFromClient } from '../state/intent-bridge';
import type { MemoryGraph } from '../../shared/memory-graph.js';
import { canvasAreaCenter } from './canvas-area';
import { nodes, viewport } from '../state/canvas-store';
import { useFocusTrap } from './use-focus-trap';

export function BoardLinkDialog({
  onClose,
  sourceNodeId,
  wikiRef,
}: {
  onClose: () => void;
  sourceNodeId?: string;
  wikiRef?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sourceBoardId = useRef(activeBoardId.value).current;
  const sourceNode = useRef(sourceNodeId ? nodes.value.get(sourceNodeId) : undefined).current;
  const [graph, setGraph] = useState<MemoryGraph | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useFocusTrap(dialogRef, true, { initial: searchRef });
  useEffect(() => {
    let cancelled = false;
    if (sourceNodeId && !wikiRef)
      void requestJson<MemoryGraph | null>('linkCardChoices', '/api/canvas/memory-graph', null).then((result) => {
        if (!cancelled) {
          setGraph(result);
          if (!result) setError('Could not load cards. Close and retry.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sourceNodeId, wikiRef]);
  const choices = boardList.value.filter(
    (board) => board.id !== sourceBoardId && board.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const cards = (graph?.nodes ?? []).filter(
    (node) =>
      node.kind === 'card' &&
      node.boardId !== sourceBoardId &&
      `${node.title} ${boardList.value.find((board) => board.id === node.boardId)?.name ?? ''}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const createWikiBoard = async () => {
    if (!wikiRef || !sourceNode || activeBoardId.value !== sourceBoardId)
      return setError('The source board changed. Reopen it before creating the link.');
    setBusy(true);
    const created = await requestJson<{ board?: { id: string } } | null>(
      'createWikiBoard',
      '/api/canvas/boards',
      null,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: wikiRef, expectedBoardId: sourceBoardId }),
      },
    );
    if (!created?.board) {
      setBusy(false);
      return setError('Could not create the board.');
    }
    const saved = await updateNodeFromClient(sourceNode.id, {
      content: typeof sourceNode.data.content === 'string' ? sourceNode.data.content : '',
      expectedBoardId: sourceBoardId,
      expectedContentRevision: sourceNode.contentRevision ?? 0,
    });
    await loadBoards();
    setBusy(false);
    if (!saved.ok)
      return setError('Board created, but the source changed. Save its Markdown again to resolve the link.');
    onClose();
    await openMemoryTarget({ boardId: created.board.id });
  };
  const connect = async (boardId: string, cardId: string) => {
    if (!sourceNodeId) return;
    setBusy(true);
    const result = await createEdgeFromClient(sourceNodeId, cardId, 'references', undefined, {
      toBoardId: boardId,
      expectedBoardId: sourceBoardId,
    });
    setBusy(false);
    if (!result.ok)
      return setError('Could not add the connection. Check the source board and target card, then retry.');
    onClose();
  };
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
          expectedBoardId: sourceBoardId,
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
        <h2 id="board-link-title">
          {wikiRef
            ? 'Create unresolved board'
            : sourceNodeId
              ? 'Connect to a card on another board'
              : 'Link to a board'}
        </h2>
        {wikiRef ? (
          <p>Create “{wikiRef}” and save this link to its board ID?</p>
        ) : (
          <input
            ref={searchRef}
            type="search"
            class="text-prompt-input"
            aria-label={sourceNodeId ? 'Find a card to connect' : 'Find a board to link'}
            placeholder={sourceNodeId ? 'Find a board or card…' : 'Find a board…'}
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        )}
        {error && (
          <div role="alert" class="board-copy-error">
            {error}
          </div>
        )}
        {!wikiRef && (
          <ul class="board-link-results">
            {sourceNodeId
              ? cards.map((card) => (
                  <li key={card.key}>
                    <button type="button" disabled={busy} onClick={() => void connect(card.boardId, card.cardId!)}>
                      <span>{card.title}</span>
                      <small>{boardList.value.find((board) => board.id === card.boardId)?.name ?? card.boardId}</small>
                    </button>
                  </li>
                ))
              : choices.map((board) => (
                  <li key={board.id}>
                    <button type="button" onClick={() => void create(board.id)}>
                      <span>{board.name}</span>
                      <small>{board.nodeCount} nodes</small>
                    </button>
                  </li>
                ))}
            {(sourceNodeId ? cards.length : choices.length) === 0 && (
              <li class="board-copy-status">
                {boardList.value.length <= 1
                  ? 'Create another board first, then link it here.'
                  : sourceNodeId && !graph
                    ? 'Loading cards…'
                    : 'No matches. Try another search.'}
              </li>
            )}
          </ul>
        )}
        <div class="text-prompt-actions">
          {wikiRef && (
            <button type="button" disabled={busy} onClick={() => void createWikiBoard()}>
              {busy ? 'Creating…' : 'Create board'}
            </button>
          )}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
