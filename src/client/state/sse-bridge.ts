import { findOpenCanvasPosition } from '../utils/placement.js';
import { normalizeExtAppToolResult } from '../utils/ext-app-tool-result.js';
import type { CanvasEdge, CanvasNodeState } from '../types';
import {
  activeNodeId,
  addEdge,
  addNode,
  canvasTheme,
  connectionStatus,
  edges,
  focusNode,
  hasInitialServerLayout,
  nodes,
  removeEdge,
  removeNode,
  restoreLayout,
  sessionId,
  traceEnabled,
  updateNode,
  updateNodeData,
} from './canvas-store';
import { invalidateTokenCache } from '../theme/tokens';

let eventSource: EventSource | null = null;
let savedLayout: Map<string, Partial<CanvasNodeState>> | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// Maps responseNodeId → thread prompt node ID so response deltas/completions
// are routed into the thread's turns array instead of creating separate nodes.
// Entries are added on response-start and removed on response-complete.
// Not cleaned on SSE reconnect — orphaned entries are benign (small, bounded by active streams).
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

// ── Default positions by type ─────────────────────────────────
const DEFAULT_POSITIONS: Record<
  CanvasNodeState['type'],
  { x: number; y: number; w: number; h: number }
> = {
  status: { x: 40, y: 80, w: 300, h: 120 },
  markdown: { x: 380, y: 80, w: 720, h: 600 },
  context: { x: 1130, y: 80, w: 320, h: 400 },
  'mcp-app': { x: 380, y: 720, w: 720, h: 500 },
  ledger: { x: 1130, y: 520, w: 320, h: 280 },
  trace: { x: 40, y: 900, w: 200, h: 56 },
  prompt: { x: 380, y: 1260, w: 520, h: 400 },
  response: { x: 380, y: 1480, w: 720, h: 400 },
};

function makeNode(
  id: string,
  type: CanvasNodeState['type'],
  data: Record<string, unknown>,
  dockPosition: 'left' | 'right' | null = null,
): CanvasNodeState {
  const pos = DEFAULT_POSITIONS[type];
  return applyLayoutOverrides({
    id,
    type,
    position: { x: pos.x, y: pos.y },
    size: { width: pos.w, height: pos.h },
    zIndex: type === 'status' ? 0 : 1,
    collapsed: false,
    pinned: false,
    dockPosition,
    data,
  });
}

function getMarkdownPlacement(): { x: number; y: number } {
  return findOpenCanvasPosition(
    [...nodes.value.values()],
    DEFAULT_POSITIONS.markdown.w,
    DEFAULT_POSITIONS.markdown.h,
  );
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
  }
}

function ensureContextNode(cards: unknown[]): void {
  const id = 'context-main';
  const existing = nodes.value.get(id);
  if (existing) {
    updateNodeData(id, { cards });
  } else if (cards.length > 0) {
    const node = makeNode(id, 'context', { cards }, 'right');
    node.collapsed = true;
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
  }
}

function ensureExtAppNode(data: Record<string, unknown>): void {
  const toolCallId = data.toolCallId as string;
  const id = `ext-app-${toolCallId}`;
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
  const node = applyLayoutOverrides({
    id,
    type: 'mcp-app' as const,
    position: {
      x: customX ?? autoPos?.x ?? pos.x,
      y: customY ?? autoPos?.y ?? pos.y,
    },
    size: {
      width,
      height,
    },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    dockPosition: null,
    data: {
      mode: 'ext-app',
      ...data,
    },
  });
  addNode(node);
}

function findExtAppNodeId(toolCallId: string): string | null {
  const directId = `ext-app-${toolCallId}`;
  if (nodes.value.has(directId)) return directId;
  for (const [nodeId, node] of nodes.value.entries()) {
    if (
      node.type === 'mcp-app' &&
      node.data.mode === 'ext-app' &&
      node.data.toolCallId === toolCallId
    ) {
      return nodeId;
    }
  }
  return null;
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
  const valid = theme === 'dark' || theme === 'light' || theme === 'high-contrast';
  if (!valid || canvasTheme.value === theme) return;
  canvasTheme.value = theme;
  document.documentElement.setAttribute('data-theme', theme);
  invalidateTokenCache();
}

