import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createCanvas,
  canvasState,
  type CanvasEdge,
  type CanvasLayout,
  type CanvasNodeState,
  type CanvasSnapshot,
  type PmxCanvas,
} from '../server/index.js';
import type { PmxAxSource } from '../server/ax-state.js';

type AddNodeInput = Parameters<PmxCanvas['addNode']>[0];
type AddWebpageNodeInput = Parameters<PmxCanvas['addWebpageNode']>[0];
type RefreshWebpageNodeResult = Awaited<ReturnType<PmxCanvas['refreshWebpageNode']>>;
type OpenMcpAppInput = Parameters<PmxCanvas['openMcpApp']>[0];
type OpenMcpAppResult = Awaited<ReturnType<PmxCanvas['openMcpApp']>>;
type AddDiagramInput = Parameters<PmxCanvas['addDiagram']>[0];
type AddJsonRenderNodeInput = Parameters<PmxCanvas['addJsonRenderNode']>[0];
type AddJsonRenderNodeResult = ReturnType<PmxCanvas['addJsonRenderNode']>;
type StreamJsonRenderNodeInput = Parameters<PmxCanvas['streamJsonRenderNode']>[0];
type StreamJsonRenderNodeResult = ReturnType<PmxCanvas['streamJsonRenderNode']>;
type AddHtmlNodeInput = Parameters<PmxCanvas['addHtmlNode']>[0];
type AddHtmlPrimitiveInput = Parameters<PmxCanvas['addHtmlPrimitive']>[0];
type AddHtmlPrimitiveResult = ReturnType<PmxCanvas['addHtmlPrimitive']>;
type AddGraphNodeInput = Parameters<PmxCanvas['addGraphNode']>[0];
type AddGraphNodeResult = ReturnType<PmxCanvas['addGraphNode']>;
type UpdateNodePatch = Parameters<PmxCanvas['updateNode']>[1];
type AddEdgeInput = Parameters<PmxCanvas['addEdge']>[0];
type CreateGroupInput = Parameters<PmxCanvas['createGroup']>[0];
type GroupNodesOptions = Parameters<PmxCanvas['groupNodes']>[2];
type ArrangeLayout = Parameters<PmxCanvas['arrange']>[0];
type FocusNodeResult = ReturnType<PmxCanvas['focusNode']>;
type FitViewOptions = Parameters<PmxCanvas['fitView']>[0];
type FitViewResult = ReturnType<PmxCanvas['fitView']>;
type AxStateResult = ReturnType<PmxCanvas['getAxState']>;
type AxContextResult = ReturnType<PmxCanvas['getAxContext']>;
type SetAxFocusResult = ReturnType<PmxCanvas['setAxFocus']>;
type RecordAxEventInput = Parameters<PmxCanvas['recordAxEvent']>[0];
type RecordAxEventResult = ReturnType<PmxCanvas['recordAxEvent']>;
type SendSteeringResult = ReturnType<PmxCanvas['sendSteering']>;
type SubmitAxInteractionInput = Parameters<PmxCanvas['submitAxInteraction']>[0];
type SubmitAxInteractionResult = ReturnType<PmxCanvas['submitAxInteraction']>;
type GetPendingSteeringResult = ReturnType<PmxCanvas['getPendingSteering']>;
type ListElicitationsResult = ReturnType<PmxCanvas['listElicitations']>;
type RequestElicitationInput = Parameters<PmxCanvas['requestElicitation']>[0];
type RequestElicitationResult = ReturnType<PmxCanvas['requestElicitation']>;
type RespondElicitationResult = ReturnType<PmxCanvas['respondElicitation']>;
type ListModeRequestsResult = ReturnType<PmxCanvas['listModeRequests']>;
type RequestModeInput = Parameters<PmxCanvas['requestMode']>[0];
type RequestModeResult = ReturnType<PmxCanvas['requestMode']>;
type ResolveModeRequestResult = ReturnType<PmxCanvas['resolveModeRequest']>;
type GetAxTimelineQuery = Parameters<PmxCanvas['getAxTimeline']>[0];
type GetAxTimelineResult = ReturnType<PmxCanvas['getAxTimeline']>;
type AddWorkItemInput = Parameters<PmxCanvas['addWorkItem']>[0];
type AddWorkItemResult = ReturnType<PmxCanvas['addWorkItem']>;
type UpdateWorkItemPatch = Parameters<PmxCanvas['updateWorkItem']>[1];
type UpdateWorkItemResult = ReturnType<PmxCanvas['updateWorkItem']>;
type ListWorkItemsResult = ReturnType<PmxCanvas['listWorkItems']>;
type RequestApprovalInput = Parameters<PmxCanvas['requestApproval']>[0];
type RequestApprovalResult = ReturnType<PmxCanvas['requestApproval']>;
type ResolveApprovalResult = ReturnType<PmxCanvas['resolveApproval']>;
type ListApprovalGatesResult = ReturnType<PmxCanvas['listApprovalGates']>;
type AddEvidenceInput = Parameters<PmxCanvas['addEvidence']>[0];
type AddEvidenceResult = ReturnType<PmxCanvas['addEvidence']>;
type AddReviewAnnotationInput = Parameters<PmxCanvas['addReviewAnnotation']>[0];
type AddReviewAnnotationResult = ReturnType<PmxCanvas['addReviewAnnotation']>;
type UpdateReviewAnnotationPatch = Parameters<PmxCanvas['updateReviewAnnotation']>[1];
type UpdateReviewAnnotationResult = ReturnType<PmxCanvas['updateReviewAnnotation']>;
type ListReviewAnnotationsResult = ReturnType<PmxCanvas['listReviewAnnotations']>;
type GetHostCapabilityResult = ReturnType<PmxCanvas['getHostCapability']>;
type ReportHostCapabilityResult = ReturnType<PmxCanvas['reportHostCapability']>;
type SearchResult = ReturnType<PmxCanvas['search']>;
type UndoRedoResult = Awaited<ReturnType<PmxCanvas['undo']>>;
type HistoryResult = ReturnType<PmxCanvas['getHistory']>;
type SetContextPinsResult = ReturnType<PmxCanvas['setContextPins']>;
type RunBatchInput = Parameters<PmxCanvas['runBatch']>[0];
type RunBatchResult = Awaited<ReturnType<PmxCanvas['runBatch']>>;
type SnapshotListOptions = Parameters<PmxCanvas['listSnapshots']>[0];
type SnapshotList = ReturnType<PmxCanvas['listSnapshots']>;
type DeleteSnapshotResult = ReturnType<PmxCanvas['deleteSnapshot']>;
type GcSnapshotsOptions = Parameters<PmxCanvas['gcSnapshots']>[0];
type GcSnapshotsResult = ReturnType<PmxCanvas['gcSnapshots']>;
type DiffSnapshotResult = ReturnType<PmxCanvas['diffSnapshot']>;
type CodeGraphResult = ReturnType<PmxCanvas['getCodeGraph']>;
type ValidationResult = ReturnType<PmxCanvas['validate']>;
type WebArtifactInput = Parameters<PmxCanvas['buildWebArtifact']>[0];
type WebArtifactResult = Awaited<ReturnType<PmxCanvas['buildWebArtifact']>>;
type AutomationWebViewOptions = Parameters<PmxCanvas['startAutomationWebView']>[0];
type AutomationWebViewStatus = Awaited<ReturnType<PmxCanvas['startAutomationWebView']>>;
type AutomationEvaluateResult = Awaited<ReturnType<PmxCanvas['evaluateAutomationWebView']>>;
type AutomationScreenshotOptions = Parameters<PmxCanvas['screenshotAutomationWebView']>[0];

