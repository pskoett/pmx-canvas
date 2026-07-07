import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import {
  createCanvas,
  canvasState,
  type CanvasEdge,
  type CanvasLayout,
  type CanvasNodeState,
  type PmxCanvas,
} from '../server/index.js';
import type { PmxAxSource } from '../server/ax-state.js';
import { HttpOperationInvoker, LocalOperationInvoker, type OperationInvoker } from '../server/operations/index.js';

// openMcpApp / addDiagram / buildWebArtifact / refreshWebpageNode / addHtmlNode /
// addHtmlPrimitive CanvasAccess methods + their type aliases removed with the
// standalone MCP tools (plan-008 Wave 4; refresh/html tools removed v0.3.0):
// those tools migrated to the operation registry (mcpapp.open / diagram.open /
// webartifact.build) and the composite/registry tools dispatch via the invoker,
// not CanvasAccess. The public SDK PmxCanvas methods are unchanged.
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
// canvas_screenshot (the only webview tool still hand-written) needs the status
// + screenshot accessors; the other four webview methods (start/stop/evaluate/
// resize) migrated to the operation registry (plan-008 Wave 3) and were removed
// from CanvasAccess.
type AutomationWebViewStatus = Awaited<ReturnType<PmxCanvas['getAutomationWebViewStatus']>>;
type AutomationScreenshotOptions = Parameters<PmxCanvas['screenshotAutomationWebView']>[0];

interface HealthResponse {
  ok?: boolean;
  workspace?: string;
}

export interface CanvasAccess {
  readonly port: number;
  readonly remoteBaseUrl: string | null;
  /** Operation-registry invoker (plan-005): local in-process or HTTP, matching the access mode. */
  invoker(): OperationInvoker;
  getLayout(): Promise<CanvasLayout>;
  getNode(id: string): Promise<CanvasNodeState | undefined>;
  getAxState(): Promise<AxStateResult>;
  getAxContext(options?: { consumer?: string }): Promise<AxContextResult>;
  getAxTimeline(query?: GetAxTimelineQuery): Promise<GetAxTimelineResult>;
  listWorkItems(): Promise<ListWorkItemsResult>;
  listApprovalGates(): Promise<ListApprovalGatesResult>;
  listReviewAnnotations(): Promise<ListReviewAnnotationsResult>;
  submitAxInteraction(
    input: SubmitAxInteractionInput,
    options?: { source?: PmxAxSource },
  ): Promise<SubmitAxInteractionResult>;
  getPendingSteering(options?: { consumer?: string; limit?: number }): Promise<GetPendingSteeringResult>;
  listElicitations(): Promise<ListElicitationsResult>;
  listModeRequests(): Promise<ListModeRequestsResult>;
  ingestActivity(input: IngestActivityInput, options?: { source?: PmxAxSource }): Promise<IngestActivityResult>;
  getPolicy(): Promise<GetPolicyResult>;
  getHistory(): Promise<HistoryResult>;
  getPinnedNodeIds(): Promise<string[]>;
  runBatch(operations: RunBatchInput): Promise<RunBatchResult>;
  getCodeGraph(): Promise<CodeGraphResult>;
  // canvas_screenshot (still hand-written — binary payload) is the only webview
  // tool left on CanvasAccess; it needs the status + screenshot accessors.
  getAutomationWebViewStatus(): Promise<AutomationWebViewStatus>;
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

  async getAxState(): Promise<AxStateResult> {
    return this.canvas.getAxState();
  }

  async getAxContext(options?: { consumer?: string }): Promise<AxContextResult> {
    return this.canvas.getAxContext(options);
  }

  async getAxTimeline(query?: GetAxTimelineQuery): Promise<GetAxTimelineResult> {
    return this.canvas.getAxTimeline(query);
  }

  async submitAxInteraction(
    input: SubmitAxInteractionInput,
    options?: { source?: PmxAxSource },
  ): Promise<SubmitAxInteractionResult> {
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

  async getAutomationWebViewStatus(): Promise<AutomationWebViewStatus> {
    return this.canvas.getAutomationWebViewStatus();
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
      const error =
        parsed && typeof parsed === 'object' && 'error' in parsed
          ? String((parsed as { error?: unknown }).error)
          : `HTTP ${response.status}`;
      if (path === '/api/canvas/batch' && parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as T;
      }
      throw new Error(error);
    }
    return parsed as T;
  }

  async getLayout(): Promise<CanvasLayout> {
    return await this.requestJson<CanvasLayout>('GET', '/api/canvas/state?includeBlobs=true');
  }

