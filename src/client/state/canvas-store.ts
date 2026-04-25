import { batch, computed, signal } from '@preact/signals';
import { isExcalidrawNode, type CanvasEdge, type CanvasLayout, type CanvasNodeState, type ConnectionStatus, type ViewportState } from '../types';
import { computeAutoArrange } from '../../shared/auto-arrange';
import { pushCanvasUpdate, updateViewportFromClient } from './intent-bridge';

function logCanvasStoreError(action: string, error: unknown): void {
  console.error(`[canvas-store] ${action} failed`, error);
}

// ── Core signals ──────────────────────────────────────────────
export const viewport = signal<ViewportState>({ x: 0, y: 0, scale: 1 });
export const nodes = signal<Map<string, CanvasNodeState>>(new Map());
export const edges = signal<Map<string, CanvasEdge>>(new Map());
export const activeNodeId = signal<string | null>(null);
export const connectionStatus = signal<ConnectionStatus>('connecting');
export const sessionId = signal<string>('');
export const traceEnabled = signal<boolean>(false);
export const canvasTheme = signal<string>('dark');
export const hasInitialServerLayout = signal<boolean>(false);

// ── Expanded (focus) node ─────────────────────────────────────
// Only one node at a time can be in expanded/focus mode. When expanded, the
// node renders as a full-viewport overlay for deep editing/reading.
export const expandedNodeId = signal<string | null>(null);
export const pendingExpandedNodeCloseId = signal<string | null>(null);
let expandedCloseTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCloseInitialCheckpointAt: unknown = undefined;
const EXCALIDRAW_CLOSE_POLL_MS = 100;
const EXCALIDRAW_CLOSE_MAX_WAIT_MS = 2500;

// ── Pending edge connection (for context menu "Connect from") ─
export const pendingConnection = signal<{ from: string } | null>(null);

// ── Drag-to-connect (live edge preview) ─────────────────────
export const draggingEdge = signal<{
  fromId: string;
  fromX: number;
  fromY: number;
  cursorX: number;
  cursorY: number;
} | null>(null);

// ── Spatial search highlight (command palette live results) ──
export const searchHighlightIds = signal<Set<string> | null>(null);

// ── Multi-node selection ──────────────────────────────────────
export const selectedNodeIds = signal<Set<string>>(new Set());

// ── Context pins (persistent context for agent queries) ──────
export const contextPinnedNodeIds = signal<Set<string>>(new Set());

export function getNeighborNodeIds(
  nodeId: string | null,
  edgeMap: Map<string, CanvasEdge>,
): Set<string> {
  if (!nodeId) return new Set();

  const neighborIds = new Set<string>();
  for (const edge of edgeMap.values()) {
    if (edge.from === nodeId) neighborIds.add(edge.to);
    if (edge.to === nodeId) neighborIds.add(edge.from);
  }
  return neighborIds;
}

export const activeNeighborNodeIds = computed(() => getNeighborNodeIds(activeNodeId.value, edges.value));

function filterNodeIdSet(ids: Set<string>, nodeMap: Map<string, CanvasNodeState>): Set<string> {
  const next = new Set<string>();
  for (const id of ids) {
    if (nodeMap.has(id)) next.add(id);
  }
  return next;
}

