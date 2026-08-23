import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { mutatingNodeIds, sessionActive } from '../state/presence-store';
import { attentionPrimaryNodeIds, attentionPulseNodeIds, attentionSecondaryNodeIds } from '../state/attention-store';
import {
  activeNodeId,
  activeNeighborNodeIds,
  addContextPins,
  bringToFront,
  contextPinnedNodeIds,
  dragDropTarget,
  draggingEdge,
  endDropTracking,
  expandNode,
  nodes,
  persistLayout,
  removeNode,
  resizeNode,
  searchHighlightIds,
  selectedNodeIds,
  suppressDropForDrag,
  toggleCollapsed,
  toggleContextPin,
  toggleSelected,
  trackDragMembership,
  updateNode,
  updateNodeData,
  viewport,
} from '../state/canvas-store';
import {
  addToGroupFromClient,
  removeNodeFromClient,
  setGroupChildrenFromClient,
  ungroupFromClient,
  updateNodeFromClient,
} from '../state/intent-bridge';
import { KIND_COLOR } from './kind-colors';
import { AxStepControls } from '../nodes/AxStepControls';
import { canOpenAsSite, openNodeAsSite } from '../nodes/surface-url';
import { getNodeIcon } from '../icons';
import { EXPANDABLE_TYPES, TYPE_LABELS } from '../types';
import type { CanvasNodeState } from '../types';
import { AUTO_FIT_TITLEBAR_HEIGHT, computeAutoFitHeight, shouldAutoFitNode } from './auto-fit';
import { activeGuides, buildSnapCache, clearSnapCache, snapToGuides } from './snap-guides';
import { useNodeDrag } from './use-node-drag';
import { useNodeResize } from './use-node-resize';

const ARROW_DIRS: Record<string, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
};

/** The closest node whose centre lies in `dir` from `from` (a 90° cone, weighted toward the axis). */
export function nearestNodeInDirection(
  from: CanvasNodeState,
  dir: { dx: number; dy: number },
  candidates: Iterable<CanvasNodeState>,
): CanvasNodeState | null {
  const fx = from.position.x + from.size.width / 2;
  const fy = from.position.y + from.size.height / 2;
  let best: CanvasNodeState | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const node of candidates) {
    if (node.id === from.id) continue;
    const dx = node.position.x + node.size.width / 2 - fx;
    const dy = node.position.y + node.size.height / 2 - fy;
    const along = dx * dir.dx + dy * dir.dy;
    if (along <= 0) continue;
    const across = Math.abs(dx * dir.dy) + Math.abs(dy * dir.dx);
    if (across > along) continue; // outside the 90° cone
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = node;
    }
  }
  return best;
}

/** Fraction of a node's height the title bar may occupy before it starts
 *  crowding out the content it is labelling. */
const MAX_TITLEBAR_HEIGHT_RATIO = 0.4;
/** Fraction of a node's width the fixed title-bar chrome may occupy before it
 *  starts eating the node's NAME. */
const MAX_TITLEBAR_CHROME_WIDTH_RATIO = 0.55;
/** Unscaled width of everything in the bar that is not the title: type icon,
 *  status/type pill, the control cluster, and the gaps between them. */
const TITLEBAR_CHROME_BASE_WIDTH = 175;

/**
 * How much to enlarge node chrome (title bar, badges, icons) when zoomed out so
 * it stays legible. Full inverse compensation is capped at 2.2x — but the cap
 * alone ignored the node it is drawn on, so on SHORT nodes the growing bar ate
 * the body: a 116px-tall section label at 46% zoom gave the title bar 72% of the
 * node and left 14px for text that needed 41, so the markdown was simply cut off.
 * The scale is therefore also bounded by the node's own height, keeping the bar
 * under MAX_TITLEBAR_HEIGHT_RATIO of it. Tall nodes are unaffected (their height
 * never binds); pass height 0 for collapsed/auto-height nodes to skip the bound.
 */
