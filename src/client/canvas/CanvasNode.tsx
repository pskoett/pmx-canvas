import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  attentionPrimaryNodeIds,
  attentionPulseNodeIds,
  attentionSecondaryNodeIds,
} from '../state/attention-store';
import {
  activeNodeId,
  bringToFront,
  contextPinnedNodeIds,
  draggingEdge,
  edges,
  expandNode,
  nodes,
  persistLayout,
  removeNode,
  resizeNode,
  searchHighlightIds,
  selectedNodeIds,
  toggleCollapsed,
  toggleContextPin,
  toggleSelected,
  updateNode,
  updateNodeData,
  viewport,
} from '../state/canvas-store';
import { removeNodeFromClient, updateNodeFromClient } from '../state/intent-bridge';
import { getNodeIcon } from '../icons';
import { EXPANDABLE_TYPES, TYPE_LABELS } from '../types';
import type { CanvasNodeState } from '../types';
import { activeGuides, buildSnapCache, clearSnapCache, snapToGuides } from './snap-guides';
import { useNodeDrag } from './use-node-drag';
import { useNodeResize } from './use-node-resize';

interface CanvasNodeProps {
  node: CanvasNodeState;
  children: preact.ComponentChildren;
  onContextMenu?: (e: MouseEvent, nodeId: string) => void;
}