function sameSetValues(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

export function toggleSelected(id: string): void {
  const next = new Set(selectedNodeIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selectedNodeIds.value = next;
}

export function selectNodes(ids: string[]): void {
  selectedNodeIds.value = new Set(ids);
}

export function clearSelection(): void {
  if (selectedNodeIds.value.size === 0) return;
  selectedNodeIds.value = new Set();
}

export function getSelectedNodes(): CanvasNodeState[] {
  const sel = selectedNodeIds.value;
  if (sel.size === 0) return [];
  return Array.from(sel)
    .map((id) => nodes.value.get(id))
    .filter((n): n is CanvasNodeState => n !== undefined);
}

// ── Context pin actions ──────────────────────────────────────
export function toggleContextPin(id: string): void {
  const next = new Set(contextPinnedNodeIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  contextPinnedNodeIds.value = next;
  persistLayout();
  syncContextPinsToServer(next);
}

export function addContextPins(ids: string[]): void {
  const next = new Set(contextPinnedNodeIds.value);
  for (const id of ids) next.add(id);
  contextPinnedNodeIds.value = next;
  persistLayout();
  syncContextPinsToServer(next);
}

export function clearContextPins(): void {
  if (contextPinnedNodeIds.value.size === 0) return;
  contextPinnedNodeIds.value = new Set();
  persistLayout();
  syncContextPinsToServer(new Set());
}

export function replaceContextPinsFromServer(ids: string[]): void {
  contextPinnedNodeIds.value = new Set(ids);
}

export function getContextPinnedNodes(): CanvasNodeState[] {
  const pins = contextPinnedNodeIds.value;
  if (pins.size === 0) return [];
  return Array.from(pins)
    .map((id) => nodes.value.get(id))
    .filter((n): n is CanvasNodeState => n !== undefined);
}

function syncContextPinsToServer(ids: Set<string>): void {
  fetch('/api/canvas/context-pins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeIds: Array.from(ids) }),
  }).catch((error) => {
    logCanvasStoreError('syncContextPinsToServer', error);
  });
}

let maxZ = 1;

// ── Node CRUD ─────────────────────────────────────────────────
export function addNode(node: CanvasNodeState): void {
  batch(() => {
    const next = new Map(nodes.value);
    if (node.zIndex >= maxZ) maxZ = node.zIndex + 1;
    next.set(node.id, node);
    nodes.value = next;
    activeNodeId.value = node.id;
  });
}

export function updateNode(id: string, patch: Partial<CanvasNodeState>): void {
  const existing = nodes.value.get(id);
  if (!existing) return;
  const next = new Map(nodes.value);
  if (existing.type === 'group' && patch.position) {
    const deltaX = patch.position.x - existing.position.x;
    const deltaY = patch.position.y - existing.position.y;
    if (deltaX !== 0 || deltaY !== 0) {
      const childIds = Array.isArray(existing.data.children)
        ? existing.data.children.filter((childId): childId is string => typeof childId === 'string')
        : [];
      for (const childId of childIds) {
        const child = next.get(childId);
        if (!child || child.type === 'group') continue;
        next.set(childId, {
          ...child,
          position: {
            x: child.position.x + deltaX,
            y: child.position.y + deltaY,
          },
        });
      }
    }
  }
  next.set(id, { ...existing, ...patch });
  nodes.value = next;
  const updatedAt = (next.get(id)?.data.appCheckpoint as { updatedAt?: unknown } | undefined)?.updatedAt;
  if (
    pendingExpandedNodeCloseId.value === id &&
    updatedAt !== undefined &&
    updatedAt !== pendingCloseInitialCheckpointAt
  ) {
    finishExpandedNodeClose(id);
  }
}

export function updateNodeData(id: string, dataPatch: Record<string, unknown>): void {
  const existing = nodes.value.get(id);
  if (!existing) return;
  updateNode(id, { data: { ...existing.data, ...dataPatch } });
}

export function removeNode(id: string): void {
  removeEdgesForNode(id);
  const next = new Map(nodes.value);
  next.delete(id);
  nodes.value = next;
  if (activeNodeId.value === id) activeNodeId.value = null;
  if (expandedNodeId.value === id) expandedNodeId.value = null;
  if (selectedNodeIds.value.has(id)) {
    const sel = new Set(selectedNodeIds.value);
    sel.delete(id);
    selectedNodeIds.value = sel;
  }
  if (contextPinnedNodeIds.value.has(id)) {
    const pins = new Set(contextPinnedNodeIds.value);
    pins.delete(id);
    contextPinnedNodeIds.value = pins;
    syncContextPinsToServer(pins);
  }
}

// ── Edge CRUD ────────────────────────────────────────────────
export function addEdge(edge: CanvasEdge): void {
  const next = new Map(edges.value);
  next.set(edge.id, edge);
  edges.value = next;
}

export function removeEdge(id: string): void {
  const next = new Map(edges.value);
  next.delete(id);
  edges.value = next;
}

export function removeEdgesForNode(nodeId: string): void {
  let changed = false;
  const next = new Map(edges.value);
  for (const [id, edge] of next) {
    if (edge.from === nodeId || edge.to === nodeId) {
      next.delete(id);
      changed = true;
    }
  }
  if (changed) edges.value = next;
}

export function resizeNode(id: string, size: { width: number; height: number }): void {
  const existing = nodes.value.get(id);
  if (!existing) return;
  updateNode(id, { size });
}

export function bringToFront(id: string): void {
  const existing = nodes.value.get(id);
  if (!existing) return;
  updateNode(id, { zIndex: maxZ++ });
  activeNodeId.value = id;
}

export function toggleCollapsed(id: string): void {
  const existing = nodes.value.get(id);
  if (!existing) return;
  updateNode(id, { collapsed: !existing.collapsed });
}

export function dockNode(id: string, position: 'left' | 'right'): void {
  const existing = nodes.value.get(id);
  if (!existing) return;
  updateNode(id, { dockPosition: position });
  persistLayout();
}

export function undockNode(id: string): void {
  const existing = nodes.value.get(id);
  if (!existing) return;
  // Place at center of current viewport in world-space
  const v = viewport.value;
  const cx = (window.innerWidth / 2 - v.x) / v.scale;
  const cy = (window.innerHeight / 2 - v.y) / v.scale;
  updateNode(id, {
    dockPosition: null,
    position: { x: cx - existing.size.width / 2, y: cy - existing.size.height / 2 },
  });
  persistLayout();
}

// ── Viewport ──────────────────────────────────────────────────
export function setViewport(v: Partial<ViewportState>): void {
  viewport.value = { ...viewport.value, ...v };
}

export function replaceViewport(next: ViewportState): void {
  viewport.value = next;
}

export function commitViewport(next: ViewportState): void {
  viewport.value = next;
  persistLayout();
  void updateViewportFromClient(next);
}

export function applyServerCanvasLayout(layout: Pick<CanvasLayout, 'nodes' | 'edges'> & { viewport?: ViewportState }): void {
  const nextNodes = new Map<string, CanvasNodeState>();
  let nextMaxZ = 1;
  for (const node of layout.nodes) {
    nextNodes.set(node.id, node);
    if (node.zIndex >= nextMaxZ) nextMaxZ = node.zIndex + 1;
  }

  const edgeSource = layout.edges.filter(
    (edge) => nextNodes.has(edge.from) && nextNodes.has(edge.to),
  );
  const nextEdges = new Map<string, CanvasEdge>();
  for (const edge of edgeSource) {
    nextEdges.set(edge.id, edge);
  }

  const nextActiveNodeId =
    activeNodeId.value !== null && nextNodes.has(activeNodeId.value) ? activeNodeId.value : null;
  const nextExpandedNodeId =
    expandedNodeId.value !== null && nextNodes.has(expandedNodeId.value) ? expandedNodeId.value : null;
  const nextSelectedNodeIds = filterNodeIdSet(selectedNodeIds.value, nextNodes);
  const nextContextPinnedNodeIds = filterNodeIdSet(contextPinnedNodeIds.value, nextNodes);

  batch(() => {
    if (layout.viewport) {
      viewport.value = layout.viewport;
    }
    maxZ = nextMaxZ;
    nodes.value = nextNodes;
    edges.value = nextEdges;
    activeNodeId.value = nextActiveNodeId;
    expandedNodeId.value = nextExpandedNodeId;
    if (!sameSetValues(selectedNodeIds.value, nextSelectedNodeIds)) {
      selectedNodeIds.value = nextSelectedNodeIds;
    }
    if (!sameSetValues(contextPinnedNodeIds.value, nextContextPinnedNodeIds)) {
      contextPinnedNodeIds.value = nextContextPinnedNodeIds;
    }
  });
}

// ── Animated viewport transitions ────────────────────────────
let animationId: number | null = null;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Smoothly animate the viewport to a target state.
 * Cancels any in-flight animation. Direct manipulation (pan/zoom gestures)
 * should use setViewport() instead for instant response.
 */
export function animateViewport(
  target: ViewportState,
  duration = 300,
): void {
  if (animationId !== null) cancelAnimationFrame(animationId);

  const from = { ...viewport.value };
  const start = performance.now();

  function tick(now: number) {
    const elapsed = now - start;
    const t = Math.min(1, elapsed / duration);
    const e = easeOutCubic(t);

    viewport.value = {
      x: from.x + (target.x - from.x) * e,
      y: from.y + (target.y - from.y) * e,
      scale: from.scale + (target.scale - from.scale) * e,
    };

    if (t < 1) {
      animationId = requestAnimationFrame(tick);
    } else {
      animationId = null;
      commitViewport(target);
    }
  }

  animationId = requestAnimationFrame(tick);
}

/** Cancel any in-flight viewport animation (e.g. when user starts dragging). */
export function cancelViewportAnimation(): void {
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
}

// ── Persistence ───────────────────────────────────────────────
const STORAGE_KEY = 'pmx-canvas-layout';

export function persistLayout(): void {
  try {
    const allNodes = Array.from(nodes.value.values());
    const nodeUpdates = allNodes.map((n) => ({
      id: n.id,
      position: n.position,
      size: n.size,
      collapsed: n.collapsed,
      dockPosition: n.dockPosition,
    }));
    const layout = {
      viewport: viewport.value,
      nodes: allNodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        size: n.size,
        collapsed: n.collapsed,
        pinned: n.pinned,
        dockPosition: n.dockPosition,
      })),
      edges: Array.from(edges.value.values()).map((e) => ({
        id: e.id,
        from: e.from,
        to: e.to,
        type: e.type,
        label: e.label,
        style: e.style,
        animated: e.animated,
      })),
      contextPinnedNodeIds: Array.from(contextPinnedNodeIds.value),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    void pushCanvasUpdate(nodeUpdates);
  } catch (error) {
    logCanvasStoreError('persistLayout', error);
  }
}

