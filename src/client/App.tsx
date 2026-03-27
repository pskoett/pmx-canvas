import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { CanvasViewport } from './canvas/CanvasViewport';
import { CommandPalette } from './canvas/CommandPalette';
import { ContextMenu, useContextMenu } from './canvas/ContextMenu';
import { ContextPinBar } from './canvas/ContextPinBar';
import { ContextPinHud } from './canvas/ContextPinHud';
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
import { invalidateTokenCache } from './theme/tokens';

function sendIntent(type: string, payload: Record<string, unknown> = {}): void {
  fetch(`/api/workbench/intent?_ts=${Date.now()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, payload }),
  }).catch(() => {});
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
    <div class="canvas-toolbar">
      <span class={`connection-dot ${status}`} title={statusTitle} />
      <span style={{ fontSize: '11px', color: 'var(--c-muted)' }}>
        {sessionId.value ? sessionId.value.slice(0, 12) : '…'}
      </span>

      <div class="separator" />

      <button
        type="button"
        onClick={() => fitAll(window.innerWidth, window.innerHeight)}
        title="Fit all nodes"
      >
        ◻
      </button>
      <button
        type="button"
        onClick={() => animateViewport({ x: 0, y: 0, scale: 1 }, 250)}
        title="Reset view (Cmd+0)"
      >
        1:1
      </button>
      <button
        type="button"
        onClick={() => animateViewport({ ...v, scale: Math.min(4, v.scale * 1.25) }, 150)}
        title="Zoom in (Cmd++)"
      >
        +
      </button>
      <button
        type="button"
        onClick={() => animateViewport({ ...v, scale: Math.max(0.1, v.scale / 1.25) }, 150)}
        title="Zoom out (Cmd+-)"
      >
        −
      </button>
      <span style={{ fontSize: '10px', color: 'var(--c-dim)', minWidth: '36px', textAlign: 'center' }}>
        {Math.round(v.scale * 100)}%
      </span>

      <div class="separator" />

      <button type="button" onClick={() => edgeCount > 0 ? forceDirectedArrange() : autoArrange()} title={edgeCount > 0 ? 'Auto-arrange (force-directed)' : 'Auto-arrange (grid)'}>
        ⊞
      </button>
      <button
        type="button"
        onClick={onToggleMinimap}
        title="Toggle minimap"
        style={{ color: minimapVisible ? 'var(--c-accent)' : undefined }}
      >
        ◫
      </button>
      <button
        type="button"
        onClick={() => {
          const next = canvasTheme.value === 'dark' ? 'light' : 'dark';
          canvasTheme.value = next;
          document.documentElement.setAttribute('data-theme', next);
          invalidateTokenCache();
        }}
        title={`Switch to ${canvasTheme.value === 'dark' ? 'light' : 'dark'} theme`}
      >
        {canvasTheme.value === 'dark' ? '☀' : '☾'}
      </button>
      <button
        ref={snapshotBtnRef}
        type="button"
        onClick={onToggleSnapshot}
        title="Snapshots"
        style={{ color: snapshotOpen ? 'var(--c-accent)' : undefined }}
      >
        ◈
      </button>

      <div class="separator" />

      <button
        type="button"
        onClick={() => sendIntent('trace-toggle', { enabled: !isTraceOn })}
        title={isTraceOn ? 'Disable trace' : 'Enable trace'}
        style={{ color: isTraceOn ? 'var(--c-purple)' : undefined }}
      >
        ◉
      </button>
      {(isTraceOn || traceNodeCount > 0) && (
        <button
          type="button"
          onClick={() => sendIntent('trace-clear')}
          title={traceNodeCount > 0 ? 'Clear trace' : 'Trace is enabled but still empty'}
        >
          ⌫
        </button>
      )}

      <div class="separator" />

      <button
        type="button"
        onClick={onOpenPalette}
        title="Search nodes & actions (Cmd+K)"
      >
        ⌕
      </button>
      <button
        type="button"
        onClick={onOpenShortcuts}
        title="Keyboard shortcuts (?)"
      >
        ?
      </button>

      <span style={{ fontSize: '10px', color: 'var(--c-dim)' }}>{countsLabel}</span>
    </div>
  );
}

import { MOD_KEY } from './utils/platform';

function WelcomeCard({ onOpenPalette }: { onOpenPalette: () => void }) {
  return (
    <div class="welcome-card">
      <div class="welcome-icon">◇</div>
      <div class="welcome-title">PMX Canvas</div>
      <div class="welcome-subtitle">Your agent's spatial working memory</div>
      <div class="welcome-hints">
        <button type="button" class="welcome-hint" onClick={onOpenPalette}>
          <kbd>{MOD_KEY}+K</kbd>
          <span>Search & create</span>
        </button>
        <div class="welcome-hint">
          <kbd>Double-click</kbd>
          <span>New note on canvas</span>
        </div>
        <div class="welcome-hint">
          <kbd>?</kbd>
          <span>All keyboard shortcuts</span>
        </div>
        <div class="welcome-hint">
          <kbd>Scroll / pinch</kbd>
          <span>Pan & zoom</span>
        </div>
      </div>
      <div class="welcome-footer">
        Nodes appear here as agents work — or create your own.
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
  const { menu, openMenu, closeMenu } = useContextMenu();
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
          <ContextPinHud />
          {dockedRight.map((n) => (
            <DockedNode key={n.id} node={n} />
          ))}
        </div>
      </div>
      <CanvasViewport onNodeContextMenu={openMenu} />
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
      {menu && <ContextMenu x={menu.x} y={menu.y} nodeId={menu.nodeId} onClose={closeMenu} />}
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
