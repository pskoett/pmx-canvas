import { EventEmitter } from 'node:events';
import { canvasState } from './canvas-state.js';
import type { CanvasNodeState, CanvasEdge, CanvasLayout, ViewportState } from './canvas-state.js';
import { findOpenCanvasPosition } from './placement.js';
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

    // Wire up prompt handler to emit events
    setPrimaryWorkbenchCanvasPromptHandler(async (request) => {
      this.emit('prompt', request);
    });

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
    const node: CanvasNodeState = {
      id,
      type: input.type,
      position: pos,
      size: { width, height },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      dockPosition: null,
      data: {
        ...(input.title ? { title: input.title } : {}),
        ...(input.content ? { content: input.content } : {}),
      },
    };

    canvasState.addNode(node);
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return id;
  }

  updateNode(id: string, patch: Partial<CanvasNodeState>): void {
    canvasState.updateNode(id, patch);
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  }

  removeNode(id: string): void {
    canvasState.removeNode(id);
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
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

  arrange(layout?: 'grid' | 'column' | 'flow'): void {
    const nodes = canvasState.getLayout().nodes;
    const mode = layout ?? 'grid';
    const gap = 24;

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
export { findOpenCanvasPosition } from './placement.js';
export { traceManager } from './trace-manager.js';