export function restoreLayout(): Map<string, Partial<CanvasNodeState>> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const layout = JSON.parse(raw) as {
      viewport?: ViewportState;
      nodes?: Array<{
        id?: string;
        position?: CanvasNodeState['position'];
        size?: CanvasNodeState['size'];
        collapsed?: boolean;
        pinned?: boolean;
        dockPosition?: CanvasNodeState['dockPosition'];
      }>;
    };
    const savedNodes = Array.isArray(layout.nodes) ? layout.nodes : [];
    if (savedNodes.length === 0) return null;

    const overrides = new Map<string, Partial<CanvasNodeState>>();
    for (const node of savedNodes) {
      if (typeof node.id !== 'string' || node.id.length === 0) continue;
      overrides.set(node.id, {
        ...(node.position ? { position: node.position } : {}),
        ...(node.size ? { size: node.size } : {}),
        ...(node.collapsed !== undefined ? { collapsed: node.collapsed } : {}),
        ...(node.pinned !== undefined ? { pinned: node.pinned } : {}),
        ...(node.dockPosition !== undefined ? { dockPosition: node.dockPosition } : {}),
      });
    }

    return overrides.size > 0 ? overrides : null;
  } catch (error) {
    logCanvasStoreError('restoreLayout', error);
    return null;
  }
}