interface HealthResponse {
  ok?: boolean;
  workspace?: string;
}

interface NodeResponse {
  id?: string;
  node?: { id?: string };
}

interface JsonRenderNodeResponse extends NodeResponse {
  url: string;
  spec: AddJsonRenderNodeResult['spec'];
}

interface GraphNodeResponse extends NodeResponse {
  url: string;
  spec: AddGraphNodeResult['spec'];
}

interface SearchResponse {
  results?: SearchResult;
}

interface SnapshotSaveResponse {
  snapshot?: CanvasSnapshot;
}

interface WebViewEnvelope {
  webview?: AutomationWebViewStatus;
}

interface WebViewStopEnvelope extends WebViewEnvelope {
  stopped?: boolean;
}

interface WebViewEvaluateEnvelope {
  value?: AutomationEvaluateResult;
}

export interface CanvasAccess {
  readonly port: number;
  readonly remoteBaseUrl: string | null;
  getLayout(): Promise<CanvasLayout>;
  getNode(id: string): Promise<CanvasNodeState | undefined>;
  addNode(input: AddNodeInput): Promise<string>;
  addWebpageNode(input: AddWebpageNodeInput): Promise<Awaited<ReturnType<PmxCanvas['addWebpageNode']>>>;
  refreshWebpageNode(id: string, url?: string): Promise<RefreshWebpageNodeResult>;
  openMcpApp(input: OpenMcpAppInput): Promise<OpenMcpAppResult>;
  addDiagram(input: AddDiagramInput): Promise<OpenMcpAppResult>;
  addJsonRenderNode(input: AddJsonRenderNodeInput): Promise<AddJsonRenderNodeResult>;
  streamJsonRenderNode(input: StreamJsonRenderNodeInput): Promise<StreamJsonRenderNodeResult>;
  addHtmlNode(input: AddHtmlNodeInput): Promise<string>;
  addHtmlPrimitive(input: AddHtmlPrimitiveInput): Promise<AddHtmlPrimitiveResult>;
  addGraphNode(input: AddGraphNodeInput): Promise<AddGraphNodeResult>;
  buildWebArtifact(input: WebArtifactInput): Promise<WebArtifactResult>;
  updateNode(id: string, patch: UpdateNodePatch): Promise<void>;
  removeNode(id: string): Promise<void>;
  removeAnnotation(id: string): Promise<boolean>;
  addEdge(input: AddEdgeInput): Promise<string>;
  removeEdge(id: string): Promise<void>;
  createGroup(input: CreateGroupInput): Promise<string>;
  groupNodes(groupId: string, childIds: string[], options?: GroupNodesOptions): Promise<boolean>;
  ungroupNodes(groupId: string): Promise<boolean>;
  arrange(layout?: ArrangeLayout): Promise<void>;
  focusNode(id: string, options?: { noPan?: boolean }): Promise<FocusNodeResult>;
  fitView(options?: FitViewOptions): Promise<FitViewResult>;
  getAxState(): Promise<AxStateResult>;
  getAxContext(): Promise<AxContextResult>;
  setAxFocus(nodeIds: string[], options?: { source?: PmxAxSource }): Promise<SetAxFocusResult>;
  recordAxEvent(input: RecordAxEventInput, options?: { source?: PmxAxSource }): Promise<RecordAxEventResult>;
  sendSteering(message: string, options?: { source?: PmxAxSource }): Promise<SendSteeringResult>;
  getAxTimeline(query?: GetAxTimelineQuery): Promise<GetAxTimelineResult>;
  addWorkItem(input: AddWorkItemInput, options?: { source?: PmxAxSource }): Promise<AddWorkItemResult>;
  updateWorkItem(id: string, patch: UpdateWorkItemPatch, options?: { source?: PmxAxSource }): Promise<UpdateWorkItemResult>;
  listWorkItems(): Promise<ListWorkItemsResult>;
  requestApproval(input: RequestApprovalInput, options?: { source?: PmxAxSource }): Promise<RequestApprovalResult>;
  resolveApproval(id: string, decision: 'approved' | 'rejected', options?: { resolution?: string; source?: PmxAxSource }): Promise<ResolveApprovalResult>;
  listApprovalGates(): Promise<ListApprovalGatesResult>;
  addEvidence(input: AddEvidenceInput, options?: { source?: PmxAxSource }): Promise<AddEvidenceResult>;
  addReviewAnnotation(input: AddReviewAnnotationInput, options?: { source?: PmxAxSource }): Promise<AddReviewAnnotationResult>;
  updateReviewAnnotation(id: string, patch: UpdateReviewAnnotationPatch, options?: { source?: PmxAxSource }): Promise<UpdateReviewAnnotationResult>;
  listReviewAnnotations(): Promise<ListReviewAnnotationsResult>;
  getHostCapability(): Promise<GetHostCapabilityResult>;
  reportHostCapability(input: unknown, options?: { source?: PmxAxSource }): Promise<ReportHostCapabilityResult>;
  submitAxInteraction(input: SubmitAxInteractionInput, options?: { source?: PmxAxSource }): Promise<SubmitAxInteractionResult>;
  getPendingSteering(options?: { consumer?: string; limit?: number }): Promise<GetPendingSteeringResult>;
  markSteeringDelivered(id: string): Promise<boolean>;
  listElicitations(): Promise<ListElicitationsResult>;
  requestElicitation(input: RequestElicitationInput, options?: { source?: PmxAxSource }): Promise<RequestElicitationResult>;
  respondElicitation(id: string, response: Record<string, unknown>, options?: { source?: PmxAxSource }): Promise<RespondElicitationResult>;
  listModeRequests(): Promise<ListModeRequestsResult>;
  requestMode(input: RequestModeInput, options?: { source?: PmxAxSource }): Promise<RequestModeResult>;
  resolveModeRequest(id: string, decision: 'approved' | 'rejected', options?: { resolution?: string; source?: PmxAxSource }): Promise<ResolveModeRequestResult>;
  clear(): Promise<void>;
  search(query: string): Promise<SearchResult>;
  undo(): Promise<UndoRedoResult>;
  redo(): Promise<UndoRedoResult>;
  getHistory(): Promise<HistoryResult>;
  setContextPins(nodeIds: string[], mode?: 'set' | 'add' | 'remove'): Promise<SetContextPinsResult>;
  getPinnedNodeIds(): Promise<string[]>;
  runBatch(operations: RunBatchInput): Promise<RunBatchResult>;
  listSnapshots(options?: SnapshotListOptions): Promise<SnapshotList>;
  saveSnapshot(name: string): Promise<CanvasSnapshot | null>;
  restoreSnapshot(id: string): Promise<{ ok: boolean }>;
  deleteSnapshot(id: string): Promise<DeleteSnapshotResult>;
  gcSnapshots(options?: GcSnapshotsOptions): Promise<GcSnapshotsResult>;
  diffSnapshot(idOrName: string): Promise<DiffSnapshotResult>;
  getCodeGraph(): Promise<CodeGraphResult>;
  validate(): Promise<ValidationResult>;
  getAutomationWebViewStatus(): Promise<AutomationWebViewStatus>;
  startAutomationWebView(options?: AutomationWebViewOptions): Promise<AutomationWebViewStatus>;
  stopAutomationWebView(): Promise<boolean>;
  evaluateAutomationWebView(expression: string): Promise<AutomationEvaluateResult>;
  resizeAutomationWebView(width: number, height: number): Promise<AutomationWebViewStatus>;
  screenshotAutomationWebView(options?: AutomationScreenshotOptions): Promise<Uint8Array>;
}

