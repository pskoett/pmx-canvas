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

type AddNodeInput = Parameters<PmxCanvas['addNode']>[0];
type AddWebpageNodeInput = Parameters<PmxCanvas['addWebpageNode']>[0];
type RefreshWebpageNodeResult = Awaited<ReturnType<PmxCanvas['refreshWebpageNode']>>;
type OpenMcpAppInput = Parameters<PmxCanvas['openMcpApp']>[0];
type OpenMcpAppResult = Awaited<ReturnType<PmxCanvas['openMcpApp']>>;
type AddDiagramInput = Parameters<PmxCanvas['addDiagram']>[0];
type AddJsonRenderNodeInput = Parameters<PmxCanvas['addJsonRenderNode']>[0];
type AddJsonRenderNodeResult = ReturnType<PmxCanvas['addJsonRenderNode']>;
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
type SearchResult = ReturnType<PmxCanvas['search']>;
type UndoRedoResult = Awaited<ReturnType<PmxCanvas['undo']>>;
type HistoryResult = ReturnType<PmxCanvas['getHistory']>;
type SetContextPinsResult = ReturnType<PmxCanvas['setContextPins']>;
type RunBatchInput = Parameters<PmxCanvas['runBatch']>[0];
type RunBatchResult = Awaited<ReturnType<PmxCanvas['runBatch']>>;
type SnapshotList = ReturnType<PmxCanvas['listSnapshots']>;
type DeleteSnapshotResult = ReturnType<PmxCanvas['deleteSnapshot']>;
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
  addGraphNode(input: AddGraphNodeInput): Promise<AddGraphNodeResult>;
  buildWebArtifact(input: WebArtifactInput): Promise<WebArtifactResult>;
  updateNode(id: string, patch: UpdateNodePatch): Promise<void>;
  removeNode(id: string): Promise<void>;
  addEdge(input: AddEdgeInput): Promise<string>;
  removeEdge(id: string): Promise<void>;
  createGroup(input: CreateGroupInput): Promise<string>;
  groupNodes(groupId: string, childIds: string[], options?: GroupNodesOptions): Promise<boolean>;
  ungroupNodes(groupId: string): Promise<boolean>;
  arrange(layout?: ArrangeLayout): Promise<void>;
  focusNode(id: string, options?: { noPan?: boolean }): Promise<FocusNodeResult>;
  fitView(options?: FitViewOptions): Promise<FitViewResult>;
  clear(): Promise<void>;
  search(query: string): Promise<SearchResult>;
  undo(): Promise<UndoRedoResult>;
  redo(): Promise<UndoRedoResult>;
  getHistory(): Promise<HistoryResult>;
  setContextPins(nodeIds: string[], mode?: 'set' | 'add' | 'remove'): Promise<SetContextPinsResult>;
  getPinnedNodeIds(): Promise<string[]>;
  runBatch(operations: RunBatchInput): Promise<RunBatchResult>;
  listSnapshots(): Promise<SnapshotList>;
  saveSnapshot(name: string): Promise<CanvasSnapshot | null>;
  restoreSnapshot(id: string): Promise<{ ok: boolean }>;
  deleteSnapshot(id: string): Promise<DeleteSnapshotResult>;
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
    return this.canvas.addNode(input);
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

  async listSnapshots(): Promise<SnapshotList> {
    return this.canvas.listSnapshots();
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
    return await this.requestJson<CanvasLayout>('GET', '/api/canvas/state');
  }

  async getNode(id: string): Promise<CanvasNodeState | undefined> {
    const response = await fetch(`${this.remoteBaseUrl}/api/canvas/node/${encodeURIComponent(id)}`);
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

  async listSnapshots(): Promise<SnapshotList> {
    return await this.requestJson<SnapshotList>('GET', '/api/canvas/snapshots');
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

  const canvas = createCanvas({ port });
  await canvas.start({ open: true });
  return new LocalCanvasAccess(canvas, workspaceRoot, port);
}
