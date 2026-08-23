import { findOpenCanvasPosition } from '../utils/placement.js';
import { normalizeExtAppToolResult } from '../utils/ext-app-tool-result.js';
import type { CanvasAnnotation, CanvasEdge, CanvasNodeState } from '../types';
import {
  activeNodeId,
  addEdge,
  addNode,
  applyServerCanvasLayout,
  axSurfaceState,
  bringToFront,
  cancelViewportAnimation,
  canvasTheme,
  connectionStatus,
  replaceContextPinsFromServer,
  edges,
  focusNode,
  hasInitialServerLayout,
  nodes,
  replaceViewport,
  removeEdge,
  removeNode,
  restoreLayout,
  sessionId,
  traceEnabled,
  updateNodeData,
  workbenchConnectionEpoch,
} from './canvas-store';
import { fetchAgentPresence, fetchAxSurfaceState, reportClientViewportSize } from './intent-bridge';
import { applyPresenceSnapshot, sessionActive } from './presence-store';
import { refreshTimeline } from './session-store';
import { initSessionThemeOverride, themeOverrideActive } from './theme-override';
import { DEFAULT_POSITIONS, makeNodeState } from './node-factory';
import { invalidateTokenCache } from '../theme/tokens';
import { resetAttentionBridge, syncAttentionFromSse } from './attention-bridge';
import { dissolveIntent, resetIntents, settleIntent, upsertIntent } from './intent-store';
import type { PmxAxIntent } from '../../shared/ax-intent.js';
import type { AgentPresenceSnapshot } from '../../shared/agent-presence.js';
import { isCanvasTheme } from '../../shared/themes.js';

let eventSource: EventSource | null = null;
let savedLayout: Map<string, Partial<CanvasNodeState>> | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// ── Proxy-safe polling transport ──────────────────────────────
// Some proxies (e.g. the Amp orb portal) buffer streaming responses and only
// flush them on close, so the SSE stream delivers NOTHING — the connection
// "opens" (headers pass through) but no event ever arrives. Fallback: if the
// stream produces no event at all within the watchdog window, switch to
// polling GET /api/workbench/poll, which returns buffered events (or a full
// connect snapshot) as a normal response every couple of seconds. The same
// EVENT_HANDLERS map serves both transports. `?transport=poll` forces polling
// from the start; `?transport=sse` disables the fallback.
const SSE_FIRST_EVENT_WATCHDOG_MS = 3000;
const POLL_INTERVAL_MS = 2000;
const POLL_ERROR_INTERVAL_MS = 5000;
let pollingMode = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollSeq: number | null = null;
let pollGeneration = 0;
let sseFirstEventWatchdog: ReturnType<typeof setTimeout> | null = null;

export function forcedTransport(): 'poll' | 'sse' | null {
  if (typeof location === 'undefined' || typeof window === 'undefined') return null;
  const value = new URLSearchParams(location.search).get('transport');
  if (value === 'poll' || value === 'sse') return value;
  // Amp orbs: the portal proxy buffers SSE, so auto mode burns the 3s
  // watchdog before falling back — and on slow proxy days that trips the
  // boot modal. The server stamps the orb flag into the page (canvasSpaHtml);
  // go straight to the transport that works there. `?transport=sse` above
  // still overrides for diagnosis.
  if ((window as Window & { __PMX_AMP_ORB?: unknown }).__PMX_AMP_ORB === true) return 'poll';
  return null;
}

// Maps responseNodeId → thread prompt node ID so response deltas/completions
// are routed into the thread's turns array instead of creating separate nodes.
// Entries are added on response-start and removed on response-complete. Streams
// still in flight when the connection drops would otherwise leak entries, so
// connectSSE() — the shared entry path for both transports — clears the map
// alongside the rest of the per-connection state.
const responseToThreadMap = new Map<string, string>();

// ── Helpers ───────────────────────────────────────────────────

// D1: Simple string hash for deterministic node IDs (e.g. `md-${hashPath(path)}`).
// Uses Java's String.hashCode algorithm. Collisions are acceptable here — they
// just cause two paths to share a node slot (last-write-wins), which is benign
// for the canvas use case and keeps IDs stable across reconnects.
/** @internal — exported for testing */
export function hashPath(path: string): string {
  let h = 0;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) - h + path.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function applyLayoutOverrides(node: CanvasNodeState): CanvasNodeState {
  if (!savedLayout) return node;
  const overrides = savedLayout.get(node.id);
  if (!overrides) return node;
  return {
    ...node,
    position: overrides.position ?? node.position,
    size: overrides.size ?? node.size,
    collapsed: overrides.collapsed ?? node.collapsed,
    pinned: overrides.pinned ?? node.pinned,
    dockPosition: overrides.dockPosition !== undefined ? overrides.dockPosition : node.dockPosition,
  };
}

// Default geometry lives in the shared node factory (node-factory.ts); this
// wrapper just layers the connection-local saved-layout overrides on top.
function makeNode(
  id: string,
  type: CanvasNodeState['type'],
  data: Record<string, unknown>,
  dockPosition: 'left' | 'right' | null = null,
): CanvasNodeState {
  return applyLayoutOverrides(makeNodeState(id, type, data, { dockPosition }));
}

function getMarkdownPlacement(): { x: number; y: number } {
  return findOpenCanvasPosition([...nodes.value.values()], DEFAULT_POSITIONS.markdown.w, DEFAULT_POSITIONS.markdown.h);
}

// ── Node ensure helpers ───────────────────────────────────────
function ensureStatusNode(): void {
  const id = 'status-main';
  if (!nodes.value.has(id)) {
    addNode(makeNode(id, 'status', { phase: 'idle', message: '', elapsed: 0 }, 'left'));
  }
}

