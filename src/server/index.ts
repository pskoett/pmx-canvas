import { EventEmitter } from 'node:events';
import { canvasState, IMAGE_MIME_MAP } from './canvas-state.js';
import type { CanvasAnnotation, CanvasNodeState, CanvasEdge, CanvasLayout, ViewportState } from './canvas-state.js';
import { buildCanvasAxContext } from './ax-context.js';
import { applyAxInteraction, type AxInteractionInput, type AxInteractionPublicResult } from './ax-interaction.js';
import { intentRegistry } from './intent-registry.js';
import type { PmxAxIntent, PmxAxIntentKind } from '../shared/ax-intent.js';
import { waitForAxResolution } from './ax-wait.js';
import type {
  PmxAxActivityKind,
  PmxAxApprovalGate,
  PmxAxCommandDescriptor,
  PmxAxContext,
  PmxAxElicitation,
  PmxAxEvent,
  PmxAxEvidence,
  PmxAxEvidenceKind,
  PmxAxFocusState,
  PmxAxHostCapability,
  PmxAxMode,
  PmxAxModeRequest,
  PmxAxPolicy,
  PmxAxReviewAnchorType,
  PmxAxReviewAnnotation,
  PmxAxReviewKind,
  PmxAxReviewRegion,
  PmxAxReviewSeverity,
  PmxAxReviewStatus,
  PmxAxSource,
  PmxAxState,
  PmxAxSteeringMessage,
  PmxAxWorkItem,
  PmxAxWorkItemStatus,
} from './ax-state.js';
import type { AxTimelineQuery } from './canvas-db.js';
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
  fitCanvasView,
  deleteCanvasSnapshot,
  gcCanvasSnapshots,
  groupCanvasNodes,
  listCanvasSnapshots,
  refreshCanvasWebpageNode,
  removeCanvasEdge,
  resolveHtmlContent,
  restoreCanvasSnapshot,
  saveCanvasSnapshot,
  scheduleCodeGraphRecompute,
  syncCanvasRuntimeBackends,
  setCanvasContextPins,
  ungroupCanvasNodes,
} from './canvas-operations.js';
import {
  buildNodePatch,
  createBasicCanvasNode,
  removeNodeCore,
  setGroupChildrenFromApi,
} from './operations/ops/nodes.js';
import { streamJsonRenderCore } from './operations/ops/json-render.js';
import {
  executeOperation,
  runCanvasBatchOperation,
  type OpenMcpAppCoreResult,
} from './operations/index.js';
import { validateCanvasLayout } from './canvas-validation.js';
import { describeCanvasSchema, validateStructuredCanvasPayload } from './canvas-schema.js';
import { serializeCanvasNode, type SerializedCanvasNode } from './canvas-serialization.js';
import { buildHtmlPrimitive, getHtmlPrimitiveSemanticMetadata, isHtmlPrimitiveKind, listHtmlPrimitiveDescriptors } from './html-primitives.js';
import type { HtmlPrimitiveKind } from './html-primitives.js';
import {
  buildWebArtifactOnCanvas,
  type WebArtifactBuildInput,
  type WebArtifactCanvasBuildResult,
} from './web-artifacts.js';
import {
  closeMcpAppSession,
  type ExternalMcpTransportConfig,
} from './mcp-app-runtime.js';
import {
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

/**
 * Node object returned by the SDK's create/get methods. It is the fully
 * serialized node (adds `surfaceUrl`, `kind`, `title`, `content`, …) plus a
 * `nodeId` alias for `id`, so the SDK return shape matches the HTTP/CLI
 * `node`-create responses field-for-field.
 */
export type SdkCanvasNode = SerializedCanvasNode & { nodeId: string };

/** Enrich a raw canvas node into the SDK return shape (surfaceUrl + nodeId). */
function toSdkNode(node: CanvasNodeState): SdkCanvasNode {
  return { ...serializeCanvasNode(node), nodeId: node.id };
}

export class PmxCanvas extends EventEmitter {
  private _port: number;
  private _server: string | null = null;

  constructor(options?: { port?: number }) {
    super();
    this._port = options?.port ?? 4313;
  }

  private runIntentCommit<T>(
    intentId: string | undefined,
    allowedKinds: readonly PmxAxIntentKind[],
    mutate: () => T,
    settledNodeId: (result: T) => string | undefined,
  ): T {
    if (intentId === undefined) return mutate();
    intentRegistry.beginCommit(intentId, allowedKinds);
    try {
      const result = mutate();
      intentRegistry.completeCommit(intentId, settledNodeId(result));
      return result;
    } catch (error) {
      intentRegistry.abortCommit(intentId);
      throw error;
    }
  }

  async start(options?: {
    open?: boolean;
    automationWebView?: boolean | CanvasAutomationWebViewOptions;
    /**
     * Bind a nearby free port when the preferred one is taken instead of
     * failing. Default false (an explicit SDK port is honored exactly); the
     * MCP auto-start opts in so a daemon already on the port can't crash it.
     */
    allowPortFallback?: boolean;
  }): Promise<void> {
    const base = startCanvasServer({ port: this._port, allowPortFallback: options?.allowPortFallback ?? false });
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

  /**
   * Add a node to the canvas and return the created node (including its `id`,
   * resolved geometry, and data). Destructure `const { id } = canvas.addNode(...)`
   * or keep the whole node — both work. (Previously returned a bare id string.)
   */
  addNode(input: {
    intentId?: string;
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
  }): SdkCanvasNode {
    return this.runIntentCommit(input.intentId, ['create'], () => {
      if (input.type === 'webpage') {
        throw new Error('Use addWebpageNode for webpage nodes so page content is fetched and cached on the server.');
      }
      if (input.type === 'group') {
        const groupId = this.createGroup({
          ...(typeof input.title === 'string' ? { title: input.title } : {}),
          childIds: input.childIds ?? input.children ?? [],
          ...(typeof input.x === 'number' ? { x: input.x } : {}),
          ...(typeof input.y === 'number' ? { y: input.y } : {}),
          ...(typeof input.width === 'number' ? { width: input.width } : {}),
          ...(typeof input.height === 'number' ? { height: input.height } : {}),
          ...(typeof input.color === 'string' ? { color: input.color } : {}),
          ...(input.childLayout ? { childLayout: input.childLayout } : {}),
        });
        const groupNode = canvasState.getNode(groupId);
        if (!groupNode) throw new Error(`Group node "${groupId}" was not created.`);
        return toSdkNode(groupNode);
      }
      // Thin wrapper over the shared operation core (plan-005); the SDK keeps
      // fileMode 'path' as an explicit visible parameter instead of forked code.
      const { node, needsCodeGraphRecompute } = createBasicCanvasNode(input, { fileMode: 'path' });

      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });

      if (needsCodeGraphRecompute) {
        scheduleCodeGraphRecompute(() => {
          emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
        });
      }

      return toSdkNode(node);
    }, (node) => node.id);
  }

  async addWebpageNode(input: {
    intentId?: string;
    title?: string;
    url: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    strictSize?: boolean;
  }): Promise<{ ok: boolean; id: string; error?: string; fetch: { ok: boolean; error?: string } }> {
    const mutate = async () => {
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
    };
    if (input.intentId === undefined) return await mutate();
    return await intentRegistry.runCommit(input.intentId, ['create'], mutate, (result) => result.id);
  }

  async refreshWebpageNode(id: string, url?: string): Promise<{ ok: boolean; id: string; error?: string }> {
    const result = await refreshCanvasWebpageNode(id, { ...(url ? { url } : {}) });
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return result;
  }

  updateNode(id: string, patch: Partial<CanvasNodeState> & Record<string, unknown>): void {
    const intentId = typeof patch.intentId === 'string' ? patch.intentId : undefined;
    this.runIntentCommit(intentId, ['move', 'edit'], () => {
      const existing = canvasState.getNode(id);
      if (!existing) {
        if (intentId !== undefined) throw new Error(`Node "${id}" not found.`);
        return;
      }
      // Thin wrapper over the shared patch core (plan-005): the SDK now carries
      // the same superset semantics as HTTP/MCP (webpage titleSource/url, html
      // top-level fields, axCapabilities merge, group children).
      const { patch: resolvedPatch, groupChildIds } = buildNodePatch(existing, patch);
      canvasState.updateNode(id, resolvedPatch);
      if (groupChildIds !== undefined) setGroupChildrenFromApi(id, groupChildIds);
      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    }, () => id);
  }

  /** Remove a node. Missing id throws (plan-005 unifies this across surfaces). */
  removeNode(id: string, options?: { intentId?: string }): void {
    this.runIntentCommit(options?.intentId, ['remove'], () => {
      const { needsCodeGraphRecompute } = removeNodeCore(id);
      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });

      if (needsCodeGraphRecompute) {
        scheduleCodeGraphRecompute(() => {
          emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
        });
      }
    }, () => undefined);
  }

  addEdge(input: {
    intentId?: string;
    from?: string;
    to?: string;
    fromSearch?: string;
    toSearch?: string;
    type: CanvasEdge['type'];
    label?: string;
    style?: CanvasEdge['style'];
    animated?: boolean;
  }): string {
    return this.runIntentCommit(input.intentId, ['connect'], () => {
      const { id } = addCanvasEdge(input);
      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
      return id;
    }, () => undefined);
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
    intentId?: string;
    title?: string;
    childIds?: string[];
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    color?: string;
    childLayout?: 'grid' | 'column' | 'flow';
  }): string {
    return this.runIntentCommit(input.intentId, ['create'], () => {
      const { id } = createCanvasGroup(input);
      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
      return id;
    }, (id) => id);
  }

  /** Add nodes to an existing group. */
  groupNodes(groupId: string, childIds: string[], options?: { childLayout?: 'grid' | 'column' | 'flow'; intentId?: string }): boolean {
    return this.runIntentCommit(options?.intentId, ['edit'], () => {
      const { ok } = groupCanvasNodes(groupId, childIds, options);
      if (!ok && options?.intentId !== undefined) {
        throw new Error(`Group "${groupId}" could not be updated.`);
      }
      if (ok) {
        emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
      }
      return ok;
    }, () => groupId);
  }

  /** Remove all children from a group (the group node remains). */
  ungroupNodes(groupId: string, options?: { intentId?: string }): boolean {
    return this.runIntentCommit(options?.intentId, ['edit'], () => {
      const { ok } = ungroupCanvasNodes(groupId);
      if (!ok && options?.intentId !== undefined) {
        throw new Error(`Group "${groupId}" could not be updated.`);
      }
      if (ok) {
        emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
      }
      return ok;
    }, () => groupId);
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

  getAxContext(options?: { consumer?: string }): PmxAxContext {
    return buildCanvasAxContext(options?.consumer);
  }

  setAxFocus(nodeIds: string[], options?: { source?: PmxAxSource }): PmxAxFocusState {
    const focus = canvasState.setAxFocus(nodeIds, { source: options?.source ?? 'sdk' });
    emitPrimaryWorkbenchEvent('ax-state-changed', { focus });
    return focus;
  }

  recordAxEvent(
    input: { kind: PmxAxEvent['kind']; summary: string; detail?: string | null; nodeIds?: string[]; data?: Record<string, unknown> | null },
    options?: { source?: PmxAxSource },
  ): PmxAxEvent {
    const event = canvasState.recordAxEvent(input, { source: options?.source ?? 'sdk' });
    emitPrimaryWorkbenchEvent('ax-event-created', { event });
    return event;
  }

  sendSteering(message: string, options?: { source?: PmxAxSource }): PmxAxSteeringMessage {
    const steering = canvasState.recordSteeringMessage(message, { source: options?.source ?? 'sdk' });
    emitPrimaryWorkbenchEvent('ax-event-created', { steering });
    return steering;
  }

  markSteeringDelivered(id: string): boolean {
    const ok = canvasState.markSteeringDelivered(id);
    if (ok) emitPrimaryWorkbenchEvent('ax-event-created', { steeringDelivered: id });
    return ok;
  }

  /**
   * Ghost Cursor of Intent — announce a spatial move before making it. The ghost
   * is ephemeral presence (auto-expiring, never snapshotted); the registry emits
   * the `ax-intent` SSE frame so the browser paints a pre-commit placeholder.
   */
  signalIntent(input: Record<string, unknown>): PmxAxIntent {
    return intentRegistry.signal({ source: 'sdk', ...input });
  }

  updateIntent(id: string, patch: Record<string, unknown>): PmxAxIntent {
    return intentRegistry.update(id, patch);
  }

  /** Dissolve a ghost; pass `settledNodeId` once the real node has landed. */
  clearIntent(id: string, options?: { settledNodeId?: string; vetoed?: boolean }): boolean {
    return intentRegistry.clear(id, options ?? {});
  }

  /** Undelivered steering for a consumer (loop-safe; excludes consumer-originated). */
  getPendingSteering(options?: { consumer?: string; limit?: number }): PmxAxSteeringMessage[] {
    return canvasState.getPendingSteering(options ?? {});
  }

  /**
   * Submit a node-originated AX interaction (plan-004 Phase 1). Validates the
   * envelope + node capabilities, maps the interaction onto the matching AX
   * operation, and emits the outcome + state SSE events.
   */
  submitAxInteraction(input: AxInteractionInput, options?: { source?: PmxAxSource }): AxInteractionPublicResult {
    const { result, events } = applyAxInteraction(canvasState, input, options?.source ?? 'sdk');
    for (const e of events) emitPrimaryWorkbenchEvent(e.event, e.payload);
    return result;
  }

  getAxTimeline(query?: AxTimelineQuery): ReturnType<typeof canvasState.getAxTimeline> {
    return canvasState.getAxTimeline(query);
  }

  listWorkItems(): PmxAxWorkItem[] {
    return canvasState.getWorkItems();
  }

  addWorkItem(
    input: { title: string; status?: PmxAxWorkItemStatus; detail?: string | null; nodeIds?: string[] },
    options?: { source?: PmxAxSource },
  ): PmxAxWorkItem {
    const workItem = canvasState.addWorkItem(input, { source: options?.source ?? 'sdk' });
    emitPrimaryWorkbenchEvent('ax-state-changed', { workItem });
    return workItem;
  }

  updateWorkItem(
    id: string,
    patch: { title?: string; status?: PmxAxWorkItemStatus; detail?: string | null; nodeIds?: string[] },
    options?: { source?: PmxAxSource },
  ): PmxAxWorkItem | null {
    const workItem = canvasState.updateWorkItem(id, patch, { source: options?.source ?? 'sdk' });
    if (workItem) emitPrimaryWorkbenchEvent('ax-state-changed', { workItem });
    return workItem;
  }

  listApprovalGates(): PmxAxApprovalGate[] {
    return canvasState.getApprovalGates();
  }

  requestApproval(
    input: { title: string; detail?: string | null; action?: string | null; nodeIds?: string[] },
    options?: { source?: PmxAxSource },
  ): PmxAxApprovalGate {
    const approvalGate = canvasState.requestApproval(input, { source: options?.source ?? 'sdk' });
    emitPrimaryWorkbenchEvent('ax-state-changed', { approvalGate });
    return approvalGate;
  }

  resolveApproval(
    id: string,
    decision: 'approved' | 'rejected',
    options?: { resolution?: string; source?: PmxAxSource },
  ): PmxAxApprovalGate | null {
    const approvalGate = canvasState.resolveApproval(id, decision, {
      ...(options?.resolution !== undefined ? { resolution: options.resolution } : {}),
      source: options?.source ?? 'sdk',
    });
    if (approvalGate) emitPrimaryWorkbenchEvent('ax-state-changed', { approvalGate });
    return approvalGate;
  }

  addEvidence(
    input: { kind: PmxAxEvidenceKind; title: string; body?: string | null; ref?: string | null; nodeIds?: string[]; data?: Record<string, unknown> | null },
    options?: { source?: PmxAxSource },
  ): PmxAxEvidence {
    const evidence = canvasState.addEvidence(input, { source: options?.source ?? 'sdk' });
    emitPrimaryWorkbenchEvent('ax-event-created', { evidence });
    return evidence;
  }

  listReviewAnnotations(): PmxAxReviewAnnotation[] {
    return canvasState.getReviewAnnotations();
  }

  addReviewAnnotation(
    input: {
      body: string;
      kind?: PmxAxReviewKind;
      severity?: PmxAxReviewSeverity;
      anchorType?: PmxAxReviewAnchorType;
      nodeId?: string | null;
      file?: string | null;
      region?: PmxAxReviewRegion | null;
      author?: string | null;
    },
    options?: { source?: PmxAxSource },
  ): PmxAxReviewAnnotation | null {
    const reviewAnnotation = canvasState.addReviewAnnotation(input, { source: options?.source ?? 'sdk' });
    if (!reviewAnnotation) return null;
    emitPrimaryWorkbenchEvent('ax-state-changed', { reviewAnnotation });
    return reviewAnnotation;
  }

  updateReviewAnnotation(
    id: string,
    patch: { body?: string; status?: PmxAxReviewStatus; severity?: PmxAxReviewSeverity; kind?: PmxAxReviewKind },
    options?: { source?: PmxAxSource },
  ): PmxAxReviewAnnotation | null {
    const reviewAnnotation = canvasState.updateReviewAnnotation(id, patch, { source: options?.source ?? 'sdk' });
    if (reviewAnnotation) emitPrimaryWorkbenchEvent('ax-state-changed', { reviewAnnotation });
    return reviewAnnotation;
  }

  getHostCapability(): PmxAxHostCapability | null {
    return canvasState.getHostCapability();
  }

  reportHostCapability(input: unknown, options?: { source?: PmxAxSource }): PmxAxHostCapability {
    const host = canvasState.setHostCapability(input, { source: options?.source ?? 'sdk' });
    emitPrimaryWorkbenchEvent('ax-state-changed', { host });
    return host;
  }

  listElicitations(): PmxAxElicitation[] {
    return canvasState.getElicitations();
  }

  requestElicitation(
    input: { prompt: string; fields?: string[]; nodeIds?: string[] },
    options?: { source?: PmxAxSource },
  ): PmxAxElicitation {
    const elicitation = canvasState.requestElicitation(input, { source: options?.source ?? 'sdk' });
    emitPrimaryWorkbenchEvent('ax-state-changed', { elicitation });
    return elicitation;
  }

  respondElicitation(
    id: string,
    response: Record<string, unknown>,
    options?: { source?: PmxAxSource },
  ): PmxAxElicitation | null {
    const elicitation = canvasState.respondElicitation(id, response, { source: options?.source ?? 'sdk' });
    if (elicitation) emitPrimaryWorkbenchEvent('ax-state-changed', { elicitation });
    return elicitation;
  }

  listModeRequests(): PmxAxModeRequest[] {
    return canvasState.getModeRequests();
  }

  requestMode(
    input: { mode: PmxAxMode; reason?: string | null; nodeIds?: string[] },
    options?: { source?: PmxAxSource },
  ): PmxAxModeRequest {
    const modeRequest = canvasState.requestMode(input, { source: options?.source ?? 'sdk' });
    emitPrimaryWorkbenchEvent('ax-state-changed', { modeRequest });
    return modeRequest;
  }

  resolveModeRequest(
    id: string,
    decision: 'approved' | 'rejected',
    options?: { resolution?: string; source?: PmxAxSource },
  ): PmxAxModeRequest | null {
    const modeRequest = canvasState.resolveModeRequest(id, decision, { ...(options ?? {}), source: options?.source ?? 'sdk' });
    if (modeRequest) emitPrimaryWorkbenchEvent('ax-state-changed', { modeRequest });
    return modeRequest;
  }

  // ── Activity ingestion (primitive A — bidirectional board) ────────
  ingestActivity(
    input: {
      kind: PmxAxActivityKind;
      title: string;
      summary?: string | null;
      outcome?: 'success' | 'failure';
      ref?: string | null;
      nodeIds?: string[];
      data?: Record<string, unknown> | null;
      reactions?: {
        workItem?: false | { status?: PmxAxWorkItemStatus; detail?: string | null };
        evidence?: false | { kind?: PmxAxEvidenceKind; body?: string | null };
        review?: false | { severity?: PmxAxReviewSeverity; kind?: PmxAxReviewKind; anchorType?: PmxAxReviewAnchorType; nodeId?: string | null };
      };
    },
    options?: { source?: PmxAxSource },
  ): { event: PmxAxEvent; workItem: PmxAxWorkItem | null; evidence: PmxAxEvidence | null; review: PmxAxReviewAnnotation | null } {
    const result = canvasState.ingestActivity(input, { source: options?.source ?? 'sdk' });
    emitPrimaryWorkbenchEvent('ax-event-created', { event: result.event });
    if (result.workItem) emitPrimaryWorkbenchEvent('ax-state-changed', { workItem: result.workItem });
    if (result.evidence) emitPrimaryWorkbenchEvent('ax-event-created', { evidence: result.evidence });
    if (result.review) emitPrimaryWorkbenchEvent('ax-state-changed', { reviewAnnotation: result.review });
    return result;
  }

  // ── Single-item readers + blocking waits (primitive D — gates that gate) ──
  getApproval(id: string): PmxAxApprovalGate | null {
    return canvasState.getApproval(id);
  }

  getElicitation(id: string): PmxAxElicitation | null {
    return canvasState.getElicitation(id);
  }

  getModeRequest(id: string): PmxAxModeRequest | null {
    return canvasState.getModeRequest(id);
  }

  async awaitApproval(
    id: string,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<{ approvalGate: PmxAxApprovalGate | null; pending: boolean }> {
    const { value, pending } = await waitForAxResolution<PmxAxApprovalGate>({
      read: () => canvasState.getApproval(id),
      isResolved: (g) => g.status !== 'pending',
      timeoutMs: options?.timeoutMs ?? 30000,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    return { approvalGate: value, pending };
  }

  async awaitElicitation(
    id: string,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<{ elicitation: PmxAxElicitation | null; pending: boolean }> {
    const { value, pending } = await waitForAxResolution<PmxAxElicitation>({
      read: () => canvasState.getElicitation(id),
      isResolved: (e) => e.status !== 'pending',
      timeoutMs: options?.timeoutMs ?? 30000,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    return { elicitation: value, pending };
  }

  async awaitMode(
    id: string,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<{ modeRequest: PmxAxModeRequest | null; pending: boolean }> {
    const { value, pending } = await waitForAxResolution<PmxAxModeRequest>({
      read: () => canvasState.getModeRequest(id),
      isResolved: (m) => m.status !== 'pending',
      timeoutMs: options?.timeoutMs ?? 30000,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    return { modeRequest: value, pending };
  }

  getCommandRegistry(): PmxAxCommandDescriptor[] {
    return canvasState.getCommandRegistry();
  }

  invokeCommand(name: string, args?: Record<string, unknown> | null, options?: { source?: PmxAxSource }): PmxAxEvent | null {
    const event = canvasState.invokeCommand(name, args ?? null, { source: options?.source ?? 'sdk' });
    if (event) emitPrimaryWorkbenchEvent('ax-event-created', { event });
    return event;
  }

  getPolicy(): PmxAxPolicy {
    return canvasState.getPolicy();
  }

  setPolicy(
    patch: { tools?: Partial<PmxAxPolicy['tools']>; prompt?: Partial<PmxAxPolicy['prompt']> },
    options?: { source?: PmxAxSource },
  ): PmxAxPolicy {
    const policy = canvasState.setPolicy(patch, { source: options?.source ?? 'sdk' });
    emitPrimaryWorkbenchEvent('ax-state-changed', { policy });
    return policy;
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

  getNode(id: string): SdkCanvasNode | undefined {
    const node = canvasState.getNode(id);
    return node ? toSdkNode(node) : undefined;
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
    // Undo can reverse an AX mutation (work item, focus, …); nudge AX surfaces to
    // re-fetch so a live board reflects the reversal (debounced client-side).
    emitPrimaryWorkbenchEvent('ax-state-changed', {});
    return { ok: true, description: `Undid: ${entry.description}` };
  }

  async redo(): Promise<{ ok: boolean; description?: string }> {
    const entry = mutationHistory.redo();
    if (!entry) return { ok: false, description: 'Nothing to redo' };
    await syncCanvasRuntimeBackends();
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    emitPrimaryWorkbenchEvent('ax-state-changed', {});
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
    // Delegates to the canvas.batch registry meta-op (plan-008 Wave 2). The op
    // emits the single final canvas-layout-update itself (via the registry
    // emitter, which server.ts wires to emitPrimaryWorkbenchEvent) — do NOT
    // emit again here or the frame would fire twice.
    return await runCanvasBatchOperation(operations);
  }

  async buildWebArtifact(
    input: WebArtifactBuildInput & { openInCanvas?: boolean; includeLogs?: boolean },
  ): Promise<WebArtifactCanvasBuildResult> {
    // The registry's webartifact.build op wraps buildWebArtifactOnCanvas and
    // returns a wire ENVELOPE (path/bytes/…); the SDK's documented return is the
    // full WebArtifactCanvasBuildResult, so the SDK calls the build runtime
    // directly here (the op core is the same buildWebArtifactOnCanvas; the node
    // creation emits its own canvas-layout-update). The op and the SDK share the
    // single build runtime — no behavior divergence.
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
  }): Promise<OpenMcpAppCoreResult> {
    // Delegate to the mcpapp.open registry op (plan-008 Wave 4). The op handler
    // is the relocated legacy body (toolCallId, openExternalMcpApp, prior-session
    // close, ext-app-open + ext-app-result via ctx.emit → the registry emitter
    // wired to emitPrimaryWorkbenchEvent). mutates:false, so the registry adds no
    // canvas-layout-update; the two ext-app-* frames fire exactly once.
    return await executeOperation('mcpapp.open', input) as OpenMcpAppCoreResult;
  }

  async addDiagram(
    input: DiagramPresetOpenInput,
  ): Promise<OpenMcpAppCoreResult> {
    // Delegate to the diagram.open registry op, which builds the Excalidraw
    // OpenMcpApp input and dispatches to the shared open core (one ext-app-* pair).
    return await executeOperation('diagram.open', input) as OpenMcpAppCoreResult;
  }

  addJsonRenderNode(
    input: JsonRenderNodeInput & { intentId?: string },
  ): { id: string; url: string; spec: JsonRenderSpec } {
    return this.runIntentCommit(input.intentId, ['create'], () => {
      const result = createCanvasJsonRenderNode(input);
      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
      return result;
    }, (result) => result.id);
  }

  /**
   * Progressively build a json-render node from SpecStream patches. Omit nodeId
   * to create a new streaming node; pass the same nodeId on later calls to
   * append more patches. The server accumulates the spec and the browser
   * reloads the viewer as the specVersion bumps.
   */
  streamJsonRenderNode(input: {
    intentId?: string;
    nodeId?: string;
    title?: string;
    patches?: unknown[];
    done?: boolean;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    strictSize?: boolean;
  }): {
    id: string;
    url: string;
    applied: number;
    skipped: number;
    specVersion: number;
    elementCount: number;
    streamStatus: 'open' | 'closed';
  } {
    // Thin wrapper over the shared create-or-append core (plan-005). The op
    // handler and this SDK method now share one implementation; the SDK emits
    // the layout update itself (it does not flow through the registry's
    // `mutates` path). `streamJsonRenderCore` throws OperationError (an Error
    // subclass with the same message) on a bad append target. The core's
    // result carries an extra `ok: true`; the SDK's wire shape omits it.
    return this.runIntentCommit(input.intentId, input.nodeId ? ['edit'] : ['create'], () => {
      const result = streamJsonRenderCore(input);
      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
      return {
        id: result.id,
        url: result.url,
        applied: result.applied,
        skipped: result.skipped,
        specVersion: result.specVersion,
        elementCount: result.elementCount,
        streamStatus: result.streamStatus,
      };
    }, (result) => result.id);
  }

  addHtmlNode(input: {
    intentId?: string;
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
    /** Opt this html node into AX interactions (window.PMX_AX.emit). Clamped to
     *  the html capability ceiling server-side; cannot escalate. */
    axCapabilities?: { enabled?: boolean; allowed?: string[] };
  }): SdkCanvasNode {
    return this.runIntentCommit(input.intentId, ['create'], () => {
      const { id } = addCanvasNode({
        type: 'html',
        ...(typeof input.title === 'string' ? { title: input.title } : {}),
        data: {
          html: resolveHtmlContent(input.html),
          ...(typeof input.summary === 'string' ? { summary: input.summary } : {}),
          ...(typeof input.agentSummary === 'string' ? { agentSummary: input.agentSummary } : {}),
          ...(typeof input.description === 'string' ? { description: input.description } : {}),
          ...(input.presentation === true ? { presentation: true } : {}),
          ...(Array.isArray(input.slideTitles) ? { slideTitles: input.slideTitles } : {}),
          ...(Array.isArray(input.embeddedNodeIds) ? { embeddedNodeIds: input.embeddedNodeIds } : {}),
          ...(Array.isArray(input.embeddedUrls) ? { embeddedUrls: input.embeddedUrls } : {}),
          ...(input.axCapabilities ? { axCapabilities: input.axCapabilities } : {}),
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
      const node = canvasState.getNode(id);
      if (!node) throw new Error(`HTML node "${id}" was not created.`);
      return toSdkNode(node);
    }, (node) => node.id);
  }

  addHtmlPrimitive(input: {
    intentId?: string;
    kind: HtmlPrimitiveKind;
    title?: string;
    data?: Record<string, unknown>;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    strictSize?: boolean;
  }): { id: string; kind: HtmlPrimitiveKind; title: string; htmlBytes: number } {
    return this.runIntentCommit(input.intentId, ['create'], () => {
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
    }, (result) => result.id);
  }

  addGraphNode(input: GraphNodeInput & { intentId?: string }): { id: string; url: string; spec: JsonRenderSpec } {
    return this.runIntentCommit(input.intentId, ['create'], () => {
      const result = createCanvasGraphNode(input);
      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
      return result;
    }, (result) => result.id);
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
export type {
  PmxAxApprovalGate,
  PmxAxApprovalStatus,
  PmxAxCommandDescriptor,
  PmxAxContext,
  PmxAxEvent,
  PmxAxElicitation,
  PmxAxElicitationStatus,
  PmxAxEventKind,
  PmxAxEvidence,
  PmxAxEvidenceKind,
  PmxAxFocusState,
  PmxAxHostCapability,
  PmxAxMode,
  PmxAxModeRequest,
  PmxAxModeRequestStatus,
  PmxAxPolicy,
  PmxAxReviewAnchorType,
  PmxAxReviewAnnotation,
  PmxAxReviewKind,
  PmxAxReviewRegion,
  PmxAxReviewSeverity,
  PmxAxReviewStatus,
  PmxAxSource,
  PmxAxState,
  PmxAxSteeringMessage,
  PmxAxTimelineSummary,
  PmxAxWorkItem,
  PmxAxWorkItemStatus,
} from './ax-state.js';
export type { AxTimelineQuery } from './canvas-db.js';