// ── Fit all ───────────────────────────────────────────────────
export function fitAll(containerW: number, containerH: number): void {
  const all = Array.from(nodes.value.values());
  if (all.length === 0) return;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const n of all) {
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + n.size.width);
    maxY = Math.max(maxY, n.position.y + n.size.height);
  }

  const PAD = 60;
  const worldW = maxX - minX + PAD * 2;
  const worldH = maxY - minY + PAD * 2;
  const scale = Math.min(1, Math.min(containerW / worldW, containerH / worldH));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  animateViewport({
    x: containerW / 2 - cx * scale,
    y: containerH / 2 - cy * scale,
    scale,
  });
}

// ── Focus node ────────────────────────────────────────────────
export function focusNode(id: string): void {
  const node = nodes.value.get(id);
  if (!node) return;
  const v = viewport.value;
  const cx = node.position.x + node.size.width / 2;
  const cy = node.position.y + node.size.height / 2;
  animateViewport({
    x: window.innerWidth / 2 - cx * v.scale,
    y: window.innerHeight / 2 - cy * v.scale,
    scale: v.scale,
  });
  bringToFront(id);
}

// ── Cycle focus ───────────────────────────────────────────────
export function cycleActiveNode(direction: 1 | -1 = 1): void {
  const all = Array.from(nodes.value.keys());
  if (all.length === 0) return;
  const currentIdx = activeNodeId.value ? all.indexOf(activeNodeId.value) : -1;
  const nextIdx = (currentIdx + direction + all.length) % all.length;
  const nextId = all[nextIdx];
  bringToFront(nextId);
  focusNode(nextId);
}

// ── Graph walking (arrow keys) ───────────────────────────────
export function walkGraph(direction: 'up' | 'down' | 'left' | 'right'): void {
  const current = activeNodeId.value;
  if (!current) return;
  const currentNode = nodes.value.get(current);
  if (!currentNode) return;

  // Find all connected node IDs
  const neighborIds = getNeighborNodeIds(current, edges.value);
  if (neighborIds.size === 0) return;

  // Center of current node
  const cx = currentNode.position.x + currentNode.size.width / 2;
  const cy = currentNode.position.y + currentNode.size.height / 2;

  // Score each neighbor by directional alignment
  let bestId: string | null = null;
  let bestScore = -Infinity;

  for (const nid of neighborIds) {
    const n = nodes.value.get(nid);
    if (!n) continue;
    const nx = n.position.x + n.size.width / 2;
    const ny = n.position.y + n.size.height / 2;
    const dx = nx - cx;
    const dy = ny - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) continue;

    // Dot product with direction vector, normalized by distance
    let dot: number;
    switch (direction) {
      case 'up':    dot = -dy; break;
      case 'down':  dot =  dy; break;
      case 'left':  dot = -dx; break;
      case 'right': dot =  dx; break;
    }

    // Only consider nodes that are at least somewhat in the right direction
    if (dot <= 0) continue;

    // Score: favor alignment (dot/dist) with distance penalty
    const score = dot / dist - dist * 0.001;
    if (score > bestScore) {
      bestScore = score;
      bestId = nid;
    }
  }

  if (bestId) focusNode(bestId);
}