function ensureMarkdownNode(path: string, title: string): void {
  const id = `md-${hashPath(path)}`;
  const existing = nodes.value.get(id);
  if (existing) {
    updateNodeData(id, { path, title });
    activeNodeId.value = id;
  } else {
    const placement = getMarkdownPlacement();
    const node = makeNode(id, 'markdown', { path, title, content: '', rendered: '' });
    node.position = placement;
    addNode(node);
    if (!node.dockPosition) {
      focusNode(id);
    }
  }
}

function ensureContextNode(cards: unknown[]): void {
  const id = 'context-main';
  const existing = nodes.value.get(id);
  if (existing) {
    updateNodeData(id, { cards });
  } else if (cards.length > 0) {
    const node = makeNode(id, 'context', { cards });
    addNode(node);
  }
}

function ensureMcpAppNode(data: Record<string, unknown>): void {
  const url = data.url as string;
  const id = `mcp-${hashPath(url)}`;
  const existing = nodes.value.get(id);
  if (existing) {
    updateNodeData(id, data);
  } else {
    addNode(makeNode(id, 'mcp-app', data));
    focusNode(id);
  }
}

function ensureExtAppNode(data: Record<string, unknown>): void {
  const toolCallId = data.toolCallId as string;
  const eventNodeId = typeof data.nodeId === 'string' && data.nodeId.length > 0 ? data.nodeId : null;
  const id = eventNodeId ?? (toolCallId.startsWith('ext-app-') ? toolCallId : `ext-app-${toolCallId}`);
  const existing = nodes.value.get(id);
  if (existing) {
    updateNodeData(id, data);
    return;
  }

  // Check if there's already an ext-app node for the same server+tool still in
  // "loading" state (no toolResult yet). Reuse it instead of creating a duplicate.
  const serverName = data.serverName as string;
  const toolName = data.toolName as string;
  if (serverName && toolName) {
    for (const [existingId, n] of nodes.value.entries()) {
      if (
        n.type === 'mcp-app' &&
        n.data.mode === 'ext-app' &&
        n.data.serverName === serverName &&
        n.data.toolName === toolName &&
        !n.data.toolResult
      ) {
        // Reuse this node — update its data with the new toolCallId and html
        updateNodeData(existingId, { ...data });
        return;
      }
    }
  }

  // Use custom position/size if provided (chart nodes), otherwise offset from defaults
  const customX = data._x as number | undefined;
  const customY = data._y as number | undefined;
  const customW = data._width as number | undefined;
  const customH = data._height as number | undefined;
  const pos = DEFAULT_POSITIONS['mcp-app'];
  const width = customW ?? pos.w;
  const height = customH ?? pos.h;
  const autoPos =
    customX === undefined || customY === undefined
      ? findOpenCanvasPosition([...nodes.value.values()], width, height)
      : null;
  const node = applyLayoutOverrides(
    makeNodeState(
      id,
      'mcp-app',
      { mode: 'ext-app', ...data },
      {
        position: {
          x: customX ?? autoPos?.x ?? pos.x,
          y: customY ?? autoPos?.y ?? pos.y,
        },
        size: { width, height },
      },
    ),
  );
  addNode(node);
  if (!node.dockPosition) {
    focusNode(id, { recordHistory: false });
  }
}

function findExtAppNodeId(toolCallId: string): string | null {
  const directId = toolCallId.startsWith('ext-app-') ? toolCallId : `ext-app-${toolCallId}`;
  if (nodes.value.has(directId)) return directId;
  const legacyDirectId = `ext-app-${toolCallId}`;
  if (legacyDirectId !== directId && nodes.value.has(legacyDirectId)) return legacyDirectId;
  for (const [nodeId, node] of nodes.value.entries()) {
    if (node.type === 'mcp-app' && node.data.mode === 'ext-app' && node.data.toolCallId === toolCallId) {
      return nodeId;
    }
  }
  return null;
}

function findExtAppEventNodeId(data: Record<string, unknown>): string | null {
  const eventNodeId = typeof data.nodeId === 'string' && data.nodeId.length > 0 ? data.nodeId : null;
  if (eventNodeId && nodes.value.has(eventNodeId)) return eventNodeId;
  if (typeof data.toolCallId !== 'string' || !data.toolCallId) return null;
  return findExtAppNodeId(data.toolCallId);
}

function findOnlyPendingExtAppNodeId(serverName: unknown, toolName: unknown): string | null {
  if (typeof serverName !== 'string' || !serverName) return null;
  if (typeof toolName !== 'string' || !toolName) return null;
  let matchId: string | null = null;
  for (const [nodeId, node] of nodes.value.entries()) {
    if (
      node.type === 'mcp-app' &&
      node.data.mode === 'ext-app' &&
      node.data.serverName === serverName &&
      node.data.toolName === toolName &&
      !node.data.toolResult
    ) {
      if (matchId) return null;
      matchId = nodeId;
    }
  }
  return matchId;
}

function ensureLedgerNode(summary: Record<string, unknown>): void {
  const id = 'ledger-main';
  const existing = nodes.value.get(id);
  if (existing) {
    updateNodeData(id, summary);
  } else {
    const node = makeNode(id, 'ledger', summary, 'right');
    node.collapsed = true;
    addNode(node);
  }
}

function applyCanvasTheme(theme: string): void {
  // Registry-driven: this is the ONLY path a server-side theme reaches the
  // browser (connected snapshot + theme-changed events) — a hardcoded subset
  // here silently drops themes on reload and breaks cross-tab sync.
  if (!isCanvasTheme(theme)) return;
  document.documentElement.setAttribute('data-theme', theme);
  invalidateTokenCache();
  if (canvasTheme.value !== theme) canvasTheme.value = theme;
}