// ── SSE event handlers ───────────────────────────────────────
function handleConnected(data: Record<string, unknown>): void {
  sessionId.value = (data.sessionId as string) || '';
  connectionStatus.value = 'connected';
  if (typeof data.theme === 'string') {
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
  const title =
    (typeof data.title === 'string' ? data.title : '') || path.split('/').pop() || 'Untitled';

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
      const auxTabs = ((existing.data.auxTabs as Array<Record<string, unknown>>) ?? []).filter(
        (t) => t.id !== data.id,
      );
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
    title: data.title,
    html: data.html,
    toolInput: data.toolInput,
    serverName: data.serverName,
    toolName: data.toolName,
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
  const id =
    findExtAppNodeId(data.toolCallId) ?? findOnlyPendingExtAppNodeId(data.serverName, data.toolName);
  if (!id) return;
  if (nodes.value.has(id)) {
    updateNodeData(id, { html: data.html });
  }
}

function handleExtAppResult(data: Record<string, unknown>): void {
  if (typeof data.toolCallId !== 'string' || !data.toolCallId) return;
  const id =
    findExtAppNodeId(data.toolCallId) ?? findOnlyPendingExtAppNodeId(data.serverName, data.toolName);
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
        detailedContent:
          typeof data.detailedContent === 'string' ? data.detailedContent : undefined,
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
      applyLayoutOverrides({
        id: nodeId,
        type: 'prompt' as const,
        position: { x: pos.x, y: pos.y },
        size: { width: DEFAULT_POSITIONS.prompt.w, height: 400 },
        zIndex: 1,
        collapsed: false,
        pinned: false,
        dockPosition: null,
        data: {
          text,
          turns: text ? [{ role: 'user', text, status: 'pending' }] : [],
          threadStatus: text ? 'pending' : 'draft',
          status: text ? 'pending' : 'draft',
          parentNodeId,
          contextNodeIds,
        },
      }),
    );
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
      applyLayoutOverrides({
        id: responseNodeId,
        type: 'response' as const,
        position: pos,
        size: { width: DEFAULT_POSITIONS.response.w, height: DEFAULT_POSITIONS.response.h },
        zIndex: 1,
        collapsed: false,
        pinned: false,
        dockPosition: null,
        data: { content: '', status: 'streaming', promptNodeId },
      }),
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
        viewport?: Record<string, unknown>;
      }
    | undefined;
  if (!layout?.nodes) return;
  hasInitialServerLayout.value = true;

  // Reconcile server-side node state with client
  const serverNodeIds = new Set<string>();
  for (const raw of layout.nodes) {
    const id = raw.id as string;
    serverNodeIds.add(id);
    const existing = nodes.value.get(id);
    if (existing) {
      updateNode(id, {
        position: raw.position as { x: number; y: number },
        size: raw.size as { width: number; height: number },
        collapsed: raw.collapsed as boolean,
        pinned: raw.pinned as boolean,
        data: raw.data as Record<string, unknown>,
      });
    } else {
      addNode(raw as unknown as CanvasNodeState);
    }
  }

  // Remove nodes that the server deleted
  for (const id of nodes.value.keys()) {
    if (!serverNodeIds.has(id)) {
      removeNode(id);
    }
  }

  // Reconcile edges
  if (Array.isArray(layout.edges)) {
    const serverEdgeIds = new Set<string>();
    for (const raw of layout.edges) {
      const id = raw.id as string;
      serverEdgeIds.add(id);
      if (!edges.value.has(id)) {
        addEdge(raw as unknown as CanvasEdge);
      }
    }
    // Remove edges not present on server
    for (const id of edges.value.keys()) {
      if (!serverEdgeIds.has(id)) {
        removeEdge(id);
      }
    }
  }
}

function reconnectDelayMs(attempt: number): number {
  if (attempt <= 1) return 500;
  if (attempt === 2) return 1000;
  return Math.min(2500, 1500 + (attempt - 3) * 500);
}

function handleCanvasFocusNode(data: Record<string, unknown>): void {
  const nodeId = data.nodeId as string;
  if (nodeId && nodes.value.has(nodeId)) {
    focusNode(nodeId);
  }
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
  if (typeof data.theme === 'string') {
    applyCanvasTheme(data.theme);
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
  'canvas-layout-update': handleCanvasLayoutUpdate,
  'canvas-focus-node': handleCanvasFocusNode,
  'context-usage': handleContextUsage,
  'trace-state': handleTraceState,
  'theme-changed': handleThemeChanged,
  'canvas-prompt-created': handleCanvasPromptCreated,
  'canvas-prompt-status': handleCanvasPromptStatus,
  'canvas-response-start': handleCanvasResponseStart,
  'canvas-response-delta': handleCanvasResponseDelta,
  'canvas-response-complete': handleCanvasResponseComplete,
};

export function connectSSE(): () => void {
  savedLayout = restoreLayout();
  ensureStatusNode();
  hasInitialServerLayout.value = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const sid = sessionId.value;
  const url = sid ? `/api/workbench/events?session=${sid}` : '/api/workbench/events';
  connectionStatus.value = 'connecting';

  const source = new EventSource(url);
  eventSource = source;

  for (const [event, handler] of Object.entries(EVENT_HANDLERS)) {
    source.addEventListener(event, (e) => {
      try {
        handler(JSON.parse((e as MessageEvent).data));
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
    source.close();
    eventSource = null;
  };
}
