import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import {
  contextPinnedNodeIds,
  dockNode,
  edges,
  expandNode,
  focusNode,
  nodes,
  pendingConnection,
  removeNode,
  toggleCollapsed,
  toggleContextPin,
  undockNode,
  updateNode,
} from '../state/canvas-store';
import {
  createEdgeFromClient,
  refreshWebpageNodeFromClient,
  removeNodeFromClient,
  sendIntent,
  ungroupFromClient,
  updateNodeFromClient,
} from '../state/intent-bridge';
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

const DEFAULT_GROUP_COLOR = '#4bbcFF';

const GROUP_COLOR_PRESETS = [
  { label: 'Blue', value: '#3b82f6' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Yellow', value: '#eab308' },
  { label: 'Red', value: '#ef4444' },
  { label: 'Gray', value: '#6b7280' },
  { label: 'Purple', value: '#a855f7' },
] as const;

export function ContextMenu({ x, y, nodeId, onClose }: ContextMenuProps) {
  const node = nodes.value.get(nodeId);
  if (!node) return null;

  const items = buildMenuItems(node);
  const keyCounts = new Map<string, number>();
  const estimatedHeight = items.some((item) => item.render)
    ? items.length * 32 + 168
    : items.length * 32 + 8;

  // Keep menu on screen
  const adjustedX = Math.min(x, Math.max(12, window.innerWidth - 240));
  const adjustedY = Math.min(y, Math.max(12, window.innerHeight - estimatedHeight));

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
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) => {
        const baseKey = item.separator
          ? 'separator'
          : item.render
            ? 'custom'
          : `${item.label ?? 'item'}:${item.shortcut ?? ''}`;
        const nextCount = (keyCounts.get(baseKey) ?? 0) + 1;
        keyCounts.set(baseKey, nextCount);
        const itemKey = `${baseKey}:${nextCount}`;

        if (item.separator) {
          return <div key={itemKey} class="context-menu-separator" />;
        }

        if (item.render) {
          return (
            <div key={itemKey} class="context-menu-custom">
              {item.render(onClose)}
            </div>
          );
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
  render?: (onClose: () => void) => ComponentChildren;
}

function getNodeLocalPath(node: CanvasNodeState): string | null {
  const path = typeof node.data.path === 'string' ? node.data.path.trim() : '';
  return path || null;
}

function normalizeHexColor(color: string): string {
  const trimmed = color.trim().toLowerCase();
  const shortMatch = trimmed.match(/^#([0-9a-f]{3})$/);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return trimmed;
}

function currentGroupColor(node: CanvasNodeState): string | null {
  if (typeof node.data.color !== 'string' || !node.data.color.trim()) return null;
  return normalizeHexColor(node.data.color);
}

function groupColorInputValue(node: CanvasNodeState): string {
  const color = currentGroupColor(node);
  return color && /^#[0-9a-f]{6}$/.test(color) ? color : normalizeHexColor(DEFAULT_GROUP_COLOR);
}

function applyGroupColor(node: CanvasNodeState, color: string | null): void {
  const nextColor = color ? normalizeHexColor(color) : null;
  updateNode(node.id, { data: { ...node.data, color: nextColor } });
  void updateNodeFromClient(node.id, { data: { color: nextColor } });
}

function renderGroupColorSection(node: CanvasNodeState, onClose: () => void): ComponentChildren {
  const activeColor = currentGroupColor(node);

  return (
    <div class="context-menu-section">
      <div class="context-menu-section-header">
        <span class="context-menu-section-label">Group color</span>
        <button
          type="button"
          class="context-menu-reset"
          onClick={() => {
            applyGroupColor(node, null);
            onClose();
          }}
        >
          Theme default
        </button>
      </div>

      <div class="context-menu-color-grid">
        {GROUP_COLOR_PRESETS.map((preset) => {
          const normalizedPreset = normalizeHexColor(preset.value);
          const active = activeColor === normalizedPreset;
          return (
            <button
              key={preset.value}
              type="button"
              class={`context-menu-color-swatch${active ? ' active' : ''}`}
              aria-label={`Set group color to ${preset.label}`}
              title={preset.label}
              style={{ '--swatch-color': preset.value }}
              onClick={() => {
                applyGroupColor(node, preset.value);
                onClose();
              }}
            >
              <span
                class="context-menu-color-dot"
                style={{ '--swatch-color': preset.value }}
              />
              <span>{preset.label}</span>
            </button>
          );
        })}
      </div>

      <label class="context-menu-color-custom">
        <span>Custom</span>
        <input
          type="color"
          class="context-menu-color-input"
          aria-label="Custom group color"
          value={groupColorInputValue(node)}
          onClick={(e) => e.stopPropagation()}
          onInput={(e) => {
            applyGroupColor(node, (e.currentTarget as HTMLInputElement).value);
            onClose();
          }}
        />
      </label>
    </div>
  );
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
      const pinned = !node.pinned;
      updateNode(node.id, { pinned });
      void updateNodeFromClient(node.id, { pinned });
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

  if (node.type === 'webpage') {
    const url = typeof node.data.url === 'string' ? node.data.url : '';
    items.push({
      label: 'Refresh webpage',
      action: () => {
        void refreshWebpageNodeFromClient(node.id);
      },
    });
    items.push({
      label: 'Open in browser',
      action: () => {
        if (url) window.open(url, '_blank', 'noopener');
      },
    });
    items.push({
      label: 'Copy URL',
      action: () => {
        if (url) navigator.clipboard.writeText(url);
      },
    });
  }

  // Group-specific actions
  if (node.type === 'group') {
    const childIds = (node.data.children as string[]) ?? [];
    items.push({ separator: true });
    items.push({
      render: (onClose) => renderGroupColorSection(node, onClose),
    });
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
        void removeNodeFromClient(node.id);
      },
    });
  }

  return items;
}