  async getNode(id: string): Promise<CanvasNodeState | undefined> {
    const response = await fetch(`${this.remoteBaseUrl}/api/canvas/node/${encodeURIComponent(id)}?includeBlobs=true`);
    if (response.status === 404) return undefined;
    const text = await response.text();
    let parsed: unknown;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = { error: text };
      }
    }
    if (!response.ok) {
      const error =
        parsed && typeof parsed === 'object' && 'error' in parsed
          ? String((parsed as { error?: unknown }).error)
          : `HTTP ${response.status}`;
      throw new Error(error);
    }
    return parsed as CanvasNodeState;
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

  async submitAxInteraction(
    input: SubmitAxInteractionInput,
    options?: { source?: PmxAxSource },
  ): Promise<SubmitAxInteractionResult> {
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
    const response = await this.requestJson<{ approvalGates?: ListApprovalGatesResult }>(
      'GET',
      '/api/canvas/ax/approval',
    );
    return response.approvalGates ?? [];
  }

  async listReviewAnnotations(): Promise<ListReviewAnnotationsResult> {
    const response = await this.requestJson<{ reviewAnnotations?: ListReviewAnnotationsResult }>(
      'GET',
      '/api/canvas/ax/review',
    );
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

  async getAutomationWebViewStatus(): Promise<AutomationWebViewStatus> {
    return await this.requestJson<AutomationWebViewStatus>('GET', '/api/workbench/webview');
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
    return (await response.json()) as HealthResponse;
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

/**
 * Finding I (0.2.6): decide whether to ATTACH to the daemon already holding the
 * preferred port instead of spawning a split daemon on a fallback port. True only
 * when the split is not opted in AND the preferred port is held by a healthy canvas
 * daemon that reports a workspace (i.e. a real different-workspace daemon, the
 * "wrong-workspace split" trap — not a free port or a non-canvas occupant). Pure +
 * exported for deterministic testing.
 */
export function shouldAttachToExistingDaemon(
  occupant: { ok?: boolean; workspace?: unknown } | null,
  allowSplit: boolean,
): boolean {
  return (
    !allowSplit && occupant?.ok === true && typeof occupant.workspace === 'string' && occupant.workspace.length > 0
  );
}

/**
 * Finding I (0.2.6, first-binder gap): true when the launch cwd looks like a
 * host/agent config dir rather than a project root — the home dir itself, or a
 * dot-prefixed DIRECT child of home (e.g. `~/.copilot`, `~/.codex`, `~/.claude`,
 * `~/.config`). POSITIVE-signal ONLY — never "absence of project markers", because
 * the MCP/SDK test harness runs from bare `mkdtemp` temp dirs (under `os.tmpdir()`,
 * never under home) that a marker-absence heuristic would misflag. Both sides are
 * canonicalized (realpath) so a symlinked home matches. Pure + exported for tests;
 * FS-safe (defaults to false on any error).
 */
export function looksLikeIncidentalCwd(cwd: string): boolean {
  let home: string;
  try {
    home = canonicalWorkspacePath(homedir());
  } catch {
    return false;
  }
  if (!home || home === '/') return false;
  const canonical = canonicalWorkspacePath(cwd);
  if (canonical === home) return true;
  // A dot-prefixed direct child of home: ~/.copilot, ~/.codex, ~/.claude, ~/.config …
  return dirname(canonical) === home && basename(canonical).startsWith('.');
}

export async function createCanvasAccess(): Promise<CanvasAccess> {
  // PMX_CANVAS_WORKSPACE_ROOT (Finding I escape hatch): an explicit project root the
  // host can pass so the MCP server keys off it instead of an incidental launch cwd
  // (e.g. ~/.copilot). When set, it overrides process.cwd() for the whole acquisition
  // and suppresses the incidental-cwd guard below (the operator stated intent).
  const override = process.env.PMX_CANVAS_WORKSPACE_ROOT?.trim();
  const explicitRoot = Boolean(override);
  const workspaceRoot = explicitRoot ? resolve(override as string) : resolve(process.cwd());
  const port = targetPort();
  const remoteBaseUrl = await findExistingCanvasServer(workspaceRoot, port);
  if (remoteBaseUrl) return new RemoteCanvasAccess(remoteBaseUrl);

  // No SAME-workspace server to attach to. The preferred port may still be held by
  // a healthy canvas daemon serving a DIFFERENT workspace. The old behavior silently
  // started our own canvas on a FALLBACK port adopting this process's launch cwd as
  // the workspace — but the open workbench panel renders the PREFERRED port and never
  // shows that fallback, so MCP writes land on a phantom workspace nobody sees (report
  // Finding I, the "wrong-workspace daemon split"; the launch cwd is often incidental,
  // e.g. the host spawns `--mcp` from ~/.copilot). Default to the safer behavior:
  // ATTACH to the existing preferred-port daemon (inherit its workspace) so writes are
  // visible where the human is looking. Opt back into a separate canvas with
  // PMX_CANVAS_ALLOW_WORKSPACE_SPLIT=1 or by pinning a distinct PMX_CANVAS_PORT.
  // An explicit PMX_CANVAS_WORKSPACE_ROOT is an operator statement of intent and WINS:
  // skip the heuristic attach so the pinned root is honored (it binds its own daemon —
  // on a fallback port if the preferred port is foreign-held) rather than silently
  // inheriting the foreign daemon's workspace. So the pin is genuinely deterministic.
  const occupantBaseUrl = `http://127.0.0.1:${port}`;
  const allowSplit = process.env.PMX_CANVAS_ALLOW_WORKSPACE_SPLIT === '1';
  if (!explicitRoot) {
    const occupant = await readHealth(occupantBaseUrl);
    if (occupant && shouldAttachToExistingDaemon(occupant, allowSplit)) {
      // stderr only — stdout is the MCP stdio JSON-RPC channel.
      process.stderr.write(
        `[pmx-canvas] port ${port} is serving a different workspace (${occupant.workspace}); this ` +
          `MCP server launched from ${workspaceRoot}. Attaching to that canvas so writes are visible ` +
          `in the open workbench instead of splitting to a hidden fallback port. For a SEPARATE canvas, ` +
          `set PMX_CANVAS_PORT to a free port or PMX_CANVAS_ALLOW_WORKSPACE_SPLIT=1.\n`,
      );
      return new RemoteCanvasAccess(occupantBaseUrl);
    }
  }

  // First-binder gap (Finding I): the attach branch above only fires when the
  // preferred port is HELD. If it is FREE (or a non-canvas occupant) AND this process
  // launched from an incidental host/agent config dir (e.g. ~/.copilot), binding the
  // preferred port here would adopt that incidental cwd as the workspace — a canvas the
  // human's project panel would never render. Don't silently do that.
  if (!allowSplit && !explicitRoot && looksLikeIncidentalCwd(workspaceRoot)) {
    // Race-tolerant: a real daemon may have appeared on the preferred port since the
    // first probe. Attach to ANY healthy canvas now there (inherit its workspace)
    // rather than inventing a phantom workspace under the incidental launch dir.
    const racedOccupant = await readHealth(occupantBaseUrl);
    if (racedOccupant?.ok === true) {
      process.stderr.write(
        `[pmx-canvas] launch cwd ${workspaceRoot} looks like a host config dir; attaching to the ` +
          `canvas now on port ${port}.\n`,
      );
      return new RemoteCanvasAccess(occupantBaseUrl);
    }
    // Still free: bind it anyway (the agent always gets a working canvas) but warn
    // loudly so a wrong-workspace canvas is diagnosed, not silent. stderr only.
    process.stderr.write(
      `[pmx-canvas] launch cwd ${workspaceRoot} looks like a host/agent config dir, not a project ` +
        `root. This canvas will persist under it and may not be visible in a workbench opened for ` +
        `your project. Set PMX_CANVAS_WORKSPACE_ROOT=/abs/project to target it, PMX_CANVAS_URL to ` +
        `attach to a running daemon, or PMX_CANVAS_ALLOW_WORKSPACE_SPLIT=1 / PMX_CANVAS_PORT=<free ` +
        `port> for a deliberate separate canvas.\n`,
    );
  }

  // Either the split is opted in, the root is explicit, the cwd is a real project, or
  // the preferred port is genuinely free / not a canvas daemon. Allow a port fallback
  // so a non-canvas occupant doesn't crash this session with EADDRINUSE — start our
  // own canvas and explain how to share one.
  const canvas = createCanvas({ port });
  await canvas.start({ open: true, allowPortFallback: true });
  const boundPort = canvas.port;
  if (boundPort !== port) {
    const occupant = await readHealth(occupantBaseUrl);
    const occupantWorkspace = typeof occupant?.workspace === 'string' ? ` (serving ${occupant.workspace})` : '';
    process.stderr.write(
      `[pmx-canvas] preferred port ${port} was in use${occupantWorkspace}; ` +
        `started this canvas on port ${boundPort} instead. To share one canvas, run the daemon ` +
        `from this workspace or set PMX_CANVAS_URL / PMX_CANVAS_PORT to point at it.\n`,
    );
  }
  return new LocalCanvasAccess(canvas, workspaceRoot, port);
}