// ── Expand / Collapse (focus mode) ────────────────────────────
// Uses a fixed overlay (not world-space resize) so the original node
// position/size is preserved when the user collapses back.
export function expandNode(id: string): void {
  const node = nodes.value.get(id);
  if (!node) return;
  if (expandedCloseTimer !== null) {
    clearTimeout(expandedCloseTimer);
    expandedCloseTimer = null;
  }
  pendingExpandedNodeCloseId.value = null;
  pendingCloseInitialCheckpointAt = undefined;
  bringToFront(id);
  expandedNodeId.value = id;
}

function finishExpandedNodeClose(nodeId: string): void {
  if (expandedCloseTimer !== null) {
    clearTimeout(expandedCloseTimer);
    expandedCloseTimer = null;
  }
  if (expandedNodeId.value === nodeId) expandedNodeId.value = null;
  if (pendingExpandedNodeCloseId.value === nodeId) pendingExpandedNodeCloseId.value = null;
  pendingCloseInitialCheckpointAt = undefined;
}

export function collapseExpandedNode(): void {
  const nodeId = expandedNodeId.value;
  const node = nodeId ? nodes.value.get(nodeId) : undefined;
  if (nodeId && node && isExcalidrawNode(node)) {
    const closingNodeId = nodeId;
    const startedAt = Date.now();
    pendingExpandedNodeCloseId.value = closingNodeId;
    pendingCloseInitialCheckpointAt = (node.data.appCheckpoint as { updatedAt?: unknown } | undefined)?.updatedAt;
    if (expandedCloseTimer !== null) clearTimeout(expandedCloseTimer);
    const pollForSave = () => {
      const latestNode = nodes.value.get(closingNodeId);
      const latestCheckpointAt = (latestNode?.data.appCheckpoint as { updatedAt?: unknown } | undefined)?.updatedAt;
      if (
        latestCheckpointAt !== undefined &&
        latestCheckpointAt !== pendingCloseInitialCheckpointAt
      ) {
        finishExpandedNodeClose(closingNodeId);
        return;
      }
      if (Date.now() - startedAt >= EXCALIDRAW_CLOSE_MAX_WAIT_MS) {
        finishExpandedNodeClose(closingNodeId);
        return;
      }
      expandedCloseTimer = setTimeout(pollForSave, EXCALIDRAW_CLOSE_POLL_MS);
    };
    expandedCloseTimer = setTimeout(pollForSave, EXCALIDRAW_CLOSE_POLL_MS);
    return;
  }
  if (expandedCloseTimer !== null) {
    clearTimeout(expandedCloseTimer);
    expandedCloseTimer = null;
  }
  pendingExpandedNodeCloseId.value = null;
  pendingCloseInitialCheckpointAt = undefined;
  expandedNodeId.value = null;
}

// ── Auto-arrange ──────────────────────────────────────────────
export function autoArrange(): void {
  const result = computeAutoArrange(Array.from(nodes.value.values()), Array.from(edges.value.values()), 'grid');
  if (result.nodePositions.size === 0 && result.groupBounds.size === 0) return;

  batch(() => {
    for (const [id, position] of result.nodePositions.entries()) {
      updateNode(id, { position });
    }
    for (const [groupId, bounds] of result.groupBounds.entries()) {
      updateNode(groupId, {
        position: { x: bounds.x, y: bounds.y },
        size: { width: bounds.width, height: bounds.height },
      });
    }
  });
  persistLayout();
}

export function forceDirectedArrange(): void {
  const result = computeAutoArrange(Array.from(nodes.value.values()), Array.from(edges.value.values()), 'graph');
  if (result.nodePositions.size === 0 && result.groupBounds.size === 0) return;

  batch(() => {
    for (const [id, position] of result.nodePositions.entries()) {
      updateNode(id, { position });
    }
    for (const [groupId, bounds] of result.groupBounds.entries()) {
      updateNode(groupId, {
        position: { x: bounds.x, y: bounds.y },
        size: { width: bounds.width, height: bounds.height },
      });
    }
  });
  persistLayout();
}