class LocalCanvasAccess implements CanvasAccess {
  readonly remoteBaseUrl = null;

  constructor(
    private readonly canvas: PmxCanvas,
    readonly workspaceRoot: string,
    readonly targetPort: number,
  ) {}

  get port(): number {
    return this.canvas.port;
  }

  async getLayout(): Promise<CanvasLayout> {
    return this.canvas.getLayout();
  }

  async getNode(id: string): Promise<CanvasNodeState | undefined> {
    return this.canvas.getNode(id);
  }

  async addNode(input: AddNodeInput): Promise<string> {
    // PmxCanvas.addNode returns the created node; the CanvasAccess contract
    // (shared with the remote proxy + MCP) stays id-only.
    return this.canvas.addNode(input).id;
  }

  async addWebpageNode(input: AddWebpageNodeInput): Promise<Awaited<ReturnType<PmxCanvas['addWebpageNode']>>> {
    return await this.canvas.addWebpageNode(input);
  }

  async refreshWebpageNode(id: string, url?: string): Promise<RefreshWebpageNodeResult> {
    return await this.canvas.refreshWebpageNode(id, url);
  }

  async openMcpApp(input: OpenMcpAppInput): Promise<OpenMcpAppResult> {
    return await this.canvas.openMcpApp(input);
  }

  async addDiagram(input: AddDiagramInput): Promise<OpenMcpAppResult> {
    return await this.canvas.addDiagram(input);
  }

  async addJsonRenderNode(input: AddJsonRenderNodeInput): Promise<AddJsonRenderNodeResult> {
    return this.canvas.addJsonRenderNode(input);
  }

  async streamJsonRenderNode(input: StreamJsonRenderNodeInput): Promise<StreamJsonRenderNodeResult> {
    return this.canvas.streamJsonRenderNode(input);
  }

  async addHtmlNode(input: AddHtmlNodeInput): Promise<string> {
    return this.canvas.addHtmlNode(input);
  }

  async addHtmlPrimitive(input: AddHtmlPrimitiveInput): Promise<AddHtmlPrimitiveResult> {
    return this.canvas.addHtmlPrimitive(input);
  }

  async addGraphNode(input: AddGraphNodeInput): Promise<AddGraphNodeResult> {
    return this.canvas.addGraphNode(input);
  }

  async buildWebArtifact(input: WebArtifactInput): Promise<WebArtifactResult> {
    return await this.canvas.buildWebArtifact(input);
  }

  async updateNode(id: string, patch: UpdateNodePatch): Promise<void> {
    this.canvas.updateNode(id, patch);
  }

  async removeNode(id: string): Promise<void> {
    this.canvas.removeNode(id);
  }

  async removeAnnotation(id: string): Promise<boolean> {
    return this.canvas.removeAnnotation(id);
  }

  async addEdge(input: AddEdgeInput): Promise<string> {
    return this.canvas.addEdge(input);
  }

  async removeEdge(id: string): Promise<void> {
    this.canvas.removeEdge(id);
  }

  async createGroup(input: CreateGroupInput): Promise<string> {
    return this.canvas.createGroup(input);
  }

  async groupNodes(groupId: string, childIds: string[], options?: GroupNodesOptions): Promise<boolean> {
    return this.canvas.groupNodes(groupId, childIds, options);
  }

  async ungroupNodes(groupId: string): Promise<boolean> {
    return this.canvas.ungroupNodes(groupId);
  }

  async arrange(layout?: ArrangeLayout): Promise<void> {
    this.canvas.arrange(layout);
  }

  async focusNode(id: string, options?: { noPan?: boolean }): Promise<FocusNodeResult> {
    return this.canvas.focusNode(id, options);
  }

  async fitView(options?: FitViewOptions): Promise<FitViewResult> {
    return this.canvas.fitView(options);
  }

  async getAxState(): Promise<AxStateResult> {
    return this.canvas.getAxState();
  }

  async getAxContext(): Promise<AxContextResult> {
    return this.canvas.getAxContext();
  }

  async setAxFocus(nodeIds: string[], options?: { source?: PmxAxSource }): Promise<SetAxFocusResult> {
    return this.canvas.setAxFocus(nodeIds, { source: options?.source ?? 'mcp' });
  }

  async recordAxEvent(input: RecordAxEventInput, options?: { source?: PmxAxSource }): Promise<RecordAxEventResult> {
    return this.canvas.recordAxEvent(input, { source: options?.source ?? 'mcp' });
  }

  async sendSteering(message: string, options?: { source?: PmxAxSource }): Promise<SendSteeringResult> {
    return this.canvas.sendSteering(message, { source: options?.source ?? 'mcp' });
  }

  async getAxTimeline(query?: GetAxTimelineQuery): Promise<GetAxTimelineResult> {
    return this.canvas.getAxTimeline(query);
  }

  async addWorkItem(input: AddWorkItemInput, options?: { source?: PmxAxSource }): Promise<AddWorkItemResult> {
    return this.canvas.addWorkItem(input, { source: options?.source ?? 'mcp' });
  }

  async submitAxInteraction(input: SubmitAxInteractionInput, options?: { source?: PmxAxSource }): Promise<SubmitAxInteractionResult> {
    return this.canvas.submitAxInteraction(input, { source: options?.source ?? 'mcp' });
  }

  async getPendingSteering(options?: { consumer?: string; limit?: number }): Promise<GetPendingSteeringResult> {
    return this.canvas.getPendingSteering(options);
  }

  async markSteeringDelivered(id: string): Promise<boolean> {
    return this.canvas.markSteeringDelivered(id);
  }

  async listElicitations(): Promise<ListElicitationsResult> {
    return this.canvas.listElicitations();
  }

  async requestElicitation(input: RequestElicitationInput, options?: { source?: PmxAxSource }): Promise<RequestElicitationResult> {
    return this.canvas.requestElicitation(input, { source: options?.source ?? 'mcp' });
  }

