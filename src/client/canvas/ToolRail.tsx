import { useEffect, useRef, useState } from 'preact/hooks';
import {
  IconArrange,
  IconClearTrace,
  IconCursorTool,
  IconEraser,
  IconHandTool,
  IconLogo,
  IconMinimap,
  IconMoon,
  IconNodeFile,
  IconNodeGroup,
  IconNodeHtml,
  IconNodeImage,
  IconNodeMarkdown,
  IconNodeWebpage,
  IconPen,
  IconSearch,
  IconShortcuts,
  IconSnapshot,
  IconSun,
  IconTextAnnotation,
  IconTrace,
} from '../icons';
import {
  autoArrange,
  canvasTheme,
  canvasTool,
  edges,
  forceDirectedArrange,
  nodes,
  traceEnabled,
} from '../state/canvas-store';
import { saveCanvasTheme } from '../state/intent-bridge';
import { createNodeInView } from './create-in-view';
import { askText } from './TextPrompt';
import { clearThemeOverride } from '../state/theme-override';
import { invalidateTokenCache } from '../theme/tokens';
import type { AnnotationTool } from '../types';
import { MOD_KEY } from '../utils/platform';
import {
  CANVAS_THEMES,
  CANVAS_THEME_META,
  type CanvasThemeName,
  canvasThemeScheme,
  normalizeCanvasThemeName,
} from '../../shared/themes.js';

function logRailError(action: string, error: unknown): void {
  console.error(`[tool-rail] ${action} failed`, error);
}

/** Prompt-driven creates for node kinds that need a source (url / path). */
export function promptedCreate(kind: 'image' | 'file' | 'webpage'): void {
  const ask: Record<typeof kind, { message: string; placeholder: string }> = {
    image: { message: 'Image URL (https://… or data:image/…)', placeholder: 'https://example.com/diagram.png' },
    file: { message: 'Workspace file path', placeholder: 'src/server/server.ts' },
    webpage: { message: 'Page URL', placeholder: 'https://example.com' },
  };
  // In-canvas prompt — `window.prompt` is silently a no-op in embedded panes.
  void askText(ask[kind].message, ask[kind].placeholder).then((value) => {
    if (!value) return;
    void createNodeInView({ type: kind, content: value }).catch((error) => logRailError(`create ${kind}`, error));
  });
}

/**
 * A rail button with its hover/focus tooltip (label + shortcut key cap, the
 * top bar's `BarHint` look). The rail scrolls (overflow-y:auto), so a CSS-only
 * tooltip would be clipped inside the 52px column — like the side menus, the
 * tooltip is positioned FIXED from the button's rect. No native `title`: it
 * would double the tooltip a second later (and never shows in some embedded
 * browser panes at all). The accessible name keeps the "Label (Shortcut)" form.
 */
function RailButton({
  label,
  shortcut,
  detail,
  ariaLabel,
  active,
  menuOpen,
  onClick,
  btnRef,
  children,
}: {
  label: string;
  shortcut?: string;
  detail?: string;
  ariaLabel?: string;
  active?: boolean;
  /** The button's own popover is open — its tooltip would sit on top of it. */
  menuOpen?: boolean;
  onClick: (e: MouseEvent) => void;
  btnRef?: { current: HTMLButtonElement | null };
  children: preact.ComponentChildren;
}) {
  const [hint, setHint] = useState<{ left: number; top: number } | null>(null);
  const show = (e: Event) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHint({ left: rect.right + 10, top: rect.top + rect.height / 2 });
  };
  const hide = () => setHint(null);
  const name = ariaLabel ?? (shortcut ? `${label} (${shortcut})` : detail ? `${label} (${detail})` : label);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        class={`rail-btn${active ? ' active' : ''}`}
        aria-label={name}
        aria-pressed={active === undefined ? undefined : active}
        onClick={(e) => {
          hide();
          onClick(e);
        }}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </button>
      {hint && !menuOpen && (
        <span
          class="toolbar-tooltip rail-tooltip"
          role="tooltip"
          data-testid="rail-tooltip"
          style={{ left: `${hint.left}px`, top: `${hint.top}px` }}
        >
          <span class="toolbar-tooltip-label">{label}</span>
          {(shortcut || detail) && (
            <span class="toolbar-tooltip-meta">
              {shortcut && <kbd class="toolbar-tooltip-shortcut">{shortcut}</kbd>}
              {detail && <span>{detail}</span>}
            </span>
          )}
        </span>
      )}
    </>
  );
}

/**
 * The persistent 52px left tool rail (rail-chrome-v2 phase 1): brand → tools →
 * node palette → utilities. Every button shows a hover/focus tooltip with its
 * shortcut (`RailButton`) — the rail is the shortcut discovery surface.
 */
