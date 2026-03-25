import { useCallback, useEffect, useState } from 'preact/hooks';
import { CanvasViewport } from './canvas/CanvasViewport';
import { ContextMenu, useContextMenu } from './canvas/ContextMenu';
import { ContextPinBar } from './canvas/ContextPinBar';
import { ContextPinHud } from './canvas/ContextPinHud';
import { DockedNode } from './canvas/DockedNode';
import { ExpandedNodeOverlay } from './canvas/ExpandedNodeOverlay';
import { Minimap } from './canvas/Minimap';
import { SelectionBar } from './canvas/SelectionBar';
import {
  activeNodeId,
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
  hasInitialServerLayout,
  nodes,
  persistLayout,
  selectedNodeIds,
  sessionId,
  setViewport,
  traceEnabled,
  viewport,
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
}: { minimapVisible: boolean; onToggleMinimap: () => void }) {
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
        onClick={() => {
          setViewport({ x: 0, y: 0, scale: 1 });
          persistLayout();
        }}
        title="Reset view (Cmd+0)"
      >
        1:1
      </button>
      <button
        type="button"
        onClick={() => {
          setViewport({ scale: Math.min(4, v.scale * 1.25) });
          persistLayout();
        }}
        title="Zoom in (Cmd++)"
      >
        +
      </button>
      <button
        type="button"
        onClick={() => {
          setViewport({ scale: Math.max(0.1, v.scale / 1.25) });
          persistLayout();
        }}
        title="Zoom out (Cmd+-)"
      >
        −
      </button>
      <span style={{ fontSize: '10px', color: 'var(--c-dim)', minWidth: '36px', textAlign: 'center' }}>
        {Math.round(v.scale * 100)}%
      </span>

      <div class="separator" />

      <button type="button" onClick={autoArrange} title="Auto-arrange nodes (grid)">
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

      <span style={{ fontSize: '10px', color: 'var(--c-dim)' }}>{countsLabel}</span>
    </div>
  );
}

export function App() {
  const [minimapVisible, setMinimapVisible] = useState(true);
  const { menu, openMenu, closeMenu } = useContextMenu();
  const hasInitialLayout = hasInitialServerLayout.value;

  const handleToggleMinimap = useCallback(() => setMinimapVisible((v) => !v), []);

  const handleMinimapNavigate = useCallback((x: number, y: number) => {
    setViewport({ x, y });
    persistLayout();
  }, []);

  useEffect(() => {
    const disconnect = connectSSE();

    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Esc always collapses expanded node first (even from inside inputs)
      if (e.key === 'Escape' && expandedNodeId.value) {
        e.preventDefault();
        collapseExpandedNode();
        return;
      }

      // Ignore other shortcuts when inside inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (mod && e.key === '0') {
        e.preventDefault();
        setViewport({ x: 0, y: 0, scale: 1 });
        persistLayout();
      } else if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setViewport({ scale: Math.min(4, viewport.value.scale * 1.25) });
        persistLayout();
      } else if (mod && e.key === '-') {
        e.preventDefault();
        setViewport({ scale: Math.max(0.1, viewport.value.scale / 1.25) });
        persistLayout();
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
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      disconnect();
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeMenu]);

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
        <Toolbar minimapVisible={minimapVisible} onToggleMinimap={handleToggleMinimap} />
        <div class="hud-right">
          <ContextPinHud />
          {dockedRight.map((n) => (
            <DockedNode key={n.id} node={n} />
          ))}
        </div>
      </div>
      <CanvasViewport onNodeContextMenu={openMenu} />
      {selectedNodeIds.value.size > 0 && <SelectionBar />}
      {contextPinnedNodeIds.value.size > 0 && <ContextPinBar />}
      {expandedNodeId.value && <ExpandedNodeOverlay />}
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
    </div>
  );
}