  async respondElicitation(id: string, response: Record<string, unknown>, options?: { source?: PmxAxSource }): Promise<RespondElicitationResult> {
    return this.canvas.respondElicitation(id, response, { source: options?.source ?? 'mcp' });
  }

  async listModeRequests(): Promise<ListModeRequestsResult> {
    return this.canvas.listModeRequests();
  }

  async requestMode(input: RequestModeInput, options?: { source?: PmxAxSource }): Promise<RequestModeResult> {
    return this.canvas.requestMode(input, { source: options?.source ?? 'mcp' });
  }

  async resolveModeRequest(id: string, decision: 'approved' | 'rejected', options?: { resolution?: string; source?: PmxAxSource }): Promise<ResolveModeRequestResult> {
    return this.canvas.resolveModeRequest(id, decision, { ...(options ?? {}), source: options?.source ?? 'mcp' });
  }

  async updateWorkItem(id: string, patch: UpdateWorkItemPatch, options?: { source?: PmxAxSource }): Promise<UpdateWorkItemResult> {
    return this.canvas.updateWorkItem(id, patch, { source: options?.source ?? 'mcp' });
  }

  async listWorkItems(): Promise<ListWorkItemsResult> {
    return this.canvas.listWorkItems();
  }

  async requestApproval(input: RequestApprovalInput, options?: { source?: PmxAxSource }): Promise<RequestApprovalResult> {
    return this.canvas.requestApproval(input, { source: options?.source ?? 'mcp' });
  }

  async resolveApproval(id: string, decision: 'approved' | 'rejected', options?: { resolution?: string; source?: PmxAxSource }): Promise<ResolveApprovalResult> {
    return this.canvas.resolveApproval(id, decision, {
      ...(options?.resolution !== undefined ? { resolution: options.resolution } : {}),
      source: options?.source ?? 'mcp',
    });
  }

  async listApprovalGates(): Promise<ListApprovalGatesResult> {
    return this.canvas.listApprovalGates();
  }

  async addEvidence(input: AddEvidenceInput, options?: { source?: PmxAxSource }): Promise<AddEvidenceResult> {
    return this.canvas.addEvidence(input, { source: options?.source ?? 'mcp' });
  }

  async addReviewAnnotation(input: AddReviewAnnotationInput, options?: { source?: PmxAxSource }): Promise<AddReviewAnnotationResult> {
    return this.canvas.addReviewAnnotation(input, { source: options?.source ?? 'mcp' });
  }

  async updateReviewAnnotation(id: string, patch: UpdateReviewAnnotationPatch, options?: { source?: PmxAxSource }): Promise<UpdateReviewAnnotationResult> {
    return this.canvas.updateReviewAnnotation(id, patch, { source: options?.source ?? 'mcp' });
  }

  async listReviewAnnotations(): Promise<ListReviewAnnotationsResult> {
    return this.canvas.listReviewAnnotations();
  }

  async getHostCapability(): Promise<GetHostCapabilityResult> {
    return this.canvas.getHostCapability();
  }

  async reportHostCapability(input: unknown, options?: { source?: PmxAxSource }): Promise<ReportHostCapabilityResult> {
    return this.canvas.reportHostCapability(input, { source: options?.source ?? 'mcp' });
  }

  async clear(): Promise<void> {
    this.canvas.clear();
  }

  async search(query: string): Promise<SearchResult> {
    return this.canvas.search(query);
  }

  async undo(): Promise<UndoRedoResult> {
    return await this.canvas.undo();
  }

  async redo(): Promise<UndoRedoResult> {
    return await this.canvas.redo();
  }

  async getHistory(): Promise<HistoryResult> {
    return this.canvas.getHistory();
  }

  async setContextPins(nodeIds: string[], mode: 'set' | 'add' | 'remove' = 'set'): Promise<SetContextPinsResult> {
    return this.canvas.setContextPins(nodeIds, mode);
  }

  async getPinnedNodeIds(): Promise<string[]> {
    return Array.from(canvasState.contextPinnedNodeIds);
  }

  async runBatch(operations: RunBatchInput): Promise<RunBatchResult> {
    return await this.canvas.runBatch(operations);
  }

  async listSnapshots(options?: SnapshotListOptions): Promise<SnapshotList> {
    return this.canvas.listSnapshots(options);
  }

  async saveSnapshot(name: string): Promise<CanvasSnapshot | null> {
    return this.canvas.saveSnapshot(name);
  }

  async restoreSnapshot(id: string): Promise<{ ok: boolean }> {
    return await this.canvas.restoreSnapshot(id);
  }

  async deleteSnapshot(id: string): Promise<DeleteSnapshotResult> {
    return this.canvas.deleteSnapshot(id);
  }

  async gcSnapshots(options?: GcSnapshotsOptions): Promise<GcSnapshotsResult> {
    return this.canvas.gcSnapshots(options);
  }

  async diffSnapshot(idOrName: string): Promise<DiffSnapshotResult> {
    return this.canvas.diffSnapshot(idOrName);
  }

  async getCodeGraph(): Promise<CodeGraphResult> {
    return this.canvas.getCodeGraph();
  }

  async validate(): Promise<ValidationResult> {
    return this.canvas.validate();
  }

  async getAutomationWebViewStatus(): Promise<AutomationWebViewStatus> {
    return this.canvas.getAutomationWebViewStatus();
  }

  async startAutomationWebView(options: AutomationWebViewOptions = {}): Promise<AutomationWebViewStatus> {
    return await this.canvas.startAutomationWebView(options);
  }

  async stopAutomationWebView(): Promise<boolean> {
    return await this.canvas.stopAutomationWebView();
  }

  async evaluateAutomationWebView(expression: string): Promise<AutomationEvaluateResult> {
    return await this.canvas.evaluateAutomationWebView(expression);
  }

  async resizeAutomationWebView(width: number, height: number): Promise<AutomationWebViewStatus> {
    return await this.canvas.resizeAutomationWebView(width, height);
  }

  async screenshotAutomationWebView(options: AutomationScreenshotOptions = {}): Promise<Uint8Array> {
    return await this.canvas.screenshotAutomationWebView(options);
  }
}

class RemoteCanvasAccess implements CanvasAccess {
  readonly remoteBaseUrl: string;
  readonly port: number;

  constructor(baseUrl: string) {
    this.remoteBaseUrl = baseUrl.replace(/\/$/, '');
    const parsed = new URL(this.remoteBaseUrl);
    this.port = Number(parsed.port || '80');
  }