export function ToolRail({
  minimapVisible,
  onToggleMinimap,
  snapshotOpen,
  onToggleSnapshot,
  snapshotBtnRef,
  onOpenPalette,
  onOpenShortcuts,
  annotationTool,
  onSetAnnotationTool,
}: {
  minimapVisible: boolean;
  onToggleMinimap: () => void;
  snapshotOpen: boolean;
  onToggleSnapshot: () => void;
  snapshotBtnRef: { current: HTMLButtonElement | null };
  onOpenPalette: () => void;
  onOpenShortcuts: () => void;
  annotationTool: AnnotationTool;
  onSetAnnotationTool: (tool: AnnotationTool) => void;
}) {
  const tool = canvasTool.value;
  const isTraceOn = traceEnabled.value;
  const traceNodeCount = Array.from(nodes.value.values()).filter((n) => n.type === 'trace').length;
  const edgeCount = edges.value.size;
  const [openMenu, setOpenMenu] = useState<null | 'theme' | 'annotate'>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; bottom: number; right: number } | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  const toggleMenu = (menu: 'theme' | 'annotate') => (e: MouseEvent) => {
    if (openMenu === menu) {
      setOpenMenu(null);
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuAnchor({ top: rect.top, bottom: rect.bottom, right: rect.right });
    setOpenMenu(menu);
  };

  // The rail scrolls (overflow-y:auto), so an absolutely-positioned popover
  // would be clipped by it. Fixed positioning from the trigger's rect escapes
  // the scroll container; the annotate menu top-aligns with its trigger, the
  // theme menu (bottom cluster) bottom-aligns so it grows upward.
  const sideMenuStyle = (alignBottom: boolean) =>
    menuAnchor
      ? alignBottom
        ? {
            position: 'fixed' as const,
            left: `${menuAnchor.right + 8}px`,
            bottom: `${window.innerHeight - menuAnchor.bottom}px`,
            top: 'auto',
            right: 'auto',
          }
        : { position: 'fixed' as const, left: `${menuAnchor.right + 8}px`, top: `${menuAnchor.top}px`, right: 'auto' }
      : undefined;

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (railRef.current && e.target instanceof Node && !railRef.current.contains(e.target)) setOpenMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  const applyTheme = (next: CanvasThemeName) => {
    clearThemeOverride();
    document.documentElement.setAttribute('data-theme', next);
    invalidateTokenCache();
    canvasTheme.value = next;
    void saveCanvasTheme(next);
    setOpenMenu(null);
  };
  const activeTheme = normalizeCanvasThemeName(canvasTheme.value);

  const sendIntent = (type: string, payload: Record<string, unknown> = {}) => {
    fetch(`/api/workbench/intent?_ts=${Date.now()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload }),
    }).catch((error) => logRailError('sendIntent', error));
  };

  return (
    <div class="tool-rail" ref={railRef} role="toolbar" aria-label="Canvas tools" aria-orientation="vertical">
      <span class="rail-brand" title="PMX Canvas" aria-label="PMX Canvas">
        <IconLogo size={22} />
      </span>

      <div class="rail-divider" />

      <RailButton label="Select" shortcut="V" active={tool === 'select'} onClick={() => (canvasTool.value = 'select')}>
        <IconCursorTool />
      </RailButton>
      <RailButton label="Pan" shortcut="Space" active={tool === 'pan'} onClick={() => (canvasTool.value = 'pan')}>
        <IconHandTool />
      </RailButton>
      <RailButton
        label="Connect"
        shortcut="C"
        active={tool === 'connect'}
        onClick={() => (canvasTool.value = 'connect')}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <circle cx="4" cy="4" r="2" />
          <circle cx="12" cy="12" r="2" />
          <path d="M5.5 5.5 C 8 8, 8 8, 10.5 10.5" />
        </svg>
      </RailButton>

      <div class="rail-divider" />

      <RailButton
        label="Markdown note"
        shortcut="M"
        onClick={() =>
          void createNodeInView({ type: 'markdown', title: 'New note', width: 520, height: 360 }).catch((error) =>
            logRailError('create markdown', error),
          )
        }
      >
        <IconNodeMarkdown size={15} />
      </RailButton>
      <RailButton label="Image" shortcut="I" onClick={() => promptedCreate('image')}>
        <IconNodeImage size={15} />
      </RailButton>
      <RailButton label="File" shortcut="Shift+F" onClick={() => promptedCreate('file')}>
        <IconNodeFile size={15} />
      </RailButton>
      <RailButton label="Webpage" shortcut="W" onClick={() => promptedCreate('webpage')}>
        <IconNodeWebpage size={15} />
      </RailButton>
      <RailButton
        label="HTML surface"
        shortcut="H"
        onClick={() =>
          void createNodeInView({ type: 'html', title: 'HTML surface' }).catch((error) =>
            logRailError('create html', error),
          )
        }
      >
        <IconNodeHtml />
      </RailButton>
      <RailButton
        label="Group"
        shortcut="G"
        onClick={() =>
          void createNodeInView({ type: 'group', title: 'Group' }).catch((error) => logRailError('create group', error))
        }
      >
        <IconNodeGroup size={15} />
      </RailButton>
      <span class="toolbar-menu-anchor">
        <RailButton
          label="Annotate"
          shortcut="A"
          detail="Draw · Text note · Eraser"
          active={annotationTool !== null}
          menuOpen={openMenu === 'annotate'}
          onClick={toggleMenu('annotate')}
        >
          {annotationTool === 'eraser' ? (
            <IconEraser />
          ) : annotationTool === 'text' ? (
            <IconTextAnnotation />
          ) : (
            <IconPen />
          )}
        </RailButton>
        {openMenu === 'annotate' && (
          <div class="toolbar-menu" style={sideMenuStyle(false)} role="menu" aria-label="Annotate">
            <button
              type="button"
              class={`toolbar-menu-item${annotationTool === 'pen' ? ' active' : ''}`}
              onClick={() => {
                onSetAnnotationTool(annotationTool === 'pen' ? null : 'pen');
                setOpenMenu(null);
              }}
            >
              <IconPen />
              <span>{annotationTool === 'pen' ? 'Stop annotating' : 'Draw (A)'}</span>
            </button>
            <button
              type="button"
              class={`toolbar-menu-item${annotationTool === 'text' ? ' active' : ''}`}
              onClick={() => {
                onSetAnnotationTool(annotationTool === 'text' ? null : 'text');
                setOpenMenu(null);
              }}
            >
              <IconTextAnnotation />
              <span>{annotationTool === 'text' ? 'Stop text notes' : 'Text note'}</span>
            </button>
            <button
              type="button"
              class={`toolbar-menu-item${annotationTool === 'eraser' ? ' active' : ''}`}
              onClick={() => {
                onSetAnnotationTool(annotationTool === 'eraser' ? null : 'eraser');
                setOpenMenu(null);
              }}
            >
              <IconEraser />
              <span>{annotationTool === 'eraser' ? 'Stop erasing' : 'Eraser'}</span>
            </button>
          </div>
        )}
      </span>

      <div class="rail-spacer" />

      <RailButton label="Search & commands" shortcut={`${MOD_KEY}+K`} onClick={onOpenPalette}>
        <IconSearch />
      </RailButton>
      <RailButton
        label="Arrange"
        detail={edgeCount > 0 ? 'graph-aware' : 'grid'}
        onClick={() => (edgeCount > 0 ? forceDirectedArrange() : autoArrange())}
      >
        <IconArrange />
      </RailButton>
      <RailButton
        label={isTraceOn ? 'Disable trace' : 'Enable trace'}
        active={isTraceOn}
        onClick={() => sendIntent('trace-toggle', { enabled: !isTraceOn })}
      >
        <IconTrace />
      </RailButton>
      {(isTraceOn || traceNodeCount > 0) && (
        <RailButton label="Clear trace" onClick={() => sendIntent('trace-clear')}>
          <IconClearTrace />
        </RailButton>
      )}
      <RailButton
        label={minimapVisible ? 'Hide minimap' : 'Show minimap'}
        active={minimapVisible}
        onClick={onToggleMinimap}
      >
        <IconMinimap />
      </RailButton>
      <RailButton label="Snapshots" active={snapshotOpen} onClick={onToggleSnapshot} btnRef={snapshotBtnRef}>
        <IconSnapshot />
      </RailButton>
      <span class="toolbar-menu-anchor">
        <RailButton
          label="Theme"
          detail={CANVAS_THEME_META[activeTheme].label}
          menuOpen={openMenu === 'theme'}
          ariaLabel="Choose theme"
          active={openMenu === 'theme'}
          onClick={toggleMenu('theme')}
        >
          {canvasThemeScheme(activeTheme) === 'dark' ? <IconSun /> : <IconMoon />}
        </RailButton>
        {openMenu === 'theme' && (
          <div class="toolbar-menu" style={sideMenuStyle(true)} role="menu" aria-label="Theme">
            {CANVAS_THEMES.map((name) => (
              <button
                key={name}
                type="button"
                role="menuitemradio"
                aria-checked={activeTheme === name}
                class={`toolbar-menu-item${activeTheme === name ? ' active' : ''}`}
                onClick={() => applyTheme(name)}
              >
                <span class="theme-swatch" style={{ background: CANVAS_THEME_META[name].swatchBg }}>
                  <span class="theme-swatch-dot" style={{ background: CANVAS_THEME_META[name].swatchAccent }} />
                </span>
                <span>{CANVAS_THEME_META[name].label}</span>
                {activeTheme === name && (
                  <span class="toolbar-menu-check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </span>
      <RailButton label="Shortcuts" shortcut="?" onClick={onOpenShortcuts}>
        <IconShortcuts />
      </RailButton>
    </div>
  );
}