function isCanvasNodeType(value: unknown): value is CanvasNodeState['type'] {
  return (
    value === 'markdown' ||
    value === 'mcp-app' ||
    value === 'webpage' ||
    value === 'json-render' ||
    value === 'graph' ||
    value === 'prompt' ||
    value === 'response' ||
    value === 'status' ||
    value === 'context' ||
    value === 'ledger' ||
    value === 'trace' ||
    value === 'file' ||
    value === 'diff' ||
    value === 'mermaid' ||
    value === 'image' ||
    value === 'html' ||
    value === 'group'
  );
}

function isCanvasEdgeType(value: unknown): value is CanvasEdge['type'] {
  return value === 'relation' || value === 'depends-on' || value === 'flow' || value === 'references';
}

function parseCanvasPosition(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== 'object') return null;
  const position = value as { x?: unknown; y?: unknown };
  if (typeof position.x !== 'number' || typeof position.y !== 'number') return null;
  return { x: position.x, y: position.y };
}

function parseCanvasSize(value: unknown): { width: number; height: number } | null {
  if (!value || typeof value !== 'object') return null;
  const size = value as { width?: unknown; height?: unknown };
  if (typeof size.width !== 'number' || typeof size.height !== 'number') return null;
  return { width: size.width, height: size.height };
}

function parseCanvasRect(value: unknown): { x: number; y: number; width: number; height: number } | null {
  const position = parseCanvasPosition(value);
  const size = parseCanvasSize(value);
  return position && size ? { ...position, ...size } : null;
}

function parseCanvasNode(raw: Record<string, unknown>): CanvasNodeState | null {
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (!isCanvasNodeType(raw.type)) return null;

  const position = parseCanvasPosition(raw.position);
  const size = parseCanvasSize(raw.size);
  if (!position || !size) return null;

  const dockPosition = raw.dockPosition === 'left' || raw.dockPosition === 'right' ? raw.dockPosition : null;
  const data = raw.data && typeof raw.data === 'object' ? Object.fromEntries(Object.entries(raw.data)) : {};

  return {
    id: raw.id,
    type: raw.type,
    position,
    size,
    zIndex: typeof raw.zIndex === 'number' ? raw.zIndex : 1,
    collapsed: raw.collapsed === true,
    pinned: raw.pinned === true,
    dockPosition,
    data,
  };
}

function parseCanvasEdge(raw: Record<string, unknown>): CanvasEdge | null {
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.from !== 'string' || !raw.from) return null;
  if (typeof raw.to !== 'string' || !raw.to) return null;
  if (!isCanvasEdgeType(raw.type)) return null;

  return {
    id: raw.id,
    from: raw.from,
    to: raw.to,
    type: raw.type,
    ...(typeof raw.label === 'string' ? { label: raw.label } : {}),
    ...(raw.style === 'solid' || raw.style === 'dashed' || raw.style === 'dotted' ? { style: raw.style } : {}),
    ...(raw.animated === true ? { animated: true } : {}),
  };
}

function parseCanvasAnnotation(raw: Record<string, unknown>): CanvasAnnotation | null {
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (raw.type !== 'freehand' && raw.type !== 'text') return null;
  if (!Array.isArray(raw.points)) return null;
  const points = raw.points
    .map((point) => parseCanvasPosition(point))
    .filter((point): point is { x: number; y: number } => point !== null);
  const bounds = parseCanvasRect(raw.bounds);
  if (points.length < (raw.type === 'text' ? 1 : 2) || !bounds) return null;

  return {
    id: raw.id,
    type: raw.type,
    points,
    bounds,
    color: typeof raw.color === 'string' ? raw.color : '#f97316',
    width: typeof raw.width === 'number' ? raw.width : 4,
    ...(typeof raw.text === 'string' ? { text: raw.text } : {}),
    ...(typeof raw.label === 'string' ? { label: raw.label } : {}),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
  };
}

// ── SSE event handlers ───────────────────────────────────────

/**
 * Stale-SPA guard (0.4.5 report Finding W): a long-lived host panel keeps its
 * in-memory bundle across a daemon upgrade — SSE reconnects silently and the
 * old client renders none of the new release's behavior. The boot HTML stamps
 * the server version at page-serve time; when a `connected` frame reports a
 * DIFFERENT version, the server was upgraded under this page — reload once to
 * pick up the new bundle. Guarded per version so a broken stamp can't loop.
 */
const VERSION_RELOAD_KEY = 'pmx-canvas-version-reload';
function reloadIfServerUpgraded(serverVersion: unknown): void {
  if (typeof serverVersion !== 'string' || !serverVersion || serverVersion === 'unknown') return;
  if (typeof window === 'undefined') return;
  const bootVersion = (window as Window & { __PMX_BOOT_SERVER_VERSION?: unknown }).__PMX_BOOT_SERVER_VERSION;
  if (typeof bootVersion !== 'string' || !bootVersion || bootVersion === 'unknown') return;
  if (serverVersion === bootVersion) return;
  try {
    if (window.sessionStorage.getItem(VERSION_RELOAD_KEY) === serverVersion) return;
    window.sessionStorage.setItem(VERSION_RELOAD_KEY, serverVersion);
  } catch {
    return; // No sessionStorage loop guard available — never risk a reload loop.
  }
  window.location.reload();
}

function handleAgentPresence(data: Record<string, unknown>): void {
  applyPresenceSnapshot(data as Partial<AgentPresenceSnapshot>);
}

