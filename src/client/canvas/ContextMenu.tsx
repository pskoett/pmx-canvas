import { useCallback, useEffect, useState } from 'preact/hooks';
import {
  contextPinnedNodeIds,
  dockNode,
  edges,
  expandNode,
  focusNode,
  nodes,
  pendingConnection,
  persistLayout,
  removeNode,
  toggleCollapsed,
  toggleContextPin,
  undockNode,
  updateNode,
} from '../state/canvas-store';
import { createEdgeFromClient, sendIntent, ungroupFromClient } from '../state/intent-bridge';
import { EXPANDABLE_TYPES } from '../types';
import type { CanvasNodeState } from '../types';

interface MenuState {
  x: number;
  y: number;
  nodeId: string;
}

export function useContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);

  const openMenu = useCallback((e: MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, nodeId });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (!menu) return;
    const handleClick = () => setMenu(null);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menu]);

  return { menu, openMenu, closeMenu };
}

interface ContextMenuProps {
  x: number;
  y: number;
  nodeId: string;
  onClose: () => void;
}

export function ContextMenu({ x, y, nodeId, onClose }: ContextMenuProps) {
  const node = nodes.value.get(nodeId);
  if (!node) return null;

  const items = buildMenuItems(node);
  const keyCounts = new Map<string, number>();

  // Keep menu on screen
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - items.length * 32 - 8);

  return (
    <div
      class="context-menu"
      style={{
        position: 'fixed',
        left: `${adjustedX}px`,
        top: `${adjustedY}px`,
        zIndex: 10000,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => {
        const baseKey = item.separator
          ? 'separator'
          : `${item.label ?? 'item'}:${item.shortcut ?? ''}`;
        const nextCount = (keyCounts.get(baseKey) ?? 0) + 1;
        keyCounts.set(baseKey, nextCount);
        const itemKey = `${baseKey}:${nextCount}`;

        if (item.separator) {
          return <div key={itemKey} class="context-menu-separator" />;
        }

        return (
          <button
            key={itemKey}
            type="button"
            class="context-menu-item"
            onClick={() => {
              item.action?.();
              onClose();
            }}
          >
            <span class="context-menu-label">{item.label}</span>
            {item.shortcut && <span class="context-menu-shortcut">{item.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}

interface MenuItem {
  label?: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
}

function getNodeLocalPath(node: CanvasNodeState): string | null {
  const path = typeof node.data.path === 'string' ? node.data.path.trim() : '';
  return path || null;
}

function buildMenuItems(node: CanvasNodeState): MenuItem[] {
  const items: MenuItem[] = [];
  const localPath = getNodeLocalPath(node);

  // S2: Delegate to focusNode() which centers, brings to front, and persists
  items.push({
    label: 'Focus',
    action: () => focusNode(node.id),
  });

  // Expand into full-viewport overlay for focused work
  if (EXPANDABLE_TYPES.has(node.type)) {
    items.push({
      label: 'Expand',
      shortcut: '⤢',
      action: () => expandNode(node.id),
    });
  }

  // Collapse/Expand
  items.push({
    label: node.collapsed ? 'Expand' : 'Collapse',
    action: () => toggleCollapsed(node.id),
  });

  // Pin/Unpin
  items.push({
    label: node.pinned ? 'Unpin' : 'Pin (exclude from auto-arrange)',
    action: () => {
      updateNode(node.id, { pinned: !node.pinned });
      persistLayout();
    },
  });

  // Context pin — add/remove from persistent agent context
  const isCtxPinned = contextPinnedNodeIds.value.has(node.id);
  items.push({
    label: isCtxPinned ? 'Remove from context' : 'Add to context',
    action: () => toggleContextPin(node.id),
  });

  // ── Edge connection ──
  const pending = pendingConnection.value;
  if (pending && pending.from !== node.id) {
    const sourceNode = nodes.value.get(pending.from);
    const sourceTitle = sourceNode
      ? ((sourceNode.data.title as string) || sourceNode.id).slice(0, 20)
      : pending.from;
    items.push({
      label: `Connect from "${sourceTitle}"`,
      action: () => {
        createEdgeFromClient(pending.from, node.id, 'relation');
        pendingConnection.value = null;
      },
    });
  }

  items.push({
    label: pending ? 'Connect from here (replace)' : 'Connect from here',
    action: () => {
      pendingConnection.value = { from: node.id };
    },
  });

  // Show edge count
  const edgeCount = Array.from(edges.value.values()).filter(
    (e) => e.from === node.id || e.to === node.id,
  ).length;
  if (edgeCount > 0) {
    items.push({
      label: `${edgeCount} edge${edgeCount !== 1 ? 's' : ''} connected`,
    });
  }

  items.push({ separator: true });

  // Type-specific
  if ((node.type === 'markdown' || node.type === 'file' || node.type === 'image') && localPath) {
    items.push({
      label: 'Open in browser',
      action: () => {
        window.open(`/artifact?path=${encodeURIComponent(localPath)}`, '_blank', 'noopener');
      },
    });
    items.push({
      label: 'Copy path',
      action: () => {
        navigator.clipboard.writeText(localPath);
      },
    });
  }

  if (node.type === 'mcp-app' || node.type === 'json-render' || node.type === 'graph') {
    if (node.data.chartConfig) {
      // Chart ext-app node — chart-specific actions
      const chartTitle =
        ((node.data.chartConfig as Record<string, unknown>).title as string) || 'chart';
      items.push({
        label: 'Copy chart data',
        action: () => {
          navigator.clipboard.writeText(JSON.stringify(node.data.chartConfig, null, 2));
        },
      });
    } else {
      // Regular MCP app node
      const url = node.data.url as string;
      items.push({
        label: 'Open in browser',
        action: () => {
          if (url) window.open(url, '_blank');
        },
      });
      items.push({
        label: 'Focus in TUI',
        action: () => sendIntent('mcp-app-focus', { url }),
      });
      if (node.type === 'json-render' || node.type === 'graph') {
        items.push({
          label: 'Copy spec',
          action: () => {
            navigator.clipboard.writeText(
              JSON.stringify(node.data.spec ?? node.data.graphConfig ?? {}, null, 2),
            );
          },
        });
      }
    }
  }

  // Group-specific actions
  if (node.type === 'group') {
    const childIds = (node.data.children as string[]) ?? [];
    items.push({ separator: true });
    if (childIds.length > 0) {
      items.push({
        label: `Ungroup (${childIds.length} node${childIds.length !== 1 ? 's' : ''})`,
        action: () => ungroupFromClient(node.id),
      });
    }
  }

  // Dock/undock for status and ledger nodes
  if (node.type === 'status' || node.type === 'ledger') {
    items.push({ separator: true });
    if (node.dockPosition !== null) {
      items.push({
        label: 'Undock to canvas',
        action: () => undockNode(node.id),
      });
    } else {
      items.push({
        label: 'Dock left of toolbar',
        action: () => dockNode(node.id, 'left'),
      });
      items.push({
        label: 'Dock right of toolbar',
        action: () => dockNode(node.id, 'right'),
      });
    }
  }

  if (node.type !== 'status') {
    items.push({ separator: true });
    items.push({
      label: 'Close',
      action: () => {
        removeNode(node.id);
        persistLayout();
      },
    });
  }

  return items;
}
