import { EventEmitter } from 'node:events';
import { canvasState, IMAGE_MIME_MAP } from './canvas-state.js';
import type { CanvasNodeState, CanvasEdge, CanvasLayout, ViewportState } from './canvas-state.js';
import { findCanvasExtAppNodeId } from './ext-app-lookup.js';
import { onFileNodeChanged } from './file-watcher.js';
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
  executeCanvasBatch,
  groupCanvasNodes,
  listCanvasSnapshots,
  refreshCanvasWebpageNode,
  removeCanvasNode,
  removeCanvasEdge,
  restoreCanvasSnapshot,
  saveCanvasSnapshot,
  scheduleCodeGraphRecompute,
  syncCanvasRuntimeBackends,
  setCanvasContextPins,
  ungroupCanvasNodes,
  validateCanvasNodePatch,
} from './canvas-operations.js';
import { validateCanvasLayout } from './canvas-validation.js';
import { describeCanvasSchema, validateStructuredCanvasPayload } from './canvas-schema.js';
import {
  buildWebArtifactOnCanvas,
  type WebArtifactBuildInput,
  type WebArtifactCanvasBuildResult,
} from './web-artifacts.js';
import {
  closeMcpAppSession,
  openMcpApp as openExternalMcpApp,
  type ExternalMcpTransportConfig,
} from './mcp-app-runtime.js';
import {
  buildExcalidrawOpenMcpAppInput,
  ensureExcalidrawCheckpointId,
  isExcalidrawCreateView,
  type DiagramPresetOpenInput,
} from './diagram-presets.js';
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
      defaultWidth: 360,
      defaultHeight: 200,
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
    const existing = canvasState.getNode(id);
    const appSessionId =
      existing?.type === 'mcp-app' && typeof existing.data.appSessionId === 'string'
        ? existing.data.appSessionId
        : null;
    if (appSessionId) {
      closeMcpAppSession(appSessionId);
    }
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
    from?: string;
    to?: string;
    fromSearch?: string;
    toSearch?: string;
    type: CanvasEdge['type'];
    label?: string;
    style?: CanvasEdge['style'];
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
    childLayout?: 'grid' | 'column' | 'flow';
  }): string {
    const { id } = createCanvasGroup(input);

    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return id;
  }

  /** Add nodes to an existing group. */
  groupNodes(groupId: string, childIds: string[], options?: { childLayout?: 'grid' | 'column' | 'flow' }): boolean {
    const { ok } = groupCanvasNodes(groupId, childIds, options);
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
    for (const node of canvasState.getLayout().nodes) {
      if (node.type !== 'mcp-app') continue;
      const sessionId = typeof node.data.appSessionId === 'string' ? node.data.appSessionId : '';
      if (sessionId) closeMcpAppSession(sessionId);
    }
    clearCanvas();
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  }

  arrange(layout?: 'grid' | 'column' | 'flow'): void {
    arrangeCanvasNodes(layout ?? 'grid');
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  }

  focusNode(id: string, options?: { noPan?: boolean }): { focused: string; panned: boolean } | null {
    const node = canvasState.getNode(id);
    if (!node) return null;
    const noPan = options?.noPan === true;
    if (!noPan) {
      canvasState.setViewport({
        x: node.position.x - 100,
        y: node.position.y - 100,
      });
    }
    emitPrimaryWorkbenchEvent('canvas-focus-node', { nodeId: id, noPan });
    if (!noPan) {
      emitPrimaryWorkbenchEvent('canvas-viewport-update', { viewport: canvasState.viewport });
    }
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return { focused: id, panned: !noPan };
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

  async undo(): Promise<{ ok: boolean; description?: string }> {
    const entry = mutationHistory.undo();
    if (!entry) return { ok: false, description: 'Nothing to undo' };
    await syncCanvasRuntimeBackends();
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return { ok: true, description: `Undid: ${entry.description}` };
  }

  async redo(): Promise<{ ok: boolean; description?: string }> {
    const entry = mutationHistory.redo();
    if (!entry) return { ok: false, description: 'Nothing to redo' };
    await syncCanvasRuntimeBackends();
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

  async restoreSnapshot(id: string): Promise<{ ok: boolean }> {
    const result = await restoreCanvasSnapshot(id);
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

  validate() {
    return validateCanvasLayout(canvasState.getLayout());
  }

  private findCanvasExtAppNodeId(toolCallId: string): string | null {
    return findCanvasExtAppNodeId(toolCallId, {
      getNode: (id) => canvasState.getNode(id),
      listNodes: () => canvasState.getLayout().nodes,
    });
  }

  describeSchema() {
    return describeCanvasSchema();
  }

  validateSpec(input: {
    type: 'json-render' | 'graph';
    spec?: unknown;
    graph?: GraphNodeInput;
  }) {
    return validateStructuredCanvasPayload(input);
  }

  async runBatch(operations: Array<{ op: string; assign?: string; args?: Record<string, unknown> }>) {
    const result = await executeCanvasBatch(operations);
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return result;
  }

  async buildWebArtifact(
    input: WebArtifactBuildInput & { openInCanvas?: boolean },
  ): Promise<WebArtifactCanvasBuildResult> {
    return buildWebArtifactOnCanvas(input);
  }

  async openMcpApp(input: {
    transport: ExternalMcpTransportConfig;
    toolName: string;
    toolArguments?: Record<string, unknown>;
    serverName?: string;
    title?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }): Promise<{ ok: true; id?: string; nodeId: string | null; toolCallId: string; sessionId: string; resourceUri: string }> {
    const opened = await openExternalMcpApp({
      transport: input.transport,
      toolName: input.toolName,
      ...(input.toolArguments ? { toolArguments: input.toolArguments } : {}),
      ...(input.serverName ? { serverName: input.serverName } : {}),
    });
    const toolCallId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const nodeIdSeed = `ext-app-${toolCallId}`;
    const toolResult = isExcalidrawCreateView(opened.serverName, opened.toolName)
      ? ensureExcalidrawCheckpointId(opened.toolResult, nodeIdSeed)
      : opened.toolResult;
    emitPrimaryWorkbenchEvent('ext-app-open', {
      toolCallId,
      nodeId: nodeIdSeed,
      title: input.title ?? opened.tool.title ?? opened.tool.name,
      html: opened.html,
      toolInput: opened.toolInput,
      serverName: opened.serverName,
      toolName: opened.toolName,
      appSessionId: opened.sessionId,
      transportConfig: input.transport,
      resourceUri: opened.resourceUri,
      toolDefinition: opened.tool,
      sessionStatus: 'ready',
      sessionError: null,
      ...(opened.resourceMeta ? { resourceMeta: opened.resourceMeta } : {}),
      ...(typeof input.x === 'number' ? { x: input.x } : {}),
      ...(typeof input.y === 'number' ? { y: input.y } : {}),
      ...(typeof input.width === 'number' ? { width: input.width } : {}),
      ...(typeof input.height === 'number' ? { height: input.height } : {}),
    });
    emitPrimaryWorkbenchEvent('ext-app-result', {
      toolCallId,
      nodeId: nodeIdSeed,
      serverName: opened.serverName,
      toolName: opened.toolName,
      success: toolResult.isError !== true,
      result: toolResult,
    });
    const nodeId = this.findCanvasExtAppNodeId(toolCallId);
    return {
      ok: true,
      ...(nodeId ? { id: nodeId } : {}),
      nodeId,
      toolCallId,
      sessionId: opened.sessionId,
      resourceUri: opened.resourceUri,
    };
  }

  async addDiagram(
    input: DiagramPresetOpenInput,
  ): Promise<{ ok: true; id?: string; nodeId: string | null; toolCallId: string; sessionId: string; resourceUri: string }> {
    const built = buildExcalidrawOpenMcpAppInput(input);
    return this.openMcpApp(built);
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
export { describeCanvasSchema, validateStructuredCanvasPayload } from './canvas-schema.js';
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