function handleConnected(data: Record<string, unknown>): void {
  sessionId.value = (data.sessionId as string) || '';
  connectionStatus.value = 'connected';
  // Reconnect marker for holders of server-minted URLs (Finding S).
  workbenchConnectionEpoch.value += 1;
  reloadIfServerUpgraded(data.version);
  // Tell the server how big this window actually is, so an agent `fit` sizes
  // the board to the human's window (0.4.6 orb feedback #2).
  void reportClientViewportSize();
  // Agent presence: read the snapshot on (re)connect; `agent-presence` frames
  // keep it live from here on.
  void fetchAgentPresence().then(applyPresenceSnapshot);
  // The AX surface snapshot (work items, gates) likewise — it used to arrive
  // only on the first ax-state-changed, so a fresh load showed an empty
  // session panel while persisted work items existed.
  void fetchAxSurfaceState().then((state) => {
    axSurfaceState.value = state;
    if (sessionActive.value) void refreshTimeline();
  });
  // A ?theme= session override (host-default theming) wins over the
  // server-global theme for THIS client only.
  if (typeof data.theme === 'string' && !themeOverrideActive()) {
    applyCanvasTheme(data.theme);
  }
  if (data.ledgerSummary) {
    ensureLedgerNode(data.ledgerSummary as Record<string, unknown>);
  }
}

function handleWorkbenchOpen(data: Record<string, unknown>): void {
  // H6: Guard — path must be a string for node ID stability
  if (typeof data.path !== 'string' || !data.path) return;
  const path = data.path;
  const title = (typeof data.title === 'string' ? data.title : '') || path.split('/').pop() || 'Untitled';

  ensureMarkdownNode(path, title);
  if (data.ledgerSummary) {
    ensureLedgerNode(data.ledgerSummary as Record<string, unknown>);
  }
}

function handleCanvasStatus(data: Record<string, unknown>): void {
  ensureStatusNode();
  updateNodeData('status-main', {
    message: typeof data.message === 'string' ? data.message : String(data.message ?? ''),
    level: data.level ?? 'ok',
    source: data.source,
  });
}

function handleExecutionPhase(data: Record<string, unknown>): void {
  ensureStatusNode();
  updateNodeData('status-main', {
    phase: data.phase,
    detail: data.detail,
  });
}

function handleContextCards(data: Record<string, unknown>): void {
  const cards = (data.cards as unknown[]) ?? [];
  ensureContextNode(cards);
}

function handleMcpAppCandidate(data: Record<string, unknown>): void {
  // H6: Guard — url must be a string for hashPath and iframe src
  if (typeof data.url === 'string' && data.url) {
    ensureMcpAppNode({
      url: data.url,
      sourceServer: data.sourceServer,
      sourceTool: data.sourceTool,
      inferredType: data.inferredType,
      trustedDomain: data.trustedDomain,
      hostMode: data.hostMode ?? 'hosted',
    });
  }
}

function handleMcpAppHostSnapshot(data: Record<string, unknown>): void {
  // Update all existing MCP nodes with session state changes
  const sessions = (data.sessions as Array<Record<string, unknown>>) ?? [];
  for (const session of sessions) {
    const url = session.url as string;
    if (!url) continue;
    const id = `mcp-${hashPath(url)}`;
    if (nodes.value.has(id)) {
      updateNodeData(id, { sessionState: session.state, lastSeenAt: session.lastSeenAt });
    }
  }
}

function handleMcpAppHostFallback(data: Record<string, unknown>): void {
  // H6: Guard — url must be a string
  if (typeof data.url === 'string' && data.url) {
    const id = `mcp-${hashPath(data.url as string)}`;
    if (nodes.value.has(id)) {
      updateNodeData(id, { hostMode: 'fallback', fallbackReason: data.reasonCode });
    }
  }
}

function handleAuxOpen(data: Record<string, unknown>): void {
  // Track auxiliary tabs in the context node
  const id = 'context-main';
  const existing = nodes.value.get(id);
  if (!existing) return;
  const auxTabs = ((existing.data.auxTabs as unknown[]) ?? []).concat(data);
  updateNodeData(id, { auxTabs });
}

function handleAuxClose(data: Record<string, unknown>): void {
  const id = 'context-main';
  if (nodes.value.has(id)) {
    const mode = data.mode as string;
    if (mode === 'all') {
      updateNodeData(id, { auxTabs: [] });
    } else {
      const existing = nodes.value.get(id);
      if (!existing) return;
      const auxTabs = ((existing.data.auxTabs as Array<Record<string, unknown>>) ?? []).filter((t) => t.id !== data.id);
      updateNodeData(id, { auxTabs });
    }
  }
}

function handleAssistantComplete(data: Record<string, unknown>): void {
  ensureStatusNode();
  updateNodeData('status-main', {
    phase: 'idle',
    lastCompletion: {
      tokenCount: data.tokenCount,
      artifactCount: data.artifactCount,
    },
  });
}

function handleToolStart(data: Record<string, unknown>): void {
  ensureStatusNode();
  updateNodeData('status-main', {
    phase: 'tooling',
    detail: `${data.name}`,
    activeTool: data.name,
  });
}

function handleToolComplete(_data: Record<string, unknown>): void {
  ensureStatusNode();
  updateNodeData('status-main', {
    activeTool: null,
  });
}

function handleReviewState(data: Record<string, unknown>): void {
  const state = data.state as string;
  if (state === 'active' && data.path) {
    const id = `md-${hashPath(data.path as string)}`;
    if (nodes.value.has(id)) {
      updateNodeData(id, { reviewActive: true });
    }
  }
}

function handleExtAppOpen(data: Record<string, unknown>): void {
  if (typeof data.toolCallId !== 'string' || !data.toolCallId) return;
  ensureExtAppNode({
    toolCallId: data.toolCallId,
    ...(typeof data.nodeId === 'string' && data.nodeId.length > 0 ? { nodeId: data.nodeId } : {}),
    title: data.title,
    html: data.html,
    toolInput: data.toolInput,
    serverName: data.serverName,
    toolName: data.toolName,
    appSessionId: data.appSessionId,
    resourceUri: data.resourceUri,
    toolDefinition: data.toolDefinition,
    resourceMeta: data.resourceMeta,
    hostMode: 'hosted',
    trustedDomain: true,
    ...(data.chartConfig ? { chartConfig: data.chartConfig } : {}),
    // Custom position/size for chart nodes (passed through from canvas_add_chart)
    ...(typeof data.x === 'number' && { _x: data.x }),
    ...(typeof data.y === 'number' && { _y: data.y }),
    ...(typeof data.width === 'number' && { _width: data.width }),
    ...(typeof data.height === 'number' && { _height: data.height }),
  });
}

