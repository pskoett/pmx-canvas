import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  boardList,
  createAndOpenBoard,
  deleteBoard,
  openBoard,
  updateBoard,
  type BoardSummary,
} from '../state/boards-store';
import { categoryAncestors, MIGRATED_SNAPSHOT_CATEGORY } from '../../shared/boards.js';
import { askText } from './TextPrompt';
import { BoardFolderDialog } from './BoardFolderDialog';

function timeAgo(iso: string | null): string {
  if (!iso) return 'never opened';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function nodesLabel(count: number): string {
  return `${count} node${count !== 1 ? 's' : ''}`;
}

export async function promptNewBoard(): Promise<void> {
  const name = await askText('New board', 'Board name', { confirm: 'Create' });
  if (name) await createAndOpenBoard(name);
}

const COLLAPSED_KEY = 'pmx-canvas-home-collapsed';

/** Which categories this viewer folded away; the migrated-snapshot shelf starts folded. */
function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // Storage can be unavailable (private windows, embedded panes): fall back to the default.
  }
  return new Set([MIGRATED_SNAPSHOT_CATEGORY]);
}

function writeCollapsed(collapsed: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  } catch {
    // Folding still works for this visit without storage.
  }
}

/**
 * Home (plan 012): the view when no board is open — every board, filed under
 * its category (most recently opened first within each). Categories keep the
 * library findable as it grows into the working memory of many sessions.
 * Deleting asks in place, naming the board and what it holds; browser confirm
 * dialogs are no-ops in agent panes.
 */
export function HomeView() {
  const boards = boardList.value;
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  const folders = [
    ...new Set(boards.flatMap((board) => (board.category ? categoryAncestors(board.category) : []))),
  ].sort((a, b) => a.localeCompare(b));
  const query = search.trim().toLocaleLowerCase();
  const visible = boards.filter((board) => `${board.name} ${board.category ?? ''}`.toLocaleLowerCase().includes(query));
  const visibleFolders = new Set(visible.flatMap((board) => (board.category ? categoryAncestors(board.category) : [])));
  const movingBoard = boards.find((board) => board.id === moving);

  const toggle = (name: string) => {
    const next = new Set(collapsed);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setCollapsed(next);
    writeCollapsed(next);
  };

  const rename = async (board: BoardSummary) => {
    const name = await askText('Rename board', 'Board name', { initial: board.name, confirm: 'Rename' });
    if (name && name !== board.name) await updateBoard(board.id, { name });
  };

  const row = (board: BoardSummary) =>
    confirmingDelete === board.id ? (
      <li key={board.id} class="home-board is-confirming" data-testid="home-board">
        <div class="home-board-confirm-text">
          Delete <strong>{board.name}</strong> and its {nodesLabel(board.nodeCount)} and snapshots? This can't be
          undone.
        </div>
        <div class="home-board-actions">
          <button type="button" class="home-board-action" onClick={() => setConfirmingDelete(null)}>
            Cancel
          </button>
          <button
            type="button"
            class="home-board-action is-danger"
            onClick={() => {
              setConfirmingDelete(null);
              void deleteBoard(board.id);
            }}
          >
            Delete board
          </button>
        </div>
      </li>
    ) : (
      <li key={board.id} class="home-board" data-testid="home-board">
        <button type="button" class="home-board-open" onClick={() => void openBoard(board.id)}>
          <span class="home-board-name">{board.name}</span>
          <span class="home-board-meta">
            {nodesLabel(board.nodeCount)} · {timeAgo(board.lastOpenedAt)}
          </span>
        </button>
        <div class="home-board-actions">
          <button type="button" class="home-board-action" aria-haspopup="dialog" onClick={() => setMoving(board.id)}>
            Move
          </button>
          <button type="button" class="home-board-action" onClick={() => void rename(board)}>
            Rename
          </button>
          <button type="button" class="home-board-action" onClick={() => setConfirmingDelete(board.id)}>
            Delete
          </button>
        </div>
      </li>
    );

  const folder = (path: string, depth: number): ComponentChildren => {
    const children = folders.filter(
      (candidate) => candidate.slice(0, candidate.lastIndexOf('/')) === path && candidate.includes('/'),
    );
    const direct = visible.filter((board) => board.category === path);
    const count = visible.filter((board) => board.category === path || board.category?.startsWith(`${path}/`)).length;
    const expanded = !!query || !collapsed.has(path);
    return (
      <section key={path} class="home-section" data-testid="home-section" data-folder={path} aria-label={path}>
        <button type="button" class="home-section-head" aria-expanded={expanded} onClick={() => toggle(path)}>
          <span class="home-section-caret" aria-hidden="true">
            {expanded ? '▾' : '▸'}
          </span>
          <span aria-hidden="true">▱</span>
          <span class="home-section-name">{path.split('/').at(-1)}</span>
          <span class="home-section-count">{count}</span>
        </button>
        {expanded && (
          <div class="home-folder-children" style={{ marginLeft: depth < 5 ? '14px' : '0' }}>
            {children.filter((child) => visibleFolders.has(child)).map((child) => folder(child, depth + 1))}
            {direct.length > 0 && (
              <ul class="home-view-list" aria-label={`Boards in ${path}`}>
                {direct.map(row)}
              </ul>
            )}
          </div>
        )}
      </section>
    );
  };

  return (
    <div class="home-view" data-testid="home-view">
      <div class="home-view-inner">
        <div class="home-view-head">
          <h1 class="home-view-title">Boards</h1>
          <button type="button" class="home-view-new" onClick={() => void promptNewBoard()}>
            New board
          </button>
        </div>
        <input
          class="text-prompt-input home-search"
          type="search"
          aria-label="Find boards and folders"
          placeholder="Find boards and folders…"
          value={search}
          onInput={(event) => setSearch(event.currentTarget.value)}
        />
        {boards.length === 0 ? (
          <div class="home-view-empty">No boards yet. Create one, or let an agent start writing — it opens one.</div>
        ) : visible.length === 0 ? (
          <div class="home-view-empty" role="status">
            No boards match “{search}”.
          </div>
        ) : (
          <>
            {folders.filter((path) => !path.includes('/') && visibleFolders.has(path)).map((path) => folder(path, 0))}
            {visible.some((board) => !board.category) && (
              <section aria-label="Unfiled boards">
                {folders.length > 0 && <div class="home-folder-hint">Unfiled boards</div>}
                <ul class="home-view-list">{visible.filter((board) => !board.category).map(row)}</ul>
              </section>
            )}
          </>
        )}
      </div>
      {movingBoard && (
        <BoardFolderDialog key={movingBoard.id} board={movingBoard} folders={folders} onClose={() => setMoving(null)} />
      )}
    </div>
  );
}
