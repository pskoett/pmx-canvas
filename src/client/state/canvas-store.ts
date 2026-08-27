import { batch, computed, signal } from '@preact/signals';
import {
  isExcalidrawNode,
  type CanvasAnnotation,
  type CanvasEdge,
  type CanvasLayout,
  type CanvasNodeState,
  type ConnectionStatus,
  type ViewportState,
} from '../types';
import { computeAutoArrange } from '../../shared/auto-arrange';
import { canvasAreaCenter } from '../canvas/canvas-area';
import { pushCanvasUpdate, requestBestEffort, requestOk, updateViewportFromClient } from './intent-bridge';

function logCanvasStoreError(action: string, error: unknown): void {
  console.error(`[canvas-store] ${action} failed`, error);
}

// ── Core signals ──────────────────────────────────────────────
export const viewport = signal<ViewportState>({ x: 0, y: 0, scale: 1 });
export const nodes = signal<Map<string, CanvasNodeState>>(new Map());
export const edges = signal<Map<string, CanvasEdge>>(new Map());
export const annotations = signal<Map<string, CanvasAnnotation>>(new Map());
export const activeNodeId = signal<string | null>(null);
/** Click-selected edge — Delete removes it, Escape/background click clears it. */
export const selectedEdgeId = signal<string | null>(null);
export const connectionStatus = signal<ConnectionStatus>('connecting');
// Bumped on every processed `connected` frame (SSE reconnects and poll snapshot
// resets alike). Consumers holding server-minted URLs revalidate on change —
// a server restart invalidates in-memory resources like frame documents
// (Finding S) while the browser keeps the stale URLs alive.
export const workbenchConnectionEpoch = signal<number>(0);
/**
 * Degraded-connection detail (rail-chrome-v2 phase 7, design item 14):
 * the reconnect attempt and the delay before the next try while the stream is
 * down. Both reset to 0 when a transport is back.
 */
export const reconnectAttempt = signal<number>(0);
export const reconnectDelay = signal<number>(0);
export const sessionId = signal<string>('');
export const traceEnabled = signal<boolean>(false);
export const canvasTheme = signal<string>('dark');
export const hasInitialServerLayout = signal<boolean>(false);
// Compact AX state snapshot (work items, focus, …) mirrored from the server and
// pushed into AX-enabled surfaces so authored boards can render the live queue.
// Refreshed by the SSE bridge on ax-state-changed / ax-event-created.
export const axSurfaceState = signal<unknown>(null);

// ── Expanded (focus) node ─────────────────────────────────────
// Only one node at a time can be in expanded/focus mode. When expanded, the
// node renders as a full-viewport overlay for deep editing/reading.
export const expandedNodeId = signal<string | null>(null);
export const pendingExpandedNodeCloseId = signal<string | null>(null);
let expandedCloseTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCloseInitialCheckpointAt: unknown;
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
  /** Node under the cursor that would receive the edge on release (item 15). */
  targetId?: string | null;
  /** L was pressed during the drag: ask for a label on release. */
  withLabel?: boolean;
} | null>(null);

// ── Spatial search highlight (command palette live results) ──
export const searchHighlightIds = signal<Set<string> | null>(null);

// ── Multi-node selection ──────────────────────────────────────
export const selectedNodeIds = signal<Set<string>>(new Set());

// ── Context pins (persistent context for agent queries) ──────
export const contextPinnedNodeIds = signal<Set<string>>(new Set());

// ── Chrome tool state (rail) ─────────────────────────────────
// 'select': background drag lassos, clicks select. 'pan': dragging anywhere
// pans — the world layer goes pointer-inert so nodes cannot swallow the drag.
/** `connect` (rail-chrome-v2 item 15): drag from anywhere on a node to draw an edge. */
export type CanvasTool = 'select' | 'pan' | 'connect';
export const canvasTool = signal<CanvasTool>('select');
/** Held-Space temporary pan — same semantics as the pan tool while held. */
export const spacePanHeld = signal<boolean>(false);
export function isPanModeActive(): boolean {
  return canvasTool.value === 'pan' || spacePanHeld.value;
}