function handleExtAppUpdate(data: Record<string, unknown>): void {
  if (typeof data.toolCallId !== 'string' || !data.toolCallId) return;
  const id = findExtAppEventNodeId(data) ?? findOnlyPendingExtAppNodeId(data.serverName, data.toolName);
  if (!id) return;
  if (nodes.value.has(id)) {
    updateNodeData(id, { html: data.html });
  }
}

function handleExtAppResult(data: Record<string, unknown>): void {
  if (typeof data.toolCallId !== 'string' || !data.toolCallId) return;
  const id = findExtAppEventNodeId(data) ?? findOnlyPendingExtAppNodeId(data.serverName, data.toolName);
  if (!id) return;
  if (nodes.value.has(id)) {
    if (data.success === false) {
      removeNode(id);
      return;
    }
    updateNodeData(id, {
      toolResult: normalizeExtAppToolResult({
        result: data.result,
        success: typeof data.success === 'boolean' ? data.success : undefined,
        error: typeof data.error === 'string' ? data.error : undefined,
        content: typeof data.content === 'string' ? data.content : undefined,
        detailedContent: typeof data.detailedContent === 'string' ? data.detailedContent : undefined,
      }),
    });
  }
}

function handleSubagentStatus(data: Record<string, unknown>): void {
  ensureStatusNode();
  updateNodeData('status-main', {
    subagent: {
      state: data.state,
      name: data.agentDisplayName ?? data.agentName,
    },
  });
}

// ── Canvas prompt/response events ─────────────────────────────

function handleCanvasPromptCreated(data: Record<string, unknown>): void {
  const nodeId = data.nodeId as string;
  if (!nodeId) return;
  const text = (data.text as string) || '';
  const position = data.position as { x: number; y: number } | undefined;
  const parentNodeId = data.parentNodeId as string | undefined;
  const contextNodeIds = data.contextNodeIds as string[] | undefined;

  // If this is a thread reply (appended turn to existing node), just update its data
  if (data.threadNodeId && nodes.value.has(data.threadNodeId as string)) {
    const threadId = data.threadNodeId as string;
    const existing = nodes.value.get(threadId);
    if (!existing) return;
    const currentTurns = Array.isArray(existing.data.turns)
      ? [...(existing.data.turns as Array<Record<string, unknown>>)]
      : [];
    // Only add user turn if not already present (server may have added it)
    const lastTurn = currentTurns[currentTurns.length - 1];
    if (!lastTurn || lastTurn.role !== 'user' || lastTurn.text !== text) {
      currentTurns.push({ role: 'user', text, status: 'pending' });
    }
    updateNodeData(threadId, { turns: currentTurns, threadStatus: 'pending' });
    return;
  }

  if (!nodes.value.has(nodeId)) {
    const pos = position ?? DEFAULT_POSITIONS.prompt;
    addNode(
      applyLayoutOverrides(
        makeNodeState(
          nodeId,
          'prompt',
          {
            text,
            turns: text ? [{ role: 'user', text, status: 'pending' }] : [],
            threadStatus: text ? 'pending' : 'draft',
            status: text ? 'pending' : 'draft',
            parentNodeId,
            contextNodeIds,
          },
          { position: { x: pos.x, y: pos.y } },
        ),
      ),
    );
    focusNode(nodeId);
  }

  // Add flow edge from parent → prompt if parent exists
  if (parentNodeId && nodes.value.has(parentNodeId)) {
    addEdge({
      id: `edge-${parentNodeId}-${nodeId}`,
      from: parentNodeId,
      to: nodeId,
      type: 'flow',
      style: 'dashed',
    });
  }
}

function handleCanvasPromptStatus(data: Record<string, unknown>): void {
  const nodeId = data.nodeId as string;
  const status = data.status as string;
  if (nodeId && nodes.value.has(nodeId)) {
    updateNodeData(nodeId, { status });
  }
}

function handleCanvasResponseStart(data: Record<string, unknown>): void {
  const responseNodeId = data.responseNodeId as string;
  const promptNodeId = data.promptNodeId as string;
  if (!responseNodeId) return;

  // Route response into thread node if prompt node has turns
  const promptNode = promptNodeId ? nodes.value.get(promptNodeId) : undefined;
  if (promptNode && Array.isArray(promptNode.data.turns)) {
    responseToThreadMap.set(responseNodeId, promptNodeId);
    const currentTurns = [...(promptNode.data.turns as Array<Record<string, unknown>>)];
    currentTurns.push({ role: 'assistant', text: '', status: 'streaming' });
    updateNodeData(promptNodeId, {
      turns: currentTurns,
      threadStatus: 'streaming',
      _activeResponseId: responseNodeId,
    });
    focusNode(promptNodeId);
    return;
  }

  // Fallback: create separate response node (for legacy prompt nodes without turns)
  const pos = promptNode
    ? { x: promptNode.position.x, y: promptNode.position.y + promptNode.size.height + 24 }
    : { x: DEFAULT_POSITIONS.response.x, y: DEFAULT_POSITIONS.response.y };

  if (!nodes.value.has(responseNodeId)) {
    addNode(
      applyLayoutOverrides(
        makeNodeState(
          responseNodeId,
          'response',
          { content: '', status: 'streaming', promptNodeId },
          { position: pos },
        ),
      ),
    );
  }

  // Animated flow edge from prompt → response
  if (promptNodeId) {
    addEdge({
      id: `edge-${promptNodeId}-${responseNodeId}`,
      from: promptNodeId,
      to: responseNodeId,
      type: 'flow',
      animated: true,
    });
  }

  focusNode(responseNodeId);
}

