import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { canvasState, IMAGE_MIME_MAP } from './canvas-state.js';
import type { CanvasNodeState, CanvasEdge, CanvasLayout, ViewportState } from './canvas-state.js';
import { watchFileForNode, unwatchFileForNode, onFileNodeChanged } from './file-watcher.js';
import { findOpenCanvasPosition } from './placement.js';
import { searchNodes, buildSpatialContext } from './spatial-analysis.js';
import { mutationHistory, diffLayouts, formatDiff } from './mutation-history.js';
import { recomputeCodeGraph, buildCodeGraphSummary, formatCodeGraph } from './code-graph.js';
import {
  startCanvasServer,
  stopCanvasServer,
  getCanvasServerPort,
  openUrlInExternalBrowser,
  emitPrimaryWorkbenchEvent,
  setPrimaryWorkbenchCanvasPromptHandler,
  setPrimaryWorkbenchAutoOpenEnabled,
  consumePrimaryWorkbenchIntents,
} from './server.js';
import type {
  PrimaryWorkbenchCanvasPromptRequest,
  PrimaryWorkbenchIntent,
} from './server.js';

export class PmxCanvas extends EventEmitter {
  private _port: number;
  private _server: string | null = null;
  private _codeGraphTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options?: { port?: number }) {
    super();
    this._port = options?.port ?? 4313;
  }

  async start(options?: { open?: boolean }): Promise<void> {
    const base = startCanvasServer({ port: this._port });
    if (!base) {
      throw new Error(`Failed to start canvas server on port ${this._port}`);
    }
    this._server = base;
    this._port = getCanvasServerPort() ?? this._port;

    // Wire up mutation history recorder
    canvasState.onMutation((info) => {
      mutationHistory.record({
        description: info.description,
        operationType: info.operationType as any,
        forward: info.forward,
        inverse: info.inverse,
      });
    });

    // Wire up prompt handler to emit events
    setPrimaryWorkbenchCanvasPromptHandler(async (request) => {
      this.emit('prompt', request);
    });

    // Wire up file watcher: push SSE updates when watched files change
    onFileNodeChanged(() => {
      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
      // Recompute code graph when a watched file changes (debounced)
      this._scheduleCodeGraphRecompute();
    });

    // Re-watch files for any file nodes restored from persistence
    for (const node of canvasState.getLayout().nodes) {
      if (node.type === 'file' && typeof node.data.path === 'string') {
        watchFileForNode(node.id, node.data.path);
      }
    }

    // Initial code graph computation for restored file nodes
    this._scheduleCodeGraphRecompute();

    if (options?.open !== false) {
      openUrlInExternalBrowser(`${base}/workbench`);
    }
  }

  stop(): void {
    stopCanvasServer();
    this._server = null;
  }

  addNode(input: {
    type: CanvasNodeState['type'];
    title?: string;
    content?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }): string {
    const width = input.width ?? 720;
    const height = input.height ?? 600;
    const pos = input.x !== undefined && input.y !== undefined
      ? { x: input.x, y: input.y }
      : findOpenCanvasPosition(canvasState.getLayout().nodes, width, height);

    const id = `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    // For file nodes, resolve path and load initial content
    let data: Record<string, unknown> = {
      ...(input.title ? { title: input.title } : {}),
      ...(input.content ? { content: input.content } : {}),
    };

    if (input.type === 'file') {
      const filePath = input.content ?? '';
      const resolved = resolve(filePath);
      const fileName = resolved.split('/').pop() ?? filePath;
      data = {
        path: resolved,
        title: input.title ?? fileName,
      };
      // Load initial content if file exists
      try {
        if (existsSync(resolved)) {
          const fileContent = readFileSync(resolved, 'utf-8');
          const stat = statSync(resolved);
          data.fileContent = fileContent;
          data.lineCount = fileContent.split('\n').length;
          data.updatedAt = new Date(stat.mtimeMs).toISOString();
        }
      } catch { /* non-fatal */ }
    }

    if (input.type === 'image') {
      const src = input.content ?? '';
      const isDataUri = src.startsWith('data:');
      const isUrl = src.startsWith('http://') || src.startsWith('https://');
      if (!isDataUri && !isUrl && src) {
        // Treat as file path
        const resolved = resolve(src);
        const fileName = resolved.split('/').pop() ?? src;
        data = {
          src: resolved,
          title: input.title ?? fileName,
          path: resolved,
        };
        // Detect MIME type from extension
        const ext = resolved.split('.').pop()?.toLowerCase() ?? '';
        if (IMAGE_MIME_MAP[ext]) data.mimeType = IMAGE_MIME_MAP[ext];
      } else {
        data = {
          src,
          title: input.title ?? (isUrl ? src.split('/').pop() ?? 'Image' : 'Image'),
        };
      }
    }

    const node: CanvasNodeState = {
      id,
      type: input.type,
      position: pos,
      size: { width, height },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      dockPosition: null,
      data,
    };

    canvasState.addNode(node);

    // Start watching file for live updates
    if (input.type === 'file' && data.path) {
      watchFileForNode(id, data.path as string);
    }

    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });

    // Recompute code graph when file nodes are added
    if (input.type === 'file') this._scheduleCodeGraphRecompute();

    return id;
  }

  updateNode(id: string, patch: Partial<CanvasNodeState>): void {
    canvasState.updateNode(id, patch);
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  }

  removeNode(id: string): void {
    const wasFile = canvasState.getNode(id)?.type === 'file';
    unwatchFileForNode(id);
    canvasState.removeNode(id);
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });

    // Recompute code graph when file nodes are removed
    if (wasFile) this._scheduleCodeGraphRecompute();
  }

  addEdge(input: {
    from: string;
    to: string;
    type: CanvasEdge['type'];
    label?: string;
  }): string {
    const id = `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const edge: CanvasEdge = {
      id,
      from: input.from,
      to: input.to,
      type: input.type,
      ...(input.label ? { label: input.label } : {}),
    };
    canvasState.addEdge(edge);
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return id;
  }

  removeEdge(id: string): void {
    canvasState.removeEdge(id);
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  }

  /**
   * Create a group node and optionally add child nodes to it.
   * If childIds are provided, the group auto-sizes to contain them with padding.
   */
  createGroup(input: {
    title?: string;
    childIds?: string[];
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    color?: string;
  }): string {
    const PAD = 40;
    let x = input.x;
    let y = input.y;
    let width = input.width ?? 600;
    let height = input.height ?? 400;

    // If child IDs provided, compute bounding box
    const childIds = input.childIds ?? [];
    if (childIds.length > 0 && x === undefined && y === undefined) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const cid of childIds) {
        const child = canvasState.getNode(cid);
        if (!child) continue;
        minX = Math.min(minX, child.position.x);
        minY = Math.min(minY, child.position.y);
        maxX = Math.max(maxX, child.position.x + child.size.width);
        maxY = Math.max(maxY, child.position.y + child.size.height);
      }
      if (minX !== Infinity) {
        x = minX - PAD;
        y = minY - PAD - 32; // extra space for group title bar
        width = maxX - minX + PAD * 2;
        height = maxY - minY + PAD * 2 + 32;
      }
    }

    const pos = x !== undefined && y !== undefined
      ? { x, y }
      : findOpenCanvasPosition(canvasState.getLayout().nodes, width, height);

    const id = `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const data: Record<string, unknown> = {
      title: input.title ?? 'Group',
      children: [],
    };
    if (input.color) data.color = input.color;

    const node: CanvasNodeState = {
      id,
      type: 'group',
      position: pos,
      size: { width, height },
      zIndex: 0, // groups render behind other nodes
      collapsed: false,
      pinned: false,
      dockPosition: null,
      data,
    };

    canvasState.addNode(node);

    // Add children to group
    if (childIds.length > 0) {
      canvasState.groupNodes(id, childIds);
    }

    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return id;
  }

  /** Add nodes to an existing group. */
  groupNodes(groupId: string, childIds: string[]): boolean {
    const ok = canvasState.groupNodes(groupId, childIds);
    if (ok) {
      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    }
    return ok;
  }

  /** Remove all children from a group (the group node remains). */
  ungroupNodes(groupId: string): boolean {
    const ok = canvasState.ungroupNodes(groupId);
    if (ok) {
      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    }
    return ok;
  }

  arrange(layout?: 'grid' | 'column' | 'flow'): void {
    const nodes = canvasState.getLayout().nodes;
    const mode = layout ?? 'grid';
    const gap = 24;

    // Capture old positions for a single compound undo entry
    const oldPositions = nodes.map((n) => ({ id: n.id, position: { ...n.position } }));

    // Suppress individual updateNode recordings — we'll record one batch entry
    canvasState._suppressRecording = true;
    try {
      if (mode === 'column') {
        let y = 80;
        for (const node of nodes) {
          canvasState.updateNode(node.id, { position: { x: 40, y } });
          y += node.size.height + gap;
        }
      } else if (mode === 'flow') {
        let x = 40;
        for (const node of nodes) {
          canvasState.updateNode(node.id, { position: { x, y: 80 } });
          x += node.size.width + gap;
        }
      } else {
        // grid
        const cols = Math.max(1, Math.floor(1440 / (360 + gap)));
        let col = 0;
        let rowY = 80;
        let rowMaxHeight = 0;
        for (const node of nodes) {
          const x = 40 + col * (360 + gap);
          canvasState.updateNode(node.id, { position: { x, y: rowY } });
          rowMaxHeight = Math.max(rowMaxHeight, node.size.height);
          col++;
          if (col >= cols) {
            col = 0;
            rowY += rowMaxHeight + gap;
            rowMaxHeight = 0;
          }
        }
      }
    } finally {
      canvasState._suppressRecording = false;
    }

    // Record as one compound mutation
    const newPositions = canvasState.getLayout().nodes.map((n) => ({ id: n.id, position: { ...n.position } }));
    mutationHistory.record({
      description: `Auto-arranged ${nodes.length} nodes (${mode})`,
      operationType: 'arrange',
      forward: () => {
        canvasState._suppressRecording = true;
        try { for (const p of newPositions) canvasState.updateNode(p.id, { position: p.position }); }
        finally { canvasState._suppressRecording = false; }
      },
      inverse: () => {
        canvasState._suppressRecording = true;
        try { for (const p of oldPositions) canvasState.updateNode(p.id, { position: p.position }); }
        finally { canvasState._suppressRecording = false; }
      },
    });

    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  }

  focusNode(id: string): void {
    const node = canvasState.getNode(id);
    if (!node) return;
    canvasState.setViewport({
      x: node.position.x - 100,
      y: node.position.y - 100,
    });
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  }

  getLayout(): CanvasLayout {
    return canvasState.getLayout();
  }

  getNode(id: string): CanvasNodeState | undefined {
    return canvasState.getNode(id);
  }

  search(query: string): ReturnType<typeof searchNodes> {
    return searchNodes(canvasState.getLayout().nodes, query);
  }

  getSpatialContext() {
    const layout = canvasState.getLayout();
    return buildSpatialContext(layout.nodes, layout.edges, canvasState.contextPinnedNodeIds);
  }

  undo(): { ok: boolean; description?: string } {
    const entry = mutationHistory.undo();
    if (!entry) return { ok: false, description: 'Nothing to undo' };
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return { ok: true, description: `Undid: ${entry.description}` };
  }

  redo(): { ok: boolean; description?: string } {
    const entry = mutationHistory.redo();
    if (!entry) return { ok: false, description: 'Nothing to redo' };
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return { ok: true, description: `Redid: ${entry.description}` };
  }

  getHistory() {
    return {
      text: mutationHistory.toHumanReadable(),
      entries: mutationHistory.getSummaries(),
      canUndo: mutationHistory.canUndo(),
      canRedo: mutationHistory.canRedo(),
    };
  }

  diffSnapshot(idOrName: string): { ok: boolean; text?: string; diff?: ReturnType<typeof diffLayouts>; error?: string } {
    const snapData = canvasState.getSnapshotData(idOrName);
    if (!snapData) return { ok: false, error: `Snapshot "${idOrName}" not found` };

    const current = canvasState.getLayout();
    const diff = diffLayouts(snapData.name, snapData, current);
    return { ok: true, text: formatDiff(diff), diff };
  }

  getCodeGraph() {
    const summary = buildCodeGraphSummary();
    return { text: formatCodeGraph(summary), summary };
  }

  /** Debounced code graph recomputation (300ms). */
  private _scheduleCodeGraphRecompute(): void {
    if (this._codeGraphTimer) clearTimeout(this._codeGraphTimer);
    this._codeGraphTimer = setTimeout(() => {
      this._codeGraphTimer = null;
      recomputeCodeGraph();
      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    }, 300);
  }

  get port(): number {
    return this._port;
  }
}

export function createCanvas(options?: { port?: number }): PmxCanvas {
  return new PmxCanvas(options);
}

export type { CanvasNodeState, CanvasEdge, CanvasLayout, ViewportState } from './canvas-state.js';
export type {
  PrimaryWorkbenchCanvasPromptRequest,
  PrimaryWorkbenchIntent,
} from './server.js';
export {
  emitPrimaryWorkbenchEvent,
  consumePrimaryWorkbenchIntents,
  setPrimaryWorkbenchAutoOpenEnabled,
  setPrimaryWorkbenchCanvasPromptHandler,
  startCanvasServer,
  stopCanvasServer,
  getCanvasServerPort,
  openUrlInExternalBrowser,
} from './server.js';
export { canvasState } from './canvas-state.js';
export type { CanvasSnapshot } from './canvas-state.js';
export { findOpenCanvasPosition } from './placement.js';
export { searchNodes, buildSpatialContext, detectClusters, findNeighborhoods } from './spatial-analysis.js';
export type { SpatialCluster, SpatialContext, SpatialNeighbor, NodeSpatialInfo } from './spatial-analysis.js';
export { mutationHistory, diffLayouts, formatDiff } from './mutation-history.js';
export { recomputeCodeGraph, buildCodeGraphSummary, formatCodeGraph } from './code-graph.js';
export type { CodeGraphSummary, CodeGraphEdge } from './code-graph.js';
export type { MutationEntry, MutationSummary, SnapshotDiffResult } from './mutation-history.js';
export { traceManager } from './trace-manager.js';