export function getNeighborNodeIds(nodeId: string | null, edgeMap: Map<string, CanvasEdge>): Set<string> {
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
  // Edge selection rides along: a background click (or any other selection
  // reset) deselects the edge exactly like it deselects nodes.
  selectedEdgeId.value = null;
  if (selectedNodeIds.value.size === 0) return;
  selectedNodeIds.value = new Set();
}

// ── Groups v2 (rail-chrome-v2 phase 7, item 20) ──────────────────────

/**
 * Membership feedback while a node is being dragged: the group it would join
 * on release (`add`), or the parent it would leave (`remove`). Membership
 * changes ONLY on release while this is set — never silently by geometry.
 * Esc during the drag clears it and keeps it cleared for that drag.
 */
export const dragDropTarget = signal<{ nodeId: string; groupId: string; mode: 'add' | 'remove' } | null>(null);
let dropSuppressedForDrag = false;

export function suppressDropForDrag(): void {
  dropSuppressedForDrag = true;
  dragDropTarget.value = null;
}

export function endDropTracking(): void {
  dropSuppressedForDrag = false;
  dragDropTarget.value = null;
}

function rectOf(node: CanvasNodeState): { x: number; y: number; w: number; h: number } {
  return { x: node.position.x, y: node.position.y, w: node.size.width, h: node.size.height };
}