function handleCanvasResponseDelta(data: Record<string, unknown>): void {
  const responseNodeId = data.responseNodeId as string;
  if (!responseNodeId) return;

  // Route into thread if mapped
  const threadId = responseToThreadMap.get(responseNodeId);
  if (threadId) {
    const threadNode = nodes.value.get(threadId);
    if (threadNode && Array.isArray(threadNode.data.turns)) {
      const currentTurns = [...(threadNode.data.turns as Array<Record<string, unknown>>)];
      const lastTurn = currentTurns[currentTurns.length - 1];
      if (lastTurn && lastTurn.role === 'assistant') {
        lastTurn.text = data.content as string;
        lastTurn.status = 'streaming';
      }
      updateNodeData(threadId, { turns: currentTurns, threadStatus: 'streaming' });
    }
    return;
  }

  // Fallback: update standalone response node
  if (!nodes.value.has(responseNodeId)) return;
  updateNodeData(responseNodeId, {
    content: data.content as string,
    status: 'streaming',
  });
}

function handleCanvasResponseComplete(data: Record<string, unknown>): void {
  const responseNodeId = data.responseNodeId as string;
  if (!responseNodeId) return;

  // Route into thread if mapped
  const threadId = responseToThreadMap.get(responseNodeId);
  if (threadId) {
    const threadNode = nodes.value.get(threadId);
    if (threadNode && Array.isArray(threadNode.data.turns)) {
      const currentTurns = [...(threadNode.data.turns as Array<Record<string, unknown>>)];
      const lastTurn = currentTurns[currentTurns.length - 1];
      if (lastTurn && lastTurn.role === 'assistant') {
        lastTurn.text = data.content as string;
        lastTurn.status = 'complete';
      }
      updateNodeData(threadId, {
        turns: currentTurns,
        threadStatus: 'answered',
        _activeResponseId: undefined,
      });
    }
    responseToThreadMap.delete(responseNodeId);
    return;
  }

  // Fallback: update standalone response node
  if (!nodes.value.has(responseNodeId)) return;
  updateNodeData(responseNodeId, {
    content: data.content as string,
    status: 'complete',
  });

  // Stop edge animation
  const node = nodes.value.get(responseNodeId);
  const promptNodeId = node?.data.promptNodeId as string | undefined;
  if (promptNodeId) {
    const edgeId = `edge-${promptNodeId}-${responseNodeId}`;
    const existingEdge = edges.value.get(edgeId);
    if (existingEdge) {
      removeEdge(edgeId);
      addEdge({ ...existingEdge, animated: false });
    }
  }
}

// ── Agent canvas tool events ──────────────────────────────────

function handleCanvasLayoutUpdate(data: Record<string, unknown>): void {
  const layout = data.layout as
    | {
        nodes?: Array<Record<string, unknown>>;
        edges?: Array<Record<string, unknown>>;
        annotations?: Array<Record<string, unknown>>;
        viewport?: Record<string, unknown>;
      }
    | undefined;
  if (!layout?.nodes) return;
  const shouldApplyViewport = !hasInitialServerLayout.value;
  hasInitialServerLayout.value = true;

  const serverNodes = layout.nodes.map(parseCanvasNode).filter((node): node is CanvasNodeState => node !== null);
  const serverEdges = Array.isArray(layout.edges)
    ? layout.edges.map(parseCanvasEdge).filter((edge): edge is CanvasEdge => edge !== null)
    : Array.from(edges.value.values());
  const serverAnnotations = Array.isArray(layout.annotations)
    ? layout.annotations
        .map(parseCanvasAnnotation)
        .filter((annotation): annotation is CanvasAnnotation => annotation !== null)
    : undefined;
  const nextViewport = layout.viewport
    ? {
        x: typeof layout.viewport.x === 'number' ? layout.viewport.x : 0,
        y: typeof layout.viewport.y === 'number' ? layout.viewport.y : 0,
        scale: typeof layout.viewport.scale === 'number' ? layout.viewport.scale : 1,
      }
    : undefined;

  cancelViewportAnimation();
  applyServerCanvasLayout(
    {
      ...(nextViewport ? { viewport: nextViewport } : {}),
      nodes: serverNodes,
      edges: serverEdges,
      ...(serverAnnotations ? { annotations: serverAnnotations } : {}),
    },
    { applyViewport: shouldApplyViewport },
  );

  syncAttentionFromSse({ event: 'canvas-layout-update', data });
}

function reconnectDelayMs(attempt: number): number {
  if (attempt <= 1) return 500;
  if (attempt === 2) return 1000;
  return Math.min(2500, 1500 + (attempt - 3) * 500);
}

function handleCanvasFocusNode(data: Record<string, unknown>): void {
  const nodeId = data.nodeId as string;
  if (nodeId && nodes.value.has(nodeId)) {
    if (data.noPan === true) {
      bringToFront(nodeId);
      return;
    }
    focusNode(nodeId);
  }
}

function handleCanvasViewportUpdate(data: Record<string, unknown>): void {
  const viewport = data.viewport as Record<string, unknown> | undefined;
  if (!viewport) return;
  const x = typeof viewport.x === 'number' ? viewport.x : 0;
  const y = typeof viewport.y === 'number' ? viewport.y : 0;
  const scale = typeof viewport.scale === 'number' ? viewport.scale : 1;
  cancelViewportAnimation();
  replaceViewport({ x, y, scale });
}

