import { timeAgo } from '../utils/time-ago';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  boardList,
  activeBoardId,
  createAndOpenBoard,
  deleteBoard,
  openBoard,
  setBoardPinned,
  updateBoard,
  type BoardSummary,
} from '../state/boards-store';
import { categoryAncestors, MIGRATED_SNAPSHOT_CATEGORY, normalizeBoardCategory } from '../../shared/boards.js';
import { askText } from './TextPrompt';
import { BoardFolderDialog } from './BoardFolderDialog';
import { requestJson } from '../state/intent-bridge';
import { focusNode, nodes } from '../state/canvas-store';
import { approxTokens } from '../state/context-chip-store';
import { BoardCopyDialog } from './BoardCopyDialog';
import { BoardPinButton } from './BoardPinButton';
import { IconChevronDown, IconChevronRight, IconMore, IconPin, IconSearch } from '../icons';

interface LibraryHit {
  boardId: string;
  boardTitle: string;
  cardId: string;
  title: string | null;
  snippet: string;
}

function openedAgo(iso: string | null): string {
  if (!iso) return 'never opened';
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (days >= 30)
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return timeAgo(iso);
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Board-to-board links in either direction: the "↔ N links" a card shows. */
function linkCount(board: BoardSummary): number {
  return (board.links?.length ?? 0) + (board.backlinks?.length ?? 0);
}

export async function promptNewBoard(category?: string | null): Promise<void> {
  const name = await askText('New board', 'Board name', { confirm: 'Create' });
  if (name) await createAndOpenBoard(name, category);
}

const COLLAPSED_KEY = 'pmx-canvas-home-collapsed';

/** Which folders this viewer folded away in the tree; the migrated-snapshot shelf starts folded. */
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

const inFolder = (board: BoardSummary, path: string) =>
  board.category === path || !!board.category?.startsWith(`${path}/`);

const leaf = (path: string) => path.split('/').at(-1) ?? path;

/** A board's layout in miniature: its cards as rectangles, pinned ones in pin blue. */
function BoardThumbnail({ board }: { board: BoardSummary }) {
  return (
    <div class="home-thumb" aria-hidden="true">
      <div class="home-thumb-inner">
        {(board.preview ?? []).map((rect, index) => (
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
  );
}

/**
 * Home (docs/design/Home.dc.html, plan 016): the library when no board is
 * open. A folder tree with pinned boards on the left, the selected folder's
 * subfolders and board cards in the middle, the selected board's details on
 * the right. At ≤ 760 px (Pane600.dc.html) the tree becomes a folder picker,
 * the boards a list and the details a bottom sheet. Folders are board
 * categories; categories carry no colour (decided 2026-10-07). Browser
 * confirm dialogs are no-ops in agent panes, so Delete asks in place.
 */
export function HomeView() {
  const boards = boardList.value;
  const [folder, setFolder] = useState<string>(() => {
    const recent = [...boardList.value].sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''))[0];
    return recent?.category ?? '';
  });
  const [extraFolders, setExtraFolders] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<LibraryHit[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pinsOpen, setPinsOpen] = useState(false);
  const openHitSequence = useRef(0);
  const moreButton = useRef<HTMLButtonElement>(null);
  const moreMenu = useRef<HTMLSpanElement>(null);

  const folders = [
    ...new Set([
      ...boards.flatMap((board) => (board.category ? categoryAncestors(board.category) : [])),
      ...extraFolders.flatMap(categoryAncestors),
    ]),
  ].sort((a, b) => a.localeCompare(b));
  const childrenOf = (path: string) =>
    folders.filter((candidate) =>
      path
        ? candidate.startsWith(`${path}/`) && !candidate.slice(path.length + 1).includes('/')
        : !candidate.includes('/'),
    );
  const query = search.trim().toLocaleLowerCase();
  const pinned = boards.filter((board) => board.pin);
  const pinnedChars = pinned.reduce((sum, board) => sum + (board.mapChars ?? 0), 0);
  const subfolders = childrenOf(folder);
  const here = boards
    .filter((board) => (board.category ?? '') === folder)
    .sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''));
  const matches = query
    ? boards.filter((board) => `${board.name} ${board.category ?? ''}`.toLocaleLowerCase().includes(query))
    : [];
  const shown = query ? matches : here;
  const selected = boards.find((board) => board.id === selectedId) ?? null;
  const movingBoard = boards.find((board) => board.id === moving);
  const copyingBoard = boards.find((board) => board.id === copying);

  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void requestJson<{ results?: LibraryHit[] } | null>(
        'searchLibrary',
        `/api/canvas/search?q=${encodeURIComponent(q)}&scope=library&limit=30`,
        null,
      ).then((result) => {
        if (!cancelled) setHits(result?.results ?? []);
      });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search]);

  // The ⋯ menu takes focus on its first item when it opens.
  useEffect(() => {
    if (menuOpen) moreMenu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [menuOpen]);

  // A selection that left this folder (moved, deleted) closes the details.
  useEffect(() => {
    if (selectedId && !boards.some((board) => board.id === selectedId)) setSelectedId(null);
  }, [boards, selectedId]);

  const openHit = async (hit: LibraryHit) => {
    const sequence = ++openHitSequence.current;
    await openBoard(hit.boardId);
    for (let attempt = 0; attempt < 40; attempt++) {
      if (sequence !== openHitSequence.current || activeBoardId.value !== hit.boardId) return;
      if (nodes.value.has(hit.cardId)) {
        focusNode(hit.cardId);
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    }
  };

  const toggle = (path: string) => {
    const next = new Set(collapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setCollapsed(next);
    writeCollapsed(next);
  };

  const goTo = (path: string) => {
    setFolder(path);
    setSearch('');
    setSelectedId(null);
    setPickerOpen(false);
  };

  const select = (id: string | null) => {
    setSelectedId(id);
    setMenuOpen(false);
    setConfirmingDelete(false);
  };

  const newFolder = async () => {
    const name = await askText('New folder', 'Folder name', { confirm: 'Create' });
    if (!name) return;
    let path: string | null;
    try {
      path = normalizeBoardCategory(folder ? `${folder}/${name}` : name);
    } catch {
      return;
    }
    if (!path) return;
    // A folder exists once a board is filed in it; until then it lives in this view.
    setExtraFolders((list) => [...list, path]);
    goTo(path);
  };

  const rename = async (board: BoardSummary) => {
    const name = await askText('Rename board', 'Board name', { initial: board.name, confirm: 'Rename' });
    if (name && name !== board.name) await updateBoard(board.id, { name });
  };

  const treeRow = (path: string, depth: number) => {
    const kids = childrenOf(path);
    const open = !collapsed.has(path);
    const count = boards.filter((board) => inFolder(board, path)).length;
    const hasPin = boards.some((board) => board.pin && inFolder(board, path));
    return (
      <li key={path}>
        <div class={`home-tree-row${folder === path && !query ? ' is-selected' : ''}`} data-folder={path}>
          <span class="home-tree-indent" style={{ width: `${depth * 16}px` }} />
          {kids.length > 0 ? (
            <button
              type="button"
              class="home-tree-chevron"
              aria-label={open ? `Fold ${leaf(path)}` : `Unfold ${leaf(path)}`}
              aria-expanded={open}
              onClick={() => toggle(path)}
            >
              {open ? <IconChevronDown /> : <IconChevronRight />}
            </button>
          ) : (
            <span class="home-tree-chevron" />
          )}
          <button type="button" class="home-tree-name" onClick={() => goTo(path)}>
            {leaf(path)}
          </button>
          {hasPin && <span class="home-tree-pin" aria-label="Has a board in the agent's context" />}
          <span class="home-tree-count">{count}</span>
        </div>
        {open && kids.length > 0 && <ul class="home-tree">{kids.map((kid) => treeRow(kid, depth + 1))}</ul>}
      </li>
    );
  };

  const tree = (
    <ul class="home-tree" aria-label="Folders">
      {childrenOf('').map((path) => treeRow(path, 0))}
      <li>
        <div class={`home-tree-row is-unfiled${folder === '' && !query ? ' is-selected' : ''}`}>
          <span class="home-tree-chevron" />
          <button type="button" class="home-tree-name" onClick={() => goTo('')}>
            Unfiled
          </button>
          <span class="home-tree-count">{boards.filter((board) => !board.category).length}</span>
        </div>
      </li>
    </ul>
  );

  const pinnedList = (
    <ul class="home-pinned" aria-label="Pinned boards">
      {pinned.map((board) => (
        <li key={board.id}>
          <button type="button" class="home-pinned-row" onClick={() => goTo(board.category ?? '')}>
            <span class="home-pin-dot" aria-hidden="true">
              <IconPin />
            </span>
            <span class="home-pinned-name">{board.name}</span>
            <span class="home-tree-count">{board.category ? leaf(board.category) : 'Unfiled'}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  const searchField = (
    <label class="home-search">
      <IconSearch />
      <span class="sr-only">Find boards, cards and folders</span>
      <input
        type="search"
        placeholder="Boards, cards, folders…"
        value={search}
        onInput={(event) => setSearch(event.currentTarget.value)}
      />
    </label>
  );

  const card = (board: BoardSummary) => (
    <li key={board.id}>
      <article
        class={`home-card${board.pin ? ' is-pinned' : ''}${selectedId === board.id ? ' is-selected' : ''}`}
        data-testid="home-board"
        data-board-id={board.id}
      >
        <button
          type="button"
          class="home-card-select"
          aria-label={board.name}
          aria-pressed={selectedId === board.id}
          onClick={() => select(board.id)}
          onDblClick={() => void openBoard(board.id)}
        >
          <BoardThumbnail board={board} />
          <span class="home-card-body">
            <span class="home-card-name">{board.name}</span>
            <span class="home-card-readme">{board.summary ?? 'No README yet.'}</span>
            <span class="home-card-meta">
              <span>{plural(board.nodeCount, 'card')}</span>
              {linkCount(board) > 0 && <span>↔ {plural(linkCount(board), 'link')}</span>}
              <span class="home-card-when">{openedAgo(board.lastOpenedAt)}</span>
            </span>
          </span>
        </button>
        <BoardPinButton board={board} />
      </article>
    </li>
  );

  const details = selected && (
    <aside class="home-details" aria-label="Board details" data-testid="home-details">
      <button type="button" class="home-details-grip" aria-label="Close details" onClick={() => select(null)} />
      <div class="home-details-head">
        <span class="home-details-folder">{selected.category ? leaf(selected.category) : 'Unfiled'}</span>
        <span class="home-details-name">{selected.name}</span>
      </div>
      <div class={`home-details-context${selected.pin ? ' is-on' : ''}`}>
        <span class="home-details-context-text">
          <span class="home-details-context-label">
            {selected.pin ? "In the agent's context" : "Not in the agent's context"}
          </span>
          <span class="home-details-context-meta">
            {[
              selected.summary ? 'README' : '',
              selected.pinnedTitles?.length ? plural(selected.pinnedTitles.length, 'pinned card') : '',
            ]
              .filter(Boolean)
              .join(' + ') || 'Nothing pinned yet'}
            {selected.mapChars ? ` · ≈ ${approxTokens(selected.mapChars)} tokens` : ''}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={!!selected.pin}
          aria-label="In the agent's context"
          class="home-switch"
          onClick={() => void setBoardPinned(selected.id, !selected.pin)}
        >
          <span class="home-switch-knob" />
        </button>
      </div>
      {selected.summary && (
        <section class="home-details-section">
          <span class="home-section-label">README</span>
          <p class="home-details-readme">{selected.summary}</p>
        </section>
      )}
      {(selected.pinnedTitles?.length ?? 0) > 0 && (
        <section class="home-details-section">
          <span class="home-section-label">Pinned cards · {selected.pinnedTitles?.length}</span>
          {selected.pinnedTitles?.map((pin) => (
            <div key={pin.nodeId} class="home-details-pinned">
              {pin.title}
            </div>
          ))}
        </section>
      )}
      {linkCount(selected) > 0 && (
        <section class="home-details-section">
          <span class="home-section-label">Links · {linkCount(selected)}</span>
          {selected.links?.map((link) => (
            <div key={link.nodeId} class="home-details-link">
              <span class="home-details-link-dir">→</span>
              <span class="home-details-link-name">{link.title ?? 'Missing board'}</span>
              <span class="home-details-link-kind">portal</span>
            </div>
          ))}
          {selected.backlinks?.map((link) => (
            <div key={`${link.boardId}:${link.nodeId}`} class="home-details-link">
              <span class="home-details-link-dir">←</span>
              <span class="home-details-link-name">{link.title}</span>
              <span class="home-details-link-kind">portal</span>
            </div>
          ))}
        </section>
      )}
      {confirmingDelete ? (
        <div class="home-details-confirm" role="alert">
          <span>
            Delete <strong>{selected.name}</strong> and its {plural(selected.nodeCount, 'card')} and snapshots? This
            can't be undone.
          </span>
          <span class="home-details-actions">
            <button type="button" class="home-button" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
            <button
              type="button"
              class="home-button is-danger"
              onClick={() => {
                setConfirmingDelete(false);
                void deleteBoard(selected.id);
              }}
            >
              Delete board
            </button>
          </span>
        </div>
      ) : (
        <div class="home-details-actions">
          <button type="button" class="home-button is-primary" onClick={() => void openBoard(selected.id)}>
            Open board
          </button>
          <span class="home-more">
            <button
              ref={moreButton}
              type="button"
              class="home-button is-icon"
              aria-label="More: move, rename, create from, delete"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <IconMore />
            </button>
            {menuOpen && (
              <span
                ref={moreMenu}
                class="home-more-menu"
                role="menu"
                onKeyDown={(event) => {
                  const items = [...(moreMenu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
                  const at = items.indexOf(document.activeElement as HTMLElement);
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setMenuOpen(false);
                    moreButton.current?.focus();
                  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    const step = event.key === 'ArrowDown' ? 1 : -1;
                    items[(at + step + items.length) % items.length]?.focus();
                  }
                }}
              >
                {(
                  [
                    ['Move…', () => setMoving(selected.id)],
                    ['Rename…', () => void rename(selected)],
                    ['Create from…', () => setCopying(selected.id)],
                    ['Delete…', () => setConfirmingDelete(true)],
                  ] as const
                ).map(([label, run]) => (
                  <button
                    key={label}
                    type="button"
                    role="menuitem"
                    class="home-more-item"
                    onClick={() => {
                      setMenuOpen(false);
                      run();
                    }}
                  >
                    {label}
                  </button>
                ))}
              </span>
            )}
          </span>
        </div>
      )}
    </aside>
  );

  return (
    <div class={`home-view${selected ? ' has-details' : ''}`} data-testid="home-view">
      <aside class={`home-library${pickerOpen ? ' is-open' : ''}`} aria-label="Library">
        <div class="home-library-head">
          <span class="home-library-title">Library</span>
          <span class="home-tree-count">{plural(boards.length, 'board')}</span>
        </div>
        {searchField}
        {pinned.length > 0 && (
          <section class="home-library-section">
            <span class="home-section-label">Pinned boards</span>
            {pinnedList}
            <span class="home-pinned-cost">
              ≈ {approxTokens(pinnedChars)} tokens · {plural(pinned.length, 'board')}
            </span>
          </section>
        )}
        <section class="home-library-section is-folders">
          <span class="home-section-label">Folders</span>
          {tree}
          <button type="button" class="home-tree-new" onClick={() => void newFolder()}>
            + New folder
          </button>
        </section>
      </aside>

      <main class="home-main">
        {/* Pane600.dc.html: at the narrow end the tree and the pins fold into these two rows. */}
        <div class="home-narrow">
          {searchField}
          {pinned.length > 0 && (
            <>
              <button
                type="button"
                class="home-narrow-context"
                aria-expanded={pinsOpen}
                onClick={() => setPinsOpen(!pinsOpen)}
              >
                <span class="home-pin-dot" aria-hidden="true">
                  <IconPin />
                </span>
                <span class="home-narrow-context-label">In context: {plural(pinned.length, 'board')}</span>
                <span class="home-narrow-context-cost">≈ {approxTokens(pinnedChars)} tokens</span>
                <span>{pinsOpen ? 'Hide ▴' : 'Show ▾'}</span>
              </button>
              {pinsOpen && pinnedList}
            </>
          )}
          <button
            type="button"
            class="home-narrow-picker"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen(!pickerOpen)}
          >
            {folder ? leaf(folder) : 'Library'}
            <span class="home-tree-count">
              · {folder ? boards.filter((board) => inFolder(board, folder)).length : here.length} ▾
            </span>
          </button>
        </div>

        <div class="home-main-head">
          <div class="home-main-title">
            <nav class="home-crumbs" aria-label="Folder path">
              <button type="button" onClick={() => goTo('')}>
                Library
              </button>
              {folder &&
                categoryAncestors(folder).map((path) => (
                  <span key={path}>
                    <span class="home-crumb-sep">/</span>
                    <button type="button" onClick={() => goTo(path)}>
                      {leaf(path)}
                    </button>
                  </span>
                ))}
            </nav>
            <h1 class="home-view-title">
              {query ? `Results for “${search.trim()}”` : folder ? leaf(folder) : 'Library'}
            </h1>
          </div>
          <button type="button" class="home-button is-primary" onClick={() => void promptNewBoard(folder || null)}>
            {folder ? 'New board here' : 'New board'}
          </button>
        </div>

        {boards.length === 0 ? (
          <div class="home-view-empty">No boards yet. Create one, or let an agent start writing — it opens one.</div>
        ) : query ? (
          <>
            {hits.length > 0 && (
              <section class="home-main-section">
                <span class="home-section-label">Cards · {hits.length}</span>
                <ul class="home-hits" aria-label="Library search results">
                  {hits.map((hit) => (
                    <li key={`${hit.boardId}:${hit.cardId}`}>
                      <button type="button" class="home-hit" onClick={() => void openHit(hit)}>
                        <span class="home-card-name">{hit.title || hit.boardTitle}</span>
                        <span class="home-card-meta">
                          {hit.boardTitle} · {hit.snippet}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {matches.length > 0 ? (
              <section class="home-main-section">
                <span class="home-section-label">Boards · {matches.length}</span>
                <ul class="home-cards">{matches.map(card)}</ul>
              </section>
            ) : (
              hits.length === 0 && (
                <div class="home-view-empty" role="status">
                  No boards match “{search.trim()}”.
                </div>
              )
            )}
          </>
        ) : (
          <>
            {subfolders.length > 0 && (
              <section class="home-main-section">
                <span class="home-section-label">Folders · {subfolders.length}</span>
                <ul class="home-folders">
                  {subfolders.map((path) => {
                    const inside = boards.filter((board) => inFolder(board, path));
                    const latest = inside
                      .map((board) => board.lastOpenedAt ?? '')
                      .sort()
                      .at(-1);
                    const inContext = inside.filter((board) => board.pin).length;
                    return (
                      <li key={path}>
                        <button
                          type="button"
                          class="home-folder"
                          data-testid="home-section"
                          data-folder={path}
                          onClick={() => goTo(path)}
                        >
                          <span class="home-folder-stack" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                          </span>
                          {inContext > 0 && <span class="home-folder-context">{inContext} in context</span>}
                          <span class="home-folder-name">{leaf(path)}</span>
                          <span class="home-folder-meta">
                            {plural(inside.length, 'board')}
                            {latest ? ` · opened ${openedAgo(latest)}` : ''}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            <section class="home-main-section">
              <span class="home-section-label">
                {folder ? `Boards in ${leaf(folder)}` : 'Unfiled boards'} · {shown.length}
              </span>
              {shown.length > 0 ? (
                <ul class="home-cards" aria-label={folder ? `Boards in ${folder}` : 'Unfiled boards'}>
                  {shown.map(card)}
                </ul>
              ) : (
                <div class="home-view-empty">No boards here yet.</div>
              )}
            </section>
          </>
        )}
      </main>

      {details}
      {movingBoard && (
        <BoardFolderDialog key={movingBoard.id} board={movingBoard} folders={folders} onClose={() => setMoving(null)} />
      )}
      {copyingBoard && <BoardCopyDialog key={copyingBoard.id} board={copyingBoard} onClose={() => setCopying(null)} />}
    </div>
  );
}
