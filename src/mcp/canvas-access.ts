import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createCanvas,
  canvasState,
  type CanvasEdge,
  type CanvasLayout,
  type CanvasNodeState,
  type PmxCanvas,
} from '../server/index.js';
import type { PmxAxSource } from '../server/ax-state.js';
import {
  HttpOperationInvoker,
  LocalOperationInvoker,
  type OperationInvoker,
} from '../server/operations/index.js';

type RefreshWebpageNodeResult = Awaited<ReturnType<PmxCanvas['refreshWebpageNode']>>;
type OpenMcpAppInput = Parameters<PmxCanvas['openMcpApp']>[0];
type OpenMcpAppResult = Awaited<ReturnType<PmxCanvas['openMcpApp']>>;
type AddDiagramInput = Parameters<PmxCanvas['addDiagram']>[0];
type AddHtmlNodeInput = Parameters<PmxCanvas['addHtmlNode']>[0];
type AddHtmlPrimitiveInput = Parameters<PmxCanvas['addHtmlPrimitive']>[0];
type AddHtmlPrimitiveResult = ReturnType<PmxCanvas['addHtmlPrimitive']>;
type AxStateResult = ReturnType<PmxCanvas['getAxState']>;
type AxContextResult = ReturnType<PmxCanvas['getAxContext']>;
type SubmitAxInteractionInput = Parameters<PmxCanvas['submitAxInteraction']>[0];
type SubmitAxInteractionResult = ReturnType<PmxCanvas['submitAxInteraction']>;
type GetPendingSteeringResult = ReturnType<PmxCanvas['getPendingSteering']>;
type ListElicitationsResult = ReturnType<PmxCanvas['listElicitations']>;
type ListModeRequestsResult = ReturnType<PmxCanvas['listModeRequests']>;
type IngestActivityInput = Parameters<PmxCanvas['ingestActivity']>[0];
type IngestActivityResult = ReturnType<PmxCanvas['ingestActivity']>;
type GetPolicyResult = ReturnType<PmxCanvas['getPolicy']>;
type GetAxTimelineQuery = Parameters<PmxCanvas['getAxTimeline']>[0];
type GetAxTimelineResult = ReturnType<PmxCanvas['getAxTimeline']>;
type ListWorkItemsResult = ReturnType<PmxCanvas['listWorkItems']>;
type ListApprovalGatesResult = ReturnType<PmxCanvas['listApprovalGates']>;
type ListReviewAnnotationsResult = ReturnType<PmxCanvas['listReviewAnnotations']>;
type HistoryResult = ReturnType<PmxCanvas['getHistory']>;
type RunBatchInput = Parameters<PmxCanvas['runBatch']>[0];
type RunBatchResult = Awaited<ReturnType<PmxCanvas['runBatch']>>;
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
  /** Operation-registry invoker (plan-005): local in-process or HTTP, matching the access mode. */
  invoker(): OperationInvoker;
  getLayout(): Promise<CanvasLayout>;
  getNode(id: string): Promise<CanvasNodeState | undefined>;
  refreshWebpageNode(id: string, url?: string): Promise<RefreshWebpageNodeResult>;
  openMcpApp(input: OpenMcpAppInput): Promise<OpenMcpAppResult>;
  addDiagram(input: AddDiagramInput): Promise<OpenMcpAppResult>;
  addHtmlNode(input: AddHtmlNodeInput): Promise<string>;
  addHtmlPrimitive(input: AddHtmlPrimitiveInput): Promise<AddHtmlPrimitiveResult>;
  buildWebArtifact(input: WebArtifactInput): Promise<WebArtifactResult>;
  removeAnnotation(id: string): Promise<boolean>;
  getAxState(): Promise<AxStateResult>;
  getAxContext(options?: { consumer?: string }): Promise<AxContextResult>;
  getAxTimeline(query?: GetAxTimelineQuery): Promise<GetAxTimelineResult>;
  listWorkItems(): Promise<ListWorkItemsResult>;
  listApprovalGates(): Promise<ListApprovalGatesResult>;
  listReviewAnnotations(): Promise<ListReviewAnnotationsResult>;
  submitAxInteraction(input: SubmitAxInteractionInput, options?: { source?: PmxAxSource }): Promise<SubmitAxInteractionResult>;
  getPendingSteering(options?: { consumer?: string; limit?: number }): Promise<GetPendingSteeringResult>;
  listElicitations(): Promise<ListElicitationsResult>;
  listModeRequests(): Promise<ListModeRequestsResult>;
  ingestActivity(input: IngestActivityInput, options?: { source?: PmxAxSource }): Promise<IngestActivityResult>;
  getPolicy(): Promise<GetPolicyResult>;
  getHistory(): Promise<HistoryResult>;
  getPinnedNodeIds(): Promise<string[]>;
  runBatch(operations: RunBatchInput): Promise<RunBatchResult>;
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
  private readonly operationInvoker = new LocalOperationInvoker();

  constructor(
    private readonly canvas: PmxCanvas,
    readonly workspaceRoot: string,
    readonly targetPort: number,
  ) {}

  get port(): number {
    return this.canvas.port;
  }

  invoker(): OperationInvoker {
    return this.operationInvoker;
  }

  async getLayout(): Promise<CanvasLayout> {
    return this.canvas.getLayout();
  }

  async getNode(id: string): Promise<CanvasNodeState | undefined> {
    return this.canvas.getNode(id);
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

  async addHtmlNode(input: AddHtmlNodeInput): Promise<string> {
    // PmxCanvas.addHtmlNode returns the created node; the CanvasAccess contract
    // is a bare id string, so extract it (mirrors addNode above).
    return this.canvas.addHtmlNode(input).id;
  }

  async addHtmlPrimitive(input: AddHtmlPrimitiveInput): Promise<AddHtmlPrimitiveResult> {
    return this.canvas.addHtmlPrimitive(input);
  }

  async buildWebArtifact(input: WebArtifactInput): Promise<WebArtifactResult> {
    return await this.canvas.buildWebArtifact(input);
  }

  async removeAnnotation(id: string): Promise<boolean> {
    return this.canvas.removeAnnotation(id);
  }

  async getAxState(): Promise<AxStateResult> {
    return this.canvas.getAxState();
  }

  async getAxContext(options?: { consumer?: string }): Promise<AxContextResult> {
    return this.canvas.getAxContext(options);
  }

  async getAxTimeline(query?: GetAxTimelineQuery): Promise<GetAxTimelineResult> {
    return this.canvas.getAxTimeline(query);
  }

  async submitAxInteraction(input: SubmitAxInteractionInput, options?: { source?: PmxAxSource }): Promise<SubmitAxInteractionResult> {
    return this.canvas.submitAxInteraction(input, { source: options?.source ?? 'mcp' });
  }

  async getPendingSteering(options?: { consumer?: string; limit?: number }): Promise<GetPendingSteeringResult> {
    return this.canvas.getPendingSteering(options);
  }

  async listElicitations(): Promise<ListElicitationsResult> {
    return this.canvas.listElicitations();
  }

  async listModeRequests(): Promise<ListModeRequestsResult> {
    return this.canvas.listModeRequests();
  }

  async ingestActivity(input: IngestActivityInput, options?: { source?: PmxAxSource }): Promise<IngestActivityResult> {
    return this.canvas.ingestActivity(input, { source: options?.source ?? 'mcp' });
  }

  async getPolicy(): Promise<GetPolicyResult> {
    return this.canvas.getPolicy();
  }

  async listWorkItems(): Promise<ListWorkItemsResult> {
    return this.canvas.listWorkItems();
  }

  async listApprovalGates(): Promise<ListApprovalGatesResult> {
    return this.canvas.listApprovalGates();
  }

  async listReviewAnnotations(): Promise<ListReviewAnnotationsResult> {
    return this.canvas.listReviewAnnotations();
  }

  async getHistory(): Promise<HistoryResult> {
    return this.canvas.getHistory();
  }

  async getPinnedNodeIds(): Promise<string[]> {
    return Array.from(canvasState.contextPinnedNodeIds);
  }

  async runBatch(operations: RunBatchInput): Promise<RunBatchResult> {
    return await this.canvas.runBatch(operations);
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
  private readonly operationInvoker: HttpOperationInvoker;

  constructor(baseUrl: string) {
    this.remoteBaseUrl = baseUrl.replace(/\/$/, '');
    const parsed = new URL(this.remoteBaseUrl);
    this.port = Number(parsed.port || '80');
    this.operationInvoker = new HttpOperationInvoker(this.remoteBaseUrl);
  }

  invoker(): OperationInvoker {
    return this.operationInvoker;
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

  async addHtmlNode(input: AddHtmlNodeInput): Promise<string> {
    const {
      summary,
      agentSummary,
      description,
      presentation,
      slideTitles,
      embeddedNodeIds,
      embeddedUrls,
      axCapabilities,
      ...rest
    } = input as AddHtmlNodeInput & {
      summary?: string;
      agentSummary?: string;
      description?: string;
      presentation?: boolean;
      slideTitles?: string[];
      embeddedNodeIds?: string[];
      embeddedUrls?: string[];
      axCapabilities?: { enabled?: boolean; allowed?: string[] };
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
        ...(axCapabilities ? { axCapabilities } : {}),
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

  async buildWebArtifact(input: WebArtifactInput): Promise<WebArtifactResult> {
    return await this.requestJson<WebArtifactResult>('POST', '/api/canvas/web-artifact', input);
  }

  async removeAnnotation(id: string): Promise<boolean> {
    const response = await this.requestJson<{ ok?: boolean }>('DELETE', `/api/canvas/annotation/${encodeURIComponent(id)}`);
    return response.ok === true;
  }

  async getHistory(): Promise<HistoryResult> {
    return await this.requestJson<HistoryResult>('GET', '/api/canvas/history');
  }

  async getAxState(): Promise<AxStateResult> {
    const response = await this.requestJson<{ state?: AxStateResult }>('GET', '/api/canvas/ax');
    if (!response.state) throw new Error('Remote canvas did not return AX state.');
    return response.state;
  }

  async getAxContext(options?: { consumer?: string }): Promise<AxContextResult> {
    const qs = options?.consumer ? `?consumer=${encodeURIComponent(options.consumer)}` : '';
    return await this.requestJson<AxContextResult>('GET', `/api/canvas/ax/context${qs}`);
  }

  async getAxTimeline(query?: GetAxTimelineQuery): Promise<GetAxTimelineResult> {
    const qs = query?.limit ? `?limit=${query.limit}` : '';
    return await this.requestJson<GetAxTimelineResult>('GET', `/api/canvas/ax/timeline${qs}`);
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

  async listElicitations(): Promise<ListElicitationsResult> {
    const r = await this.requestJson<{ elicitations?: ListElicitationsResult }>('GET', '/api/canvas/ax/elicitation');
    return r.elicitations ?? [];
  }

  async listModeRequests(): Promise<ListModeRequestsResult> {
    const r = await this.requestJson<{ modeRequests?: ListModeRequestsResult }>('GET', '/api/canvas/ax/mode');
    return r.modeRequests ?? [];
  }

  async ingestActivity(input: IngestActivityInput, options?: { source?: PmxAxSource }): Promise<IngestActivityResult> {
    return await this.requestJson<IngestActivityResult>('POST', '/api/canvas/ax/activity', {
      ...input,
      source: options?.source ?? 'mcp',
    });
  }

  async getPolicy(): Promise<GetPolicyResult> {
    const r = await this.requestJson<{ policy?: GetPolicyResult }>('GET', '/api/canvas/ax/policy');
    if (!r.policy) throw new Error('Remote canvas did not return a policy.');
    return r.policy;
  }

  async listWorkItems(): Promise<ListWorkItemsResult> {
    const response = await this.requestJson<{ workItems?: ListWorkItemsResult }>('GET', '/api/canvas/ax/work');
    return response.workItems ?? [];
  }

  async listApprovalGates(): Promise<ListApprovalGatesResult> {
    const response = await this.requestJson<{ approvalGates?: ListApprovalGatesResult }>('GET', '/api/canvas/ax/approval');
    return response.approvalGates ?? [];
  }

  async listReviewAnnotations(): Promise<ListReviewAnnotationsResult> {
    const response = await this.requestJson<{ reviewAnnotations?: ListReviewAnnotationsResult }>('GET', '/api/canvas/ax/review');
    return response.reviewAnnotations ?? [];
  }

  async getPinnedNodeIds(): Promise<string[]> {
    const response = await this.requestJson<{ nodeIds?: string[] }>('GET', '/api/canvas/pinned-context');
    return Array.isArray(response.nodeIds) ? response.nodeIds : [];
  }

  async runBatch(operations: RunBatchInput): Promise<RunBatchResult> {
    return await this.requestJson<RunBatchResult>('POST', '/api/canvas/batch', { operations });
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