  private async requestJson<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.remoteBaseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: unknown = {};
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = { error: text };
      }
    }
    if (!response.ok) {
      const error = parsed && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as { error?: unknown }).error)
        : `HTTP ${response.status}`;
      if (path === '/api/canvas/batch' && parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as T;
      }
      throw new Error(error);
    }
    return parsed as T;
  }

  private async requestNodeId(method: string, path: string, body?: unknown): Promise<string> {
    const response = await this.requestJson<NodeResponse>(method, path, body);
    const id = typeof response.id === 'string'
      ? response.id
      : typeof response.node?.id === 'string'
        ? response.node.id
        : '';
    if (!id) throw new Error('Canvas response did not include a node id.');
    return id;
  }

  async getLayout(): Promise<CanvasLayout> {
    return await this.requestJson<CanvasLayout>('GET', '/api/canvas/state?includeBlobs=true');
  }

  async getNode(id: string): Promise<CanvasNodeState | undefined> {
    const response = await fetch(`${this.remoteBaseUrl}/api/canvas/node/${encodeURIComponent(id)}?includeBlobs=true`);
    if (response.status === 404) return undefined;
    const text = await response.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = { error: text };
      }
    }
    if (!response.ok) {
      const error = parsed && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as { error?: unknown }).error)
        : `HTTP ${response.status}`;
      throw new Error(error);
    }
    return parsed as CanvasNodeState;
  }

  async addNode(input: AddNodeInput): Promise<string> {
    return await this.requestNodeId('POST', '/api/canvas/node', input);
  }

  async addWebpageNode(input: AddWebpageNodeInput): Promise<Awaited<ReturnType<PmxCanvas['addWebpageNode']>>> {
    return await this.requestJson<Awaited<ReturnType<PmxCanvas['addWebpageNode']>>>('POST', '/api/canvas/node', {
      type: 'webpage',
      ...input,
    });
  }

  async refreshWebpageNode(id: string, url?: string): Promise<RefreshWebpageNodeResult> {
    return await this.requestJson<RefreshWebpageNodeResult>('POST', `/api/canvas/node/${encodeURIComponent(id)}/refresh`, {
      ...(url ? { url } : {}),
    });
  }

  async openMcpApp(input: OpenMcpAppInput): Promise<OpenMcpAppResult> {
    return await this.requestJson<OpenMcpAppResult>('POST', '/api/canvas/mcp-app/open', input);
  }

  async addDiagram(input: AddDiagramInput): Promise<OpenMcpAppResult> {
    return await this.requestJson<OpenMcpAppResult>('POST', '/api/canvas/diagram', input);
  }

  async addJsonRenderNode(input: AddJsonRenderNodeInput): Promise<AddJsonRenderNodeResult> {
    const response = await this.requestJson<JsonRenderNodeResponse>('POST', '/api/canvas/json-render', input);
    const id = typeof response.id === 'string' ? response.id : response.node?.id;
    if (!id) throw new Error('json-render response did not include a node id.');
    return { id, url: response.url, spec: response.spec };
  }

  async streamJsonRenderNode(input: StreamJsonRenderNodeInput): Promise<StreamJsonRenderNodeResult> {
    const response = await this.requestJson<{
      id?: string;
      url?: string;
      applied?: number;
      skipped?: number;
      specVersion?: number;
      elementCount?: number;
      streamStatus?: 'open' | 'closed';
    }>('POST', '/api/canvas/json-render/stream', input);
    const id = typeof response.id === 'string' ? response.id : undefined;
    if (!id) throw new Error('json-render stream response did not include a node id.');
    return {
      id,
      url: response.url ?? '',
      applied: response.applied ?? 0,
      skipped: response.skipped ?? 0,
      specVersion: response.specVersion ?? 0,
      elementCount: response.elementCount ?? 0,
      streamStatus: response.streamStatus ?? 'open',
    };
  }

  async addHtmlNode(input: AddHtmlNodeInput): Promise<string> {
    const {
      summary,
      agentSummary,
      description,
      presentation,
      slideTitles,
      embeddedNodeIds,
      embeddedUrls,
      ...rest
    } = input as AddHtmlNodeInput & {
      summary?: string;
      agentSummary?: string;
      description?: string;
      presentation?: boolean;
      slideTitles?: string[];
      embeddedNodeIds?: string[];
      embeddedUrls?: string[];
    };
    return await this.requestNodeId('POST', '/api/canvas/node', {
      type: 'html',
      ...rest,
      data: {
        ...(typeof summary === 'string' ? { summary } : {}),
        ...(typeof agentSummary === 'string' ? { agentSummary } : {}),
        ...(typeof description === 'string' ? { description } : {}),
        ...(presentation === true ? { presentation: true } : {}),
        ...(Array.isArray(slideTitles) ? { slideTitles } : {}),
        ...(Array.isArray(embeddedNodeIds) ? { embeddedNodeIds } : {}),
        ...(Array.isArray(embeddedUrls) ? { embeddedUrls } : {}),
      },
    });
  }

  async addHtmlPrimitive(input: AddHtmlPrimitiveInput): Promise<AddHtmlPrimitiveResult> {
    const response = await this.requestJson<{
      id?: string;
      node?: { id?: string };
      primitive?: { kind?: string; title?: string; htmlBytes?: number };
    }>('POST', '/api/canvas/node', { type: 'html', ...input, primitive: input.kind });
    const id = typeof response.id === 'string' ? response.id : response.node?.id;
    if (!id) throw new Error('html primitive response did not include a node id.');
    return {
      id,
      kind: input.kind,
      title: response.primitive?.title ?? input.title ?? input.kind,
      htmlBytes: response.primitive?.htmlBytes ?? 0,
    };
  }

  async addGraphNode(input: AddGraphNodeInput): Promise<AddGraphNodeResult> {
    const response = await this.requestJson<GraphNodeResponse>('POST', '/api/canvas/graph', {
      ...input,
      ...(typeof input.heightPx === 'number' ? { nodeHeight: input.heightPx } : {}),
    });
    const id = typeof response.id === 'string' ? response.id : response.node?.id;
    if (!id) throw new Error('graph response did not include a node id.');
    return { id, url: response.url, spec: response.spec };
  }

  async buildWebArtifact(input: WebArtifactInput): Promise<WebArtifactResult> {
    return await this.requestJson<WebArtifactResult>('POST', '/api/canvas/web-artifact', input);
  }

  async updateNode(id: string, patch: UpdateNodePatch): Promise<void> {
    await this.requestJson<unknown>('PATCH', `/api/canvas/node/${encodeURIComponent(id)}`, patch);
  }

  async removeNode(id: string): Promise<void> {
    await this.requestJson<unknown>('DELETE', `/api/canvas/node/${encodeURIComponent(id)}`);
  }

  async removeAnnotation(id: string): Promise<boolean> {
    const response = await this.requestJson<{ ok?: boolean }>('DELETE', `/api/canvas/annotation/${encodeURIComponent(id)}`);
    return response.ok === true;
  }

  async addEdge(input: AddEdgeInput): Promise<string> {
    const response = await this.requestJson<{ id?: string }>('POST', '/api/canvas/edge', input);
    if (!response.id) throw new Error('Canvas edge response did not include an edge id.');
    return response.id;
  }

  async removeEdge(id: string): Promise<void> {
    await this.requestJson<unknown>('DELETE', '/api/canvas/edge', { edge_id: id });
  }

  async createGroup(input: CreateGroupInput): Promise<string> {
    return await this.requestNodeId('POST', '/api/canvas/group', input);
  }

  async groupNodes(groupId: string, childIds: string[], options?: GroupNodesOptions): Promise<boolean> {
    const response = await this.requestJson<{ ok?: boolean }>('POST', '/api/canvas/group/add', {
      groupId,
      childIds,
      ...(options?.childLayout ? { childLayout: options.childLayout } : {}),
    });
    return response.ok === true;
  }

  async ungroupNodes(groupId: string): Promise<boolean> {
    const response = await this.requestJson<{ ok?: boolean }>('POST', '/api/canvas/group/ungroup', { groupId });
    return response.ok === true;
  }

  async arrange(layout?: ArrangeLayout): Promise<void> {
    await this.requestJson<unknown>('POST', '/api/canvas/arrange', { ...(layout ? { layout } : {}) });
  }

  async focusNode(id: string, options?: { noPan?: boolean }): Promise<FocusNodeResult> {
    const response = await fetch(`${this.remoteBaseUrl}/api/canvas/focus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...(options?.noPan === true ? { noPan: true } : {}) }),
    });
    if (response.status === 404) return null;
    const parsed = await response.json() as { focused?: string; panned?: boolean };
    if (!response.ok || typeof parsed.focused !== 'string' || typeof parsed.panned !== 'boolean') return null;
    return { focused: parsed.focused, panned: parsed.panned };
  }

  async fitView(options?: FitViewOptions): Promise<FitViewResult> {
    return await this.requestJson<FitViewResult>('POST', '/api/canvas/fit', options ?? {});
  }

  async clear(): Promise<void> {
    await this.requestJson<unknown>('POST', '/api/canvas/clear', {});
  }

  async search(query: string): Promise<SearchResult> {
    const response = await this.requestJson<SearchResponse>('GET', `/api/canvas/search?q=${encodeURIComponent(query)}`);
    return response.results ?? [];
  }

  async undo(): Promise<UndoRedoResult> {
    return await this.requestJson<UndoRedoResult>('POST', '/api/canvas/undo', {});
  }

  async redo(): Promise<UndoRedoResult> {
    return await this.requestJson<UndoRedoResult>('POST', '/api/canvas/redo', {});
  }

  async getHistory(): Promise<HistoryResult> {
    return await this.requestJson<HistoryResult>('GET', '/api/canvas/history');
  }

  async getAxState(): Promise<AxStateResult> {
    const response = await this.requestJson<{ state?: AxStateResult }>('GET', '/api/canvas/ax');
    if (!response.state) throw new Error('Remote canvas did not return AX state.');
    return response.state;
  }

  async getAxContext(): Promise<AxContextResult> {
    return await this.requestJson<AxContextResult>('GET', '/api/canvas/ax/context');
  }

  async setAxFocus(nodeIds: string[], options?: { source?: PmxAxSource }): Promise<SetAxFocusResult> {
    const response = await this.requestJson<{ focus?: SetAxFocusResult }>('POST', '/api/canvas/ax/focus', {
      nodeIds,
      source: options?.source ?? 'mcp',
    });
    if (!response.focus) throw new Error('Remote canvas did not return AX focus.');
    return response.focus;
  }

  async recordAxEvent(input: RecordAxEventInput, options?: { source?: PmxAxSource }): Promise<RecordAxEventResult> {
    const response = await this.requestJson<{ event?: RecordAxEventResult }>('POST', '/api/canvas/ax/event', {
      ...input,
      source: options?.source ?? 'mcp',
    });
    if (!response.event) throw new Error('Remote canvas did not return an AX event.');
    return response.event;
  }

  async sendSteering(message: string, options?: { source?: PmxAxSource }): Promise<SendSteeringResult> {
    const response = await this.requestJson<{ steering?: SendSteeringResult }>('POST', '/api/canvas/ax/steer', {
      message,
      source: options?.source ?? 'mcp',
    });
    if (!response.steering) throw new Error('Remote canvas did not return a steering message.');
    return response.steering;
  }

  async getAxTimeline(query?: GetAxTimelineQuery): Promise<GetAxTimelineResult> {
    const qs = query?.limit ? `?limit=${query.limit}` : '';
    return await this.requestJson<GetAxTimelineResult>('GET', `/api/canvas/ax/timeline${qs}`);
  }

  async addWorkItem(input: AddWorkItemInput, options?: { source?: PmxAxSource }): Promise<AddWorkItemResult> {
    const response = await this.requestJson<{ workItem?: AddWorkItemResult }>('POST', '/api/canvas/ax/work', {
      ...input,
      source: options?.source ?? 'mcp',
    });
    if (!response.workItem) throw new Error('Remote canvas did not return a work item.');
    return response.workItem;
  }

  async submitAxInteraction(input: SubmitAxInteractionInput, options?: { source?: PmxAxSource }): Promise<SubmitAxInteractionResult> {
    // The interaction endpoint returns its structured outcome (ok/code/error) in
    // the body for both accepted and rejected interactions, so read the body
    // regardless of HTTP status rather than throwing on a denial.
    const response = await fetch(`${this.remoteBaseUrl}/api/canvas/ax/interaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, source: options?.source ?? 'mcp' }),
    });
    const body = await response.json().catch(() => null);
    if (body && typeof body === 'object') return body as SubmitAxInteractionResult;
    throw new Error(`Remote canvas interaction failed with HTTP ${response.status}`);
  }

  async getPendingSteering(options?: { consumer?: string; limit?: number }): Promise<GetPendingSteeringResult> {
    const params = new URLSearchParams();
    if (options?.consumer) params.set('consumer', options.consumer);
    if (options?.limit) params.set('limit', String(options.limit));
    const qs = params.toString();
    const response = await this.requestJson<{ pending?: GetPendingSteeringResult }>(
      'GET',
      `/api/canvas/ax/delivery/pending${qs ? `?${qs}` : ''}`,
    );
    return response.pending ?? [];
  }

  async markSteeringDelivered(id: string): Promise<boolean> {
    const response = await this.requestJson<{ delivered?: boolean }>(
      'POST',
      `/api/canvas/ax/delivery/${encodeURIComponent(id)}/mark`,
      {},
    );
    return response.delivered ?? false;
  }

  async listElicitations(): Promise<ListElicitationsResult> {
    const r = await this.requestJson<{ elicitations?: ListElicitationsResult }>('GET', '/api/canvas/ax/elicitation');
    return r.elicitations ?? [];
  }

  async requestElicitation(input: RequestElicitationInput, options?: { source?: PmxAxSource }): Promise<RequestElicitationResult> {
    const r = await this.requestJson<{ elicitation?: RequestElicitationResult }>('POST', '/api/canvas/ax/elicitation', {
      ...input,
      source: options?.source ?? 'mcp',
    });
    if (!r.elicitation) throw new Error('Remote canvas did not return an elicitation.');
    return r.elicitation;
  }

  async respondElicitation(id: string, response: Record<string, unknown>, options?: { source?: PmxAxSource }): Promise<RespondElicitationResult> {
    const res = await fetch(`${this.remoteBaseUrl}/api/canvas/ax/elicitation/${encodeURIComponent(id)}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response, source: options?.source ?? 'mcp' }),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json() as { elicitation?: RespondElicitationResult }).elicitation ?? null;
  }

  async listModeRequests(): Promise<ListModeRequestsResult> {
    const r = await this.requestJson<{ modeRequests?: ListModeRequestsResult }>('GET', '/api/canvas/ax/mode');
    return r.modeRequests ?? [];
  }

  async requestMode(input: RequestModeInput, options?: { source?: PmxAxSource }): Promise<RequestModeResult> {
    const r = await this.requestJson<{ modeRequest?: RequestModeResult }>('POST', '/api/canvas/ax/mode', {
      ...input,
      source: options?.source ?? 'mcp',
    });
    if (!r.modeRequest) throw new Error('Remote canvas did not return a mode request.');
    return r.modeRequest;
  }

  async resolveModeRequest(id: string, decision: 'approved' | 'rejected', options?: { resolution?: string; source?: PmxAxSource }): Promise<ResolveModeRequestResult> {
    const res = await fetch(`${this.remoteBaseUrl}/api/canvas/ax/mode/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, ...(options?.resolution ? { resolution: options.resolution } : {}), source: options?.source ?? 'mcp' }),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json() as { modeRequest?: ResolveModeRequestResult }).modeRequest ?? null;
  }

  async updateWorkItem(id: string, patch: UpdateWorkItemPatch, options?: { source?: PmxAxSource }): Promise<UpdateWorkItemResult> {
    const response = await fetch(`${this.remoteBaseUrl}/api/canvas/ax/work/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, source: options?.source ?? 'mcp' }),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json() as { workItem?: AddWorkItemResult }).workItem ?? null;
  }

  async listWorkItems(): Promise<ListWorkItemsResult> {
    const response = await this.requestJson<{ workItems?: ListWorkItemsResult }>('GET', '/api/canvas/ax/work');
    return response.workItems ?? [];
  }

  async requestApproval(input: RequestApprovalInput, options?: { source?: PmxAxSource }): Promise<RequestApprovalResult> {
    const response = await this.requestJson<{ approvalGate?: RequestApprovalResult }>('POST', '/api/canvas/ax/approval', {
      ...input,
      source: options?.source ?? 'mcp',
    });
    if (!response.approvalGate) throw new Error('Remote canvas did not return an approval gate.');
    return response.approvalGate;
  }

  async resolveApproval(id: string, decision: 'approved' | 'rejected', options?: { resolution?: string; source?: PmxAxSource }): Promise<ResolveApprovalResult> {
    const response = await fetch(`${this.remoteBaseUrl}/api/canvas/ax/approval/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision,
        ...(options?.resolution !== undefined ? { resolution: options.resolution } : {}),
        source: options?.source ?? 'mcp',
      }),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json() as { approvalGate?: RequestApprovalResult }).approvalGate ?? null;
  }

  async listApprovalGates(): Promise<ListApprovalGatesResult> {
    const response = await this.requestJson<{ approvalGates?: ListApprovalGatesResult }>('GET', '/api/canvas/ax/approval');
    return response.approvalGates ?? [];
  }

  async addEvidence(input: AddEvidenceInput, options?: { source?: PmxAxSource }): Promise<AddEvidenceResult> {
    const response = await this.requestJson<{ evidence?: AddEvidenceResult }>('POST', '/api/canvas/ax/evidence', {
      ...input,
      source: options?.source ?? 'mcp',
    });
    if (!response.evidence) throw new Error('Remote canvas did not return an evidence item.');
    return response.evidence;
  }

  async addReviewAnnotation(input: AddReviewAnnotationInput, options?: { source?: PmxAxSource }): Promise<AddReviewAnnotationResult> {
    const response = await fetch(`${this.remoteBaseUrl}/api/canvas/ax/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, source: options?.source ?? 'mcp' }),
    });
    // 400 = validation rejection (e.g. node-anchored review with an unknown
    // nodeId); mirror the local path and return null rather than throwing.
    if (response.status === 400) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json() as { reviewAnnotation?: AddReviewAnnotationResult }).reviewAnnotation ?? null;
  }

  async updateReviewAnnotation(id: string, patch: UpdateReviewAnnotationPatch, options?: { source?: PmxAxSource }): Promise<UpdateReviewAnnotationResult> {
    const response = await fetch(`${this.remoteBaseUrl}/api/canvas/ax/review/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, source: options?.source ?? 'mcp' }),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json() as { reviewAnnotation?: AddReviewAnnotationResult }).reviewAnnotation ?? null;
  }

  async listReviewAnnotations(): Promise<ListReviewAnnotationsResult> {
    const response = await this.requestJson<{ reviewAnnotations?: ListReviewAnnotationsResult }>('GET', '/api/canvas/ax/review');
    return response.reviewAnnotations ?? [];
  }

  async getHostCapability(): Promise<GetHostCapabilityResult> {
    const response = await this.requestJson<{ host?: GetHostCapabilityResult }>('GET', '/api/canvas/ax/host-capability');
    return response.host ?? null;
  }

  async reportHostCapability(input: unknown, options?: { source?: PmxAxSource }): Promise<ReportHostCapabilityResult> {
    const body = input !== null && typeof input === 'object' && !Array.isArray(input) ? { ...input } : {};
    const response = await this.requestJson<{ host?: ReportHostCapabilityResult }>('PUT', '/api/canvas/ax/host-capability', {
      ...body,
      source: options?.source ?? 'mcp',
    });
    if (!response.host) throw new Error('Remote canvas did not return host capability.');
    return response.host;
  }

  async setContextPins(nodeIds: string[], mode: 'set' | 'add' | 'remove' = 'set'): Promise<SetContextPinsResult> {
    const existing = mode === 'set' ? [] : await this.getPinnedNodeIds();
    const requested = new Set(nodeIds);
    const next = mode === 'set'
      ? nodeIds
      : mode === 'add'
        ? [...new Set([...existing, ...nodeIds])]
        : existing.filter((id) => !requested.has(id));
    const response = await this.requestJson<{ count?: number }>('POST', '/api/canvas/context-pins', { nodeIds: next });
    return { count: response.count ?? next.length, nodeIds: next };
  }

  async getPinnedNodeIds(): Promise<string[]> {
    const response = await this.requestJson<{ nodeIds?: string[] }>('GET', '/api/canvas/pinned-context');
    return Array.isArray(response.nodeIds) ? response.nodeIds : [];
  }

  async runBatch(operations: RunBatchInput): Promise<RunBatchResult> {
    return await this.requestJson<RunBatchResult>('POST', '/api/canvas/batch', { operations });
  }

  async listSnapshots(options?: SnapshotListOptions): Promise<SnapshotList> {
    const params = new URLSearchParams();
    if (typeof options?.limit === 'number') params.set('limit', String(options.limit));
    if (options?.query) params.set('q', options.query);
    if (options?.before) params.set('before', options.before);
    if (options?.after) params.set('after', options.after);
    if (options?.all) params.set('all', 'true');
    const query = params.size > 0 ? `?${params.toString()}` : '';
    return await this.requestJson<SnapshotList>('GET', `/api/canvas/snapshots${query}`);
  }

  async saveSnapshot(name: string): Promise<CanvasSnapshot | null> {
    const response = await this.requestJson<SnapshotSaveResponse>('POST', '/api/canvas/snapshots', { name });
    return response.snapshot ?? null;
  }

  async restoreSnapshot(id: string): Promise<{ ok: boolean }> {
    return await this.requestJson<{ ok: boolean }>('POST', `/api/canvas/snapshots/${encodeURIComponent(id)}`, {});
  }

  async deleteSnapshot(id: string): Promise<DeleteSnapshotResult> {
    return await this.requestJson<DeleteSnapshotResult>('DELETE', `/api/canvas/snapshots/${encodeURIComponent(id)}`);
  }

  async gcSnapshots(options?: GcSnapshotsOptions): Promise<GcSnapshotsResult> {
    return await this.requestJson<GcSnapshotsResult>('POST', '/api/canvas/snapshots/gc', options ?? {});
  }

  async diffSnapshot(idOrName: string): Promise<DiffSnapshotResult> {
    return await this.requestJson<DiffSnapshotResult>('GET', `/api/canvas/snapshots/${encodeURIComponent(idOrName)}/diff`);
  }

  async getCodeGraph(): Promise<CodeGraphResult> {
    const summary = await this.requestJson<CodeGraphResult['summary']>('GET', '/api/canvas/code-graph');
    return { text: JSON.stringify(summary, null, 2), summary };
  }

  async validate(): Promise<ValidationResult> {
    return await this.requestJson<ValidationResult>('GET', '/api/canvas/validate');
  }

  async getAutomationWebViewStatus(): Promise<AutomationWebViewStatus> {
    return await this.requestJson<AutomationWebViewStatus>('GET', '/api/workbench/webview');
  }

  async startAutomationWebView(options: AutomationWebViewOptions = {}): Promise<AutomationWebViewStatus> {
    const response = await this.requestJson<WebViewEnvelope>('POST', '/api/workbench/webview/start', options);
    if (!response.webview) throw new Error('WebView start response did not include status.');
    return response.webview;
  }

  async stopAutomationWebView(): Promise<boolean> {
    const response = await this.requestJson<WebViewStopEnvelope>('DELETE', '/api/workbench/webview');
    return response.stopped === true;
  }

  async evaluateAutomationWebView(expression: string): Promise<AutomationEvaluateResult> {
    const response = await this.requestJson<WebViewEvaluateEnvelope>('POST', '/api/workbench/webview/evaluate', { expression });
    return response.value as AutomationEvaluateResult;
  }

  async resizeAutomationWebView(width: number, height: number): Promise<AutomationWebViewStatus> {
    const response = await this.requestJson<WebViewEnvelope>('POST', '/api/workbench/webview/resize', { width, height });
    if (!response.webview) throw new Error('WebView resize response did not include status.');
    return response.webview;
  }

  async screenshotAutomationWebView(options: AutomationScreenshotOptions = {}): Promise<Uint8Array> {
    const response = await fetch(`${this.remoteBaseUrl}/api/workbench/webview/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}

function targetPort(): number {
  const raw = process.env.PMX_CANVAS_PORT ?? process.env.PMX_WEB_CANVAS_PORT ?? '4313';
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 4313;
}

function canonicalWorkspacePath(pathLike: string): string {
  const resolved = resolve(pathLike);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function candidateBaseUrls(port: number): string[] {
  const urls: string[] = [];
  const push = (value: string | undefined) => {
    const trimmed = value?.trim().replace(/\/$/, '');
    if (trimmed && !urls.includes(trimmed)) urls.push(trimmed);
  };
  push(process.env.PMX_CANVAS_URL);
  push(`http://127.0.0.1:${port}`);
  push(`http://localhost:${port}`);
  return urls;
}

function localBaseUrls(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

async function readHealth(baseUrl: string): Promise<HealthResponse | null> {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(400) });
    if (!response.ok) return null;
    return await response.json() as HealthResponse;
  } catch {
    return null;
  }
}