function handleContextUsage(data: Record<string, unknown>): void {
  const id = 'context-main';
  const existing = nodes.value.get(id);
  if (existing) {
    updateNodeData(id, {
      currentTokens: data.currentTokens,
      tokenLimit: data.tokenLimit,
      messagesLength: data.messagesLength,
      utilization: data.utilization,
      nearLimit: data.nearLimit,
    });
  }
}

function handleTraceState(data: Record<string, unknown>): void {
  traceEnabled.value = data.enabled === true;
}

function handleThemeChanged(data: Record<string, unknown>): void {
  if (typeof data.theme === 'string' && !themeOverrideActive()) {
    applyCanvasTheme(data.theme);
  }
}

function handleContextPinsChanged(data: Record<string, unknown>): void {
  const nodeIds = Array.isArray(data.nodeIds) ? data.nodeIds.filter((id): id is string => typeof id === 'string') : [];
  replaceContextPinsFromServer(nodeIds);
  syncAttentionFromSse({ event: 'context-pins-changed', data });
}

// AX state changes arrive as per-primitive deltas; rather than reduce them, treat
// the event as a "something changed" signal and re-fetch the full compact snapshot
// (debounced). The snapshot feeds AX-enabled surfaces (HtmlNode/McpAppNode push it
// into their iframes), so authored boards reflect the live work queue / focus.
let axRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function handleAxStateChanged(): void {
  if (axRefreshTimer) clearTimeout(axRefreshTimer);
  axRefreshTimer = setTimeout(() => {
    axRefreshTimer = null;
    void fetchAxSurfaceState().then((state) => {
      axSurfaceState.value = state;
    });
    // The session panel's timeline — only worth fetching while it is mounted.
    if (sessionActive.value) void refreshTimeline();
  }, 150);
}

// ── Ghost Cursor of Intent ────────────────────────────────────
function handleAxIntent(data: Record<string, unknown>): void {
  const intent = data.intent as PmxAxIntent | undefined;
  // Require a numeric `expiresAt`: the client-side TTL prune backstop
  // (intent-store) compares `expiresAt <= now`, so a frame missing it would never
  // be pruned if its `clear` frame were dropped. The server always sets it, so this
  // only rejects a malformed frame — keeping the backstop's guarantee real.
  if (
    !intent ||
    typeof intent.id !== 'string' ||
    typeof intent.kind !== 'string' ||
    typeof intent.expiresAt !== 'number'
  )
    return;
  upsertIntent(intent);
}

function handleAxIntentClear(data: Record<string, unknown>): void {
  const id = typeof data.id === 'string' ? data.id : '';
  if (!id) return;
  if (data.settled === true) {
    settleIntent(id, typeof data.nodeId === 'string' ? data.nodeId : undefined);
  } else {
    dissolveIntent(id);
  }
}

// ── SSE connection ────────────────────────────────────────────
/** @internal — exported for testing */
export const EVENT_HANDLERS: Record<string, (data: Record<string, unknown>) => void> = {
  connected: handleConnected,
  'workbench-open': handleWorkbenchOpen,
  'canvas-status': handleCanvasStatus,
  'execution-phase': handleExecutionPhase,
  'context-cards': handleContextCards,
  'mcp-app-candidate': handleMcpAppCandidate,
  'mcp-app-host-snapshot': handleMcpAppHostSnapshot,
  'mcp-app-host-fallback': handleMcpAppHostFallback,
  'aux-open': handleAuxOpen,
  'aux-close': handleAuxClose,
  'assistant-complete': handleAssistantComplete,
  'tool-start': handleToolStart,
  'tool-complete': handleToolComplete,
  'review-state': handleReviewState,
  'subagent-status': handleSubagentStatus,
  'ext-app-open': handleExtAppOpen,
  'ext-app-update': handleExtAppUpdate,
  'ext-app-result': handleExtAppResult,
  'context-pins-changed': handleContextPinsChanged,
  'canvas-layout-update': handleCanvasLayoutUpdate,
  'canvas-focus-node': handleCanvasFocusNode,
  'canvas-viewport-update': handleCanvasViewportUpdate,
  'context-usage': handleContextUsage,
  'trace-state': handleTraceState,
  'theme-changed': handleThemeChanged,
  'canvas-prompt-created': handleCanvasPromptCreated,
  'canvas-prompt-status': handleCanvasPromptStatus,
  'canvas-response-start': handleCanvasResponseStart,
  'canvas-response-delta': handleCanvasResponseDelta,
  'canvas-response-complete': handleCanvasResponseComplete,
  'ax-state-changed': handleAxStateChanged,
  'ax-event-created': handleAxStateChanged,
  'ax-intent': handleAxIntent,
  'ax-intent-clear': handleAxIntentClear,
  'agent-presence': handleAgentPresence,
};

/** Dispatch one event (from either transport) through the shared handler map. */
function dispatchWorkbenchEvent(event: string, payload: unknown): void {
  const handler = EVENT_HANDLERS[event as keyof typeof EVENT_HANDLERS];
  if (!handler) return;
  // The map's handlers each declare their own payload type; over the wire the
  // payload is untyped JSON either way (SSE previously passed JSON.parse output
  // straight in). The double cast states that honestly without `any`.
  const invoke = handler as unknown as (value: unknown) => void;
  try {
    invoke(payload);
  } catch (err) {
    console.warn(`[sse-bridge] Handler for "${event}" failed:`, err);
  }
}

/**
 * Polling transport loop. Each response is short-lived, so it flushes through
 * any buffering proxy. Snapshot responses (fresh client / server restart /
 * ring eviction) carry the same event list an SSE connect sends, so replaying
 * them through the handlers matches existing reconnect semantics.
 */
