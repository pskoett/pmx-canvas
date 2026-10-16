import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { BarPortal } from './BarHint';
import { agentSessionsEnabled, knowledgeLifecycleEnabled, workspaceSettings } from '../state/workspace-settings';
import type { WorkspaceSettings } from '../../shared/workspace-settings.js';
import { attachedSessions } from '../state/presence-store';
import { heldGates, pendingGates, scopeFence, sessionPanelOpened } from '../state/session-store';
import { isHostedWorkbench, workbenchFetch } from '../state/workbench-transport';
import {
  IconArrange,
  IconCursorTool,
  IconEraser,
  IconHandTool,
  IconLogo,
  IconNodeGroup,
  IconNodeMarkdown,
  IconNodeWebpage,
  IconPen,
  IconSearch,
  IconTextAnnotation,
  IconUpload,
} from '../icons';
import {
  autoArrange,
  canvasTheme,
  canvasTool,
  edges,
  forceDirectedArrange,
  nodes,
  traceEnabled,
  viewport,
} from '../state/canvas-store';
import { importFiles } from './import-files';
import { canvasArea } from './canvas-area';
import { requestJson, saveCanvasTheme } from '../state/intent-bridge';
import { browsingMemory, openBoard } from '../state/boards-store';
import { createNodeInView } from './create-in-view';
import { askText } from './TextPrompt';
import { FeedbackDialog } from './FeedbackDialog';
import { clearThemeOverride } from '../state/theme-override';
import { invalidateTokenCache } from '../theme/tokens';
import type { AnnotationTool } from '../types';
import { modChord } from '../utils/platform';
import {
  CANVAS_THEMES,
  CANVAS_THEME_META,
  type CanvasThemeName,
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

/** Menu descriptions escape its scrolling container and also work with keyboard focus. */
function SettingsItem({
  label,
  description,
  hint,
  beta,
  toggle = beta,
  checked,
  disabled,
  onClick,
}: {
  label: string;
  description: string;
  hint?: string;
  beta?: boolean;
  toggle?: boolean;
  checked?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const id = useId();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const show = (event: Event) => setAnchor((event.currentTarget as HTMLElement).getBoundingClientRect());
  const hide = () => setAnchor(null);
  return (
    <>
      <button
        type="button"
        role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
        aria-label={beta ? `${label} (Beta)` : label}
        aria-checked={checked}
        aria-describedby={anchor ? id : undefined}
        class="toolbar-menu-item"
        aria-disabled={disabled || undefined}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => {
          if (disabled) return;
          hide();
          onClick();
        }}
      >
        <span class="settings-item-label">
          {label} {beta && <span class="beta-tag">Beta</span>}
        </span>
        {toggle ? (
          <span class={`settings-switch${checked ? ' is-on' : ''}`} aria-hidden="true" />
        ) : hint ? (
          <span class="toolbar-menu-hint">{hint}</span>
        ) : null}
      </button>
      {anchor && (
        <BarPortal>
          <span
            id={id}
            class="toolbar-tooltip settings-tooltip"
            role="tooltip"
            ref={(tip) => {
              if (!tip) return;
              const beside = window.innerWidth - anchor.right >= tip.offsetWidth + 20;
              tip.style.left = `${beside ? anchor.right + 10 : Math.max(12, Math.min(anchor.left, window.innerWidth - tip.offsetWidth - 12))}px`;
              tip.style.top = `${Math.max(12, Math.min(beside ? anchor.top : anchor.top - tip.offsetHeight - 8, window.innerHeight - tip.offsetHeight - 12))}px`;
            }}
          >
            <span class="toolbar-tooltip-label">
              {label}
              {beta ? ' (Beta)' : ''}
            </span>
            <span class="toolbar-tooltip-body">{description}</span>
          </span>
        </BarPortal>
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
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState(false);
  const setBeta = async (key: keyof WorkspaceSettings) => {
    if (savingSettings || !workspaceSettings.value) return;
    setSavingSettings(true);
    setSettingsError(false);
    try {
      const result = await requestJson<{ ok: boolean }>(
        'saveWorkspaceSettings',
        '/api/canvas/settings',
        { ok: false },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [key]: !workspaceSettings.value[key] }),
        },
      );
      // Ordered SSE/poll frames, never a late POST acknowledgement, own the switches.
      setSettingsError(result.ok !== true);
    } finally {
      setSavingSettings(false);
    }
  };
  // The Settings menu (docs/design/Chrome.dc.html §7) and the view it shows.
  const [openMenu, setOpenMenu] = useState<null | 'settings' | 'theme'>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ bottom: number; right: number } | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const toggleSettings = (e: MouseEvent) => {
    if (openMenu) {
      setOpenMenu(null);
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuAnchor({ bottom: rect.bottom, right: rect.right });
    setOpenMenu('settings');
  };
  /** Run a Settings action and close the menu; focus returns to the Settings button. */
  const choose = (action: () => void) => () => {
    setOpenMenu(null);
    snapshotBtnRef.current?.focus();
    action();
  };

  // The rail scrolls (overflow-y:auto), so an absolutely-positioned popover
  // would be clipped by it. Fixed positioning from the trigger's rect escapes
  // the scroll container; the menu bottom-aligns so it grows upward.
  const sideMenuStyle = menuAnchor
    ? {
        position: 'fixed' as const,
        left: `${menuAnchor.right + 8}px`,
        bottom: `${Math.max(10, window.innerHeight - menuAnchor.bottom)}px`,
        top: 'auto',
        right: 'auto',
      }
    : undefined;

  useLayoutEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (railRef.current && e.target instanceof Node && !railRef.current.contains(e.target)) setOpenMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpenMenu(null);
        snapshotBtnRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    // Own Escape even when a saving toggle has temporarily moved focus to body.
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
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
    workbenchFetch(`/api/workbench/intent?_ts=${Date.now()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload }),
    }).catch((error) => logRailError('sendIntent', error));
  };

  return (
    <>
      <div class="tool-rail" ref={railRef} role="toolbar" aria-label="Canvas tools" aria-orientation="vertical">
        <RailButton
          label="Home"
          ariaLabel="PMX Canvas — Home"
          onClick={() => {
            setOpenMenu(null);
            void openBoard(null).catch((error) => logRailError('openHome', error));
          }}
        >
          <span class="rail-brand">
            <IconLogo size={22} />
          </span>
        </RailButton>

        {!browsingMemory.value && (
          <>
            <div class="rail-divider" />

            <RailButton
              label="Select"
              shortcut="V"
              active={tool === 'select'}
              onClick={() => (canvasTool.value = 'select')}
            >
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
            <RailButton
              label="Attach files"
              ariaLabel="Attach files"
              detail="Images (PNG, JPEG, SVG…), Markdown and text/code files. PDF, Word, Excel, PowerPoint and OpenDocument use agent import with review."
              onClick={() => fileInput.current?.click()}
            >
              <IconUpload size={15} />
            </RailButton>
            <input
              ref={fileInput}
              type="file"
              hidden
              multiple
              aria-label="Attach files"
              onChange={(event) => {
                const area = canvasArea();
                const view = viewport.value;
                void importFiles(
                  Array.from(event.currentTarget.files ?? []),
                  (area.width / 2 - view.x) / view.scale,
                  (area.height / 2 - view.y) / view.scale,
                );
                event.currentTarget.value = '';
              }}
            />
            <RailButton label="Webpage" shortcut="W" onClick={() => promptedCreate('webpage')}>
              <IconNodeWebpage size={15} />
            </RailButton>
            <RailButton
              label="Group"
              shortcut="G"
              onClick={() =>
                void createNodeInView({ type: 'group', title: 'Group' }).catch((error) =>
                  logRailError('create group', error),
                )
              }
            >
              <IconNodeGroup size={15} />
            </RailButton>
            <RailButton
              label="Draw"
              shortcut="A"
              active={annotationTool === 'pen'}
              onClick={() => onSetAnnotationTool(annotationTool === 'pen' ? null : 'pen')}
            >
              <IconPen />
            </RailButton>
            <RailButton
              label="Text note"
              active={annotationTool === 'text'}
              onClick={() => onSetAnnotationTool(annotationTool === 'text' ? null : 'text')}
            >
              <IconTextAnnotation />
            </RailButton>
            <RailButton
              label="Eraser"
              active={annotationTool === 'eraser'}
              onClick={() => onSetAnnotationTool(annotationTool === 'eraser' ? null : 'eraser')}
            >
              <IconEraser />
            </RailButton>

            <div class="rail-divider" />
          </>
        )}

        {!browsingMemory.value && (
          <RailButton label="Search & commands" shortcut={modChord('K')} onClick={onOpenPalette}>
            <IconSearch />
          </RailButton>
        )}
        {!browsingMemory.value && (
          <RailButton
            label="Arrange"
            detail={edgeCount > 0 ? 'graph-aware' : 'grid'}
            onClick={() => (edgeCount > 0 ? forceDirectedArrange() : autoArrange())}
          >
            <IconArrange />
          </RailButton>
        )}
        <div class="rail-spacer" />
        <span class="toolbar-menu-anchor">
          <RailButton
            label="Settings"
            detail="Appearance, board tools, beta features, and feedback"
            ariaLabel="Settings"
            menuOpen={openMenu !== null}
            active={openMenu !== null || snapshotOpen}
            onClick={toggleSettings}
            btnRef={snapshotBtnRef}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M4 7h9M17 7h3M4 17h3M11 17h9M13 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0" />
            </svg>
          </RailButton>
          {openMenu === 'settings' && (
            <div class="toolbar-menu rail-settings-menu" style={sideMenuStyle} role="menu" aria-label="Settings">
              <SettingsItem
                label="Theme"
                description="Choose the canvas appearance. Your choice is saved with the board."
                hint={`${CANVAS_THEME_META[activeTheme].label} ›`}
                onClick={() => setOpenMenu('theme')}
              />
              {!browsingMemory.value && (
                <>
                  <SettingsItem
                    label="Snapshots"
                    description="Save a board checkpoint, compare changes, or restore an earlier version."
                    onClick={choose(onToggleSnapshot)}
                  />
                  <SettingsItem
                    label="Minimap"
                    description="Show a small overview of the board. Drag its viewport to move around the canvas."
                    checked={minimapVisible}
                    hint={minimapVisible ? 'On' : 'Off'}
                    onClick={choose(onToggleMinimap)}
                  />
                </>
              )}
              <SettingsItem
                label="Keyboard shortcuts"
                description="See shortcuts for creating cards, selecting, navigating, and editing the canvas."
                hint="?"
                onClick={choose(onOpenShortcuts)}
              />
              <div class="toolbar-menu-divider" role="separator" />
              <span class="settings-caption">Beta features · workspace-wide · off by default</span>
              <SettingsItem
                label="Agent sessions"
                beta
                checked={agentSessionsEnabled.value}
                disabled={!workspaceSettings.value || savingSettings}
                description="Show session chips, tasks, timeline, steering composer, and receipts. Turning off hides these without ending attached agents. Approvals and edit protections remain available. Saved for this workspace."
                onClick={() => void setBeta('agentSessions')}
              />
              <SettingsItem
                label="Knowledge lifecycle"
                beta
                checked={knowledgeLifecycleEnabled.value}
                disabled={!workspaceSettings.value || savingSettings}
                description="Show Review, review policies, categories, and due or retired indicators. Turning off hides lifecycle tools without deleting their data or drafts. Saved for this workspace."
                onClick={() => void setBeta('knowledgeLifecycle')}
              />
              {settingsError && (
                <p class="settings-error" role="alert">
                  Could not save settings. Try again.
                </p>
              )}
              {!agentSessionsEnabled.value &&
                (attachedSessions.value.length > 0 ||
                  pendingGates.value.length > 0 ||
                  heldGates.value.length > 0 ||
                  scopeFence.value) && (
                  <SettingsItem
                    label="Agent controls"
                    description="Review pending approvals, inspect or clear the write scope, or end an existing attachment without enabling the session beta."
                    onClick={choose(() => (sessionPanelOpened.value = true))}
                  />
                )}
              <div class="toolbar-menu-divider" role="separator" />
              {!isHostedWorkbench() && !browsingMemory.value && (
                <>
                  <SettingsItem
                    label="Trace"
                    description="Show execution traces sent by connected tools. Turning off keeps existing traces. This does not start an agent."
                    toggle
                    checked={isTraceOn}
                    onClick={() => sendIntent('trace-toggle', { enabled: !isTraceOn })}
                  />
                  {(isTraceOn || traceNodeCount > 0) && (
                    <SettingsItem
                      label="Clear trace"
                      description="Remove recorded execution traces from this board without changing whether trace capture is enabled."
                      onClick={choose(() => sendIntent('trace-clear'))}
                    />
                  )}
                </>
              )}
              <SettingsItem
                label="Send feedback"
                description="Report a problem or suggestion. Review the feedback before sending."
                onClick={choose(() => setFeedbackOpen(true))}
              />
            </div>
          )}
          {openMenu === 'theme' && (
            <div class="toolbar-menu" style={sideMenuStyle} role="menu" aria-label="Theme">
              <button type="button" role="menuitem" class="toolbar-menu-item" onClick={() => setOpenMenu('settings')}>
                <span>‹ Settings</span>
              </button>
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
      </div>
      {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
    </>
  );
}