async function findExistingCanvasServer(
  workspaceRoot: string,
  port: number,
  options: { excludeBaseUrls?: string[] } = {},
): Promise<string | null> {
  const canonicalWorkspaceRoot = canonicalWorkspacePath(workspaceRoot);
  const excluded = new Set((options.excludeBaseUrls ?? []).map((baseUrl) => baseUrl.replace(/\/$/, '')));
  for (const baseUrl of candidateBaseUrls(port)) {
    if (excluded.has(baseUrl)) continue;
    const health = await readHealth(baseUrl);
    if (health?.ok !== true) continue;
    const healthWorkspace = typeof health.workspace === 'string' ? canonicalWorkspacePath(health.workspace) : '';
    if (healthWorkspace && healthWorkspace !== canonicalWorkspaceRoot) continue;
    return baseUrl;
  }
  return null;
}

export async function refreshCanvasAccess(access: CanvasAccess): Promise<CanvasAccess> {
  if (!(access instanceof LocalCanvasAccess)) return access;
  const remoteBaseUrl = await findExistingCanvasServer(access.workspaceRoot, access.targetPort, {
    excludeBaseUrls: localBaseUrls(access.port),
  });
  return remoteBaseUrl ? new RemoteCanvasAccess(remoteBaseUrl) : access;
}

