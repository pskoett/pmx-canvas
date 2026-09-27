import { useEffect, useState } from 'preact/hooks';
import {
  boardList,
  createAndOpenBoard,
  deleteBoard,
  openBoard,
  updateBoard,
  type BoardSummary,
} from '../state/boards-store';
import { MIGRATED_SNAPSHOT_CATEGORY } from '../../shared/boards.js';
import { requestJson } from '../state/intent-bridge';
import { askText } from './TextPrompt';

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

interface BackupInfo {
  folder: string;
  everyMs: number | null;
  lastAt: string | null;
}

function everyLabel(ms: number): string {
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  return `${Math.round(ms / 60_000)}m`;
}

/** Last backup and "Back up now" — the whole library, every board, in one file. */
function BackupLine() {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void requestJson<BackupInfo | null>('backupStatus', '/api/canvas/backup', null).then(setInfo);
  }, []);
  if (!info) return null;

  const backUp = async () => {
    setBusy(true);
    const result = await requestJson<{ status?: BackupInfo } | null>('backupNow', '/api/canvas/backup', null, {
      method: 'POST',
    });
    if (result?.status) setInfo(result.status);
    setBusy(false);
  };

  return (
    <div class="home-view-backup" data-testid="home-backup">
      <span>
        {info.lastAt ? `Last backup ${timeAgo(info.lastAt)}` : 'Not backed up yet'}
        {info.everyMs ? ` · every ${everyLabel(info.everyMs)}` : ''}
      </span>
      <button type="button" class="home-board-action" disabled={busy} onClick={() => void backUp()}>
        {busy ? 'Backing up…' : 'Back up now'}
      </button>
    </div>
  );
}

export async function promptNewBoard(): Promise<void> {
  const name = await askText('New board', 'Board name', { confirm: 'Create' });
  if (name) await createAndOpenBoard(name);
}

const COLLAPSED_KEY = 'pmx-canvas-home-collapsed';
const UNCATEGORIZED = 'No category';

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

/** Categories in name order, the uncategorized boards last; boards keep their recent-first order. */
function sections(boards: BoardSummary[]): Array<{ name: string; boards: BoardSummary[] }> {
  const byName = new Map<string, BoardSummary[]>();
  for (const board of boards) {
    const name = board.category ?? UNCATEGORIZED;
    byName.set(name, [...(byName.get(name) ?? []), board]);
  }
  return [...byName.entries()]
    .sort(([a], [b]) => (a === UNCATEGORIZED ? 1 : b === UNCATEGORIZED ? -1 : a.localeCompare(b)))
    .map(([name, list]) => ({ name, boards: list }));
}

function CategoryMenu({
  board,
  categories,
  onClose,
}: {
  board: BoardSummary;
  categories: string[];
  onClose: () => void;
}) {
  const move = (category: string | null) => {
    onClose();
    void updateBoard(board.id, { category });
  };
  const newCategory = async () => {
    onClose();
    const name = await askText('New category', 'Category name', { confirm: 'Move' });
    if (name) await updateBoard(board.id, { category: name });
  };
  return (
    <div class="toolbar-menu home-category-menu" role="menu" aria-label={`Category for ${board.name}`}>
      {categories
        .filter((category) => category !== board.category)
        .map((category) => (
          <button key={category} type="button" role="menuitem" class="toolbar-menu-item" onClick={() => move(category)}>
            {category}
          </button>
        ))}
      <button type="button" role="menuitem" class="toolbar-menu-item" onClick={() => void newCategory()}>
        New category…
      </button>
      {board.category && (
        <button type="button" role="menuitem" class="toolbar-menu-item" onClick={() => move(null)}>
          Remove from “{board.category}”
        </button>
      )}
    </div>
  );
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
  const [categoryMenu, setCategoryMenu] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  const categories = [...new Set(boards.map((board) => board.category).filter((c): c is string => c !== null))].sort(
    (a, b) => a.localeCompare(b),
  );
  const grouped = sections(boards);
  const showHeaders = grouped.length > 1 || grouped[0]?.name !== UNCATEGORIZED;

  useEffect(() => {
    if (!categoryMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Element && !e.target.closest('.home-board-category')) setCategoryMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCategoryMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [categoryMenu]);

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
          <span class="home-board-category">
            <button
              type="button"
              class="home-board-action"
              aria-haspopup="menu"
              aria-expanded={categoryMenu === board.id}
              onClick={() => setCategoryMenu(categoryMenu === board.id ? null : board.id)}
            >
              Category
            </button>
            {categoryMenu === board.id && (
              <CategoryMenu board={board} categories={categories} onClose={() => setCategoryMenu(null)} />
            )}
          </span>
          <button type="button" class="home-board-action" onClick={() => void rename(board)}>
            Rename
          </button>
          <button type="button" class="home-board-action" onClick={() => setConfirmingDelete(board.id)}>
            Delete
          </button>
        </div>
      </li>
    );

  return (
    <div class="home-view" data-testid="home-view">
      <div class="home-view-inner">
        <div class="home-view-head">
          <h1 class="home-view-title">Boards</h1>
          <button type="button" class="home-view-new" onClick={() => void promptNewBoard()}>
            New board
          </button>
        </div>
        <BackupLine />
        {boards.length === 0 ? (
          <div class="home-view-empty">No boards yet. Create one, or let an agent start writing — it opens one.</div>
        ) : (
          grouped.map((section) => (
            <section key={section.name} class="home-section" data-testid="home-section">
              {showHeaders && (
                <button
                  type="button"
                  class="home-section-head"
                  aria-expanded={!collapsed.has(section.name)}
                  onClick={() => toggle(section.name)}
                >
                  <span class="home-section-caret" aria-hidden="true">
                    {collapsed.has(section.name) ? '▸' : '▾'}
                  </span>
                  <span class="home-section-name">{section.name}</span>
                  <span class="home-section-count">{section.boards.length}</span>
                </button>
              )}
              {!(showHeaders && collapsed.has(section.name)) && (
                <ul class="home-view-list" aria-label={section.name}>
                  {section.boards.map(row)}
                </ul>
              )}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