function startPollingTransport(): () => void {
  pollingMode = true;
  pollGeneration += 1;
  const generation = pollGeneration;
  connectionStatus.value = 'connecting';
  // Server-run identity from the last poll response. The event seq counter
  // restarts at 0 on every server boot, so a cursor from a previous run can
  // look "usable" to a new run and silently skip its earlier events.
  let lastPollSessionId: string | null = null;
  let dispatchedOnce = false;

  const pollOnce = async (): Promise<void> => {
    if (generation !== pollGeneration) return;
    try {
      const params = new URLSearchParams();
      if (pollSeq !== null) params.set('since', String(pollSeq));
      const sid = sessionId.value;
      if (sid) params.set('session', sid);
      const query = params.toString();
      const response = await fetch(`/api/workbench/poll${query ? `?${query}` : ''}`);
      if (generation !== pollGeneration) return;
      if (!response.ok) throw new Error(`poll failed with HTTP ${response.status}`);
      const body = (await response.json()) as {
        ok: boolean;
        seq: number;
        snapshot: boolean;
        sessionId?: string;
        events: Array<{ event: string; payload: unknown }>;
      };
      if (generation !== pollGeneration) return;
      if (!body.ok) throw new Error('poll returned ok: false');
      const priorSession = lastPollSessionId;
      lastPollSessionId = body.sessionId ?? null;
      if (priorSession !== null && body.sessionId && priorSession !== body.sessionId && !body.snapshot) {
        // The server identity changed under our cursor (restart): a non-snapshot
        // batch may have silently skipped the new run's earlier events. Discard
        // it, drop the cursor, and re-poll immediately for a full snapshot.
        pollSeq = null;
        pollTimer = setTimeout(() => void pollOnce(), 0);
        return;
      }
      if (body.snapshot && dispatchedOnce) {
        // A mid-polling snapshot (ring eviction or server restart) replaces
        // client state wholesale — run the same per-connection resets an SSE
        // reconnect performs so in-flight stream routes and transient state
        // from the previous window can't leak (H5 orphan class).
        savedLayout = restoreLayout();
        ensureStatusNode();
        hasInitialServerLayout.value = false;
        resetAttentionBridge();
        resetIntents();
        responseToThreadMap.clear();
      }
      for (const entry of body.events) dispatchWorkbenchEvent(entry.event, entry.payload);
      dispatchedOnce = true;
      pollSeq = body.seq;
      connectionStatus.value = 'connected';
      pollTimer = setTimeout(() => void pollOnce(), POLL_INTERVAL_MS);
    } catch (err) {
      if (generation !== pollGeneration) return;
      console.warn('[sse-bridge] poll transport error:', err);
      connectionStatus.value = 'disconnected';
      pollTimer = setTimeout(() => void pollOnce(), POLL_ERROR_INTERVAL_MS);
    }
  };
  void pollOnce();

  return () => {
    pollGeneration += 1;
    pollingMode = false;
    pollSeq = null;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };
}

export function connectSSE(): () => void {
  // Host-default theming: a ?theme= param applies before the first server
  // frame so an embedding host panel never flashes the server-global theme.
  initSessionThemeOverride(applyCanvasTheme);
  savedLayout = restoreLayout();
  ensureStatusNode();
  hasInitialServerLayout.value = false;
  resetAttentionBridge();
  resetIntents();
  // Response→thread routes belong to the dropped connection's in-flight
  // streams; clear them so orphans can't accumulate across reconnect cycles.
  responseToThreadMap.clear();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const transport = forcedTransport();
  if (transport === 'poll' || pollingMode) {
    return startPollingTransport();
  }

  const sid = sessionId.value;
  const url = sid ? `/api/workbench/events?session=${sid}` : '/api/workbench/events';
  connectionStatus.value = 'connecting';

  const source = new EventSource(url);
  eventSource = source;

  // Proxy detection: a buffered stream "opens" (headers pass through) but never
  // delivers a single event — not even the immediate `connected` frame. Key the
  // watchdog on the FIRST EVENT, not onopen.
  let gotFirstEvent = false;
  if (sseFirstEventWatchdog) clearTimeout(sseFirstEventWatchdog);
  sseFirstEventWatchdog = null;
  if (transport !== 'sse') {
    sseFirstEventWatchdog = setTimeout(() => {
      sseFirstEventWatchdog = null;
      if (gotFirstEvent || eventSource !== source) return;
      console.warn('[sse-bridge] No SSE event within watchdog window — switching to polling transport.');
      // Give the bootstrap card a fresh deadline for the fallback transport so
      // the "did not finish booting" modal doesn't fire while polling is
      // already recovering the boot (the inline bootstrap script listens).
      window.dispatchEvent(new Event('pmx-canvas-boot-extend'));
      source.close();
      eventSource = null;
      startPollingTransport();
    }, SSE_FIRST_EVENT_WATCHDOG_MS);
  }

  for (const [event] of Object.entries(EVENT_HANDLERS)) {
    source.addEventListener(event, (e) => {
      gotFirstEvent = true;
      try {
        dispatchWorkbenchEvent(event, JSON.parse((e as MessageEvent).data));
      } catch (err) {
        // H5: Surface malformed SSE data during debugging instead of silently swallowing
        console.warn(`[sse-bridge] Failed to parse "${event}" event:`, err);
      }
    });
  }

  source.onopen = () => {
    if (eventSource !== source) return;
    reconnectAttempts = 0;
    connectionStatus.value = 'connected';
  };

  source.onerror = () => {
    if (eventSource !== source) return;
    connectionStatus.value = 'disconnected';
    source.close();
    eventSource = null;
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectSSE();
    }, reconnectDelayMs(reconnectAttempts));
  };

  return () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (sseFirstEventWatchdog) {
      clearTimeout(sseFirstEventWatchdog);
      sseFirstEventWatchdog = null;
    }
    if (pollingMode) {
      pollGeneration += 1;
      pollingMode = false;
      pollSeq = null;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    }
    source.close();
    eventSource = null;
  };
}