export async function createCanvasAccess(): Promise<CanvasAccess> {
  const workspaceRoot = resolve(process.cwd());
  const port = targetPort();
  const remoteBaseUrl = await findExistingCanvasServer(workspaceRoot, port);
  if (remoteBaseUrl) return new RemoteCanvasAccess(remoteBaseUrl);

  // No same-workspace server to attach to. Allow a port fallback so a daemon
  // already holding the preferred port (e.g. one serving a *different*
  // workspace) doesn't crash this MCP/SDK session with EADDRINUSE — start our
  // own canvas on a free port instead, and explain how to share one if intended.
  const canvas = createCanvas({ port });
  await canvas.start({ open: true, allowPortFallback: true });
  const boundPort = canvas.port;
  if (boundPort !== port) {
    const occupant = await readHealth(`http://127.0.0.1:${port}`);
    const occupantWorkspace =
      typeof occupant?.workspace === 'string' ? ` (serving ${occupant.workspace})` : '';
    // stderr only — stdout is the MCP stdio JSON-RPC channel.
    process.stderr.write(
      `[pmx-canvas] preferred port ${port} was in use${occupantWorkspace}; ` +
        `started this canvas on port ${boundPort} instead. To share one canvas, run the daemon ` +
        `from this workspace or set PMX_CANVAS_URL / PMX_CANVAS_PORT to point at it.\n`,
    );
  }
  return new LocalCanvasAccess(canvas, workspaceRoot, port);
}
