/**
 * TraceManager — creates trace nodes and flow edges on the canvas
 * as the agent calls tools and spawns subagents.
 *
 * Server-side singleton consumed by chat-view event wiring.
 */

import { type CanvasEdge, type CanvasNodeState, canvasState } from './canvas-state.js';
import { emitPrimaryWorkbenchEvent } from './server.js';

const MAX_TRACE_NODES = 120;
const TRACE_NODE_WIDTH = 200;
const TRACE_NODE_HEIGHT = 56;
const TRACE_GAP_X = 24;
const TRACE_GAP_Y = 80;
const TRACE_MARGIN_TOP = 80;
const TRACE_MAX_COLS = 6; // 6 x (200+24) = 1344px fits standard 1440px viewport

// ── Category color coding ─────────────────────────────────────
type TraceCategory = 'mcp' | 'file' | 'subagent' | 'other';

function categorize(name: string, mcpServerName?: string | null): TraceCategory {
  if (mcpServerName) return 'mcp';
  const lower = name.toLowerCase();
  if (
    lower.includes('read') ||
    lower.includes('write') ||
    lower.includes('edit') ||
    lower.includes('glob') ||
    lower.includes('grep') ||
    lower.includes('bash')
  )
    return 'file';
  return 'other';
}

// ── ID generation ─────────────────────────────────────────────
let traceCounter = 0;

function nextTraceNodeId(): string {
  return `trace-${Date.now().toString(36)}-${(traceCounter++).toString(36)}`;
}

function nextTraceEdgeId(): string {
  return `tedge-${Date.now().toString(36)}-${(traceCounter++).toString(36)}`;
}

// ── Positioning ───────────────────────────────────────────────

function computeTraceOrigin(): { x: number; y: number } {
  const layout = canvasState.getLayout();
  let maxY = 0;
  for (const node of layout.nodes) {
    if (node.type === 'trace') continue;
    const bottom = node.position.y + node.size.height;
    if (bottom > maxY) maxY = bottom;
  }
  return { x: 40, y: maxY + TRACE_MARGIN_TOP };
}

// ── TraceManager class ────────────────────────────────────────

class TraceManager {
  private _enabled = false;
  private traceNodeIds: string[] = [];
  private lastTraceNodeId: string | null = null;
  private toolCallToNodeId = new Map<string, string>();
  private traceOrigin: { x: number; y: number } | null = null;
  private chainIndex = 0;

  get enabled(): boolean {
    return this._enabled;
  }

  setEnabled(value: boolean): void {
    this._enabled = value;
    if (value) {
      this.traceOrigin = null; // recompute on next trace node
      this.chainIndex = 0;
    }
  }

  onToolStart(payload: {
    name: string;
    toolCallId?: string;
    activity?: string;
    mcpServerName?: string | null;
    mcpToolName?: string | null;
  }): void {
    if (!this._enabled) return;

    const id = nextTraceNodeId();
    const category = categorize(payload.name, payload.mcpServerName);
    const pos = this.nextPosition();

    const node: CanvasNodeState = {
      id,
      type: 'trace',
      position: pos,
      size: { width: TRACE_NODE_WIDTH, height: TRACE_NODE_HEIGHT },
      zIndex: 0,
      collapsed: false,
      pinned: true,
      dockPosition: null,
      data: {
        toolName: payload.name,
        category,
        status: 'running',
        activity: payload.activity ?? payload.name,
        startedAt: Date.now(),
      },
    };

    this.evictIfNeeded();
    canvasState.addNode(node);
    this.traceNodeIds.push(id);

    // Flow edge from previous trace node
    if (this.lastTraceNodeId) {
      const edge: CanvasEdge = {
        id: nextTraceEdgeId(),
        from: this.lastTraceNodeId,
        to: id,
        type: 'flow',
        animated: true,
      };
      canvasState.addEdge(edge);
    }

    if (payload.toolCallId) {
      this.toolCallToNodeId.set(payload.toolCallId, id);
    }

    this.lastTraceNodeId = id;
    this.broadcastUpdate();
  }

  onToolComplete(payload: {
    name: string;
    toolCallId?: string;
    success?: boolean;
    activity?: string;
    error?: string;
  }): void {
    const nodeId = payload.toolCallId ? this.toolCallToNodeId.get(payload.toolCallId) : null;
    if (!nodeId) return;

    if (payload.toolCallId) {
      this.toolCallToNodeId.delete(payload.toolCallId);
    }

    const node = canvasState.getNode(nodeId);
    if (!node || node.type !== 'trace') return;

    const startedAt = (node.data.startedAt as number) || Date.now();
    const durationMs = Math.max(0, Date.now() - startedAt);
    const durationText =
      durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;

    canvasState.updateNode(nodeId, {
      data: {
        ...node.data,
        status: payload.success === false ? 'failed' : 'success',
        resultSummary: payload.activity ?? '',
        error: payload.error,
        duration: durationText,
      },
    });

    // Stop edge animation for completed edges ending at this node
    for (const edge of canvasState.getEdgesForNode(nodeId)) {
      if (edge.to === nodeId && edge.animated) {
        canvasState.removeEdge(edge.id);
        canvasState.addEdge({ ...edge, animated: false });
      }
    }

    this.broadcastUpdate();
  }

