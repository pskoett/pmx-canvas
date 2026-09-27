import { useEffect, useRef, useState } from 'preact/hooks';
import { activeBoard, activeBoardId, boardList, boardsLoaded, openBoard } from '../state/boards-store';
import { promptNewBoard } from './HomeView';

const RECENT_LIMIT = 8;

/**
 * The top bar's board identity (plan 012): the open board's name, or "Home".
 * Clicking it lists recent boards, New board, and Home. The menu is fixed-
 * positioned so the bar's overflow clip cannot cut it off.
 */
export function BoardSwitcher({ fallbackName }: { fallbackName: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const board = activeBoard();
  const label = !boardsLoaded.value ? fallbackName : board ? board.name : 'Home';
  const recent = boardList.value.filter((entry) => entry.id !== activeBoardId.value).slice(0, RECENT_LIMIT);
  const anchor = buttonRef.current?.getBoundingClientRect();

  const choose = (id: string | null) => {
    setOpen(false);
    void openBoard(id);
  };

  return (
    <span class="board-switcher" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        class="top-bar-title board-switcher-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Board: ${label}. Switch board`}
        onClick={() => setOpen((value) => !value)}
      >
        <span class="board-switcher-name">{label}</span>
        <span class="board-switcher-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && anchor && (
        <div
          class="toolbar-menu board-switcher-menu"
          role="menu"
          aria-label="Boards"
          style={{ position: 'fixed', left: `${anchor.left}px`, top: `${anchor.bottom + 6}px`, right: 'auto' }}
        >
          {recent.length > 0 && <div class="board-switcher-heading">Recent boards</div>}
          {recent.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              class="toolbar-menu-item"
              onClick={() => choose(entry.id)}
            >
              <span class="board-switcher-item-name">{entry.name}</span>
              <span class="board-switcher-item-meta">{entry.nodeCount}</span>
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            class="toolbar-menu-item"
            onClick={() => {
              setOpen(false);
              void promptNewBoard();
            }}
          >
            New board…
          </button>
          <button type="button" role="menuitem" class="toolbar-menu-item" onClick={() => choose(null)}>
            All boards (Home)
          </button>
        </div>
      )}
    </span>
  );
}