export function CanvasNode({ node, children, onContextMenu }: CanvasNodeProps) {
  const isActive = activeNodeId.value === node.id;
  const isSelected = selectedNodeIds.value.has(node.id);
  const isContextPinned = contextPinnedNodeIds.value.has(node.id);
  const isAttentionPrimary = attentionPrimaryNodeIds.value.has(node.id);
  const isAttentionSecondary = !isAttentionPrimary && attentionSecondaryNodeIds.value.has(node.id);
  const isAttentionPulse = attentionPulseNodeIds.value.has(node.id);
  const focusId = activeNodeId.value;
  const isNeighbor = !isActive && focusId !== null && Array.from(edges.value.values()).some(
    (e) => (e.from === focusId && e.to === node.id) || (e.to === focusId && e.from === node.id),
  );
  const searchSet = searchHighlightIds.value;
  const isSearchMatch = searchSet !== null && searchSet.has(node.id);
  const isSearchDimmed = searchSet !== null && !searchSet.has(node.id);
  const [renaming, setRenaming] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);

  // ── Drag (with snap alignment) ──────────────────────
  const handleMove = useCallback((id: string, x: number, y: number) => {
    const snap = snapToGuides(x, y, node.size.width, node.size.height);
    updateNode(id, { position: { x: snap.x, y: snap.y } });
    activeGuides.value = snap.guides.length > 0 ? snap.guides : null;
  }, [node.size.width, node.size.height]);

  const handleDragEnd = useCallback(() => {
    clearSnapCache();
    activeGuides.value = null;
    persistLayout();
  }, []);

  const startDrag = useNodeDrag({
    nodeId: node.id,
    viewport,
    onMove: handleMove,
    onDragEnd: handleDragEnd,
  });

  // ── Resize ────────────────────────────────────────────
  const handleResize = useCallback((id: string, width: number, height: number) => {
    updateNode(id, { size: { width, height } });
  }, []);

  const handleResizeEnd = useCallback(() => persistLayout(), []);

  const startResize = useNodeResize({
    nodeId: node.id,
    viewport,
    onResize: handleResize,
    onResizeEnd: handleResizeEnd,
  });

  // ── Title bar interactions ────────────────────────────
  const handleTitlePointerDown = useCallback(
    (e: PointerEvent) => {
      if (renaming) return;
      bringToFront(node.id);
      buildSnapCache(node.id, nodes.value.values());
      startDrag(e, node.position.x, node.position.y);
    },
    [node.id, node.position.x, node.position.y, startDrag, renaming],
  );

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      e.stopPropagation();
      if (e.shiftKey) {
        toggleSelected(node.id);
        return;
      }
      bringToFront(node.id);
    },
    [node.id],
  );

  const handleContextMenuEvent = useCallback(
    (e: MouseEvent) => {
      if (onContextMenu) onContextMenu(e, node.id);
    },
    [onContextMenu, node.id],
  );

  // ── Double-click rename ───────────────────────────────
  const handleTitleDblClick = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    setRenaming(true);
    requestAnimationFrame(() => renameRef.current?.focus());
  }, []);

  const title = (node.data.title as string) || TYPE_LABELS[node.type];

  const commitRename = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (trimmed && trimmed !== title) {
        updateNodeData(node.id, { title: trimmed });
        void updateNodeFromClient(node.id, { title: trimmed });
      }
      setRenaming(false);
    },
    [node.id, title],
  );

  // ── Auto-fit: measure content and resize once ───────
  const bodyRef = useRef<HTMLDivElement>(null);
  const hasAutoFit = useRef(false);
  const autoFitPersistTimer = useRef<number | null>(null);
  const AUTO_FIT_MAX = 600;
  const TITLEBAR_HEIGHT = 37;

  useEffect(() => {
    if (hasAutoFit.current || node.collapsed || node.dockPosition || node.type === 'group') return;
    const body = bodyRef.current;
    if (!body) return;

    const observer = new ResizeObserver(() => {
      if (hasAutoFit.current) {
        observer.disconnect();
        return;
      }
      const contentHeight = body.scrollHeight;
      if (contentHeight <= 0) return;

      const fitHeight = Math.min(contentHeight + TITLEBAR_HEIGHT, AUTO_FIT_MAX);
      // Only resize if the fit height differs meaningfully from current
      if (Math.abs(fitHeight - node.size.height) > 8) {
        resizeNode(node.id, { width: node.size.width, height: fitHeight });
        if (autoFitPersistTimer.current !== null) {
          window.clearTimeout(autoFitPersistTimer.current);
        }
        autoFitPersistTimer.current = window.setTimeout(() => {
          persistLayout();
          autoFitPersistTimer.current = null;
        }, 0);
      }
      hasAutoFit.current = true;
      observer.disconnect();
    });
    observer.observe(body);
    return () => {
      observer.disconnect();
      if (autoFitPersistTimer.current !== null) {
        window.clearTimeout(autoFitPersistTimer.current);
        autoFitPersistTimer.current = null;
      }
    };
  }, [node.id, node.type, node.collapsed, node.dockPosition, node.size.width, node.size.height]);

  const isPinned = node.pinned;
  const isTrace = node.type === 'trace';
  const isTraceRunning = isTrace && node.data.status === 'running';
  const isGroup = node.type === 'group';

  const groupColor = isGroup && node.data.color ? (node.data.color as string) : undefined;
  const nodeStyle: Record<string, string | number> = {
    left: `${node.position.x}px`,
    top: `${node.position.y}px`,
    width: `${node.size.width}px`,
    height: node.collapsed ? 'auto' : `${node.size.height}px`,
    zIndex: node.zIndex,
    ...(groupColor ? { '--group-color': groupColor } : {}),
  };
  const nodeClass = [
    'canvas-node',
    isActive ? 'active' : '',
    isNeighbor ? 'neighbor' : '',
    isSearchMatch ? 'search-match' : '',
    isSearchDimmed ? 'search-dimmed' : '',
    isSelected ? 'selected' : '',
    isContextPinned ? 'context-pinned' : '',
    isAttentionPrimary ? 'attention-focus-primary' : '',
    isAttentionSecondary ? 'attention-focus-secondary' : '',
    isAttentionPulse ? 'attention-pulse' : '',
    isPinned ? 'pinned' : '',
    isTrace ? 'trace-node' : '',
    isTraceRunning ? 'trace-running' : '',
    isGroup ? 'group-node' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      class={nodeClass}
      style={nodeStyle}
      onPointerDown={handlePointerDown}
      onContextMenu={handleContextMenuEvent}
    >
      <div class="node-titlebar" onPointerDown={handleTitlePointerDown}>
        <span class="node-type-icon" aria-hidden="true">
          {(() => {
            const NodeIcon = getNodeIcon(node.type);
            return <NodeIcon size={14} />;
          })()}
        </span>
        <span class="node-type-badge">{TYPE_LABELS[node.type]}</span>
        {renaming ? (
          <input
            ref={renameRef}
            class="node-title-input"
            value={title}
            onBlur={(e) => commitRename((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename((e.target as HTMLInputElement).value);
              if (e.key === 'Escape') setRenaming(false);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span class="node-title" onDblClick={handleTitleDblClick} title="Double-click to rename">
            {title}
          </span>
        )}
        <div class="node-controls">
          {isPinned && (
            <span class="pin-indicator" title="Pinned">
              ⊙
            </span>
          )}
          <button
            type="button"
            class={`ctx-pin-btn${isContextPinned ? ' ctx-pin-active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleContextPin(node.id);
            }}
            title={isContextPinned ? 'Remove from context' : 'Add to context'}
          >
            {'\u2726'}
          </button>
          {/* Open externally — only for URL-based MCP app nodes (not ext-apps which need a host bridge) */}
          {(node.type === 'mcp-app' || node.type === 'webpage') && node.data.url && !node.data.mode && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                window.open(node.data.url as string, '_blank', 'noopener');
              }}
              title="Open in new tab"
            >
              ↗
            </button>
          )}
          {/* Expand — opens node as full-viewport overlay for focused work */}
          {EXPANDABLE_TYPES.has(node.type) && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                expandNode(node.id);
              }}
              title="Expand (focus mode)"
            >
              ⤢
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapsed(node.id);
            }}
            title={node.collapsed ? 'Expand' : 'Collapse'}
          >
            {node.collapsed ? '▸' : '▾'}
          </button>
          {node.type !== 'status' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeNode(node.id);
                void removeNodeFromClient(node.id);
              }}
              title="Close"
            >
              ×
            </button>
          )}
        </div>
      </div>
      {!node.collapsed && (
        <div ref={bodyRef} class="node-body">
          {children}
        </div>
      )}
      {!node.collapsed && (
        <div
          class="node-resize-handle"
          onPointerDown={(e) => startResize(e, node.size.width, node.size.height)}
        />
      )}
      {/* Connection port handles — visible on hover, drag to connect */}
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
        <div
          key={side}
          class={`node-port node-port-${side}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            const cx = node.position.x + node.size.width / 2;
            const cy = node.position.y + node.size.height / 2;
            const hw = node.size.width / 2;
            const hh = node.size.height / 2;
            let px: number, py: number;
            switch (side) {
              case 'top':    px = cx; py = cy - hh; break;
              case 'bottom': px = cx; py = cy + hh; break;
              case 'left':   px = cx - hw; py = cy; break;
              case 'right':  px = cx + hw; py = cy; break;
            }
            draggingEdge.value = {
              fromId: node.id,
              fromX: px,
              fromY: py,
              cursorX: px,
              cursorY: py,
            };
          }}
        />
      ))}
    </div>
  );
}
