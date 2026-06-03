import { EventEmitter } from 'node:events';
import { canvasState, IMAGE_MIME_MAP } from './canvas-state.js';
import type { CanvasAnnotation, CanvasNodeState, CanvasEdge, CanvasLayout, ViewportState } from './canvas-state.js';
import { buildCanvasAxContext } from './ax-context.js';
import type { PmxAxContext, PmxAxFocusState, PmxAxSource, PmxAxState } from './ax-state.js';
import { findCanvasExtAppNodeId } from './ext-app-lookup.js';
import { onFileNodeChanged } from './file-watcher.js';
import { findOpenCanvasPosition, computeGroupBounds } from './placement.js';
import { searchNodes, buildSpatialContext } from './spatial-analysis.js';
import { mutationHistory, diffLayouts, formatDiff } from './mutation-history.js';
import { recomputeCodeGraph, buildCodeGraphSummary, formatCodeGraph } from './code-graph.js';
import {
  addCanvasNode,
  addCanvasEdge,
  MARKDOWN_NODE_DEFAULT_SIZE,
  MCP_APP_NODE_DEFAULT_SIZE,
  applyCanvasNodeUpdates,
  arrangeCanvasNodes,
  clearCanvas,
  createCanvasGraphNode,
  createCanvasGroup,
  createCanvasJsonRenderNode,
  buildStructuredNodeUpdate,
  fitCanvasView,
  deleteCanvasSnapshot,
  executeCanvasBatch,
  gcCanvasSnapshots,
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
  hasStructuredNodeUpdateFields,
  hasTraceNodeDataFields,
  mergeTraceNodeDataFields,
} from './canvas-operations.js';
import { validateCanvasLayout } from './canvas-validation.js';
import { describeCanvasSchema, validateStructuredCanvasPayload } from './canvas-schema.js';
import { buildHtmlPrimitive, getHtmlPrimitiveSemanticMetadata, isHtmlPrimitiveKind, listHtmlPrimitiveDescriptors } from './html-primitives.js';
import type { HtmlPrimitiveKind } from './html-primitives.js';
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
    const base = startCanvasServer({ port: this._port, allowPortFallback: false });
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
    children?: string[];
    childIds?: string[];
    childLayout?: 'grid' | 'column' | 'flow';
    color?: string;
    toolName?: string;
    category?: string;
    status?: string;
    duration?: string;
    resultSummary?: string;
    error?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    strictSize?: boolean;
  }): string {
    if (input.type === 'webpage') {
      throw new Error('Use addWebpageNode for webpage nodes so page content is fetched and cached on the server.');
    }
    if (input.type === 'group') {
      return this.createGroup({
        ...(typeof input.title === 'string' ? { title: input.title } : {}),
        childIds: input.childIds ?? input.children ?? [],
        ...(typeof input.x === 'number' ? { x: input.x } : {}),
        ...(typeof input.y === 'number' ? { y: input.y } : {}),
        ...(typeof input.width === 'number' ? { width: input.width } : {}),
        ...(typeof input.height === 'number' ? { height: input.height } : {}),
        ...(typeof input.color === 'string' ? { color: input.color } : {}),
        ...(input.childLayout ? { childLayout: input.childLayout } : {}),
      });
    }
    const { id, needsCodeGraphRecompute } = addCanvasNode({
      ...input,
      defaultWidth: input.type === 'markdown'
        ? MARKDOWN_NODE_DEFAULT_SIZE.width
        : input.type === 'mcp-app'
          ? MCP_APP_NODE_DEFAULT_SIZE.width
          : 360,
      defaultHeight: input.type === 'markdown'
        ? MARKDOWN_NODE_DEFAULT_SIZE.height
        : input.type === 'mcp-app'
          ? MCP_APP_NODE_DEFAULT_SIZE.height
          : 200,
      fileMode: 'path',
      ...(input.strictSize ? { strictSize: true } : {}),
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
    strictSize?: boolean;
  }): Promise<{ ok: boolean; id: string; error?: string; fetch: { ok: boolean; error?: string } }> {
    const { id } = addCanvasNode({
      type: 'webpage',
      ...(typeof input.title === 'string' ? { title: input.title } : {}),
      content: input.url,
      ...(typeof input.x === 'number' ? { x: input.x } : {}),
      ...(typeof input.y === 'number' ? { y: input.y } : {}),
      ...(typeof input.width === 'number' ? { width: input.width } : {}),
      ...(typeof input.height === 'number' ? { height: input.height } : {}),
      ...(input.strictSize ? { strictSize: true } : {}),
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

  updateNode(id: string, patch: Partial<CanvasNodeState> & Record<string, unknown>): void {
    const existing = canvasState.getNode(id);
    if (!existing) return;
    const resolvedPatch: Partial<CanvasNodeState> = {};
    if (patch.position) resolvedPatch.position = patch.position;
    if (patch.size) resolvedPatch.size = patch.size;
    if (patch.collapsed !== undefined) resolvedPatch.collapsed = patch.collapsed;
    if (patch.pinned !== undefined) resolvedPatch.pinned = patch.pinned;
    if (patch.dockPosition !== undefined) resolvedPatch.dockPosition = patch.dockPosition;

    if (hasStructuredNodeUpdateFields(patch)) {
      resolvedPatch.data = buildStructuredNodeUpdate(existing, patch).data;
    } else if (
      patch.data !== undefined ||
      patch.title !== undefined ||
      patch.content !== undefined ||
      typeof patch.arrangeLocked === 'boolean' ||
      typeof patch.strictSize === 'boolean' ||
      (existing.type === 'trace' && hasTraceNodeDataFields(patch))
    ) {
      const nextData = {
        ...existing.data,
        ...(patch.data && typeof patch.data === 'object' && !Array.isArray(patch.data) ? patch.data : {}),
        ...(typeof patch.title === 'string' ? { title: patch.title } : {}),
        ...(typeof patch.content === 'string' ? { content: patch.content } : {}),
        ...(typeof patch.arrangeLocked === 'boolean' ? { arrangeLocked: patch.arrangeLocked } : {}),
        ...(typeof patch.strictSize === 'boolean' ? { strictSize: patch.strictSize } : {}),
      };
      resolvedPatch.data = existing.type === 'trace'
        ? mergeTraceNodeDataFields(nextData, patch)
        : nextData;
    }

    const error = validateCanvasNodePatch({
      ...(resolvedPatch.position ? { position: resolvedPatch.position } : {}),
      ...(resolvedPatch.size ? { size: resolvedPatch.size } : {}),
    });
    if (error) {
      throw new Error(error);
    }
    canvasState.updateNode(id, resolvedPatch);
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

  addAnnotation(input: Omit<CanvasAnnotation, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): string {
    const id = input.id ?? `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    canvasState.addAnnotation({
      ...input,
      id,
      createdAt: input.createdAt ?? new Date().toISOString(),
    });
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return id;
  }

  removeAnnotation(id: string): boolean {
    const removed = canvasState.removeAnnotation(id);
    if (removed) emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return removed;
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
    const focus = canvasState.setAxFocus([id], { source: 'sdk', recordHistory: false });
    emitPrimaryWorkbenchEvent('canvas-focus-node', { nodeId: id, noPan });
    emitPrimaryWorkbenchEvent('ax-state-changed', { focus });
    if (!noPan) {
      emitPrimaryWorkbenchEvent('canvas-viewport-update', { viewport: canvasState.viewport });
    }
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return { focused: id, panned: !noPan };
  }

  getAxState(): PmxAxState {
    return canvasState.getAxState();
  }

  getAxContext(): PmxAxContext {
    return buildCanvasAxContext();
  }

  setAxFocus(nodeIds: string[], options?: { source?: PmxAxSource }): PmxAxFocusState {
    const focus = canvasState.setAxFocus(nodeIds, { source: options?.source ?? 'sdk' });
    emitPrimaryWorkbenchEvent('ax-state-changed', { focus });
    return focus;
  }

  fitView(options?: {
    width?: number;
    height?: number;
    padding?: number;
    maxScale?: number;
    nodeIds?: string[];
  }): ReturnType<typeof fitCanvasView> {
    const result = fitCanvasView(options);
    emitPrimaryWorkbenchEvent('canvas-viewport-update', { viewport: result.viewport });
    return result;
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
    return buildSpatialContext(layout.nodes, layout.edges, canvasState.contextPinnedNodeIds, layout.annotations);
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

  listSnapshots(options?: Parameters<typeof listCanvasSnapshots>[0]) {
    return listCanvasSnapshots(options);
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

  gcSnapshots(options?: Parameters<typeof gcCanvasSnapshots>[0]): ReturnType<typeof gcCanvasSnapshots> {
    return gcCanvasSnapshots(options);
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
    nodeId?: string;
    serverName?: string;
    title?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    timeoutMs?: number;
  }): Promise<{ ok: true; id?: string; nodeId: string | null; toolCallId: string; sessionId: string; resourceUri: string }> {
    const targetNode = input.nodeId ? canvasState.getNode(input.nodeId) : undefined;
    if (input.nodeId && !targetNode) {
      throw new Error(`Node "${input.nodeId}" not found.`);
    }
    if (targetNode && (targetNode.type !== 'mcp-app' || targetNode.data.mode !== 'ext-app')) {
      throw new Error(`Node "${input.nodeId}" is not an external app node.`);
    }

    const opened = await openExternalMcpApp({
      transport: input.transport,
      toolName: input.toolName,
      ...(input.toolArguments ? { toolArguments: input.toolArguments } : {}),
      ...(input.serverName ? { serverName: input.serverName } : {}),
      ...(typeof input.timeoutMs === 'number' ? { timeoutMs: input.timeoutMs } : {}),
    });
    const toolCallId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const previousSessionId = targetNode?.data.appSessionId;
    if (typeof previousSessionId === 'string' && previousSessionId.trim().length > 0) {
      closeMcpAppSession(previousSessionId);
    }
    const nodeIdSeed = input.nodeId ?? `ext-app-${toolCallId}`;
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
    const nodeId = input.nodeId ?? this.findCanvasExtAppNodeId(toolCallId);
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

  addHtmlNode(input: {
    html: string;
    title?: string;
    summary?: string;
    agentSummary?: string;
    description?: string;
    presentation?: boolean;
    slideTitles?: string[];
    embeddedNodeIds?: string[];
    embeddedUrls?: string[];
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    strictSize?: boolean;
  }): string {
    const { id } = addCanvasNode({
      type: 'html',
      ...(typeof input.title === 'string' ? { title: input.title } : {}),
      data: {
        html: input.html,
        ...(typeof input.summary === 'string' ? { summary: input.summary } : {}),
        ...(typeof input.agentSummary === 'string' ? { agentSummary: input.agentSummary } : {}),
        ...(typeof input.description === 'string' ? { description: input.description } : {}),
        ...(input.presentation === true ? { presentation: true } : {}),
        ...(Array.isArray(input.slideTitles) ? { slideTitles: input.slideTitles } : {}),
        ...(Array.isArray(input.embeddedNodeIds) ? { embeddedNodeIds: input.embeddedNodeIds } : {}),
        ...(Array.isArray(input.embeddedUrls) ? { embeddedUrls: input.embeddedUrls } : {}),
      },
      ...(typeof input.x === 'number' ? { x: input.x } : {}),
      ...(typeof input.y === 'number' ? { y: input.y } : {}),
      ...(typeof input.width === 'number' ? { width: input.width } : {}),
      ...(typeof input.height === 'number' ? { height: input.height } : {}),
      ...(input.strictSize ? { strictSize: true } : {}),
      defaultWidth: 720,
      defaultHeight: 640,
    });
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return id;
  }

  addHtmlPrimitive(input: {
    kind: HtmlPrimitiveKind;
    title?: string;
    data?: Record<string, unknown>;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    strictSize?: boolean;
  }): { id: string; kind: HtmlPrimitiveKind; title: string; htmlBytes: number } {
    const built = buildHtmlPrimitive({
      kind: input.kind,
      ...(typeof input.title === 'string' ? { title: input.title } : {}),
      ...(input.data ? { data: input.data } : {}),
    });
    const { id } = addCanvasNode({
      type: 'html',
      title: built.title,
      data: {
        html: built.html,
        htmlPrimitive: built.kind,
        primitiveData: built.data,
        description: built.summary,
        agentSummary: typeof input.data?.agentSummary === 'string' ? input.data.agentSummary : built.summary,
        ...(typeof input.data?.summary === 'string' ? { summary: input.data.summary } : {}),
        ...getHtmlPrimitiveSemanticMetadata(built.data),
      },
      ...(typeof input.x === 'number' ? { x: input.x } : {}),
      ...(typeof input.y === 'number' ? { y: input.y } : {}),
      ...(typeof input.width === 'number' ? { width: input.width } : {}),
      ...(typeof input.height === 'number' ? { height: input.height } : {}),
      ...(input.strictSize ? { strictSize: true } : {}),
      defaultWidth: built.defaultSize.width,
      defaultHeight: built.defaultSize.height,
    });
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return { id, kind: built.kind, title: built.title, htmlBytes: Buffer.byteLength(built.html, 'utf-8') };
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
    const base = this._server ?? startCanvasServer({ port: this._port, allowPortFallback: false });
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
export type { CanvasAnnotation, CanvasSnapshot, CanvasSnapshotGcResult, CanvasSnapshotListOptions } from './canvas-state.js';
export { findOpenCanvasPosition } from './placement.js';
export { searchNodes, buildSpatialContext, detectClusters, findNeighborhoods } from './spatial-analysis.js';
export type { SpatialCluster, SpatialContext, SpatialNeighbor, NodeSpatialInfo } from './spatial-analysis.js';
export { mutationHistory, diffLayouts, formatDiff } from './mutation-history.js';
export { recomputeCodeGraph, buildCodeGraphSummary, formatCodeGraph } from './code-graph.js';
export { describeCanvasSchema, validateStructuredCanvasPayload } from './canvas-schema.js';
export { buildHtmlPrimitive, getHtmlPrimitiveSemanticMetadata, isHtmlPrimitiveKind, listHtmlPrimitiveDescriptors } from './html-primitives.js';
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
export type { HtmlPrimitiveKind, HtmlPrimitiveDescriptor, HtmlPrimitiveInput, HtmlPrimitiveBuildResult } from './html-primitives.js';
export { traceManager } from './trace-manager.js';