function contains(outer: CanvasNodeState, x: number, y: number): boolean {
  const r = rectOf(outer);
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function fullyOutside(inner: CanvasNodeState, outer: CanvasNodeState): boolean {
  const a = rectOf(inner);
  const b = rectOf(outer);
  return a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h;
}

/**
 * Called on every drag move of `nodeId`: updates the drop target and grows a
 * fit-mode parent frame live so a child dragged against it never clips
 * (the server re-fits on persist; shrinking happens there).
 */
export function trackDragMembership(nodeId: string): void {
  const node = nodes.value.get(nodeId);
  if (!node || node.type === 'group') return;
  const parentId = typeof node.data.parentGroup === 'string' ? node.data.parentGroup : null;
  const parent = parentId ? nodes.value.get(parentId) : undefined;
  const cx = node.position.x + node.size.width / 2;
  const cy = node.position.y + node.size.height / 2;
  let candidate: CanvasNodeState | null = null;
  for (const other of nodes.value.values()) {
    if (other.type !== 'group' || other.id === parentId || other.collapsed) continue;
    if (contains(other, cx, cy)) candidate = other;
  }
  if (!dropSuppressedForDrag) {
    const next = candidate
      ? { nodeId, groupId: candidate.id, mode: 'add' as const }
      : parent && fullyOutside(node, parent)
        ? { nodeId, groupId: parent.id, mode: 'remove' as const }
        : null;
    const current = dragDropTarget.value;
    if ((current?.groupId ?? null) !== (next?.groupId ?? null) || current?.mode !== next?.mode) {
      dragDropTarget.value = next;
    }
  }
  if (parent && parent.data.frameMode !== 'manual' && !fullyOutside(node, parent)) {
    const pad = 22;
    const left = Math.min(parent.position.x, node.position.x - pad);
    const top = Math.min(parent.position.y, node.position.y - pad - 32);
    const right = Math.max(parent.position.x + parent.size.width, node.position.x + node.size.width + pad);
    const bottom = Math.max(parent.position.y + parent.size.height, node.position.y + node.size.height + pad);
    if (
      left !== parent.position.x ||
      top !== parent.position.y ||
      right !== parent.position.x + parent.size.width ||
      bottom !== parent.position.y + parent.size.height
    ) {
      updateNodeWithOptions(
        parent.id,
        { position: { x: left, y: top }, size: { width: right - left, height: bottom - top } },
        { skipGroupChildTranslation: true },
      );
    }
  }
}

/** Children of collapsed groups are hidden; edges to them point at the chip. */
export const hiddenByCollapsedGroup = computed(() => {
  const hidden = new Map<string, string>();
  for (const node of nodes.value.values()) {
    if (node.type !== 'group' || !node.collapsed) continue;
    const children = Array.isArray(node.data.children) ? node.data.children : [];
    for (const childId of children) {
      if (typeof childId === 'string') hidden.set(childId, node.id);
    }
  }
  return hidden;
});

/** The node that stands in for `id` on the canvas: itself, or its collapsed group's chip. */
export function visibleNodeFor(id: string): CanvasNodeState | undefined {
  const chipId = hiddenByCollapsedGroup.value.get(id);
  return nodes.value.get(chipId ?? id);
}

/** Collapsed groups render as a chip; children keep their positions for restore. */
export function groupsOfSelection(): string[] {
  const ids = new Set<string>();
  for (const id of selectedNodeIds.value) {
    const node = nodes.value.get(id);
    if (!node) continue;
    if (node.type === 'group') ids.add(node.id);
    else if (typeof node.data.parentGroup === 'string') ids.add(node.data.parentGroup);
  }
  return [...ids];
}

// ── Selection bar geometry actions (rail-chrome-v2 phase 7, item 13) ──
// Each works on the current selection in world space and persists through the
// same path a drag does (store update + persistLayout → /api/canvas/update).

export function alignSelection(edge: 'left' | 'top'): void {
  const selected = getSelectedNodes();
  if (selected.length < 2) return;
  const target = Math.min(...selected.map((n) => (edge === 'left' ? n.position.x : n.position.y)));
  // Sharing an edge collapses nodes that used to sit side by side ONTO each
  // other. Aligning must never destroy the layout: when the shared edge makes
  // any pair overlap, flow the selection along the other axis in its current
  // order instead — align-left of a row reads as "stack into a left-aligned
  // column", which is what the gesture means.
  const GAP = 24;
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of selected) {
    positions.set(node.id, edge === 'left' ? { x: target, y: node.position.y } : { x: node.position.x, y: target });
  }
  const overlaps = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const framed = selected.map((node) => {
    const at = positions.get(node.id)!;
    return { node, x: at.x, y: at.y, w: node.size.width, h: node.size.height };
  });
  const collides = framed.some((a, i) => framed.some((b, j) => j > i && overlaps(a, b)));
  if (collides) {
    const ordered = [...selected].sort((a, b) =>
      edge === 'left' ? a.position.y - b.position.y : a.position.x - b.position.x,
    );
    let cursor =
      edge === 'left' ? Math.min(...selected.map((n) => n.position.y)) : Math.min(...selected.map((n) => n.position.x));
    for (const node of ordered) {
      positions.set(node.id, edge === 'left' ? { x: target, y: cursor } : { x: cursor, y: target });
      cursor += (edge === 'left' ? node.size.height : node.size.width) + GAP;
    }
  }
  batch(() => {
    for (const node of selected) {
      updateNode(node.id, { position: positions.get(node.id)! });
    }
  });
  persistLayout();
}

/** Even horizontal gaps between the selected nodes, first and last staying put. */
export function distributeSelection(): void {
  const selected = getSelectedNodes().sort((a, b) => a.position.x - b.position.x);
  if (selected.length < 3) return;
  const first = selected[0]!;
  const last = selected[selected.length - 1]!;
  const span = last.position.x - (first.position.x + first.size.width);
  const inner = selected.slice(1, -1);
  const innerWidth = inner.reduce((sum, n) => sum + n.size.width, 0);
  const gap = (span - innerWidth) / (inner.length + 1);
  batch(() => {
    if (gap < 8) {
      // The selection doesn't fit between first and last (a column, or an
      // already-tight row): keeping the ends pinned would SQUEEZE the middle
      // into overlap. Flow everything after the first into a row instead.
      let cursor = first.position.x + first.size.width + 24;
      for (const node of selected.slice(1)) {
        updateNode(node.id, { position: { x: cursor, y: node.position.y } });
        cursor += node.size.width + 24;
      }
      return;
    }
    let cursor = first.position.x + first.size.width + gap;
    for (const node of inner) {
      updateNode(node.id, { position: { x: cursor, y: node.position.y } });
      cursor += node.size.width + gap;
    }
  });
  persistLayout();
}