  onSubagentStarted(payload: {
    agentName: string;
    agentDisplayName?: string;
  }): void {
    if (!this._enabled) return;

    const id = nextTraceNodeId();
    const origin = this.getOrigin();
    // Subagent branch: offset below the full trace grid to avoid overlap
    const parentNode = this.lastTraceNodeId ? canvasState.getNode(this.lastTraceNodeId) : null;
    const gridRows = Math.floor(this.chainIndex / TRACE_MAX_COLS) + 1;
    const gridBottomY = origin.y + gridRows * (TRACE_NODE_HEIGHT + TRACE_GAP_Y);
    const pos = {
      x: parentNode ? parentNode.position.x : origin.x,
      y: gridBottomY,
    };

    const node: CanvasNodeState = {
      id,
      type: 'trace',
      position: pos,
      size: { width: TRACE_NODE_WIDTH, height: TRACE_NODE_HEIGHT },
      zIndex: 0,
      collapsed: false,
      pinned: true,
      dockPosition: null,
      data: {
        toolName: payload.agentDisplayName ?? payload.agentName,
        category: 'subagent' as TraceCategory,
        status: 'running',
        activity: `Subagent: ${payload.agentDisplayName ?? payload.agentName}`,
        startedAt: Date.now(),
      },
    };

    this.evictIfNeeded();
    canvasState.addNode(node);
    this.traceNodeIds.push(id);

    // Spawn edge from parent
    if (this.lastTraceNodeId) {
      const edge: CanvasEdge = {
        id: nextTraceEdgeId(),
        from: this.lastTraceNodeId,
        to: id,
        type: 'flow',
        label: 'spawn',
        animated: true,
      };
      canvasState.addEdge(edge);
    }

    this.toolCallToNodeId.set(`subagent:${payload.agentName}`, id);
    this.broadcastUpdate();
  }

  onSubagentCompleted(payload: {
    agentName: string;
    agentDisplayName?: string;
    durationMs?: number;
    failed?: boolean;
  }): void {
    const nodeId = this.toolCallToNodeId.get(`subagent:${payload.agentName}`);
    if (!nodeId) return;
    this.toolCallToNodeId.delete(`subagent:${payload.agentName}`);

    const node = canvasState.getNode(nodeId);
    if (!node || node.type !== 'trace') return;

    const startedAt = (node.data.startedAt as number) || Date.now();
    const durationMs = payload.durationMs ?? Math.max(0, Date.now() - startedAt);
    const durationText =
      durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;

    canvasState.updateNode(nodeId, {
      data: {
        ...node.data,
        status: payload.failed ? 'failed' : 'success',
        duration: durationText,
      },
    });

    // Stop edge animation
    for (const edge of canvasState.getEdgesForNode(nodeId)) {
      if (edge.to === nodeId && edge.animated) {
        canvasState.removeEdge(edge.id);
        canvasState.addEdge({ ...edge, animated: false });
      }
    }

    this.broadcastUpdate();
  }

  clearTrace(): void {
    const traceNodeIds = new Set(this.traceNodeIds);
    for (const node of canvasState.getLayout().nodes) {
      if (node.type === 'trace') {
        traceNodeIds.add(node.id);
      }
    }

    for (const id of traceNodeIds) {
      canvasState.removeNode(id); // removeNode cascades edge deletion
    }
    this.traceNodeIds = [];
    this.lastTraceNodeId = null;
    this.toolCallToNodeId.clear();
    this.traceOrigin = null;
    this.chainIndex = 0;
    this.broadcastUpdate();
  }

  getTraceNodeCount(): number {
    return canvasState.getLayout().nodes.filter((node) => node.type === 'trace').length;
  }

  // ── Private helpers ───────────────────────────────────────

  private getOrigin(): { x: number; y: number } {
    if (!this.traceOrigin) {
      this.traceOrigin = computeTraceOrigin();
    }
    return this.traceOrigin;
  }

  private nextPosition(): { x: number; y: number } {
    const origin = this.getOrigin();
    const col = this.chainIndex % TRACE_MAX_COLS;
    const row = Math.floor(this.chainIndex / TRACE_MAX_COLS);
    const x = origin.x + col * (TRACE_NODE_WIDTH + TRACE_GAP_X);
    const y = origin.y + row * (TRACE_NODE_HEIGHT + TRACE_GAP_Y);
    this.chainIndex++;
    return { x, y };
  }

  private evictIfNeeded(): void {
    while (this.traceNodeIds.length >= MAX_TRACE_NODES) {
      const oldest = this.traceNodeIds.shift();
      if (oldest) {
        canvasState.removeNode(oldest); // cascades edge deletion
      }
    }
  }

  private broadcastUpdate(): void {
    emitPrimaryWorkbenchEvent('canvas-layout-update', {
      layout: canvasState.getLayout(),
    });
  }
}

// Module-level singleton
export const traceManager = new TraceManager();
