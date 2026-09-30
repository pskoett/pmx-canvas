import { render, type VNode } from 'preact';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { activeBoard, activeBoardId, boardList, boardsLoaded, openBoard } from '../state/boards-store';
import { IconLogo, IconArrange, IconChevronDown, IconPlus } from '../icons';
import { promptNewBoard } from './HomeView';

const RECENT_LIMIT = 8;

/** Escape the top bar's filter/clip without installing React-compat event hooks. */
function BoardMenuPortal({ children }: { children: VNode }) {
  const host = useMemo(() => document.createElement('div'), []);
  useLayoutEffect(() => {
    document.body.appendChild(host);
    return () => {
      render(null, host);
      host.remove();
    };
  }, [host]);
  useLayoutEffect(() => render(children, host), [children, host]);
  return null;
}

/**
 * The top bar's board identity (plan 012): the open board's name, or "Home".
 * Clicking it lists recent boards, New board, and Home. The menu is fixed-
 * positioned so the bar's overflow clip cannot cut it off.
 */
export function BoardSwitcher({ fallbackName }: { fallbackName: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target) && !menuRef.current?.contains(e.target))
        setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    // Canvas gestures stop bubbling; dismiss before those handlers run.
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
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
          <IconChevronDown />
        </span>
      </button>
      {open && anchor && (
        <BoardMenuPortal>
          <div
            ref={menuRef}
            class="toolbar-menu board-switcher-menu"
            role="menu"
            aria-label="Boards"
            style={{
              position: 'fixed',
              left: `min(${anchor.left}px, max(12px, calc(100vw - 352px)))`,
              top: `${anchor.bottom + 8}px`,
              right: 'auto',
              maxHeight: `min(70vh, calc(100dvh - ${anchor.bottom + 20}px))`,
            }}
          >
            {recent.length > 0 && <div class="board-switcher-heading">Recent boards</div>}
            <div class="board-switcher-recents">
              {recent.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="menuitem"
                  class="toolbar-menu-item"
                  onClick={() => choose(entry.id)}
                >
                  <span class="board-switcher-icon" aria-hidden="true">
                    <IconLogo size={18} />
                  </span>
                  <span class="board-switcher-item-copy">
                    <span class="board-switcher-item-name">{entry.name}</span>
                    <span class="board-switcher-item-folder">
                      {entry.category?.split('/').join(' / ') || 'Unfiled'}
                    </span>
                  </span>
                  <span class="board-switcher-item-meta">
                    {entry.nodeCount} {entry.nodeCount === 1 ? 'node' : 'nodes'}
                  </span>
                </button>
              ))}
            </div>
            <div class="board-switcher-actions">
              <button
                type="button"
                role="menuitem"
                class="toolbar-menu-item"
                onClick={() => {
                  setOpen(false);
                  void promptNewBoard();
                }}
              >
                <span class="board-switcher-icon" aria-hidden="true">
                  <IconPlus size={18} />
                </span>
                New board…
              </button>
              <button type="button" role="menuitem" class="toolbar-menu-item" onClick={() => choose(null)}>
                <span class="board-switcher-icon" aria-hidden="true">
                  <IconArrange size={18} />
                </span>
                All boards (Home)
              </button>
            </div>
          </div>
        </BoardMenuPortal>
      )}
    </span>
  );
}