/** Grid the selection in reading order from its own top-left corner. */
export function arrangeSelection(gap = 24): void {
  const selected = getSelectedNodes().sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  if (selected.length < 2) return;
  const originX = Math.min(...selected.map((n) => n.position.x));
  const originY = Math.min(...selected.map((n) => n.position.y));
  const cols = Math.ceil(Math.sqrt(selected.length));
  const colWidth = Math.max(...selected.map((n) => n.size.width));
  const rowHeight = Math.max(...selected.map((n) => n.size.height));
  batch(() => {
    selected.forEach((node, index) => {
      updateNode(node.id, {
        position: {
          x: originX + (index % cols) * (colWidth + gap),
          y: originY + Math.floor(index / cols) * (rowHeight + gap),
        },
      });
    });
  });
  persistLayout();
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

function syncContextPinsToServer(ids: Set<string>): void {
  // Through the bridge so the write carries the workbench marker — a bare
  // fetch makes the human's pin look like an anonymous `api` agent.
  void requestBestEffort('syncContextPinsToServer', '/api/canvas/context-pins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeIds: Array.from(ids) }),
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
  updateNodeWithOptions(id, patch);
}

function updateNodeWithOptions(
  id: string,
  patch: Partial<CanvasNodeState>,
  options: { skipGroupChildTranslation?: boolean } = {},
): void {
  const existing = nodes.value.get(id);
  if (!existing) return;
  const next = new Map(nodes.value);
  if (existing.type === 'group' && patch.position && options.skipGroupChildTranslation !== true) {
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

export function addAnnotation(annotation: CanvasAnnotation): void {
  const next = new Map(annotations.value);
  next.set(annotation.id, annotation);
  annotations.value = next;
}

export function removeAnnotation(id: string): void {
  const next = new Map(annotations.value);
  if (!next.delete(id)) return;
  annotations.value = next;
}

export async function createAnnotationFromClient(input: {
  type?: CanvasAnnotation['type'];
  points: CanvasAnnotation['points'];
  color: string;
  width: number;
  text?: string;
  label?: string;
}): Promise<{ ok: boolean }> {
  return requestOk('createAnnotationFromClient', '/api/canvas/annotation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function removeAnnotationFromClient(id: string): Promise<{ ok: boolean }> {
  const result = await requestOk('removeAnnotationFromClient', `/api/canvas/annotation/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (result.ok) removeAnnotation(id);
  return result;
}

export function resizeNode(id: string, size: { width: number; height: number }): void {
  const existing = nodes.value.get(id);
  if (!existing) return;
  updateNode(id, { size });
}

export function bringToFront(id: string): void {
  const existing = nodes.value.get(id);
  if (!existing) return;
  batch(() => {
    updateNode(id, { zIndex: maxZ++ });
    // A group is a frame: it must never stack above its own children.
    if (existing.type === 'group' && Array.isArray(existing.data.children)) {
      for (const childId of existing.data.children) {
        if (typeof childId === 'string' && nodes.value.has(childId)) updateNode(childId, { zIndex: maxZ++ });
      }
    }
  });
  activeNodeId.value = id;
}

export function toggleCollapsed(id: string): void {
  const existing = nodes.value.get(id);
  if (!existing) return;
  updateNode(id, { collapsed: !existing.collapsed });
  // Collapse is board state (a collapsed group hides its children for every
  // viewer and survives reload), not a per-tab preference.
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
  commitViewportWithOptions(next);
}

function commitViewportWithOptions(next: ViewportState, options: { recordHistory?: boolean } = {}): void {
  viewport.value = next;
  persistLayout(options);
  void updateViewportFromClient(next, options);
}

export function applyServerCanvasLayout(
  layout: Pick<CanvasLayout, 'nodes' | 'edges'> & { viewport?: ViewportState; annotations?: CanvasAnnotation[] },
  options: { applyViewport?: boolean } = {},
): void {
  const nextNodes = new Map<string, CanvasNodeState>();
  let nextMaxZ = 1;
  for (const node of layout.nodes) {
    nextNodes.set(node.id, node);
    if (node.zIndex >= nextMaxZ) nextMaxZ = node.zIndex + 1;
  }

  const edgeSource = layout.edges.filter((edge) => nextNodes.has(edge.from) && nextNodes.has(edge.to));
  const nextEdges = new Map<string, CanvasEdge>();
  for (const edge of edgeSource) {
    nextEdges.set(edge.id, edge);
  }
  const nextAnnotations = new Map<string, CanvasAnnotation>();
  for (const annotation of layout.annotations ?? []) {
    nextAnnotations.set(annotation.id, annotation);
  }

  const nextActiveNodeId = activeNodeId.value !== null && nextNodes.has(activeNodeId.value) ? activeNodeId.value : null;
  const nextExpandedNodeId =
    expandedNodeId.value !== null && nextNodes.has(expandedNodeId.value) ? expandedNodeId.value : null;
  const nextSelectedNodeIds = filterNodeIdSet(selectedNodeIds.value, nextNodes);
  const nextContextPinnedNodeIds = filterNodeIdSet(contextPinnedNodeIds.value, nextNodes);

  batch(() => {
    if (options.applyViewport === true && layout.viewport) {
      viewport.value = layout.viewport;
    }
    maxZ = nextMaxZ;
    nodes.value = nextNodes;
    edges.value = nextEdges;
    annotations.value = nextAnnotations;
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
/**
 * Zoom by a factor about the CENTRE of the viewport.
 *
 * The toolbar's +/- used to change `scale` alone and keep `x`/`y`, which anchors
 * the zoom at the world origin — so zooming in visibly slid the board up-left and
 * zooming out pushed it down-right, instead of magnifying what you were looking
 * at. Same correction the pointer-anchored wheel zoom applies, with the viewport
 * centre as the anchor.
 */
export function zoomByFactor(factor: number, duration = 150): void {
  const v = viewport.value;
  const scale = Math.min(4, Math.max(0.1, v.scale * factor));
  if (scale === v.scale) return;
  const ratio = scale / v.scale;
  const { x: cx, y: cy } = canvasAreaCenter();
  animateViewport({ x: cx - ratio * (cx - v.x), y: cy - ratio * (cy - v.y), scale }, duration);
}

export function animateViewport(
  target: ViewportState,
  duration = 300,
  options: { recordHistory?: boolean } = {},
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
      commitViewportWithOptions(target, options);
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

export function persistLayout(options: { recordHistory?: boolean } = {}): void {
  try {
    const allNodes = Array.from(nodes.value.values());
    const nodeUpdates = allNodes.map((n) => ({
      id: n.id,
      position: n.position,
      size: n.size,
      collapsed: n.collapsed,
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
    void pushCanvasUpdate(nodeUpdates, options);
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
export function focusNode(id: string, options: { recordHistory?: boolean } = {}): void {
  const node = nodes.value.get(id);
  if (!node) return;
  const v = viewport.value;
  const cx = node.position.x + node.size.width / 2;
  const cy = node.position.y + node.size.height / 2;
  const centre = canvasAreaCenter();
  animateViewport(
    {
      x: centre.x - cx * v.scale,
      y: centre.y - cy * v.scale,
      scale: v.scale,
    },
    300,
    options,
  );
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
      case 'up':
        dot = -dy;
        break;
      case 'down':
        dot = dy;
        break;
      case 'left':
        dot = -dx;
        break;
      case 'right':
        dot = dx;
        break;
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
      if (latestCheckpointAt !== undefined && latestCheckpointAt !== pendingCloseInitialCheckpointAt) {
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
      updateNodeWithOptions(
        groupId,
        {
          position: { x: bounds.x, y: bounds.y },
          size: { width: bounds.width, height: bounds.height },
        },
        { skipGroupChildTranslation: true },
      );
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
      updateNodeWithOptions(
        groupId,
        {
          position: { x: bounds.x, y: bounds.y },
          size: { width: bounds.width, height: bounds.height },
        },
        { skipGroupChildTranslation: true },
      );
    }
  });
  persistLayout();
}
