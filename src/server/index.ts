import { EventEmitter } from 'node:events';
import { canvasState, IMAGE_MIME_MAP } from './canvas-state.js';
import type { CanvasNodeState, CanvasEdge, CanvasLayout, ViewportState } from './canvas-state.js';
import { watchFileForNode, onFileNodeChanged } from './file-watcher.js';
import { findOpenCanvasPosition, computeGroupBounds } from './placement.js';
import { searchNodes, buildSpatialContext } from './spatial-analysis.js';
import { mutationHistory, diffLayouts, formatDiff } from './mutation-history.js';
import { recomputeCodeGraph, buildCodeGraphSummary, formatCodeGraph } from './code-graph.js';
import {
  addCanvasNode,
  addCanvasEdge,
  applyCanvasNodeUpdates,
  arrangeCanvasNodes,
  clearCanvas,
  createCanvasGraphNode,
  createCanvasGroup,
  createCanvasJsonRenderNode,
  deleteCanvasSnapshot,
  groupCanvasNodes,
  listCanvasSnapshots,
  refreshCanvasWebpageNode,
  removeCanvasNode,
  removeCanvasEdge,
  restoreCanvasSnapshot,
  saveCanvasSnapshot,
  scheduleCodeGraphRecompute,
  setCanvasContextPins,
  ungroupCanvasNodes,
  validateCanvasNodePatch,
} from './canvas-operations.js';
import {
  buildWebArtifactOnCanvas,
  type WebArtifactBuildInput,
  type WebArtifactCanvasBuildResult,
} from './web-artifacts.js';
import {
  buildGraphSpec,
  buildJsonRenderViewerHtml,
  createJsonRenderNodeData,
  GRAPH_NODE_SIZE,
  JSON_RENDER_NODE_SIZE,
  normalizeAndValidateJsonRenderSpec,
  type GraphNodeInput,
  type JsonRenderNodeInput,
  type JsonRenderSpec,
} from '../json-render/server.js';
import {
  startCanvasServer,
  stopCanvasServer,
  getCanvasServerPort,
  openUrlInExternalBrowser,
  getCanvasAutomationWebViewStatus,
  startCanvasAutomationWebView,
  stopCanvasAutomationWebView,
  evaluateCanvasAutomationWebView,
  resizeCanvasAutomationWebView,
  screenshotCanvasAutomationWebView,
  emitPrimaryWorkbenchEvent,
  setPrimaryWorkbenchCanvasPromptHandler,
  setPrimaryWorkbenchAutoOpenEnabled,
  consumePrimaryWorkbenchIntents,
} from './server.js';
import type {
  CanvasAutomationWebViewOptions,
  CanvasAutomationWebViewStatus,
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

  async start(options?: {
    open?: boolean;
    automationWebView?: boolean | CanvasAutomationWebViewOptions;
  }): Promise<void> {
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
        operationType: info.operationType,
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
      scheduleCodeGraphRecompute(() => {
        emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
      });
    });

    // Re-watch files for any file nodes restored from persistence
    for (const node of canvasState.getLayout().nodes) {
      if (node.type === 'file' && typeof node.data.path === 'string') {
        watchFileForNode(node.id, node.data.path);
      }
    }

    // Initial code graph computation for restored file nodes
    scheduleCodeGraphRecompute(() => {
      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    });

    if (options?.automationWebView) {
      try {
        await startCanvasAutomationWebView(
          `${base}/workbench`,
          options.automationWebView === true ? {} : options.automationWebView,
        );
      } catch (error) {
        stopCanvasServer();
        throw error;
      }
    }

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
    if (input.type === 'webpage') {
      throw new Error('Use addWebpageNode for webpage nodes so page content is fetched and cached on the server.');
    }
    const { id, needsCodeGraphRecompute } = addCanvasNode({
      ...input,
      defaultWidth: 720,
      defaultHeight: 600,
      fileMode: 'path',
    });

    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });

    if (needsCodeGraphRecompute) {
      scheduleCodeGraphRecompute(() => {
        emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
      });
    }

    return id;
  }

  async addWebpageNode(input: {
    title?: string;
    url: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }): Promise<{ ok: boolean; id: string; error?: string; fetch: { ok: boolean; error?: string } }> {
    const { id } = addCanvasNode({
      type: 'webpage',
      ...(typeof input.title === 'string' ? { title: input.title } : {}),
      content: input.url,
      ...(typeof input.x === 'number' ? { x: input.x } : {}),
      ...(typeof input.y === 'number' ? { y: input.y } : {}),
      ...(typeof input.width === 'number' ? { width: input.width } : {}),
      ...(typeof input.height === 'number' ? { height: input.height } : {}),
      defaultWidth: 520,
      defaultHeight: 420,
    });
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    const result = await refreshCanvasWebpageNode(id);
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return {
      ok: true,
      id,
      fetch: result.ok
        ? { ok: true }
        : { ok: false, error: result.error ?? 'Failed to fetch webpage content.' },
      ...(result.ok ? {} : { error: result.error }),
    };
  }

  async refreshWebpageNode(id: string, url?: string): Promise<{ ok: boolean; id: string; error?: string }> {
    const result = await refreshCanvasWebpageNode(id, { ...(url ? { url } : {}) });
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return result;
  }

  updateNode(id: string, patch: Partial<CanvasNodeState>): void {
    const error = validateCanvasNodePatch({
      ...(patch.position ? { position: patch.position } : {}),
      ...(patch.size ? { size: patch.size } : {}),
    });
    if (error) {
      throw new Error(error);
    }
    canvasState.updateNode(id, patch);
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  }

  removeNode(id: string): void {
    const { removed, needsCodeGraphRecompute } = removeCanvasNode(id);
    if (!removed) return;
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });

    if (needsCodeGraphRecompute) {
      scheduleCodeGraphRecompute(() => {
        emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
      });
    }
  }

  addEdge(input: {
    from: string;
    to: string;
    type: CanvasEdge['type'];
    label?: string;
    animated?: boolean;
  }): string {
    const { id } = addCanvasEdge(input);
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return id;
  }

  removeEdge(id: string): void {
    removeCanvasEdge(id);
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
    const { id } = createCanvasGroup(input);

    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return id;
  }

  /** Add nodes to an existing group. */
  groupNodes(groupId: string, childIds: string[]): boolean {
    const { ok } = groupCanvasNodes(groupId, childIds);
    if (ok) {
      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    }
    return ok;
  }

  /** Remove all children from a group (the group node remains). */
  ungroupNodes(groupId: string): boolean {
    const { ok } = ungroupCanvasNodes(groupId);
    if (ok) {
      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    }
    return ok;
  }

  clear(): void {
    clearCanvas();
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  }

  arrange(layout?: 'grid' | 'column' | 'flow'): void {
    arrangeCanvasNodes(layout ?? 'grid');
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  }

  focusNode(id: string): void {
    const node = canvasState.getNode(id);
    if (!node) return;
    canvasState.setViewport({
      x: node.position.x - 100,
      y: node.position.y - 100,
    });
    emitPrimaryWorkbenchEvent('canvas-focus-node', { nodeId: id });
    emitPrimaryWorkbenchEvent('canvas-viewport-update', { viewport: canvasState.viewport });
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

  applyUpdates(updates: Array<{
    id: string;
    position?: { x: number; y: number };
    size?: { width: number; height: number };
    collapsed?: boolean;
    dockPosition?: 'left' | 'right' | null;
  }>): { applied: number; skipped: number } {
    return applyCanvasNodeUpdates(updates);
  }

  setContextPins(nodeIds: string[], mode: 'set' | 'add' | 'remove' = 'set'): { count: number; nodeIds: string[] } {
    const result = setCanvasContextPins(nodeIds, mode);
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return result;
  }

  listSnapshots() {
    return listCanvasSnapshots();
  }

  saveSnapshot(name: string) {
    return saveCanvasSnapshot(name);
  }

  restoreSnapshot(id: string): { ok: boolean } {
    const result = restoreCanvasSnapshot(id);
    if (result.ok) {
      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    }
    return result;
  }

  deleteSnapshot(id: string): { ok: boolean } {
    return deleteCanvasSnapshot(id);
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

  async buildWebArtifact(
    input: WebArtifactBuildInput & { openInCanvas?: boolean },
  ): Promise<WebArtifactCanvasBuildResult> {
    return buildWebArtifactOnCanvas(input);
  }

  addJsonRenderNode(
    input: JsonRenderNodeInput,
  ): { id: string; url: string; spec: JsonRenderSpec } {
    const result = createCanvasJsonRenderNode(input);
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return result;
  }

  addGraphNode(input: GraphNodeInput): { id: string; url: string; spec: JsonRenderSpec } {
    const result = createCanvasGraphNode(input);
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return result;
  }

  get port(): number {
    return this._port;
  }

  async startAutomationWebView(
    options: CanvasAutomationWebViewOptions = {},
  ): Promise<CanvasAutomationWebViewStatus> {
    const base = this._server ?? startCanvasServer({ port: this._port });
    if (!base) {
      throw new Error(`Failed to start canvas server on port ${this._port}`);
    }
    this._server = base;
    this._port = getCanvasServerPort() ?? this._port;
    return startCanvasAutomationWebView(`${base}/workbench`, options);
  }

  async stopAutomationWebView(): Promise<boolean> {
    return stopCanvasAutomationWebView();
  }

  getAutomationWebViewStatus(): CanvasAutomationWebViewStatus {
    return getCanvasAutomationWebViewStatus();
  }

  async evaluateAutomationWebView(expression: string): Promise<unknown> {
    return evaluateCanvasAutomationWebView(expression);
  }

  async resizeAutomationWebView(
    width: number,
    height: number,
  ): Promise<CanvasAutomationWebViewStatus> {
    return resizeCanvasAutomationWebView(width, height);
  }

  async screenshotAutomationWebView(options: Record<string, unknown> = {}): Promise<Uint8Array> {
    return screenshotCanvasAutomationWebView(options);
  }
}

export function createCanvas(options?: { port?: number }): PmxCanvas {
  return new PmxCanvas(options);
}

export type { CanvasNodeState, CanvasEdge, CanvasLayout, ViewportState } from './canvas-state.js';
export type {
  CanvasAutomationWebViewOptions,
  CanvasAutomationWebViewStatus,
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
  getCanvasAutomationWebViewStatus,
  startCanvasAutomationWebView,
  stopCanvasAutomationWebView,
  evaluateCanvasAutomationWebView,
  resizeCanvasAutomationWebView,
  screenshotCanvasAutomationWebView,
} from './server.js';
export { canvasState } from './canvas-state.js';
export type { CanvasSnapshot } from './canvas-state.js';
export { findOpenCanvasPosition } from './placement.js';
export { searchNodes, buildSpatialContext, detectClusters, findNeighborhoods } from './spatial-analysis.js';
export type { SpatialCluster, SpatialContext, SpatialNeighbor, NodeSpatialInfo } from './spatial-analysis.js';
export { mutationHistory, diffLayouts, formatDiff } from './mutation-history.js';
export { recomputeCodeGraph, buildCodeGraphSummary, formatCodeGraph } from './code-graph.js';
export {
  buildWebArtifactOnCanvas,
  executeWebArtifactBuild,
  openWebArtifactInCanvas,
  resolveWebArtifactScriptPath,
  resolveWorkspacePath,
} from './web-artifacts.js';
export {
  buildGraphSpec,
  buildJsonRenderViewerHtml,
  createJsonRenderNodeData,
  GRAPH_NODE_SIZE,
  JSON_RENDER_NODE_SIZE,
  normalizeAndValidateJsonRenderSpec,
} from '../json-render/server.js';
export type { CodeGraphSummary, CodeGraphEdge } from './code-graph.js';
export type { MutationEntry, MutationSummary, SnapshotDiffResult } from './mutation-history.js';
export type {
  WebArtifactBuildInput,
  WebArtifactBuildOutput,
  WebArtifactCanvasBuildResult,
  WebArtifactCanvasOpenResult,
} from './web-artifacts.js';
export type { GraphNodeInput, JsonRenderNodeInput, JsonRenderSpec } from '../json-render/server.js';
export { traceManager } from './trace-manager.js';