export function nodeChromeScale(viewportScale: number, nodeHeight: number, nodeWidth = 0): number {
  if (!Number.isFinite(viewportScale) || viewportScale >= 1) return 1;
  const zoomScale = Math.min(2.2, 1 / Math.max(viewportScale, 0.01));
  let bounded = zoomScale;
  if (Number.isFinite(nodeHeight) && nodeHeight > 0) {
    bounded = Math.min(bounded, (nodeHeight * MAX_TITLEBAR_HEIGHT_RATIO) / AUTO_FIT_TITLEBAR_HEIGHT);
  }
  // Width matters as much as height: the icon, pill and control cluster are all
  // flex-shrink: 0, so the NAME is the only thing that gives way. Unbounded, a
  // 360px step node at 52% zoom spent 100 of 187 bar pixels on controls alone and
  // the title collapsed to nothing. Bound the scale so the fixed chrome can never
  // take more than MAX_TITLEBAR_CHROME_WIDTH_RATIO of the node.
  if (Number.isFinite(nodeWidth) && nodeWidth > 0) {
    bounded = Math.min(bounded, (nodeWidth * MAX_TITLEBAR_CHROME_WIDTH_RATIO) / TITLEBAR_CHROME_BASE_WIDTH);
  }
  return Math.max(1, bounded);
}

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
  const isNeighbor = !isActive && activeNeighborNodeIds.value.has(node.id);
  const searchSet = searchHighlightIds.value;
  const isSearchMatch = searchSet !== null && searchSet.has(node.id);
  const isSearchDimmed = searchSet !== null && !searchSet.has(node.id);
  const [renaming, setRenaming] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);

  // ── Drag (with snap alignment + group membership feedback) ──
  const handleMove = useCallback(
    (id: string, x: number, y: number) => {
      const snap = snapToGuides(x, y, node.size.width, node.size.height);
      const current = nodes.value.get(id);
      if (current?.position.x === snap.x && current.position.y === snap.y) {
        activeGuides.value = snap.guides.length > 0 ? snap.guides : null;
        return;
      }
      updateNode(id, { position: { x: snap.x, y: snap.y } });
      activeGuides.value = snap.guides.length > 0 ? snap.guides : null;
      // Groups v2: the release pill + live auto-grow of a fit-mode parent.
      trackDragMembership(id);
    },
    [node.size.width, node.size.height],
  );

  // Esc while dragging keeps the node out of (or in) the group it hovers.
  const escListener = useRef<((e: KeyboardEvent) => void) | null>(null);

  const handleDragEnd = useCallback(() => {
    clearSnapCache();
    activeGuides.value = null;
    if (escListener.current) {
      document.removeEventListener('keydown', escListener.current);
      escListener.current = null;
    }
    persistLayout();
    // Membership changes ONLY here, and only while the pill was showing.
    const target = dragDropTarget.value;
    endDropTracking();
    if (!target || target.nodeId !== node.id) return;
    if (target.mode === 'add') {
      void addToGroupFromClient(target.groupId, [node.id]);
    } else {
      const group = nodes.value.get(target.groupId);
      const remaining = Array.isArray(group?.data.children)
        ? group.data.children.filter((id): id is string => typeof id === 'string' && id !== node.id)
        : [];
      void setGroupChildrenFromClient(target.groupId, remaining);
    }
  }, [node.id]);

  const startDrag = useNodeDrag({
    nodeId: node.id,
    viewport,
    onMove: handleMove,
    onDragEnd: handleDragEnd,
  });

  // ── Resize ────────────────────────────────────────────
  const handleResize = useCallback((id: string, width: number, height: number) => {
    const current = nodes.value.get(id);
    if (current?.size.width === width && current.size.height === height) return;
    updateNode(id, { size: { width, height } });
  }, []);

  const handleResizeEnd = useCallback(() => {
    // A manual resize is explicit user intent — stop auto/content-fit from
    // overriding it (see isAutoSizeExempt in auto-fit.ts). Persist the flag to the
    // server (mirrors the rename path below) so it survives layout reconciles,
    // undo/redo, and snapshots — a client-only flag is wiped by the next
    // canvas-layout-update broadcast. persistLayout() persists the new size.
    updateNodeData(node.id, { userResized: true });
    void updateNodeFromClient(node.id, { data: { userResized: true } });
    persistLayout();
  }, [node.id]);

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
      if (node.type !== 'group') {
        const onKey = (ev: KeyboardEvent) => {
          if (ev.key === 'Escape') suppressDropForDrag();
        };
        escListener.current = onKey;
        document.addEventListener('keydown', onKey);
      }
      startDrag(e, node.position.x, node.position.y);
    },
    [node.id, node.type, node.position.x, node.position.y, startDrag, renaming],
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

  // ── Keyboard (item 18): roving focus across nodes ─────
  // Arrow keys move focus to the nearest node in that direction (world
  // space); Enter opens the focused node in focus mode.
  const handleNodeKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target !== e.currentTarget && target.closest('input, textarea, [contenteditable="true"]')) return;
      const dir = ARROW_DIRS[e.key];
      if (dir) {
        e.preventDefault();
        const next = nearestNodeInDirection(node, dir, nodes.value.values());
        if (!next) return;
        bringToFront(next.id);
        requestAnimationFrame(() => {
          document.querySelector<HTMLElement>(`.canvas-node[data-node-id="${CSS.escape(next.id)}"]`)?.focus();
        });
      } else if (e.key === 'Enter' && e.target === e.currentTarget && EXPANDABLE_TYPES.has(node.type)) {
        e.preventDefault();
        expandNode(node.id);
      }
    },
    [node],
  );

  // ── Double-click rename ───────────────────────────────
  const handleTitleDblClick = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    setRenaming(true);
    requestAnimationFrame(() => renameRef.current?.focus());
  }, []);

  const title =
    (node.data.title as string) ||
    // Untitled file nodes (created before titles were synthesized server-side)
    // still show their filename instead of a bare type label.
    (node.type === 'file'
      ? // Separator-agnostic: node paths are OS-native (backslashes on Windows).
        (((node.data.path as string) || (node.data.content as string) || '').split(/[\\/]/).pop() ?? '')
      : '') ||
    TYPE_LABELS[node.type];

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

  useEffect(() => {
    if (hasAutoFit.current || !shouldAutoFitNode(node)) return;
    const body = bodyRef.current;
    if (!body) return;

    const observer = new ResizeObserver(() => {
      if (hasAutoFit.current) {
        observer.disconnect();
        return;
      }
      const contentHeight = body.scrollHeight;
      const fitHeight = computeAutoFitHeight(node, contentHeight);
      if (fitHeight === null) return;

      // Only resize if the fit height differs meaningfully from current
      if (Math.abs(fitHeight - node.size.height) > 8) {
        resizeNode(node.id, { width: node.size.width, height: fitHeight });
        if (autoFitPersistTimer.current !== null) {
          window.clearTimeout(autoFitPersistTimer.current);
        }
        autoFitPersistTimer.current = window.setTimeout(() => {
          persistLayout({ recordHistory: false });
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
  }, [node.id, node.type, node.data.mode, node.data.strictSize, node.collapsed, node.size.width, node.size.height]);

  const isPinned = node.pinned;
  const isTrace = node.type === 'trace';
  const isTraceRunning = isTrace && node.data.status === 'running';
  const isGroup = node.type === 'group';
  const isStrictSize = node.data.strictSize === true;
  const viewportScale = Math.max(viewport.value.scale, 0.01);
  const chromeScale = nodeChromeScale(viewportScale, node.collapsed ? 0 : node.size.height, node.size.width);

  const groupColor = isGroup && node.data.color ? (node.data.color as string) : undefined;
  const nodeStyle: Record<string, string | number> = {
    left: `${node.position.x}px`,
    top: `${node.position.y}px`,
    width: `${node.size.width}px`,
    height: node.collapsed ? 'auto' : `${node.size.height}px`,
    zIndex: node.zIndex,
    '--node-chrome-scale': chromeScale.toFixed(3),
    ...(groupColor ? { '--group-color': groupColor } : {}),
  };
  // Shimmer while an attached agent is mutating this node (rail-chrome-v2
  // phase 3). Gated on sessionActive: the quiet board never shimmers.
  const isAgentMutating = sessionActive.value && mutatingNodeIds.value.has(node.id);
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
    isStrictSize ? 'strict-size' : '',
    isAgentMutating ? 'agent-mutating' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // ── Groups v2 (rail-chrome-v2 phase 7, item 20) ──────────
  const groupChildren = isGroup
    ? (Array.isArray(node.data.children) ? node.data.children : []).filter(
        (id): id is string => typeof id === 'string' && nodes.value.has(id),
      )
    : [];
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const dropTarget = dragDropTarget.value;
  const isDropTarget = isGroup && dropTarget?.groupId === node.id && dropTarget.mode === 'add';
  const isDropSource = isGroup && dropTarget?.groupId === node.id && dropTarget.mode === 'remove';
  const groupKindDots = isGroup
    ? [
        ...new Set(
          groupChildren.map((id) => nodes.value.get(id)?.type).filter((t): t is CanvasNodeState['type'] => !!t),
        ),
      ].slice(0, 4)
    : [];

  if (isGroup && node.collapsed) {
    // Collapsed group: a compact chip. Children keep their positions for restore.
    return (
      <div
        class={`${nodeClass} group-chip`}
        data-node-type={node.type}
        style={{ ...nodeStyle, width: 'auto', height: 'auto' }}
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenuEvent}
        title="Expand group"
        data-testid="group-chip"
      >
        <div class="node-titlebar group-chip-inner" onPointerDown={handleTitlePointerDown}>
          <button
            type="button"
            class="group-chip-expand"
            aria-label={`Expand group ${title}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapsed(node.id);
            }}
          >
            ▸
          </button>
          <div class="group-chip-text">
            <div class="group-chip-name">{title}</div>
            <div class="group-chip-meta">
              {groupKindDots.map((kind) => (
                <span key={kind} class="group-kind-dot" style={{ background: KIND_COLOR[kind] }} aria-hidden="true" />
              ))}
              <span class="group-chip-count">
                {groupChildren.length} node{groupChildren.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      class={`${nodeClass}${isDropTarget ? ' is-drop-target' : ''}${isDropSource ? ' is-drop-source' : ''}`}
      data-node-type={node.type}
      data-node-id={node.id}
      style={nodeStyle}
      tabIndex={isActive ? 0 : -1}
      onKeyDown={handleNodeKeyDown}
      onPointerDown={handlePointerDown}
      onContextMenu={handleContextMenuEvent}
    >
      {isGroup && (
        <div class="node-titlebar group-edge-row" onPointerDown={handleTitlePointerDown}>
          <span class="group-name-pill">
            {renaming ? (
              <input
                ref={renameRef}
                class="node-title-input group-title-input"
                value={title}
                onBlur={(e) => commitRename((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename((e.target as HTMLInputElement).value);
                  if (e.key === 'Escape') setRenaming(false);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span class="group-name" onDblClick={handleTitleDblClick} title={`${title} — double-click to rename`}>
                {title}
              </span>
            )}
            <span class="group-count">{groupChildren.length}</span>
          </span>
          <span class="group-edge-spacer" />
          <span class="group-actions" role="toolbar" aria-label={`${title} actions`}>
            <button
              type="button"
              class="group-action"
              title="Auto-arrange children"
              aria-label="Auto-arrange children"
              disabled={groupChildren.length === 0}
              onClick={(e) => {
                e.stopPropagation();
                void addToGroupFromClient(node.id, groupChildren, 'grid');
              }}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                aria-hidden="true"
              >
                <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
                <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
                <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
                <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
              </svg>
            </button>
            <button
              type="button"
              class="group-action"
              title="Collapse group"
              aria-label="Collapse group"
              onClick={(e) => {
                e.stopPropagation();
                toggleCollapsed(node.id);
              }}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M3 10 L8 5 L13 10" />
              </svg>
            </button>
            <button
              type="button"
              class="group-action"
              title="Rename · Ungroup · Pin all to context"
              aria-label="Group menu"
              aria-expanded={groupMenuOpen}
              onClick={(e) => {
                e.stopPropagation();
                setGroupMenuOpen((open) => !open);
              }}
            >
              ⋯
            </button>
            {groupMenuOpen && (
              <div class="group-menu" role="menu" onPointerDown={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    setGroupMenuOpen(false);
                    setRenaming(true);
                    requestAnimationFrame(() => renameRef.current?.focus());
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={groupChildren.length === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setGroupMenuOpen(false);
                    void ungroupFromClient(node.id);
                  }}
                >
                  Ungroup
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={groupChildren.length === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setGroupMenuOpen(false);
                    addContextPins(groupChildren);
                  }}
                >
                  Pin all to context
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="is-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    setGroupMenuOpen(false);
                    removeNode(node.id);
                    void removeNodeFromClient(node.id);
                  }}
                >
                  Remove group
                </button>
              </div>
            )}
          </span>
        </div>
      )}
      {!isGroup && (
        <div class="node-titlebar" onPointerDown={handleTitlePointerDown}>
          <span class="node-type-icon" aria-hidden="true">
            {(() => {
              const NodeIcon = getNodeIcon(node.type);
              return <NodeIcon size={Math.round(14 * chromeScale)} />;
            })()}
          </span>
          {/* The kind-colored icon says what type this is (rail-chrome-v2 card
            shell: icon · title · controls, no type badge). Only the AX status
            chip joins it, and only when there is a status to show. */}
          {typeof node.data.axWorkStatus === 'string' && (
            <span class={`node-ax-status node-ax-status-${node.data.axWorkStatus}`}>{node.data.axWorkStatus}</span>
          )}
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
            <span class="node-title" onDblClick={handleTitleDblClick} title={`${title} — double-click to rename`}>
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
            {/* Open as site — full-page standalone view of this node's surface,
              served from /api/canvas/surface/:id (same document as the canvas
              iframe). Opens via the system browser so embedded hosts do not trap
              it in their own webview. */}
            {canOpenAsSite(node) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void openNodeAsSite(node);
                }}
                title="Open as site"
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
            {/* Report #64: status nodes get the same remove control as every other
              node type (backend removal + undo/history handle status uniformly). */}
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
          </div>
        </div>
      )}
      {!node.collapsed && (
        <div ref={bodyRef} class="node-body">
          {children}
          {/* AX flow step controls — rendered here rather than in a node renderer
              because a materialized step can be ANY node type, and because the
              body is what auto-fit measures (a footer outside it would be clipped
              on a content-fitted node). Renders nothing unless the node carries a
              `data.axStep` stamp. */}
          <AxStepControls node={node} />
        </div>
      )}
      {!node.collapsed && (
        <div class="node-resize-handle" onPointerDown={(e) => startResize(e, node.size.width, node.size.height)} />
      )}
      {isSelected &&
        (['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
          <span key={corner} class={`node-selection-handle is-${corner}`} aria-hidden="true" />
        ))}
      {/* Connection port handles — visible on hover, drag to connect. Groups
          are frames, not endpoints: no ports (and the edge row sits on the top
          edge where the port would be). */}
      {!isGroup &&
        (['top', 'right', 'bottom', 'left'] as const).map((side) => (
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
                case 'top':
                  px = cx;
                  py = cy - hh;
                  break;
                case 'bottom':
                  px = cx;
                  py = cy + hh;
                  break;
                case 'left':
                  px = cx - hw;
                  py = cy;
                  break;
                case 'right':
                  px = cx + hw;
                  py = cy;
                  break;
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
