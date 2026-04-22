import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { AttentionHistory } from './canvas/AttentionHistory';
import { AttentionToast } from './canvas/AttentionToast';
import { CanvasViewport } from './canvas/CanvasViewport';
import { CommandPalette } from './canvas/CommandPalette';
import { ContextMenu, useContextMenu } from './canvas/ContextMenu';
import { ContextPinBar } from './canvas/ContextPinBar';
import { DockedNode } from './canvas/DockedNode';
import { ExpandedNodeOverlay } from './canvas/ExpandedNodeOverlay';
import { Minimap } from './canvas/Minimap';
import { SelectionBar } from './canvas/SelectionBar';
import { ShortcutOverlay } from './canvas/ShortcutOverlay';
import { SnapshotPanel } from './canvas/SnapshotPanel';
import {
  activeNodeId,
  animateViewport,
  autoArrange,
  canvasTheme,
  clearSelection,
  collapseExpandedNode,
  connectionStatus,
  contextPinnedNodeIds,
  cycleActiveNode,
  edges,
  expandedNodeId,
  fitAll,
  forceDirectedArrange,
  hasInitialServerLayout,
  nodes,
  persistLayout,
  selectedNodeIds,
  sessionId,
  setViewport,
  traceEnabled,
  viewport,
  walkGraph,
} from './state/canvas-store';
import { connectSSE } from './state/sse-bridge';
import {
  IconArrange,
  IconClearTrace,
  IconFitAll,
  IconLogo,
  IconMinimap,
  IconMoon,
  IconResetView,
  IconSearch,
  IconShortcuts,
  IconSnapshot,
  IconSun,
  IconTrace,
  IconZoomIn,
  IconZoomOut,
} from './icons';
import { invalidateTokenCache } from './theme/tokens';
import { MOD_KEY } from './utils/platform';

function logAppError(action: string, error: unknown): void {
  console.error(`[app] ${action} failed`, error);
}

function sendIntent(type: string, payload: Record<string, unknown> = {}): void {
  fetch(`/api/workbench/intent?_ts=${Date.now()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, payload }),
  }).catch((error) => {
    logAppError('sendIntent', error);
  });
}

function ToolbarHint({
  label,
  detail,
  shortcut,
  align = 'center',
  children,
}: {
  label: string;
  detail?: string;
  shortcut?: string;
  align?: 'start' | 'center' | 'end';
  children: ComponentChildren;
}) {
  return (
    <span class={`toolbar-tooltip-anchor toolbar-tooltip-anchor-${align}`}>
      {children}
      <span class="toolbar-tooltip" role="tooltip">
        <span class="toolbar-tooltip-label">{label}</span>
        {(detail || shortcut) && (
          <span class="toolbar-tooltip-meta">
            {detail && <span>{detail}</span>}
            {shortcut && <kbd class="toolbar-tooltip-shortcut">{shortcut}</kbd>}
          </span>
        )}
      </span>
    </span>
  );
}

function Toolbar({
  minimapVisible,
  onToggleMinimap,
  snapshotOpen,
  onToggleSnapshot,
  snapshotBtnRef,
  onOpenPalette,
  onOpenShortcuts,
}: {
  minimapVisible: boolean;
  onToggleMinimap: () => void;
  snapshotOpen: boolean;
  onToggleSnapshot: () => void;
  snapshotBtnRef: { current: HTMLButtonElement | null };
  onOpenPalette: () => void;
  onOpenShortcuts: () => void;
}) {
  const status = connectionStatus.value;
  const hasSynced = hasInitialServerLayout.value;
  const v = viewport.value;
  const nodeCount = nodes.value.size;
  const edgeCount = edges.value.size;
  const isTraceOn = traceEnabled.value;
  const traceNodeCount = Array.from(nodes.value.values()).filter((n) => n.type === 'trace').length;
  const statusTitle = status === 'connected' && !hasSynced ? 'syncing' : status;
  const statusLabel = statusTitle.charAt(0).toUpperCase() + statusTitle.slice(1);
  const countsLabel = hasSynced
    ? [
        `${nodeCount} node${nodeCount !== 1 ? 's' : ''}`,
        ...(edgeCount > 0 ? [`${edgeCount} edge${edgeCount !== 1 ? 's' : ''}`] : []),
        ...(traceNodeCount > 0
          ? [`${traceNodeCount} trace${traceNodeCount !== 1 ? 's' : ''}`]
          : isTraceOn
            ? ['trace armed']
            : []),
      ].join(' · ')
    : 'Syncing canvas…';

  return (
    <div class="toolbar-group">
      {/* ── Navigation Bar ──────────────────────────────────── */}
      <div class="canvas-toolbar">
        <ToolbarHint label="PMX Canvas" detail="Focus Field · spatial workbench for coding agents" align="start">
          <span class="canvas-brand" aria-label="PMX Canvas">
            <IconLogo size={22} />
          </span>
        </ToolbarHint>

        <div class="separator" />

        <ToolbarHint label="Canvas status" detail={hasSynced ? statusLabel : 'Syncing canvas from server'} align="start">
          <span class={`connection-dot ${status}`} aria-label={`Canvas status: ${statusTitle}`} />
        </ToolbarHint>
        <span style={{ fontSize: '11px', color: 'var(--c-muted)' }}>
          {sessionId.value ? sessionId.value.slice(0, 12) : '…'}
        </span>

        <div class="separator" />

        <ToolbarHint label="Fit canvas" detail="Frame every node on screen">
          <button
            type="button"
            onClick={() => fitAll(window.innerWidth, window.innerHeight)}
            aria-label="Fit canvas"
          >
            <IconFitAll />
          </button>
        </ToolbarHint>
        <ToolbarHint label="Reset view" shortcut={`${MOD_KEY}+0`}>
          <button
            type="button"
            onClick={() => animateViewport({ x: 0, y: 0, scale: 1 }, 250)}
            aria-label="Reset view"
          >
            <IconResetView />
          </button>
        </ToolbarHint>
        <ToolbarHint label="Zoom in" shortcut={`${MOD_KEY}++`}>
          <button
            type="button"
            onClick={() => animateViewport({ ...v, scale: Math.min(4, v.scale * 1.25) }, 150)}
            aria-label="Zoom in"
          >
            <IconZoomIn />
          </button>
        </ToolbarHint>
        <ToolbarHint label="Zoom out" shortcut={`${MOD_KEY}+-`}>
          <button
            type="button"
            onClick={() => animateViewport({ ...v, scale: Math.max(0.1, v.scale / 1.25) }, 150)}
            aria-label="Zoom out"
          >
            <IconZoomOut />
          </button>
        </ToolbarHint>
        <span style={{ fontSize: '10px', color: 'var(--c-dim)', minWidth: '36px', textAlign: 'center' }}>
          {Math.round(v.scale * 100)}%
        </span>

        <div class="separator" />

        <ToolbarHint
          label="Arrange layout"
          detail={edgeCount > 0 ? 'Graph-aware layout for connected nodes' : 'Grid layout for loose nodes'}
        >
          <button type="button" onClick={() => edgeCount > 0 ? forceDirectedArrange() : autoArrange()} aria-label="Arrange layout">
            <IconArrange />
          </button>
        </ToolbarHint>
        <ToolbarHint label={minimapVisible ? 'Hide minimap' : 'Show minimap'} detail="Quickly navigate large canvases">
          <button
            type="button"
            onClick={onToggleMinimap}
            aria-label={minimapVisible ? 'Hide minimap' : 'Show minimap'}
            style={{ color: minimapVisible ? 'var(--c-accent)' : undefined }}
          >
            <IconMinimap />
          </button>
        </ToolbarHint>
        <ToolbarHint label={`Switch to ${canvasTheme.value === 'dark' ? 'light' : 'dark'} theme`} detail={`Current theme: ${canvasTheme.value}`}>
          <button
            type="button"
            onClick={() => {
              const next = canvasTheme.value === 'dark' ? 'light' : 'dark';
              canvasTheme.value = next;
              document.documentElement.setAttribute('data-theme', next);
              invalidateTokenCache();
            }}
            aria-label={`Switch to ${canvasTheme.value === 'dark' ? 'light' : 'dark'} theme`}
          >
            {canvasTheme.value === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
        </ToolbarHint>
        <ToolbarHint label="Snapshots" detail="Capture and restore canvas states" align="end">
          <button
            ref={snapshotBtnRef}
            type="button"
            onClick={onToggleSnapshot}
            aria-label="Snapshots"
            style={{ color: snapshotOpen ? 'var(--c-accent)' : undefined }}
          >
            <IconSnapshot />
          </button>
        </ToolbarHint>
      </div>

      {/* ── Action Bar ──────────────────────────────────────── */}
      <div class="canvas-toolbar">
        <ToolbarHint
          label={isTraceOn ? 'Disable trace' : 'Enable trace'}
          detail={isTraceOn ? 'Stop collecting new trace nodes' : 'Capture agent execution on the canvas'}
        >
          <button
            type="button"
            onClick={() => sendIntent('trace-toggle', { enabled: !isTraceOn })}
            aria-label={isTraceOn ? 'Disable trace' : 'Enable trace'}
            style={{ color: isTraceOn ? 'var(--c-purple)' : undefined }}
          >
            <IconTrace />
          </button>
        </ToolbarHint>
        {(isTraceOn || traceNodeCount > 0) && (
          <ToolbarHint
            label="Clear trace"
            detail={traceNodeCount > 0 ? `Remove ${traceNodeCount} trace node${traceNodeCount === 1 ? '' : 's'}` : 'Trace is enabled but still empty'}
          >
            <button
              type="button"
              onClick={() => sendIntent('trace-clear')}
              aria-label="Clear trace"
            >
              <IconClearTrace />
            </button>
          </ToolbarHint>
        )}

        <div class="separator" />

        <ToolbarHint label="Search nodes and actions" shortcut={`${MOD_KEY}+K`}>
          <button
            type="button"
            onClick={onOpenPalette}
            aria-label="Search nodes and actions"
          >
            <IconSearch />
          </button>
        </ToolbarHint>
        <ToolbarHint label="Keyboard shortcuts" shortcut="?" align="end">
          <button
            type="button"
            onClick={onOpenShortcuts}
            aria-label="Keyboard shortcuts"
          >
            <IconShortcuts />
          </button>
        </ToolbarHint>

        <span style={{ fontSize: '10px', color: 'var(--c-dim)' }}>{countsLabel}</span>
      </div>
    </div>
  );
}

function WelcomeCard({ onOpenPalette }: { onOpenPalette: () => void }) {
  return (
    <div class="welcome-card">
      <div class="welcome-icon">◇</div>
      <div class="welcome-title">Shape What The Agent Sees</div>
      <div class="welcome-subtitle">
        Lay out notes, files, and evidence. Bring related nodes together. Pin what matters. The board will reflect the active focus.
      </div>
      <div class="welcome-hints">
        <button type="button" class="welcome-hint" onClick={onOpenPalette}>
          <kbd>{MOD_KEY}+K</kbd>
          <span>Create a note</span>
        </button>
        <div class="welcome-hint">
          <kbd>Drop files</kbd>
          <span>Add evidence to the board</span>
        </div>
        <div class="welcome-hint">
          <kbd>{'\u2726'}</kbd>
          <span>Pin important nodes</span>
        </div>
        <div class="welcome-hint">
          <kbd>Move nearby</kbd>
          <span>Shape the focus field</span>
        </div>
      </div>
      <div class="welcome-footer">
        The canvas is a shared attention surface, not just an editor.
      </div>
    </div>
  );
}

export function App() {
  const [minimapVisible, setMinimapVisible] = useState(true);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const snapshotBtnRef = useRef<HTMLButtonElement>(null);
  const { menu, openNodeMenu, openCanvasMenu, closeMenu } = useContextMenu();
  const hasInitialLayout = hasInitialServerLayout.value;

  const handleToggleMinimap = useCallback(() => setMinimapVisible((v) => !v), []);
  const handleToggleSnapshot = useCallback(() => setSnapshotOpen((v) => !v), []);
  const handleCloseSnapshot = useCallback(() => setSnapshotOpen(false), []);

  const handleMinimapNavigate = useCallback((x: number, y: number) => {
    animateViewport({ x, y, scale: viewport.value.scale }, 200);
  }, []);

  useEffect(() => {
    const disconnect = connectSSE();

    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl+K toggles command palette (works from anywhere, including inputs)
      if (mod && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }

      // Esc always collapses expanded node first (even from inside inputs)
      if (e.key === 'Escape' && expandedNodeId.value) {
        e.preventDefault();
        collapseExpandedNode();
        return;
      }

      // Esc closes command palette
      if (e.key === 'Escape' && paletteOpen) {
        e.preventDefault();
        setPaletteOpen(false);
        return;
      }

      // Esc closes shortcut overlay
      if (e.key === 'Escape' && shortcutsOpen) {
        e.preventDefault();
        setShortcutsOpen(false);
        return;
      }

      // Ignore other shortcuts when inside inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // ? toggles shortcut overlay
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }

      if (mod && e.key === '0') {
        e.preventDefault();
        animateViewport({ x: 0, y: 0, scale: 1 }, 250);
      } else if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        const cur = viewport.value;
        animateViewport({ ...cur, scale: Math.min(4, cur.scale * 1.25) }, 150);
      } else if (mod && e.key === '-') {
        e.preventDefault();
        const cur = viewport.value;
        animateViewport({ ...cur, scale: Math.max(0.1, cur.scale / 1.25) }, 150);
      } else if (e.key === 'Escape') {
        if (selectedNodeIds.value.size > 0) {
          clearSelection();
          return;
        }
        activeNodeId.value = null;
        closeMenu();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        cycleActiveNode(e.shiftKey ? -1 : 1);
      } else if (activeNodeId.value && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const dir = e.key.replace('Arrow', '').toLowerCase() as 'up' | 'down' | 'left' | 'right';
        walkGraph(dir);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      disconnect();
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeMenu, paletteOpen, shortcutsOpen]);

  useEffect(() => {
    if (!hasInitialLayout) return;
    const ready = (window as Window & { __pmxCanvasBootstrapReady?: () => void })
      .__pmxCanvasBootstrapReady;
    if (typeof ready === 'function') ready();
  }, [hasInitialLayout]);

  const allNodes = Array.from(nodes.value.values());
  const dockedLeft = allNodes.filter((n) => n.dockPosition === 'left');
  const dockedRight = allNodes
    .filter((n) => n.dockPosition === 'right')
    .sort((a, b) => {
      const order: Record<string, number> = { context: 0, ledger: 1 };
      return (order[a.type] ?? 2) - (order[b.type] ?? 2);
    });

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div class="hud-layer">
        <div class="hud-left">
          {dockedLeft.map((n) => (
            <DockedNode key={n.id} node={n} />
          ))}
        </div>
        <Toolbar
          minimapVisible={minimapVisible}
          onToggleMinimap={handleToggleMinimap}
          snapshotOpen={snapshotOpen}
          onToggleSnapshot={handleToggleSnapshot}
          snapshotBtnRef={snapshotBtnRef}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenShortcuts={() => setShortcutsOpen((v) => !v)}
        />
        <div class="hud-right">
          {dockedRight.map((n) => (
            <DockedNode key={n.id} node={n} />
          ))}
        </div>
      </div>
      <AttentionToast />
      <AttentionHistory />
      <CanvasViewport
        onNodeContextMenu={openNodeMenu}
        onCanvasContextMenu={openCanvasMenu}
      />
      {hasInitialLayout && allNodes.filter((n) => !n.dockPosition).length === 0 && (
        <WelcomeCard onOpenPalette={() => setPaletteOpen(true)} />
      )}
      {selectedNodeIds.value.size > 0 && <SelectionBar />}
      {contextPinnedNodeIds.value.size > 0 && <ContextPinBar />}
      {expandedNodeId.value && <ExpandedNodeOverlay />}
      <SnapshotPanel open={snapshotOpen} onClose={handleCloseSnapshot} anchorRef={snapshotBtnRef} />
      {minimapVisible && (
        <Minimap
          viewport={viewport}
          nodes={nodes}
          edges={edges}
          onNavigate={handleMinimapNavigate}
          containerWidth={window.innerWidth}
          containerHeight={window.innerHeight}
        />
      )}
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onToggleMinimap={handleToggleMinimap}
        />
      )}
      {shortcutsOpen && <ShortcutOverlay onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
