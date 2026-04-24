/**
 * Standalone canvas server — extracted from PMX web-canvas/server.ts.
 *
 * Provides:
 * - GET  /workbench              -> canvas SPA HTML
 * - GET  /api/file?path=...      -> read markdown content
 * - POST /api/file/save          -> persist markdown edits
 * - POST /api/render             -> server-side markdown render (marked)
 * - GET  /api/canvas/state       -> canvas layout
 * - POST /api/canvas/update      -> batch node updates
 * - POST /api/canvas/edge        -> add edge
 * - DELETE /api/canvas/edge      -> remove edge
 * - POST /api/canvas/prompt      -> canvas prompt
 * - POST /api/canvas/context-pins -> update context pins
 * - GET  /api/canvas/pinned-context -> get pinned context preamble
 * - GET  /api/canvas/spatial-context -> spatial analysis (clusters, reading order, neighborhoods)
 * - GET  /api/canvas/search?q=...  -> full-text search across nodes
 * - GET  /api/canvas/code-graph   -> auto-detected file dependency graph
 * - POST /api/canvas/undo         -> undo last mutation
 * - POST /api/canvas/redo         -> redo last undone mutation
 * - GET  /api/canvas/history      -> mutation history timeline
 * - POST /api/canvas/json-render  -> create a native json-render node
 * - POST /api/canvas/graph        -> create a native graph node
 * - GET  /api/canvas/json-render/view?nodeId=... -> local json-render viewer
 * - POST /api/canvas/web-artifact -> build bundled HTML artifact + optional canvas node
 * - GET  /api/workbench/events   -> SSE event stream
 * - GET  /api/workbench/state    -> workbench state snapshot
 * - POST /api/workbench/intent   -> workbench intents
 * - GET  /api/workbench/webview  -> Bun.WebView automation status
 * - POST /api/workbench/webview/start -> start Bun.WebView automation session
 * - POST /api/workbench/webview/evaluate -> evaluate JS in Bun.WebView automation session
 * - POST /api/workbench/webview/resize -> resize Bun.WebView automation viewport
 * - POST /api/workbench/webview/screenshot -> capture Bun.WebView automation screenshot
 * - DELETE /api/workbench/webview -> stop Bun.WebView automation session
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import * as marked from 'marked';
import type {
  ListPromptsResult,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';
import { type CanvasEdge, type CanvasNodeState, IMAGE_MIME_MAP, canvasState } from './canvas-state.js';
import { normalizeExtAppToolResult } from './ext-app-tool-result.js';
import { getMcpAppHostSnapshot } from './mcp-app-host.js';
import {
  callMcpAppTool,
  closeMcpAppSession,
  closeAllMcpAppSessions,
  listMcpAppPrompts,
  listMcpAppResources,
  listMcpAppResourceTemplates,
  listMcpAppTools,
  openMcpApp,
  readMcpAppResource,
  type ExternalMcpTransportConfig,
} from './mcp-app-runtime.js';
import { findOpenCanvasPosition, computeGroupBounds } from './placement.js';
import { searchNodes, buildSpatialContext } from './spatial-analysis.js';
import { diffLayouts, formatDiff, mutationHistory } from './mutation-history.js';
import { buildCanvasSummary, serializeCanvasLayout, serializeCanvasNode } from './canvas-serialization.js';
import { buildCodeGraphSummary, formatCodeGraph } from './code-graph.js';
import { buildAgentContextPreamble, serializeNodeForAgentContext } from './agent-context.js';
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
  primeCanvasRuntimeBackends,
  syncCanvasRuntimeBackends,
  setCanvasContextPins,
  ungroupCanvasNodes,
  validateCanvasNodePatch,
} from './canvas-operations.js';
import { validateCanvasLayout } from './canvas-validation.js';
import { describeCanvasSchema, validateStructuredCanvasPayload } from './canvas-schema.js';
import { buildExcalidrawOpenMcpAppInput } from './diagram-presets.js';
import { traceManager } from './trace-manager.js';
import { buildWebArtifactOnCanvas, resolveWorkspacePath } from './web-artifacts.js';
import {
  buildGraphSpec,
  buildJsonRenderViewerHtml,
  createJsonRenderNodeData,
  GRAPH_NODE_SIZE,
  JSON_RENDER_NODE_SIZE,
  normalizeAndValidateJsonRenderSpec,
} from '../json-render/server.js';
import {
  WEBPAGE_NODE_DEFAULT_SIZE,
  normalizeWebpageUrl,
} from './webpage-node.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4313;

let server: ReturnType<typeof Bun.serve> | null = null;
let activeWorkspaceRoot = resolve(process.cwd());
let primaryWorkbenchPath: string | null = null;
let primaryWorkbenchSessionId = `pmx-${Date.now().toString(36)}`;
let nextWorkbenchEventId = 1;
let nextWorkbenchSubscriberId = 1;
const workbenchSubscribers = new Map<number, ReadableStreamDefaultController<Uint8Array>>();
const textEncoder = new TextEncoder();
let primaryWorkbenchAutoOpenEnabled = true;
const canvasThemeSetting = (['dark', 'light', 'high-contrast'].includes(process.env.PMX_CANVAS_THEME ?? '')
  ? process.env.PMX_CANVAS_THEME!
  : 'dark');
let lastWorkbenchContextCardsEnvelope: Record<string, unknown> | null = null;

export interface PrimaryWorkbenchEventPayload {
  [key: string]: unknown;
}

type CanvasWebViewBackend =
  | 'webkit'
  | 'chrome'
  | {
      type: 'chrome';
      url?: false;
      path?: string;
      argv?: string[];
      stdout?: 'inherit' | 'ignore';
      stderr?: 'inherit' | 'ignore';
    }
  | {
      type: 'chrome';
      url: string;
    }
  | {
      type: 'webkit';
      stdout?: 'inherit' | 'ignore';
      stderr?: 'inherit' | 'ignore';
    };

interface CanvasWebViewLike extends EventTarget {
  readonly url?: string;
  readonly title?: string;
  readonly loading?: boolean;
  navigate(url: string): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  screenshot(options?: Record<string, unknown>): Promise<Uint8Array | ArrayBuffer | Blob>;
  resize(width: number, height: number): Promise<void>;
  close(): void | Promise<void>;
}

interface CanvasWebViewConstructor {
  new (options?: {
    width?: number;
    height?: number;
    headless?: boolean;
    backend?: CanvasWebViewBackend;
    url?: string;
    dataStore?: 'ephemeral' | { directory: string };
  }): CanvasWebViewLike;
}

interface BunWithOptionalWebView {
  WebView?: CanvasWebViewConstructor;
}

const DEFAULT_CANVAS_AUTOMATION_WEBVIEW_TIMEOUT_MS = 5000;

export interface CanvasAutomationWebViewOptions {
  backend?: 'webkit' | 'chrome';
  width?: number;
  height?: number;
  chromePath?: string;
  chromeArgv?: string[];
  dataStoreDir?: string;
}

export interface CanvasAutomationWebViewStatus {
  supported: boolean;
  active: boolean;
  headlessOnly: true;
  url: string | null;
  backend: 'webkit' | 'chrome' | null;
  width: number | null;
  height: number | null;
  dataStoreDir: string | null;
  startedAt: string | null;
  lastError: string | null;
}

let canvasAutomationWebView: CanvasWebViewLike | null = null;
let canvasAutomationWebViewStatus: Omit<CanvasAutomationWebViewStatus, 'supported' | 'active' | 'headlessOnly'> =
  {
    url: null,
    backend: null,
    width: null,
    height: null,
    dataStoreDir: null,
    startedAt: null,
    lastError: null,
  };
let canvasAutomationWebViewQueue: Promise<void> = Promise.resolve();

function sessionDiagLog(tag: string, payload: Record<string, unknown>): void {
  const logPath = String(process.env.PMX_SESSION_LOG || process.env.PMX_TEST_LOG || '').trim();
  if (!logPath) return;
  try {
    appendFileSync(
      logPath,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        scope: 'workbench',
        tag,
        ...payload,
      })}\n`,
      'utf-8',
    );
  } catch (error) {
    console.debug('[workbench] diagnostics logging failed', error);
  }
}

function logWorkbenchWarning(action: string, error: unknown, details?: Record<string, unknown>): void {
  console.warn(`[workbench] ${action}`, { error, ...(details ?? {}) });
}

function tryParseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch (error) {
    console.debug('[workbench] invalid URL', { raw, error });
    return null;
  }
}

function getCanvasWebViewConstructor(): CanvasWebViewConstructor | null {
  return (Bun as typeof Bun & BunWithOptionalWebView).WebView ?? null;
}

function hasCanvasAutomationWebViewSupport(): boolean {
  return getCanvasWebViewConstructor() !== null;
}

function getDefaultCanvasAutomationWebViewBackend(): 'webkit' | 'chrome' {
  return process.platform === 'darwin' ? 'webkit' : 'chrome';
}

function normalizeCanvasAutomationWebViewOptions(
  input: CanvasAutomationWebViewOptions = {},
): Required<Pick<CanvasAutomationWebViewOptions, 'width' | 'height'>> &
  Pick<CanvasAutomationWebViewOptions, 'backend' | 'chromePath' | 'chromeArgv' | 'dataStoreDir'> {
  return {
    backend: input.backend,
    width:
      typeof input.width === 'number' && Number.isFinite(input.width) && input.width > 0
        ? Math.floor(input.width)
        : 1280,
    height:
      typeof input.height === 'number' && Number.isFinite(input.height) && input.height > 0
        ? Math.floor(input.height)
        : 800,
    chromePath: input.chromePath?.trim() || undefined,
    chromeArgv:
      Array.isArray(input.chromeArgv) && input.chromeArgv.length > 0
        ? input.chromeArgv.map((value) => value.trim()).filter((value) => value.length > 0)
        : undefined,
    dataStoreDir: input.dataStoreDir?.trim() || undefined,
  };
}

function resolveCanvasAutomationWebViewBackend(
  options: ReturnType<typeof normalizeCanvasAutomationWebViewOptions>,
): CanvasWebViewBackend {
  if (options.backend === 'webkit' && (options.chromePath || options.chromeArgv)) {
    throw new Error('Chrome-specific WebView options cannot be combined with the WebKit backend.');
  }

  if (options.backend === 'webkit' && process.platform !== 'darwin') {
    throw new Error('The WebKit Bun.WebView backend is only available on macOS. Use backend "chrome" instead.');
  }

  if (options.chromePath || options.chromeArgv) {
    return {
      type: 'chrome',
      ...(options.chromePath ? { path: options.chromePath } : {}),
      ...(options.chromeArgv ? { argv: options.chromeArgv } : {}),
    };
  }

  const backend = options.backend ?? getDefaultCanvasAutomationWebViewBackend();
  if (backend === 'webkit' && process.platform !== 'darwin') {
    throw new Error('The WebKit Bun.WebView backend is only available on macOS. Use backend "chrome" instead.');
  }

  return backend;
}

function detectCanvasAutomationWebViewBackendKind(backend: CanvasWebViewBackend): 'webkit' | 'chrome' {
  if (backend === 'webkit' || backend === 'chrome') return backend;
  return backend.type;
}

function getCanvasAutomationWebViewTimeoutMs(): number {
  const raw = Number.parseInt(process.env.PMX_CANVAS_WEBVIEW_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(raw) && raw > 0
    ? raw
    : DEFAULT_CANVAS_AUTOMATION_WEBVIEW_TIMEOUT_MS;
}

async function withCanvasAutomationWebViewTimeout<T>(task: Promise<T>, action: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `Timed out after ${getCanvasAutomationWebViewTimeoutMs()}ms while ${action}. ` +
                'Bun.WebView may be unavailable in this environment.',
            ),
          );
        }, getCanvasAutomationWebViewTimeoutMs());
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function closeCanvasAutomationWebViewInternal(): Promise<boolean> {
  if (!canvasAutomationWebView) return false;

  const view = canvasAutomationWebView;
  canvasAutomationWebView = null;
  canvasAutomationWebViewStatus = {
    ...canvasAutomationWebViewStatus,
    url: null,
    backend: null,
    width: null,
    height: null,
    dataStoreDir: null,
    startedAt: null,
  };

  await Promise.resolve(view.close());
  return true;
}

function runCanvasAutomationWebViewTask<T>(task: () => Promise<T>): Promise<T> {
  const result = canvasAutomationWebViewQueue.then(task);
  canvasAutomationWebViewQueue = result.then(() => undefined, () => undefined);
  return result;
}

export function getCanvasAutomationWebViewStatus(): CanvasAutomationWebViewStatus {
  return {
    supported: hasCanvasAutomationWebViewSupport(),
    active: canvasAutomationWebView !== null,
    headlessOnly: true,
    ...canvasAutomationWebViewStatus,
  };
}

export async function stopCanvasAutomationWebView(): Promise<boolean> {
  return runCanvasAutomationWebViewTask(async () => {
    try {
      return await closeCanvasAutomationWebViewInternal();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      canvasAutomationWebViewStatus = {
        ...canvasAutomationWebViewStatus,
        lastError: message,
      };
      throw error;
    }
  });
}

export async function startCanvasAutomationWebView(
  url: string,
  options: CanvasAutomationWebViewOptions = {},
): Promise<CanvasAutomationWebViewStatus> {
  return runCanvasAutomationWebViewTask(async () => {
    const WebView = getCanvasWebViewConstructor();
    if (!WebView) {
      const message = 'Bun.WebView is not available in this Bun runtime. Bun >=1.3.12 is required.';
      canvasAutomationWebViewStatus = {
        ...canvasAutomationWebViewStatus,
        lastError: message,
      };
      throw new Error(message);
    }

    const normalized = normalizeCanvasAutomationWebViewOptions(options);
    const backend = resolveCanvasAutomationWebViewBackend(normalized);

    if (canvasAutomationWebView) {
      await closeCanvasAutomationWebViewInternal();
    }

    const view = new WebView({
      width: normalized.width,
      height: normalized.height,
      headless: true,
      backend,
      dataStore: normalized.dataStoreDir ? { directory: normalized.dataStoreDir } : 'ephemeral',
    });

    try {
      await withCanvasAutomationWebViewTimeout(view.navigate(url), 'starting the workbench automation WebView');
    } catch (error) {
      canvasAutomationWebViewStatus = {
        ...canvasAutomationWebViewStatus,
        lastError: error instanceof Error ? error.message : String(error),
      };
      await Promise.resolve(view.close()).catch(() => undefined);
      throw error;
    }

    canvasAutomationWebView = view;
    canvasAutomationWebViewStatus = {
      url,
      backend: detectCanvasAutomationWebViewBackendKind(backend),
      width: normalized.width,
      height: normalized.height,
      dataStoreDir: normalized.dataStoreDir ?? null,
      startedAt: new Date().toISOString(),
      lastError: null,
    };

    return getCanvasAutomationWebViewStatus();
  });
}

function requireActiveCanvasAutomationWebView(): CanvasWebViewLike {
  if (!canvasAutomationWebView) {
    throw new Error('Canvas automation WebView is not active. Start it before issuing automation commands.');
  }
  return canvasAutomationWebView;
}

export async function evaluateCanvasAutomationWebView(expression: string): Promise<unknown> {
  return runCanvasAutomationWebViewTask(async () =>
    withCanvasAutomationWebViewTimeout(
      requireActiveCanvasAutomationWebView().evaluate(expression),
      'evaluating JavaScript in the workbench automation WebView',
    ));
}

export async function resizeCanvasAutomationWebView(
  width: number,
  height: number,
): Promise<CanvasAutomationWebViewStatus> {
  return runCanvasAutomationWebViewTask(async () => {
    const normalizedWidth = Number.isFinite(width) && width > 0 ? Math.floor(width) : 1280;
    const normalizedHeight = Number.isFinite(height) && height > 0 ? Math.floor(height) : 800;
    await withCanvasAutomationWebViewTimeout(
      requireActiveCanvasAutomationWebView().resize(normalizedWidth, normalizedHeight),
      'resizing the workbench automation WebView',
    );
    canvasAutomationWebViewStatus = {
      ...canvasAutomationWebViewStatus,
      width: normalizedWidth,
      height: normalizedHeight,
    };
    return getCanvasAutomationWebViewStatus();
  });
}

export async function screenshotCanvasAutomationWebView(
  options: Record<string, unknown> = {},
): Promise<Uint8Array> {
  return runCanvasAutomationWebViewTask(async () => {
    const result = await withCanvasAutomationWebViewTimeout(
      requireActiveCanvasAutomationWebView().screenshot(options),
      'capturing a screenshot from the workbench automation WebView',
    );
    if (result instanceof Uint8Array) return result;
    if (result instanceof ArrayBuffer) return new Uint8Array(result);
    if (result instanceof Blob) return new Uint8Array(await result.arrayBuffer());
    throw new Error('Unexpected screenshot payload type from Bun.WebView.');
  });
}

export interface PrimaryWorkbenchIntent {
  id: number;
  type:
    | 'focus-primary'
    | 'refresh-artifact'
    | 'review-artifact'
    | 'focus-approval'
    | 'open-aux'
    | 'close-aux'
    | 'mcp-app-focus'
    | 'mcp-app-close'
    | 'trace-toggle'
    | 'trace-clear'
    | 'canvas-prompt';
  payload: PrimaryWorkbenchEventPayload;
  createdAt: string;
}

export interface PrimaryWorkbenchCanvasPromptRequest {
  nodeId: string;
  text: string;
  displayText: string;
  parentNodeId?: string;
  contextNodeIds: string[];
}

type PrimaryWorkbenchCanvasPromptHandler = (
  request: PrimaryWorkbenchCanvasPromptRequest,
) => Promise<void>;

let primaryWorkbenchCanvasPromptHandler: PrimaryWorkbenchCanvasPromptHandler | null = null;

const pendingWorkbenchIntents: PrimaryWorkbenchIntent[] = [];
let nextWorkbenchIntentId = 1;
const MAX_PENDING_WORKBENCH_INTENTS = 120;
const ALLOWED_WORKBENCH_INTENTS = new Set<PrimaryWorkbenchIntent['type']>([
  'focus-primary',
  'refresh-artifact',
  'review-artifact',
  'focus-approval',
  'open-aux',
  'close-aux',
  'mcp-app-focus',
  'mcp-app-close',
  'trace-toggle',
  'trace-clear',
  'canvas-prompt',
]);

function normalizeWorkspaceRoot(workspaceRoot: string): string {
  return resolve(workspaceRoot || process.cwd());
}

function isMarkdownFile(pathLike: string): boolean {
  return extname(pathLike).toLowerCase() === '.md';
}

function resolveWorkspaceMarkdownPath(pathLike: string): string | null {
  if (!pathLike || typeof pathLike !== 'string') return null;
  const resolved = resolve(pathLike);
  const workspaceRel = relative(activeWorkspaceRoot, resolved);
  const insideWorkspace = !(workspaceRel.startsWith('..') || workspaceRel === '..');
  if (!insideWorkspace) return null;
  if (!isMarkdownFile(resolved)) return null;
  return resolved;
}

function resolveWorkspaceArtifactPath(pathLike: string): string | null {
  if (!pathLike || typeof pathLike !== 'string') return null;
  const resolved = resolve(pathLike);
  const workspaceRel = relative(activeWorkspaceRoot, resolved);
  const insideWorkspace = !(workspaceRel.startsWith('..') || workspaceRel === '..');
  return insideWorkspace ? resolved : null;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function hashPath(path: string): string {
  let h = 0;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) - h + path.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function getMarkdownPlacement(): { x: number; y: number } {
  return findOpenCanvasPosition(canvasState.getLayout().nodes, 720, 600);
}

function findCanvasExtAppNodeId(toolCallId: string): string | null {
  const directId = `ext-app-${toolCallId}`;
  if (canvasState.getNode(directId)) return directId;
  for (const node of canvasState.getLayout().nodes) {
    if (
      node.type === 'mcp-app' &&
      node.data.mode === 'ext-app' &&
      node.data.toolCallId === toolCallId
    ) {
      return node.id;
    }
  }
  return null;
}

function findReusableCanvasExtAppNodeId(serverName: string, toolName: string): string | null {
  for (const node of canvasState.getLayout().nodes) {
    if (
      node.type === 'mcp-app' &&
      node.data.mode === 'ext-app' &&
      node.data.serverName === serverName &&
      node.data.toolName === toolName &&
      !node.data.toolResult
    ) {
      return node.id;
    }
  }
  return null;
}

function findOnlyPendingCanvasExtAppNodeId(serverName: string, toolName: string): string | null {
  let matchId: string | null = null;
  for (const node of canvasState.getLayout().nodes) {
    if (
      node.type === 'mcp-app' &&
      node.data.mode === 'ext-app' &&
      node.data.serverName === serverName &&
      node.data.toolName === toolName &&
      !node.data.toolResult
    ) {
      if (matchId) return null;
      matchId = node.id;
    }
  }
  return matchId;
}

function toSseFrame(event: string, payload: PrimaryWorkbenchEventPayload): Uint8Array {
  const id = nextWorkbenchEventId++;
  const lines = [`id: ${id}`, `event: ${event}`, `data: ${JSON.stringify(payload)}`, ''];
  return textEncoder.encode(`${lines.join('\n')}\n`);
}

function broadcastWorkbenchEvent(event: string, payload: PrimaryWorkbenchEventPayload): void {
  const frame = toSseFrame(event, payload);
  for (const [subscriberId, controller] of workbenchSubscribers.entries()) {
    try {
      controller.enqueue(frame);
    } catch (error) {
      sessionDiagLog('drop-subscriber-after-enqueue-failure', {
        subscriberId,
        event,
        error: error instanceof Error ? error.message : String(error),
      });
      workbenchSubscribers.delete(subscriberId);
      syncCanvasBrowserOpenedFromSubscribers();
    }
  }
}

function setPrimaryWorkbenchPath(safePath: string, source: string): void {
  const resolved = resolve(safePath);
  if (primaryWorkbenchPath === resolved) return;
  primaryWorkbenchPath = resolved;
  broadcastWorkbenchEvent('workbench-open', {
    path: resolved,
    title: basename(resolved),
    source,
    sessionId: primaryWorkbenchSessionId,
    updatedAt: new Date().toISOString(),
  });
}

export function setPrimaryWorkbenchAutoOpenEnabled(enabled: boolean): void {
  primaryWorkbenchAutoOpenEnabled = enabled;
}

export function isPrimaryWorkbenchAutoOpenEnabled(): boolean {
  return primaryWorkbenchAutoOpenEnabled;
}

export function hasWorkbenchSubscribers(): boolean {
  return workbenchSubscribers.size > 0;
}

export function setPrimaryWorkbenchCanvasPromptHandler(
  handler: PrimaryWorkbenchCanvasPromptHandler | null,
): void {
  primaryWorkbenchCanvasPromptHandler = handler;
}

function enqueuePrimaryWorkbenchIntent(
  type: PrimaryWorkbenchIntent['type'],
  payload: PrimaryWorkbenchEventPayload = {},
): PrimaryWorkbenchIntent {
  const intent: PrimaryWorkbenchIntent = {
    id: nextWorkbenchIntentId++,
    type,
    payload,
    createdAt: new Date().toISOString(),
  };
  pendingWorkbenchIntents.push(intent);
  if (pendingWorkbenchIntents.length > MAX_PENDING_WORKBENCH_INTENTS) {
    pendingWorkbenchIntents.splice(
      0,
      pendingWorkbenchIntents.length - MAX_PENDING_WORKBENCH_INTENTS,
    );
  }
  broadcastWorkbenchEvent('workbench-intent', { ...intent });
  return intent;
}

function rotatePrimaryWorkbenchSessionIfNeeded(): void {
  if (primaryWorkbenchSessionId) return;
  primaryWorkbenchSessionId = `pmx-${Date.now().toString(36)}`;
}

function readJson(req: Request): Promise<Record<string, unknown>> {
  return req.json()
    .then((value) => {
      if (!value || typeof value !== 'object') return {};
      return value as Record<string, unknown>;
    })
    .catch((error) => {
      logWorkbenchWarning('readJson', error);
      return {};
    });
}

function htmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toPreferredExcalidrawUrl(raw: string): string {
  const parsed = tryParseUrl(raw);
  if (!parsed) return raw;
  const host = parsed.hostname.toLowerCase();
  if (!host.includes('excalidraw-mcp-app')) return parsed.toString();
  const lowerHash = parsed.hash.toLowerCase();
  const hasPortableState =
    lowerHash.includes('json=') ||
    lowerHash.includes('room=') ||
    parsed.searchParams.has('json') ||
    parsed.searchParams.has('room');
  if (hasPortableState) {
    parsed.protocol = 'https:';
    parsed.hostname = 'excalidraw.com';
  }
  parsed.hash = parsed.hash.replace(/\s+/g, '');
  return parsed.toString();
}

function isExcalidrawUrl(url: string): boolean {
  const parsed = tryParseUrl(url);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  return host.includes('excalidraw.com') || host.includes('excalidraw-mcp-app');
}

function normalizeMarkdownExternalUrls(markdown: string): string {
  const normalizedLinks = markdown.replace(/https?:\/\/[^\s<>"'`)\]]+/gi, (url) =>
    toPreferredExcalidrawUrl(url),
  );
  return normalizedLinks.replace(
    /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi,
    (full, altRaw: string, urlRaw: string) => {
      const url = toPreferredExcalidrawUrl(urlRaw);
      if (!isExcalidrawUrl(url)) return full;
      const label = (altRaw || 'Open Excalidraw diagram').trim() || 'Open Excalidraw diagram';
      return `> Excalidraw diagram: [${label}](${url})`;
    },
  );
}

// ── Canvas SPA HTML ────────────────────────────────────────────

function canvasSpaHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PMX Canvas</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=focus-field" />
  <link rel="alternate icon" href="/favicon.ico?v=focus-field" sizes="any" />
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      background: #081524;
      color: #d9e2f2;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    body { overflow: hidden; }
    #app { width: 100%; height: 100%; }
    #canvasBootstrap {
      position: fixed;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      background:
        radial-gradient(circle at top left, rgba(62, 134, 255, 0.18), transparent 32%),
        radial-gradient(circle at bottom right, rgba(0, 214, 201, 0.12), transparent 28%),
        #081524;
      z-index: 9999;
    }
    #canvasBootstrap.ready { display: none; }
    .canvas-bootstrap-card {
      width: min(480px, 100%);
      padding: 22px 24px;
      border-radius: 18px;
      border: 1px solid rgba(132, 160, 214, 0.18);
      background: rgba(11, 18, 29, 0.92);
      box-shadow: 0 28px 80px rgba(0, 0, 0, 0.34);
    }
    .canvas-bootstrap-card strong {
      display: block;
      font-size: 18px;
      line-height: 1.2;
      margin-bottom: 8px;
    }
    .canvas-bootstrap-card p {
      margin: 0;
      color: #aebbd3;
      line-height: 1.5;
      font-size: 14px;
    }
    .canvas-bootstrap-actions {
      display: flex;
      gap: 12px;
      margin-top: 18px;
    }
    .canvas-bootstrap-actions button {
      border: 0;
      border-radius: 999px;
      padding: 10px 16px;
      font: inherit;
      cursor: pointer;
      background: #233246;
      color: #eef4ff;
    }
  </style>
  <link rel="stylesheet" href="/canvas/global.css" />
</head>
<body>
  <div id="canvasBootstrap">
    <div class="canvas-bootstrap-card">
      <strong>Opening PMX Canvas</strong>
      <p id="canvasBootstrapCopy">Loading the shared PMX workbench...</p>
      <div class="canvas-bootstrap-actions" id="canvasBootstrapActions" hidden>
        <button type="button" onclick="window.location.reload()">Reload canvas</button>
      </div>
    </div>
  </div>
  <div id="app"></div>
  <script>
    (function () {
      var bootstrap = document.getElementById('canvasBootstrap');
      var copy = document.getElementById('canvasBootstrapCopy');
      var actions = document.getElementById('canvasBootstrapActions');
      window.__pmxCanvasBootstrapReady = function () {
        if (!bootstrap) return;
        bootstrap.classList.add('ready');
      };
      window.addEventListener('error', function (event) {
        if (!bootstrap || !copy || !actions) return;
        copy.textContent = event && event.message
          ? 'PMX Canvas hit a browser error while loading: ' + event.message
          : 'PMX Canvas hit a browser error while loading.';
        actions.hidden = false;
      });
      setTimeout(function () {
        if (!bootstrap || !copy || !actions) return;
        if (bootstrap.classList.contains('ready')) return;
        copy.textContent = 'PMX Canvas did not finish booting. Reload the canvas or restart the server.';
        actions.hidden = false;
      }, 4000);
    })();
  </script>
  <script type="module" src="/canvas/index.js"></script>
</body>
</html>`;
}

const CANVAS_STATIC_MIME: Record<string, string> = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
};

const CANVAS_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#081524"/>
  <rect x="8"  y="8"  width="48" height="48" rx="7" fill="none" stroke="#4BBCFF" stroke-width="2.2" opacity="0.35"/>
  <rect x="16" y="16" width="32" height="32" rx="5" fill="none" stroke="#4BBCFF" stroke-width="2.2" opacity="0.6"/>
  <rect x="24" y="24" width="16" height="16" rx="3" fill="none" stroke="#4BBCFF" stroke-width="2.2"/>
  <rect x="29" y="29" width="6"  height="6"  rx="1" fill="#4BBCFF"/>
</svg>`;

// Resolve canvas bundle directory — uses PMX_CANVAS_DIST env or fallback chain.
let _canvasBundleDir: string | null = null;

function resolveCanvasBundleDir(): string {
  if (_canvasBundleDir) return _canvasBundleDir;

  const candidates: string[] = [];
  const explicitBundleDir = process.env.PMX_CANVAS_DIST?.trim();

  if (explicitBundleDir) {
    candidates.push(resolve(explicitBundleDir));
  }

  // Adjacent to built module: dist/canvas/ when running dist/index.js
  candidates.push(resolve(import.meta.dir, 'canvas'));

  // Installed package layout: node_modules/pmx-canvas/dist/canvas/
  candidates.push(resolve(import.meta.dir, '..', '..', 'dist', 'canvas'));

  // cwd-based: works when cwd is the repo root
  candidates.push(resolve(process.cwd(), 'dist', 'canvas'));

  for (const dir of candidates) {
    if (existsSync(resolve(dir, 'index.js'))) {
      _canvasBundleDir = dir;
      return dir;
    }
  }

  // Fallback: last candidate
  const fallback = candidates[candidates.length - 1];
  _canvasBundleDir = fallback;
  return fallback;
}

function serveCanvasStatic(pathname: string): Response | null {
  const fileName = pathname.slice('/canvas/'.length);
  if (!fileName || fileName.includes('..') || fileName.startsWith('/')) return null;

  const bundleDir = resolveCanvasBundleDir();
  const distPath = resolve(bundleDir, fileName);
  if (!distPath.startsWith(`${bundleDir}/`)) return null;
  if (existsSync(distPath)) {
    const ext = extname(fileName);
    return new Response(readFileSync(distPath), {
      headers: {
        'Content-Type': CANVAS_STATIC_MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=300',
      },
    });
  }
  return null;
}

function serveCanvasFavicon(): Response {
  return new Response(CANVAS_FAVICON_SVG, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

// ── Canvas REST handlers ──────────────────────────────────────

async function handleCanvasUpdate(req: Request): Promise<Response> {
  const body = await readJson(req);
  const updates = Array.isArray(body.updates) ? body.updates : [];
  const result = applyCanvasNodeUpdates(updates);
  if (result.applied > 0) {
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  }
  return responseJson({ ok: true, ...result });
}

async function handleCanvasViewport(req: Request): Promise<Response> {
  const body = await readJson(req);
  const next = {
    x: typeof body.x === 'number' ? body.x : canvasState.viewport.x,
    y: typeof body.y === 'number' ? body.y : canvasState.viewport.y,
    scale: typeof body.scale === 'number' ? body.scale : canvasState.viewport.scale,
  };
  canvasState.setViewport(next);
  emitPrimaryWorkbenchEvent('canvas-viewport-update', { viewport: canvasState.viewport });
  return responseJson({ ok: true });
}

// ── Serve image file for image nodes ─────────────────────────
function handleCanvasImage(pathname: string): Response {
  const nodeId = pathname.replace('/api/canvas/image/', '');
  const node = canvasState.getNode(nodeId);
  if (!node || node.type !== 'image') {
    return responseText('Image node not found', 404);
  }
  const src = (node.data.path as string) || (node.data.src as string) || '';
  if (!src || src.startsWith('data:') || src.startsWith('http')) {
    return responseText('Not a file-based image', 400);
  }
  const safePath = resolve(src);
  if (!existsSync(safePath)) {
    return responseText('Image file not found', 404);
  }
  const ext = safePath.split('.').pop()?.toLowerCase() ?? '';
  const contentType = IMAGE_MIME_MAP[ext] || 'application/octet-stream';
  const data = readFileSync(safePath);
  return new Response(data, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    },
  });
}

// ── Add node from client ─────────────────────────────────────
const VALID_NODE_TYPES = new Set(['markdown', 'status', 'context', 'ledger', 'trace', 'file', 'image', 'mcp-app', 'webpage', 'group']);

function buildNodeResponse(node: CanvasNodeState): Record<string, unknown> {
  return {
    ok: true,
    ...serializeCanvasNode(node),
  };
}

async function createCanvasWebpageNode(body: Record<string, unknown>): Promise<Response> {
  const rawUrl = typeof body.url === 'string' && body.url.trim().length > 0
    ? body.url
    : typeof body.content === 'string'
      ? body.content
      : '';

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeWebpageUrl(rawUrl);
  } catch (error) {
    return responseJson({ ok: false, error: error instanceof Error ? error.message : 'Invalid webpage URL.' }, 400);
  }

  const extraData = body.data && typeof body.data === 'object' && !Array.isArray(body.data)
    ? body.data as Record<string, unknown>
    : undefined;
  const { id, node } = addCanvasNode({
    type: 'webpage',
    ...(typeof body.title === 'string' ? { title: body.title } : {}),
    content: normalizedUrl,
    ...(extraData ? { data: extraData } : {}),
    ...(typeof body.x === 'number' ? { x: body.x } : {}),
    ...(typeof body.y === 'number' ? { y: body.y } : {}),
    ...(typeof body.width === 'number' ? { width: body.width } : { width: WEBPAGE_NODE_DEFAULT_SIZE.width }),
    ...(typeof body.height === 'number' ? { height: body.height } : { height: WEBPAGE_NODE_DEFAULT_SIZE.height }),
  });

  emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  const refreshed = await refreshCanvasWebpageNode(id);
  emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  const created = canvasState.getNode(id) ?? node;
  return responseJson({
    ...buildNodeResponse(created),
    fetch: refreshed.ok
      ? { ok: true }
      : { ok: false, error: refreshed.error ?? 'Failed to fetch webpage content.' },
    ...(refreshed.ok ? {} : { error: refreshed.error }),
  });
}

async function handleCanvasAddNode(req: Request): Promise<Response> {
  const body = await readJson(req);
  const type = (body.type as string) || 'markdown';

  if (!VALID_NODE_TYPES.has(type)) {
    if (type === 'json-render') {
      return responseJson({
        ok: false,
        error: 'Node type "json-render" is created via POST /api/canvas/json-render. See /api/canvas/schema for the required spec shape.',
      }, 400);
    }
    if (type === 'graph') {
      return responseJson({
        ok: false,
        error: 'Node type "graph" is created via POST /api/canvas/graph. See /api/canvas/schema for graphType + data fields.',
      }, 400);
    }
    if (type === 'web-artifact') {
      return responseJson({
        ok: false,
        error: 'Node type "web-artifact" is created via POST /api/canvas/web-artifact with appTsx + title.',
      }, 400);
    }
    return responseJson({ ok: false, error: `Invalid node type: "${type}".` }, 400);
  }

  if (type === 'webpage') {
    return createCanvasWebpageNode(body);
  }

  const extraData = body.data && typeof body.data === 'object' && !Array.isArray(body.data)
    ? body.data as Record<string, unknown>
    : undefined;
  let added: ReturnType<typeof addCanvasNode>;
  try {
    added = addCanvasNode({
      type: type as CanvasNodeState['type'],
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      ...(typeof body.content === 'string' ? { content: body.content } : {}),
      ...(extraData ? { data: extraData } : {}),
      ...(typeof body.x === 'number' ? { x: body.x } : {}),
      ...(typeof body.y === 'number' ? { y: body.y } : {}),
      ...(typeof body.width === 'number' ? { width: body.width } : {}),
      ...(typeof body.height === 'number' ? { height: body.height } : {}),
      defaultWidth: 360,
      defaultHeight: 200,
      fileMode: 'auto',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return responseJson({ ok: false, error: message }, 400);
  }
  const { node, needsCodeGraphRecompute } = added;

  emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  if (needsCodeGraphRecompute) {
    scheduleCodeGraphRecompute(() => {
      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    });
  }
  return responseJson(buildNodeResponse(node));
}

// ── Group operations ─────────────────────────────────────────
async function handleCanvasCreateGroup(req: Request): Promise<Response> {
  const body = await readJson(req);
  const title = typeof body.title === 'string' ? body.title : 'Group';
  const childIds = Array.isArray(body.childIds) ? body.childIds.filter((id: unknown) => typeof id === 'string') : [];
  const color = typeof body.color === 'string' ? body.color : undefined;
  const x = typeof body.x === 'number' ? body.x : undefined;
  const y = typeof body.y === 'number' ? body.y : undefined;
  const width = typeof body.width === 'number' ? body.width : undefined;
  const height = typeof body.height === 'number' ? body.height : undefined;
  const childLayout =
    body.childLayout === 'grid' || body.childLayout === 'column' || body.childLayout === 'flow'
      ? body.childLayout
      : undefined;

  const { node } = createCanvasGroup({ title, childIds, color, x, y, width, height, ...(childLayout ? { childLayout } : {}) });

  broadcastWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  return responseJson(buildNodeResponse(node));
}

async function handleCanvasGroupNodes(req: Request): Promise<Response> {
  const body = await readJson(req);
  const groupId = body.groupId as string;
  const childIds = Array.isArray(body.childIds) ? body.childIds.filter((id: unknown) => typeof id === 'string') : [];
  const childLayout =
    body.childLayout === 'grid' || body.childLayout === 'column' || body.childLayout === 'flow'
      ? body.childLayout
      : undefined;
  if (!groupId || childIds.length === 0) {
    return responseJson({ ok: false, error: 'Missing groupId or childIds.' }, 400);
  }
  const { ok } = groupCanvasNodes(groupId, childIds, childLayout ? { childLayout } : {});
  if (!ok) return responseJson({ ok: false, error: 'Group not found or no valid children.' }, 400);
  broadcastWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  return responseJson({ ok: true, groupId });
}

async function handleCanvasUngroupNodes(req: Request): Promise<Response> {
  const body = await readJson(req);
  const groupId = body.groupId as string;
  if (!groupId) return responseJson({ ok: false, error: 'Missing groupId.' }, 400);
  const { ok } = ungroupCanvasNodes(groupId);
  if (!ok) return responseJson({ ok: false, error: 'Group not found or empty.' }, 400);
  broadcastWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  return responseJson({ ok: true, groupId });
}

const VALID_EDGE_TYPES = new Set(['relation', 'depends-on', 'flow', 'references']);
const VALID_EDGE_STYLES = new Set(['solid', 'dashed', 'dotted']);

async function handleCanvasAddEdge(req: Request): Promise<Response> {
  const body = await readJson(req);
  const type = body.type as string;
  const style = typeof body.style === 'string' ? body.style : undefined;

  if (
    !type ||
    (!body.from && !body.fromSearch) ||
    (!body.to && !body.toSearch)
  ) {
    return responseJson({ ok: false, error: 'Missing required fields: type plus from/fromSearch and to/toSearch.' }, 400);
  }
  if (!VALID_EDGE_TYPES.has(type)) {
    return responseJson({ ok: false, error: `Invalid edge type: "${type}".` }, 400);
  }
  if (style && !VALID_EDGE_STYLES.has(style)) {
    return responseJson({ ok: false, error: `Invalid edge style: "${style}". Use solid, dashed, or dotted.` }, 400);
  }
  try {
    const result = addCanvasEdge({
      ...(typeof body.from === 'string' ? { from: body.from } : {}),
      ...(typeof body.to === 'string' ? { to: body.to } : {}),
      ...(typeof body.fromSearch === 'string' ? { fromSearch: body.fromSearch } : {}),
      ...(typeof body.toSearch === 'string' ? { toSearch: body.toSearch } : {}),
      type: type as CanvasEdge['type'],
      ...(body.label ? { label: String(body.label) } : {}),
      ...(style ? { style: style as CanvasEdge['style'] } : {}),
      ...(body.animated !== undefined ? { animated: Boolean(body.animated) } : {}),
    });
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return responseJson({ ok: true, ...result });
  } catch (error) {
    return responseJson({ ok: false, error: error instanceof Error ? error.message : 'Duplicate or self-edge.' }, 400);
  }
}

async function handleCanvasRemoveEdge(req: Request): Promise<Response> {
  const body = await readJson(req);
  const edgeId = body.edge_id as string;
  if (!edgeId) {
    return responseJson({ ok: false, error: 'Missing edge_id.' }, 400);
  }
  const { removed } = removeCanvasEdge(edgeId);
  if (!removed) {
    return responseJson({ ok: false, error: `Edge "${edgeId}" not found.` }, 404);
  }
  emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  return responseJson({ ok: true, removed: edgeId });
}

async function handleCanvasRefreshWebpageNode(nodeId: string, req: Request): Promise<Response> {
  const existing = canvasState.getNode(nodeId);
  if (!existing || existing.type !== 'webpage') {
    return responseJson({ ok: false, error: `Webpage node "${nodeId}" not found.` }, 404);
  }

  const body = await readJson(req);
  const rawUrl = typeof body.url === 'string' ? body.url : undefined;
  let url: string | undefined;
  if (rawUrl && rawUrl.trim().length > 0) {
    try {
      url = normalizeWebpageUrl(rawUrl);
    } catch (error) {
      return responseJson({ ok: false, error: error instanceof Error ? error.message : 'Invalid webpage URL.' }, 400);
    }
  }

  const result = await refreshCanvasWebpageNode(nodeId, { ...(url ? { url } : {}) });
  emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  return responseJson(result, result.ok ? 200 : 400);
}

// ── Individual node update (PATCH) ──────────────────────────
async function handleCanvasUpdateNode(nodeId: string, req: Request): Promise<Response> {
  const existing = canvasState.getNode(nodeId);
  if (!existing) return responseJson({ ok: false, error: `Node "${nodeId}" not found.` }, 404);
  const body = await readJson(req);
  if (existing.type === 'webpage' && body.refresh === true) {
    return handleCanvasRefreshWebpageNode(nodeId, req);
  }
  const patch: Record<string, unknown> = {};
  if (body.position) patch.position = body.position;
  if (body.size) patch.size = body.size;
  if (body.collapsed !== undefined) patch.collapsed = body.collapsed;
  if (body.pinned !== undefined) patch.pinned = Boolean(body.pinned);
  if (body.dockPosition === null || body.dockPosition === 'left' || body.dockPosition === 'right') {
    patch.dockPosition = body.dockPosition;
  }
  if (body.title !== undefined || body.content !== undefined || body.data || typeof body.arrangeLocked === 'boolean') {
    const data = { ...existing.data };
    if (body.title !== undefined) {
      data.title = String(body.title);
      if (existing.type === 'webpage') {
        data.titleSource = 'user';
      }
    }
    if (body.content !== undefined) data.content = String(body.content);
    if (typeof body.arrangeLocked === 'boolean') data.arrangeLocked = body.arrangeLocked;
    // Merge extra data fields (for status, context, ledger, trace nodes)
    if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
      Object.assign(data, body.data as Record<string, unknown>);
    }
    if (existing.type === 'webpage') {
      const nextUrl = typeof body.url === 'string'
        ? body.url
        : typeof (body.data as Record<string, unknown> | undefined)?.url === 'string'
          ? (body.data as Record<string, unknown>).url as string
          : undefined;
      if (typeof nextUrl === 'string' && nextUrl.trim().length > 0) {
        try {
          data.url = normalizeWebpageUrl(nextUrl);
        } catch (error) {
          return responseJson({ ok: false, error: error instanceof Error ? error.message : 'Invalid webpage URL.' }, 400);
        }
      }
    }
    patch.data = data;
  }
  const error = validateCanvasNodePatch({
    ...(patch.position ? { position: patch.position as { x: number; y: number } } : {}),
    ...(patch.size ? { size: patch.size as { width: number; height: number } } : {}),
  });
  if (error) return responseJson({ ok: false, error }, 400);
  canvasState.updateNode(nodeId, patch as Partial<CanvasNodeState>);
  emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  return responseJson({ ok: true, id: nodeId });
}

// ── Arrange nodes ───────────────────────────────────────────
async function handleCanvasArrange(req: Request): Promise<Response> {
  const body = await readJson(req);
  const layout = typeof body.layout === 'string' ? body.layout : 'grid';
  if (!['grid', 'column', 'flow'].includes(layout)) {
    return responseJson({ ok: false, error: `Invalid layout: "${layout}". Use: grid, column, flow` }, 400);
  }
  const result = arrangeCanvasNodes(layout as 'grid' | 'column' | 'flow');
  emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  return responseJson({ ok: true, arranged: result.arranged, layout: result.layout });
}

// ── Focus on node ───────────────────────────────────────────
async function handleCanvasFocus(req: Request): Promise<Response> {
  const body = await readJson(req);
  const nodeId = body.id as string;
  if (!nodeId) return responseJson({ ok: false, error: 'Missing id.' }, 400);
  const node = canvasState.getNode(nodeId);
  if (!node) return responseJson({ ok: false, error: `Node "${nodeId}" not found.` }, 404);
  canvasState.setViewport({ x: node.position.x - 100, y: node.position.y - 100 });
  emitPrimaryWorkbenchEvent('canvas-focus-node', { nodeId });
  emitPrimaryWorkbenchEvent('canvas-viewport-update', { viewport: canvasState.viewport });
  emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  return responseJson({ ok: true, focused: nodeId });
}

async function handleCanvasBuildWebArtifact(req: Request): Promise<Response> {
  const body = await readJson(req);
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const appTsx = typeof body.appTsx === 'string' ? body.appTsx : '';
  if (!title || !appTsx) {
    return responseJson({ ok: false, error: 'Missing required fields: title, appTsx.' }, 400);
  }

  const files: Record<string, string> = {};
  if (body.files && typeof body.files === 'object' && !Array.isArray(body.files)) {
    for (const [pathKey, value] of Object.entries(body.files as Record<string, unknown>)) {
      if (typeof value === 'string') files[pathKey] = value;
    }
  }

  try {
    const result = await buildWebArtifactOnCanvas({
      title,
      appTsx,
      ...(typeof body.indexCss === 'string' ? { indexCss: body.indexCss } : {}),
      ...(typeof body.mainTsx === 'string' ? { mainTsx: body.mainTsx } : {}),
      ...(typeof body.indexHtml === 'string' ? { indexHtml: body.indexHtml } : {}),
      ...(Object.keys(files).length > 0 ? { files } : {}),
      ...(typeof body.projectPath === 'string'
        ? { projectPath: resolveWorkspacePath(body.projectPath, activeWorkspaceRoot) }
        : {}),
      ...(typeof body.outputPath === 'string'
        ? { outputPath: resolveWorkspacePath(body.outputPath, activeWorkspaceRoot) }
        : {}),
      ...(typeof body.initScriptPath === 'string'
        ? { initScriptPath: body.initScriptPath }
        : {}),
      ...(typeof body.bundleScriptPath === 'string'
        ? { bundleScriptPath: body.bundleScriptPath }
        : {}),
      ...(typeof body.timeoutMs === 'number' ? { timeoutMs: body.timeoutMs } : {}),
      ...(typeof body.openInCanvas === 'boolean' ? { openInCanvas: body.openInCanvas } : {}),
    });

    return responseJson({
      ok: true,
      path: result.filePath,
      bytes: result.fileSize,
      projectPath: result.projectPath,
      openedInCanvas: result.openedInCanvas,
      nodeId: result.nodeId,
      url: result.url,
      metadata: result.metadata,
      logs: result.logs,
      ...(body.includeLogs === true ? {
        stdout: result.stdout,
        stderr: result.stderr,
      } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return responseJson({ ok: false, error: message }, 400);
  }
}

function handleCanvasDescribeSchema(): Response {
  return responseJson(describeCanvasSchema());
}

async function handleCanvasValidateSpec(req: Request): Promise<Response> {
  const body = await readJson(req);
  const rawType = typeof body.type === 'string' ? body.type.trim() : '';
  if (rawType !== 'json-render' && rawType !== 'graph') {
    return responseJson({ ok: false, error: 'Validation type must be "json-render" or "graph".' }, 400);
  }

  try {
    if (rawType === 'json-render') {
      const rawSpec =
        body.spec && typeof body.spec === 'object' && !Array.isArray(body.spec)
          ? body.spec
          : body;
      return responseJson(validateStructuredCanvasPayload({
        type: 'json-render',
        spec: rawSpec,
      }));
    }

    const data = Array.isArray(body.data)
      ? body.data.filter((item: unknown) => item && typeof item === 'object') as Array<Record<string, unknown>>
      : null;
    if (!data) {
      return responseJson({ ok: false, error: 'Graph validation requires a data array.' }, 400);
    }

    const aggregate =
      body.aggregate === 'sum' || body.aggregate === 'count' || body.aggregate === 'avg'
        ? body.aggregate
        : undefined;

    return responseJson(validateStructuredCanvasPayload({
      type: 'graph',
      graph: {
        title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Graph',
        graphType: typeof body.graphType === 'string'
          ? body.graphType
          : typeof body.typeName === 'string'
            ? body.typeName
            : 'line',
        data,
        ...(typeof body.xKey === 'string' ? { xKey: body.xKey } : {}),
        ...(typeof body.yKey === 'string' ? { yKey: body.yKey } : {}),
        ...(typeof body.nameKey === 'string' ? { nameKey: body.nameKey } : {}),
        ...(typeof body.valueKey === 'string' ? { valueKey: body.valueKey } : {}),
        ...(aggregate ? { aggregate } : {}),
        ...(typeof body.color === 'string' ? { color: body.color } : {}),
        ...(typeof body.height === 'number' ? { height: body.height } : {}),
      },
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return responseJson({ ok: false, error: message, type: rawType }, 400);
  }
}

async function handleCanvasAddJsonRender(req: Request): Promise<Response> {
  const body = await readJson(req);
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const rawSpec =
    body.spec && typeof body.spec === 'object' && !Array.isArray(body.spec) ? body.spec : body;
  if (!title) {
    return responseJson({ ok: false, error: 'Missing required field: title.' }, 400);
  }

  try {
    const result = createCanvasJsonRenderNode({
      title,
      spec: rawSpec,
      ...(typeof body.x === 'number' ? { x: body.x } : {}),
      ...(typeof body.y === 'number' ? { y: body.y } : {}),
      ...(typeof body.width === 'number' ? { width: body.width } : {}),
      ...(typeof body.height === 'number' ? { height: body.height } : {}),
    });
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return responseJson({ ok: true, ...result, ...serializeCanvasNode(result.node) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return responseJson({ ok: false, error: message }, 400);
  }
}

async function handleCanvasAddGraph(req: Request): Promise<Response> {
  const body = await readJson(req);
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Graph';
  const graphType = typeof body.graphType === 'string' ? body.graphType : typeof body.type === 'string' ? body.type : 'line';
  const data = Array.isArray(body.data)
    ? body.data.filter((item: unknown) => item && typeof item === 'object') as Array<Record<string, unknown>>
    : null;
  if (!data) {
    return responseJson({ ok: false, error: 'Missing required field: data.' }, 400);
  }

  try {
    const aggregate =
      body.aggregate === 'sum' || body.aggregate === 'count' || body.aggregate === 'avg'
        ? body.aggregate
        : undefined;
    const metrics = Array.isArray(body.metrics)
      ? body.metrics.filter((m: unknown): m is string => typeof m === 'string')
      : null;
    const series = Array.isArray(body.series)
      ? body.series.filter((s: unknown): s is string => typeof s === 'string')
      : null;
    const result = createCanvasGraphNode({
      title,
      graphType,
      data,
      ...(typeof body.xKey === 'string' ? { xKey: body.xKey } : {}),
      ...(typeof body.yKey === 'string' ? { yKey: body.yKey } : {}),
      ...(typeof body.zKey === 'string' ? { zKey: body.zKey } : {}),
      ...(typeof body.nameKey === 'string' ? { nameKey: body.nameKey } : {}),
      ...(typeof body.valueKey === 'string' ? { valueKey: body.valueKey } : {}),
      ...(typeof body.axisKey === 'string' ? { axisKey: body.axisKey } : {}),
      ...(metrics ? { metrics } : {}),
      ...(series ? { series } : {}),
      ...(typeof body.barKey === 'string' ? { barKey: body.barKey } : {}),
      ...(typeof body.lineKey === 'string' ? { lineKey: body.lineKey } : {}),
      ...(aggregate ? { aggregate } : {}),
      ...(typeof body.color === 'string' ? { color: body.color } : {}),
      ...(typeof body.barColor === 'string' ? { barColor: body.barColor } : {}),
      ...(typeof body.lineColor === 'string' ? { lineColor: body.lineColor } : {}),
      ...(typeof body.height === 'number' ? { height: body.height } : {}),
      ...(typeof body.x === 'number' ? { x: body.x } : {}),
      ...(typeof body.y === 'number' ? { y: body.y } : {}),
      ...(typeof body.width === 'number' ? { width: body.width } : {}),
      ...(typeof body.nodeHeight === 'number' ? { heightPx: body.nodeHeight } : {}),
    });
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    return responseJson({ ok: true, ...result, ...serializeCanvasNode(result.node) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return responseJson({ ok: false, error: message }, 400);
  }
}

async function handleCanvasBatch(req: Request): Promise<Response> {
  const body = await readJson(req);
  const operations = Array.isArray(body.operations) ? body.operations : Array.isArray(body) ? body : [];
  const normalized = operations
    .filter((operation): operation is Record<string, unknown> => operation && typeof operation === 'object' && !Array.isArray(operation))
    .map((operation) => ({
      op: String(operation.op ?? ''),
      ...(typeof operation.assign === 'string' ? { assign: operation.assign } : {}),
      args: operation.args && typeof operation.args === 'object' && !Array.isArray(operation.args)
        ? operation.args as Record<string, unknown>
        : {},
    }));
  const result = await executeCanvasBatch(normalized);
  emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  return responseJson(result, result.ok ? 200 : 400);
}

function handleCanvasValidate(): Response {
  return responseJson(validateCanvasLayout(canvasState.getLayout()));
}

async function handleJsonRenderView(url: URL): Promise<Response> {
  const nodeId = url.searchParams.get('nodeId') ?? '';
  if (!nodeId) return responseText('Missing nodeId', 400);
  const node = canvasState.getNode(nodeId);
  if (!node || (node.type !== 'json-render' && node.type !== 'graph')) {
    return responseText('json-render node not found', 404);
  }

  const spec = node.data.spec;
  if (!spec || typeof spec !== 'object') {
    return responseText('json-render spec missing', 404);
  }

  const themeValue = url.searchParams.get('theme');
  const theme =
    themeValue === 'dark' || themeValue === 'light' || themeValue === 'high-contrast'
      ? themeValue
      : undefined;
  const title = (node.data.title as string) || node.id;
  const html = await buildJsonRenderViewerHtml({
    title,
    spec: spec as { root: string; elements: Record<string, unknown>; state?: Record<string, unknown> },
    ...(theme ? { theme } : {}),
  });
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function responseJson(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

function responseText(text: string, status = 400): Response {
  return new Response(text, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function handleArtifactView(url: URL): Response {
  const pathLike = url.searchParams.get('path') ?? '';
  const safePath = resolveWorkspaceArtifactPath(pathLike);
  if (!safePath) return responseText('Invalid artifact path', 400);
  if (!existsSync(safePath)) return responseText('Artifact not found', 404);

  const stat = statSync(safePath);
  if (!stat.isFile()) return responseText('Not a file', 400);

  const ext = extname(safePath).toLowerCase();
  const imageExt = ext.replace(/^\./, '');
  if (IMAGE_MIME_MAP[imageExt]) {
    const data = readFileSync(safePath);
    return new Response(data, {
      headers: {
        'Content-Type': IMAGE_MIME_MAP[imageExt],
        'Cache-Control': 'no-store',
      },
    });
  }

  if (ext === '.html' || ext === '.htm') {
    const content = readFileSync(safePath, 'utf-8');
    return new Response(content, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  const content = readFileSync(safePath, 'utf-8');
  const title = basename(safePath);
  const relPath = relative(activeWorkspaceRoot, safePath) || title;
  const body =
    ext === '.md'
      ? `<article class="markdown-body">${marked.parse(content) as string}</article>`
      : `<pre class="artifact-code"><code>${escapeHtml(content)}</code></pre>`;

  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} · PMX Artifact</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #081524;
      --panel: #111a2d;
      --line: rgba(110, 140, 190, 0.22);
      --text: #d9e2f2;
      --muted: #9da8bd;
      --accent: #46b6ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at top left, rgba(62, 134, 255, 0.12), transparent 26%),
        radial-gradient(circle at bottom right, rgba(0, 214, 201, 0.08), transparent 24%),
        var(--bg);
      color: var(--text);
      font: 15px/1.6 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .shell {
      max-width: 1120px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    .header {
      margin-bottom: 20px;
      padding: 16px 18px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: rgba(17, 26, 45, 0.92);
      backdrop-filter: blur(8px);
    }
    .title {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
    }
    .path {
      margin-top: 4px;
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
    }
    .panel {
      border: 1px solid var(--line);
      border-radius: 18px;
      background: rgba(17, 26, 45, 0.94);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.28);
      overflow: hidden;
    }
    .artifact-code, .markdown-body {
      margin: 0;
      padding: 24px;
    }
    .artifact-code {
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .markdown-body :first-child { margin-top: 0; }
    .markdown-body :last-child { margin-bottom: 0; }
    .markdown-body pre {
      overflow: auto;
      padding: 14px;
      border-radius: 12px;
      background: rgba(4, 10, 20, 0.88);
      border: 1px solid var(--line);
    }
    .markdown-body code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.95em;
    }
    .markdown-body a { color: var(--accent); }
    .markdown-body blockquote {
      margin: 0;
      padding-left: 16px;
      border-left: 3px solid rgba(70, 182, 255, 0.45);
      color: var(--muted);
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="header">
      <h1 class="title">${escapeHtml(title)}</h1>
      <div class="path">${escapeHtml(relPath)}</div>
    </header>
    <section class="panel">${body}</section>
  </main>
</body>
</html>`, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function handleRead(pathLike: string): Response {
  const safePath = resolveWorkspaceMarkdownPath(pathLike);
  if (!safePath) return responseText('Invalid path', 400);
  if (!existsSync(safePath)) return responseText('File not found', 404);
  const stat = statSync(safePath);
  if (!stat.isFile()) return responseText('Not a file', 400);
  const content = readFileSync(safePath, 'utf-8');
  return responseJson({
    path: safePath,
    title: basename(safePath),
    content,
    updatedAt: new Date(stat.mtimeMs).toISOString(),
  });
}

function randomExtAppToolCallId(): string {
  return `ext-app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nodeAppSessionId(node: CanvasNodeState | undefined): string | null {
  if (!node || node.type !== 'mcp-app') return null;
  const sessionId = node.data.appSessionId;
  return typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId : null;
}

function closeNodeAppSession(node: CanvasNodeState | undefined): void {
  const sessionId = nodeAppSessionId(node);
  if (sessionId) closeMcpAppSession(sessionId);
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([key, text]) => [key, text.trim()] as const)
    .filter(([, text]) => text.length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function parseExternalMcpTransportConfig(body: Record<string, unknown>): ExternalMcpTransportConfig | null {
  const transport = body.transport;
  if (!transport || typeof transport !== 'object' || Array.isArray(transport)) return null;
  const transportRecord = transport as Record<string, unknown>;

  const type = typeof transportRecord.type === 'string' ? transportRecord.type : '';
  if (type === 'http') {
    const url = typeof transportRecord.url === 'string' ? transportRecord.url.trim() : '';
    if (!url) return null;
    const headers = normalizeStringRecord(transportRecord.headers);
    return {
      type: 'http',
      url,
      ...(headers ? { headers } : {}),
    };
  }

  if (type === 'stdio') {
    const command = typeof transportRecord.command === 'string' ? transportRecord.command.trim() : '';
    if (!command) return null;
    const env = normalizeStringRecord(transportRecord.env);
    return {
      type: 'stdio',
      command,
      ...(Array.isArray(transportRecord.args)
        ? { args: transportRecord.args.filter((value: unknown): value is string => typeof value === 'string') }
        : {}),
      ...(typeof transportRecord.cwd === 'string' && transportRecord.cwd.trim().length > 0 ? { cwd: transportRecord.cwd } : {}),
      ...(env ? { env } : {}),
    };
  }

  return null;
}

interface RunAndEmitOpenMcpAppParams {
  transport: ExternalMcpTransportConfig;
  toolName: string;
  toolArguments?: Record<string, unknown>;
  serverName?: string;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

async function runAndEmitOpenMcpApp(params: RunAndEmitOpenMcpAppParams): Promise<Response> {
  try {
    const opened = await openMcpApp({
      transport: params.transport,
      toolName: params.toolName,
      ...(params.toolArguments ? { toolArguments: params.toolArguments } : {}),
      ...(params.serverName ? { serverName: params.serverName } : {}),
    });

    const toolCallId = randomExtAppToolCallId();
    const nodeTitle = params.title ?? opened.tool.title ?? opened.tool.name;

    emitPrimaryWorkbenchEvent('ext-app-open', {
      toolCallId,
      title: nodeTitle,
      html: opened.html,
      toolInput: opened.toolInput,
      serverName: opened.serverName,
      toolName: opened.toolName,
      appSessionId: opened.sessionId,
      transportConfig: params.transport,
      resourceUri: opened.resourceUri,
      toolDefinition: opened.tool,
      sessionStatus: 'ready',
      sessionError: null,
      ...(opened.resourceMeta ? { resourceMeta: opened.resourceMeta } : {}),
      ...(typeof params.x === 'number' ? { x: params.x } : {}),
      ...(typeof params.y === 'number' ? { y: params.y } : {}),
      ...(typeof params.width === 'number' ? { width: params.width } : {}),
      ...(typeof params.height === 'number' ? { height: params.height } : {}),
    });
    emitPrimaryWorkbenchEvent('ext-app-result', {
      toolCallId,
      serverName: opened.serverName,
      toolName: opened.toolName,
      success: opened.toolResult.isError !== true,
      result: opened.toolResult,
    });
    const nodeId = findCanvasExtAppNodeId(toolCallId);

    return responseJson({
      ok: true,
      nodeId,
      toolCallId,
      sessionId: opened.sessionId,
      resourceUri: opened.resourceUri,
      serverName: opened.serverName,
      toolName: opened.toolName,
    });
  } catch (error) {
    return responseJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, 400);
  }
}

async function handleCanvasOpenMcpApp(req: Request): Promise<Response> {
  const body = await readJson(req);
  const transport = parseExternalMcpTransportConfig(body);
  const toolName = typeof body.toolName === 'string' ? body.toolName.trim() : '';
  if (!transport || !toolName) {
    return responseJson({ ok: false, error: 'Missing valid transport or toolName.' }, 400);
  }

  const toolArguments =
    body.toolArguments && typeof body.toolArguments === 'object' && !Array.isArray(body.toolArguments)
      ? body.toolArguments as Record<string, unknown>
      : undefined;

  const requestedTitle = typeof body.title === 'string' && body.title.trim().length > 0
    ? body.title.trim()
    : undefined;
  const requestedServerName = typeof body.serverName === 'string' && body.serverName.trim().length > 0
    ? body.serverName.trim()
    : undefined;

  return runAndEmitOpenMcpApp({
    transport,
    toolName,
    ...(toolArguments ? { toolArguments } : {}),
    ...(requestedServerName ? { serverName: requestedServerName } : {}),
    ...(requestedTitle ? { title: requestedTitle } : {}),
    ...(typeof body.x === 'number' ? { x: body.x } : {}),
    ...(typeof body.y === 'number' ? { y: body.y } : {}),
    ...(typeof body.width === 'number' ? { width: body.width } : {}),
    ...(typeof body.height === 'number' ? { height: body.height } : {}),
  });
}

async function handleCanvasAddDiagram(req: Request): Promise<Response> {
  const body = await readJson(req);
  let built;
  try {
    built = buildExcalidrawOpenMcpAppInput({
      elements: body.elements,
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      ...(typeof body.x === 'number' ? { x: body.x } : {}),
      ...(typeof body.y === 'number' ? { y: body.y } : {}),
      ...(typeof body.width === 'number' ? { width: body.width } : {}),
      ...(typeof body.height === 'number' ? { height: body.height } : {}),
    });
  } catch (error) {
    return responseJson({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, 400);
  }
  return runAndEmitOpenMcpApp({
    transport: built.transport,
    toolName: built.toolName,
    toolArguments: built.toolArguments,
    serverName: built.serverName,
    ...(built.title ? { title: built.title } : {}),
    ...(typeof built.x === 'number' ? { x: built.x } : {}),
    ...(typeof built.y === 'number' ? { y: built.y } : {}),
    ...(typeof built.width === 'number' ? { width: built.width } : {}),
    ...(typeof built.height === 'number' ? { height: built.height } : {}),
  });
}

async function handleExtAppCallTool(req: Request): Promise<Response> {
  const body = await readJson(req);
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  const toolName = typeof body.toolName === 'string' ? body.toolName.trim() : '';
  if (!sessionId || !toolName) {
    return responseJson({ ok: false, error: 'Missing sessionId or toolName.' }, 400);
  }

  const args =
    body.arguments && typeof body.arguments === 'object' && !Array.isArray(body.arguments)
      ? body.arguments as Record<string, unknown>
      : undefined;
  const nodeId = typeof body.nodeId === 'string' ? body.nodeId.trim() : '';

  try {
    const result = await callMcpAppTool(sessionId, toolName, args);
    if (nodeId) {
      const node = canvasState.getNode(nodeId);
      if (node?.type === 'mcp-app' && node.data.mode === 'ext-app' && node.data.appSessionId === sessionId) {
        const nextData: Record<string, unknown> = {
          ...node.data,
          toolResult: result,
        };
        const nextModelContext: Record<string, unknown> = {};
        if (Array.isArray(result.content)) {
          nextModelContext.content = result.content;
        }
        if (result.structuredContent && typeof result.structuredContent === 'object' && !Array.isArray(result.structuredContent)) {
          nextModelContext.structuredContent = result.structuredContent;
        }
        if (Object.keys(nextModelContext).length > 0) {
          nextData.appModelContext = {
            ...nextModelContext,
            updatedAt: new Date().toISOString(),
          };
        }
        canvasState.updateNode(nodeId, {
          data: nextData,
        });
        broadcastWorkbenchEvent('canvas-layout-update', {
          layout: canvasState.getLayout(),
          sessionId: primaryWorkbenchSessionId,
          timestamp: new Date().toISOString(),
        });
      }
    }
    return responseJson({ ok: true, result });
  } catch (error) {
    return responseJson({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
  }
}

async function handleExtAppReadResource(req: Request): Promise<Response> {
  const body = await readJson(req);
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  const uri = typeof body.uri === 'string' ? body.uri.trim() : '';
  if (!sessionId || !uri) {
    return responseJson({ ok: false, error: 'Missing sessionId or uri.' }, 400);
  }

  try {
    const result = await readMcpAppResource(sessionId, uri);
    return responseJson({ ok: true, result });
  } catch (error) {
    return responseJson({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
  }
}

async function handleExtAppListTools(req: Request): Promise<Response> {
  const body = await readJson(req);
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId) return responseJson({ ok: false, error: 'Missing sessionId.' }, 400);

  try {
    const result: ListToolsResult = await listMcpAppTools(sessionId);
    return responseJson({ ok: true, result });
  } catch (error) {
    return responseJson({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
  }
}

async function handleExtAppListResources(req: Request): Promise<Response> {
  const body = await readJson(req);
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId) return responseJson({ ok: false, error: 'Missing sessionId.' }, 400);

  try {
    const result: ListResourcesResult = await listMcpAppResources(sessionId);
    return responseJson({ ok: true, result });
  } catch (error) {
    return responseJson({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
  }
}

async function handleExtAppListResourceTemplates(req: Request): Promise<Response> {
  const body = await readJson(req);
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId) return responseJson({ ok: false, error: 'Missing sessionId.' }, 400);

  try {
    const result: ListResourceTemplatesResult = await listMcpAppResourceTemplates(sessionId);
    return responseJson({ ok: true, result });
  } catch (error) {
    return responseJson({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
  }
}

async function handleExtAppListPrompts(req: Request): Promise<Response> {
  const body = await readJson(req);
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId) return responseJson({ ok: false, error: 'Missing sessionId.' }, 400);

  try {
    const result: ListPromptsResult = await listMcpAppPrompts(sessionId);
    return responseJson({ ok: true, result });
  } catch (error) {
    return responseJson({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
  }
}

async function handleExtAppModelContext(req: Request): Promise<Response> {
  const body = await readJson(req);
  const nodeId = typeof body.nodeId === 'string' ? body.nodeId.trim() : '';
  if (!nodeId) return responseJson({ ok: false, error: 'Missing nodeId.' }, 400);

  const node = canvasState.getNode(nodeId);
  if (!node) return responseJson({ ok: false, error: `Node "${nodeId}" not found.` }, 404);

  canvasState.updateNode(nodeId, {
    data: {
      ...node.data,
      appModelContext: {
        ...(Array.isArray(body.content) ? { content: body.content } : {}),
        ...(body.structuredContent && typeof body.structuredContent === 'object' && !Array.isArray(body.structuredContent)
          ? { structuredContent: body.structuredContent }
          : {}),
        updatedAt: new Date().toISOString(),
      },
    },
  });

  broadcastWorkbenchEvent('canvas-layout-update', {
    layout: canvasState.getLayout(),
    sessionId: primaryWorkbenchSessionId,
    timestamp: new Date().toISOString(),
  });
  return responseJson({ ok: true });
}

function handleWorkbenchState(): Response {
  const mcpAppHost = getMcpAppHostSnapshot();
  if (!primaryWorkbenchPath) {
    return responseJson({
      sessionId: primaryWorkbenchSessionId,
      path: null,
      title: null,
      mcpAppHost,
      updatedAt: new Date().toISOString(),
    });
  }

  const safePath = resolveWorkspaceMarkdownPath(primaryWorkbenchPath);
  if (!safePath || !existsSync(safePath)) {
    primaryWorkbenchPath = null;
    return responseJson({
      sessionId: primaryWorkbenchSessionId,
      path: null,
      title: null,
      mcpAppHost,
      updatedAt: new Date().toISOString(),
    });
  }

  const stat = statSync(safePath);
  return responseJson({
    sessionId: primaryWorkbenchSessionId,
    path: safePath,
    title: basename(safePath),
    mcpAppHost,
    updatedAt: new Date(stat.mtimeMs).toISOString(),
  });
}

function parseCanvasAutomationWebViewRequestBody(
  body: Record<string, unknown>,
): CanvasAutomationWebViewOptions {
  const backendValue = typeof body.backend === 'string' ? body.backend.trim() : '';
  const backend =
    backendValue === 'chrome' || backendValue === 'webkit'
      ? backendValue
      : undefined;

  const width = typeof body.width === 'number' ? body.width : undefined;
  const height = typeof body.height === 'number' ? body.height : undefined;
  const chromePath = typeof body.chromePath === 'string' ? body.chromePath : undefined;
  const dataStoreDir = typeof body.dataStoreDir === 'string' ? body.dataStoreDir : undefined;
  const chromeArgv = Array.isArray(body.chromeArgv)
    ? body.chromeArgv.filter((value): value is string => typeof value === 'string')
    : undefined;

  return {
    ...(backend ? { backend } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(chromePath ? { chromePath } : {}),
    ...(chromeArgv ? { chromeArgv } : {}),
    ...(dataStoreDir ? { dataStoreDir } : {}),
  };
}

function currentWorkbenchUrl(): string | null {
  return server && typeof server.port === 'number' ? `${loopbackBaseUrl(server.port)}/workbench` : null;
}

function handleWorkbenchWebViewStatus(): Response {
  return responseJson(getCanvasAutomationWebViewStatus());
}

async function handleWorkbenchWebViewStart(req: Request): Promise<Response> {
  const url = currentWorkbenchUrl();
  if (!url) {
    return responseJson({ ok: false, error: 'Canvas server is not running.' }, 503);
  }

  const body = await readJson(req);
  const options = parseCanvasAutomationWebViewRequestBody(body);

  try {
    const webview = await startCanvasAutomationWebView(url, options);
    return responseJson({ ok: true, webview });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = hasCanvasAutomationWebViewSupport() ? 500 : 501;
    return responseJson({
      ok: false,
      error: message,
      webview: getCanvasAutomationWebViewStatus(),
    }, status);
  }
}

async function handleWorkbenchWebViewStop(): Promise<Response> {
  try {
    const stopped = await stopCanvasAutomationWebView();
    return responseJson({
      ok: true,
      stopped,
      webview: getCanvasAutomationWebViewStatus(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return responseJson({
      ok: false,
      error: message,
      webview: getCanvasAutomationWebViewStatus(),
    }, 500);
  }
}

async function handleWorkbenchWebViewEvaluate(req: Request): Promise<Response> {
  const body = await readJson(req);
  const expression = typeof body.expression === 'string' ? body.expression.trim() : '';
  const script = typeof body.script === 'string' ? body.script.trim() : '';
  if ((expression ? 1 : 0) + (script ? 1 : 0) !== 1) {
    return responseJson({
      ok: false,
      error: 'Pass exactly one of "expression" (single JS expression) or "script" (multi-statement body, wrapped in an IIFE).',
    }, 400);
  }
  const source = script ? `(() => {\n${script}\n})()` : expression;

  try {
    const value = await evaluateCanvasAutomationWebView(source);
    return responseJson({ ok: true, value });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return responseJson({ ok: false, error: message, webview: getCanvasAutomationWebViewStatus() }, 400);
  }
}

async function handleWorkbenchWebViewResize(req: Request): Promise<Response> {
  const body = await readJson(req);
  const width = typeof body.width === 'number' ? body.width : NaN;
  const height = typeof body.height === 'number' ? body.height : NaN;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return responseJson({ ok: false, error: 'Missing required positive numeric fields: width, height.' }, 400);
  }

  try {
    const webview = await resizeCanvasAutomationWebView(width, height);
    return responseJson({ ok: true, webview });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return responseJson({ ok: false, error: message, webview: getCanvasAutomationWebViewStatus() }, 400);
  }
}

async function handleWorkbenchWebViewScreenshot(req: Request): Promise<Response> {
  const body = await readJson(req);
  const format = body.format === 'jpeg' || body.format === 'webp' || body.format === 'png'
    ? body.format
    : 'png';
  const quality = typeof body.quality === 'number' ? body.quality : undefined;

  try {
    const bytes = await screenshotCanvasAutomationWebView({
      format,
      ...(quality !== undefined ? { quality } : {}),
    });
    const responseBytes = Uint8Array.from(bytes);
    const mimeType = format === 'jpeg'
      ? 'image/jpeg'
      : format === 'webp'
        ? 'image/webp'
        : 'image/png';
    return new Response(responseBytes.buffer, {
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return responseJson({ ok: false, error: message, webview: getCanvasAutomationWebViewStatus() }, 400);
  }
}

async function handleWorkbenchOpen(req: Request): Promise<Response> {
  const body = await readJson(req);
  const pathLike = typeof body.path === 'string' ? body.path : '';
  const safePath = resolveWorkspaceMarkdownPath(pathLike);
  if (!safePath) return responseText('Invalid path', 400);
  if (!existsSync(safePath)) return responseText('File not found', 404);
  rotatePrimaryWorkbenchSessionIfNeeded();
  setPrimaryWorkbenchPath(safePath, 'api');
  return handleWorkbenchState();
}

async function handleWorkbenchIntent(req: Request): Promise<Response> {
  const body = await readJson(req);
  const rawType = typeof body.type === 'string' ? body.type.trim() : '';
  if (!rawType) return responseText('Missing intent type', 400);
  if (!ALLOWED_WORKBENCH_INTENTS.has(rawType as PrimaryWorkbenchIntent['type'])) {
    return responseText('Unsupported intent type', 400);
  }

  const rawPayload = body.payload;
  const payload =
    rawPayload && typeof rawPayload === 'object'
      ? (rawPayload as PrimaryWorkbenchEventPayload)
      : {};

  // Handle trace intents directly on the server
  if (rawType === 'trace-toggle') {
    const enabled = payload.enabled === true;
    traceManager.setEnabled(enabled);
    emitPrimaryWorkbenchEvent('trace-state', { enabled });
    return responseJson({ ok: true, traceEnabled: enabled });
  }
  if (rawType === 'trace-clear') {
    const count = traceManager.getTraceNodeCount();
    const note =
      count === 0 && traceManager.enabled
        ? 'Trace is enabled, but no tool or subagent activity has been recorded yet.'
        : count === 0
          ? 'Trace is already empty.'
          : undefined;
    traceManager.clearTrace();
    emitPrimaryWorkbenchEvent('trace-state', { enabled: traceManager.enabled });
    return responseJson({
      ok: true,
      removed: count,
      traceEnabled: traceManager.enabled,
      ...(note ? { note } : {}),
    });
  }

  const intent = enqueuePrimaryWorkbenchIntent(rawType as PrimaryWorkbenchIntent['type'], payload);
  return responseJson({ ok: true, intent });
}

function handleWorkbenchEvents(req: Request): Response {
  const reqUrl = new URL(req.url);
  const requestedSessionId = reqUrl.searchParams.get('session')?.trim() ?? '';
  const continuity =
    requestedSessionId.length === 0
      ? 'fresh'
      : requestedSessionId === primaryWorkbenchSessionId
        ? 'resumed'
        : 'rotated';
  const subscriberId = nextWorkbenchSubscriberId++;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      workbenchSubscribers.set(subscriberId, controller);
      syncCanvasBrowserOpenedFromSubscribers();
      controller.enqueue(
        toSseFrame('connected', {
          sessionId: primaryWorkbenchSessionId,
          requestedSessionId: requestedSessionId || null,
          continuity,
          path: primaryWorkbenchPath,
          theme: canvasThemeSetting,
          timestamp: new Date().toISOString(),
        }),
      );
      if (primaryWorkbenchPath) {
        controller.enqueue(
          toSseFrame('workbench-open', {
            sessionId: primaryWorkbenchSessionId,
            path: primaryWorkbenchPath,
            title: basename(primaryWorkbenchPath),
            source: 'snapshot',
            updatedAt: new Date().toISOString(),
          }),
        );
      }
      if (lastWorkbenchContextCardsEnvelope) {
        controller.enqueue(
          toSseFrame('context-cards', {
            ...lastWorkbenchContextCardsEnvelope,
            sessionId: primaryWorkbenchSessionId,
            timestamp: new Date().toISOString(),
          }),
        );
      }
      controller.enqueue(
        toSseFrame('mcp-app-host-snapshot', {
          reason: 'connect-snapshot',
          ...getMcpAppHostSnapshot(),
          timestamp: new Date().toISOString(),
        }),
      );
      const layout = canvasState.getLayout();
      controller.enqueue(
        toSseFrame('canvas-layout-update', {
          layout,
          sessionId: primaryWorkbenchSessionId,
          timestamp: new Date().toISOString(),
        }),
      );
      controller.enqueue(
        toSseFrame('context-pins-changed', {
          count: canvasState.contextPinnedNodeIds.size,
          nodeIds: Array.from(canvasState.contextPinnedNodeIds),
          sessionId: primaryWorkbenchSessionId,
          timestamp: new Date().toISOString(),
        }),
      );
      pingTimer = setInterval(() => {
        try {
          controller.enqueue(
            toSseFrame('ping', {
              ts: Date.now(),
              sessionId: primaryWorkbenchSessionId,
            }),
          );
        } catch (error) {
          sessionDiagLog('drop-subscriber-after-ping-failure', {
            subscriberId,
            error: error instanceof Error ? error.message : String(error),
          });
          if (pingTimer) clearInterval(pingTimer);
          pingTimer = null;
          workbenchSubscribers.delete(subscriberId);
          syncCanvasBrowserOpenedFromSubscribers();
        }
      }, 8000);
    },
    cancel() {
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
      workbenchSubscribers.delete(subscriberId);
      syncCanvasBrowserOpenedFromSubscribers();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

async function handleSave(req: Request): Promise<Response> {
  const body = await readJson(req);
  const pathLike = typeof body.path === 'string' ? body.path : '';
  const safePath = resolveWorkspaceMarkdownPath(pathLike);
  if (!safePath) return responseText('Invalid path', 400);

  const content = typeof body.content === 'string' ? body.content : '';
  const normalized = content.replace(/\r\n?/g, '\n');
  writeFileSync(safePath, normalized, 'utf-8');
  return responseJson({
    ok: true,
    path: safePath,
    updatedAt: new Date().toISOString(),
  });
}

async function handleRender(req: Request): Promise<Response> {
  const body = await readJson(req);
  const markdown = typeof body.markdown === 'string' ? body.markdown : '';
  const html =
    (marked.parse(normalizeMarkdownExternalUrls(markdown), {
      gfm: true,
      breaks: true,
    }) as string) || '';
  return responseJson({ html });
}

function buildSelectionContextPreamble(contextNodeIds: string[]): string {
  const nodes = contextNodeIds
    .map((id) => canvasState.getNode(id))
    .filter((node): node is CanvasNodeState => node !== undefined);
  return buildAgentContextPreamble(nodes, {
    defaultTextLength: 700,
    webpageTextLength: 1600,
  });
}

async function handleCanvasPrompt(req: Request): Promise<Response> {
  const body = await readJson(req);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return responseText('Missing prompt text', 400);

  const threadNodeId = typeof body.threadNodeId === 'string' ? body.threadNodeId : undefined;
  const position = body.position as { x: number; y: number } | undefined;
  const parentNodeId = typeof body.parentNodeId === 'string' ? body.parentNodeId : undefined;
  const MAX_CONTEXT_NODES = 20;
  let contextNodeIds = Array.isArray(body.contextNodeIds)
    ? (body.contextNodeIds.filter((id: unknown) => typeof id === 'string') as string[]).slice(
        0,
        MAX_CONTEXT_NODES,
      )
    : [];

  if (contextNodeIds.length === 0 && canvasState.contextPinnedNodeIds.size > 0) {
    contextNodeIds = Array.from(canvasState.contextPinnedNodeIds).slice(0, MAX_CONTEXT_NODES);
  }

  // ── Thread reply: append user turn to existing thread node ──
  if (threadNodeId) {
    let threadNode = canvasState.getNode(threadNodeId);
    if (!threadNode) {
      const promptCount = canvasState
        .getLayout()
        .nodes.filter((n) => n.type === 'prompt' || n.type === 'response').length;
      const pos = position ?? { x: 380 + promptCount * 30, y: 1260 + promptCount * 30 };
      canvasState.addNode({
        id: threadNodeId,
        type: 'prompt',
        position: pos,
        size: { width: 520, height: 400 },
        zIndex: 1,
        collapsed: false,
        pinned: false,
        dockPosition: null,
        data: {
          text,
          turns: [],
          threadStatus: 'draft',
          contextNodeIds: contextNodeIds.length > 0 ? contextNodeIds : undefined,
        },
      });
      if (parentNodeId && canvasState.getNode(parentNodeId)) {
        canvasState.addEdge({
          id: `edge-${parentNodeId}-${threadNodeId}`,
          from: parentNodeId,
          to: threadNodeId,
          type: 'flow',
          style: 'dashed',
        });
      }
      for (const ctxId of contextNodeIds) {
        if (canvasState.getNode(ctxId)) {
          canvasState.addEdge({
            id: `edge-ctx-${ctxId}-${threadNodeId}`,
            from: ctxId,
            to: threadNodeId,
            type: 'references',
            style: 'dashed',
          });
        }
      }
      const createdThreadNode = canvasState.getNode(threadNodeId);
      if (!createdThreadNode) {
        return responseJson({ ok: false, error: 'Failed to initialize canvas thread.' }, 500);
      }
      threadNode = createdThreadNode;
    }

    const MAX_THREAD_TURNS = 100;
    const existingTurnCount = Array.isArray(threadNode.data.turns)
      ? (threadNode.data.turns as unknown[]).length
      : 0;
    if (existingTurnCount >= MAX_THREAD_TURNS) {
      return responseText('Thread has reached the maximum number of turns', 400);
    }

    const currentTurns = Array.isArray(threadNode.data.turns)
      ? [...(threadNode.data.turns as Array<Record<string, unknown>>)]
      : [];
    currentTurns.push({ role: 'user', text, status: 'pending' });

    if (contextNodeIds.length === 0 && Array.isArray(threadNode.data.contextNodeIds)) {
      contextNodeIds = threadNode.data.contextNodeIds as string[];
    }

    canvasState.updateNode(threadNodeId, {
      data: { ...threadNode.data, turns: currentTurns, threadStatus: 'pending' },
    });

    let enrichedText = text;
    if (contextNodeIds.length > 0) {
      const preamble = buildSelectionContextPreamble(contextNodeIds);
      if (preamble) {
        enrichedText = `${preamble}User question: ${text}`;
      }
    }

    broadcastWorkbenchEvent('canvas-prompt-created', {
      nodeId: threadNodeId,
      threadNodeId,
      text,
      sessionId: primaryWorkbenchSessionId,
      timestamp: new Date().toISOString(),
    });

    broadcastWorkbenchEvent('canvas-prompt-status', {
      nodeId: threadNodeId,
      status: 'pending',
    });

    const promptRequest: PrimaryWorkbenchCanvasPromptRequest = {
      nodeId: threadNodeId,
      text: enrichedText,
      displayText: text,
      parentNodeId: threadNodeId,
      contextNodeIds,
    };

    if (primaryWorkbenchCanvasPromptHandler) {
      try {
        await primaryWorkbenchCanvasPromptHandler(promptRequest);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        broadcastWorkbenchEvent('canvas-prompt-status', {
          nodeId: threadNodeId,
          status: 'error',
          error: message,
        });
        return responseJson({ ok: false, error: message }, 409);
      }
    } else {
      enqueuePrimaryWorkbenchIntent('canvas-prompt', {
        nodeId: threadNodeId,
        text: enrichedText,
        parentNodeId: threadNodeId,
        contextNodeIds,
      });
    }

    return responseJson({ ok: true, nodeId: threadNodeId });
  }

  // ── New prompt: create fresh prompt node ──
  const suffix = Math.random().toString(36).slice(2, 8);
  const nodeId = `prompt-${Date.now()}-${suffix}`;

  const promptCount = canvasState
    .getLayout()
    .nodes.filter((n) => n.type === 'prompt' || n.type === 'response').length;
  const pos = position ?? { x: 380 + promptCount * 30, y: 1260 + promptCount * 30 };

  let enrichedText = text;
  if (contextNodeIds.length > 0) {
    const preamble = buildSelectionContextPreamble(contextNodeIds);
    if (preamble) {
      enrichedText = `${preamble}User question: ${text}`;
    }
  }

  canvasState.addNode({
    id: nodeId,
    type: 'prompt',
    position: pos,
    size: { width: 520, height: 400 },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    dockPosition: null,
    data: {
      text,
      turns: [{ role: 'user', text, status: 'pending' }],
      threadStatus: 'pending',
      status: 'pending',
      parentNodeId,
      contextNodeIds: contextNodeIds.length > 0 ? contextNodeIds : undefined,
    },
  });

  if (parentNodeId && canvasState.getNode(parentNodeId)) {
    canvasState.addEdge({
      id: `edge-${parentNodeId}-${nodeId}`,
      from: parentNodeId,
      to: nodeId,
      type: 'flow',
      style: 'dashed',
    });
  }

  for (const ctxId of contextNodeIds) {
    if (canvasState.getNode(ctxId)) {
      canvasState.addEdge({
        id: `edge-ctx-${ctxId}-${nodeId}`,
        from: ctxId,
        to: nodeId,
        type: 'references',
        style: 'dashed',
      });
    }
  }

  broadcastWorkbenchEvent('canvas-prompt-created', {
    nodeId,
    text,
    position: pos,
    parentNodeId,
    contextNodeIds,
    sessionId: primaryWorkbenchSessionId,
    timestamp: new Date().toISOString(),
  });

  const promptRequest: PrimaryWorkbenchCanvasPromptRequest = {
    nodeId,
    text: enrichedText,
    displayText: text,
    ...(parentNodeId ? { parentNodeId } : {}),
    contextNodeIds,
  };

  if (primaryWorkbenchCanvasPromptHandler) {
    try {
      await primaryWorkbenchCanvasPromptHandler(promptRequest);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      broadcastWorkbenchEvent('canvas-prompt-status', {
        nodeId,
        status: 'error',
        error: message,
      });
      return responseJson({ ok: false, error: message }, 409);
    }
  } else {
    enqueuePrimaryWorkbenchIntent('canvas-prompt', {
      nodeId,
      text: enrichedText,
      parentNodeId,
      contextNodeIds,
    });
  }

  return responseJson({ ok: true, nodeId });
}

async function handleSnapshotSave(req: Request): Promise<Response> {
  const body = await readJson(req);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return responseText('Missing snapshot name', 400);
  const snapshot = saveCanvasSnapshot(name);
  if (!snapshot) return responseText('Failed to save snapshot', 500);
  return responseJson({ ok: true, snapshot });
}

async function handleContextPinsUpdate(req: Request): Promise<Response> {
  const body = await readJson(req);
  const MAX_PINS = 20;
  const nodeIds = Array.isArray(body.nodeIds)
    ? (body.nodeIds.filter((id: unknown) => typeof id === 'string') as string[]).slice(0, MAX_PINS)
    : [];
  const result = setCanvasContextPins(nodeIds, 'set');
  broadcastWorkbenchEvent('context-pins-changed', {
    count: result.count,
    nodeIds: result.nodeIds,
    sessionId: primaryWorkbenchSessionId,
    timestamp: new Date().toISOString(),
  });
  return responseJson({ ok: true, count: result.count });
}

function handleGetPinnedContext(): Response {
  const pinnedIds = Array.from(canvasState.contextPinnedNodeIds);
  const preamble = pinnedIds.length > 0 ? buildSelectionContextPreamble(pinnedIds) : '';
  const nodes = pinnedIds
    .map((id) => canvasState.getNode(id))
    .filter((node): node is CanvasNodeState => node !== undefined)
    .map((node) => serializeNodeForAgentContext(node, {
      defaultTextLength: 700,
      webpageTextLength: 1600,
      includePosition: true,
    }));
  return responseJson({ preamble, nodeIds: pinnedIds, count: pinnedIds.length, nodes });
}

// ── Port resolution ───────────────────────────────────────────

function buildPortCandidates(preferredPort: number): number[] {
  const candidates: number[] = [];
  const push = (value: number) => {
    const normalized = Number.isFinite(value) ? Math.floor(value) : 0;
    if (normalized < 0) return;
    if (candidates.includes(normalized)) return;
    candidates.push(normalized);
  };

  push(preferredPort > 0 ? preferredPort : DEFAULT_PORT);
  push(DEFAULT_PORT);
  for (let offset = 1; offset <= 8; offset++) {
    push(DEFAULT_PORT + offset);
  }
  push(0);
  return candidates;
}

function loopbackBaseUrl(port: number): string {
  return `http://${DEFAULT_HOST}:${port}`;
}

// ── Browser opening ───────────────────────────────────────────

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function resolveMacBrowserForCanvas(): { appName: string; appPath: string } | null {
  const candidates = [
    { appName: 'Google Chrome', appPath: '/Applications/Google Chrome.app' },
    { appName: 'Chromium', appPath: '/Applications/Chromium.app' },
    { appName: 'Microsoft Edge', appPath: '/Applications/Microsoft Edge.app' },
    { appName: 'Safari', appPath: '/Applications/Safari.app' },
  ];
  return candidates.find((candidate) => existsSync(candidate.appPath)) ?? null;
}

export function buildMacBrowserOpenScript(appName: string, url: string): string {
  const escapedUrl = escapeAppleScriptString(url);

  if (appName === 'Safari') {
    return [
      `tell application "${appName}"`,
      'launch',
      `set targetUrl to "${escapedUrl}"`,
      'set reusedDocument to false',
      'set startupDocumentIndex to 0',
      'set documentIndex to 0',
      'repeat with d in documents',
      '  set documentIndex to documentIndex + 1',
      '  try',
      '    set currentUrl to URL of d',
      '  on error',
      '    set currentUrl to ""',
      '  end try',
      '  if currentUrl contains "/workbench" then',
      '    set URL of d to targetUrl',
      '    set current tab of front window to current tab of d',
      '    set reusedDocument to true',
      '    exit repeat',
      '  end if',
      '  if startupDocumentIndex = 0 and (currentUrl is "" or currentUrl is "about:blank" or currentUrl starts with "favorites://") then',
      '    set startupDocumentIndex to documentIndex',
      '  end if',
      'end repeat',
      'if not reusedDocument then',
      '  if startupDocumentIndex > 0 then',
      '    set URL of document startupDocumentIndex to targetUrl',
      '  else',
      '    make new document with properties {URL:targetUrl}',
      '  end if',
      'end if',
      'activate',
      'end tell',
    ].join('\n');
  }

  return [
    `tell application "${appName}"`,
    'launch',
    `set targetUrl to "${escapedUrl}"`,
    'set reusedTab to false',
    'set startupWindowIndex to 0',
    'set startupTabIndex to 0',
    'set windowIndex to 0',
    'repeat with w in windows',
    '  set windowIndex to windowIndex + 1',
    '  set tabIndex to 0',
    '  repeat with t in tabs of w',
    '    set tabIndex to tabIndex + 1',
    '    try',
    '      set currentUrl to URL of t',
    '    on error',
    '      set currentUrl to ""',
    '    end try',
    '    if currentUrl contains "/workbench" then',
    '      set active tab index of w to tabIndex',
    '      set URL of active tab of w to targetUrl',
    '      set index of w to 1',
    '      set reusedTab to true',
    '      exit repeat',
    '    end if',
    '    if startupWindowIndex = 0 and (currentUrl is "" or currentUrl is "about:blank" or currentUrl starts with "chrome://newtab" or currentUrl starts with "chrome-search://") then',
    '      set startupWindowIndex to windowIndex',
    '      set startupTabIndex to tabIndex',
    '    end if',
    '  end repeat',
    '  if reusedTab then exit repeat',
    'end repeat',
    'if not reusedTab then',
    '  if startupWindowIndex > 0 then',
    '    set targetWindow to window startupWindowIndex',
    '    set active tab index of targetWindow to startupTabIndex',
    '    set URL of active tab of targetWindow to targetUrl',
    '    set index of targetWindow to 1',
    '  else if (count of windows) = 0 then',
    '    make new window',
    '    set URL of active tab of front window to targetUrl',
    '  else',
    '    tell front window',
    '      make new tab with properties {URL:targetUrl}',
    '      set active tab index to (count of tabs)',
    '    end tell',
    '  end if',
    'end if',
    'activate',
    'end tell',
  ].join('\n');
}

function resolveWindowsBrowserForCanvas(): { name: string; exe: string } | null {
  const envDirs = [
    process.env.PROGRAMFILES,
    process.env['PROGRAMFILES(X86)'],
    process.env.LOCALAPPDATA,
  ].filter((d): d is string => Boolean(d));

  const browsers = [
    { name: 'Edge', subpath: join('Microsoft', 'Edge', 'Application', 'msedge.exe') },
    { name: 'Chrome', subpath: join('Google', 'Chrome', 'Application', 'chrome.exe') },
  ];

  for (const { name, subpath } of browsers) {
    for (const dir of envDirs) {
      const exe = join(dir, subpath);
      if (existsSync(exe)) return { name, exe };
    }
  }
  return null;
}

export function openUrlInExternalBrowser(url: string): boolean {
  try {
    if (process.env.PMX_CANVAS_DISABLE_BROWSER_OPEN === '1') {
      return false;
    }
    if (process.platform === 'darwin') {
      const browser = resolveMacBrowserForCanvas();
      const script = browser
        ? buildMacBrowserOpenScript(browser.appName, url)
        : `open location "${escapeAppleScriptString(url)}"`;
      const result = spawnSync('osascript', ['-e', script], { stdio: 'ignore' });
      return !result.error && result.status === 0;
    }
    if (process.platform === 'win32') {
      const browser = resolveWindowsBrowserForCanvas();
      const result = browser
        ? spawnSync(browser.exe, [url], { stdio: 'ignore' })
        : spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
      return !result.error && result.status === 0;
    }
    const result = spawnSync('xdg-open', [url], { stdio: 'ignore' });
    return !result.error && result.status === 0;
  } catch (error) {
    logWorkbenchWarning('openUrlInExternalBrowser', error, { url });
    return false;
  }
}

// ── Sync SSE events to canvas state ───────────────────────────

function syncContextNodeToCanvasState(
  dataPatch: Record<string, unknown>,
  options: { forceCreate?: boolean } = {},
): void {
  const id = 'context-main';
  const existing = canvasState.getNode(id);
  const mergedData = { ...(existing?.data ?? {}), ...dataPatch };
  const cards = Array.isArray(mergedData.cards) ? mergedData.cards : [];
  const auxTabs = Array.isArray(mergedData.auxTabs) ? mergedData.auxTabs : [];
  const hasUsage =
    mergedData.currentTokens !== undefined ||
    mergedData.tokenLimit !== undefined ||
    mergedData.messagesLength !== undefined ||
    mergedData.utilization !== undefined ||
    mergedData.nearLimit !== undefined;
  const shouldCreate =
    options.forceCreate === true || cards.length > 0 || auxTabs.length > 0 || hasUsage;

  if (!existing) {
    if (!shouldCreate) return;
    canvasState.addNode({
      id,
      type: 'context',
      position: { x: 1130, y: 80 },
      size: { width: 320, height: 400 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      dockPosition: null,
      data: mergedData,
    });
    return;
  }

  canvasState.updateNode(id, { data: mergedData });
}

// Maps responseNodeId -> thread prompt node ID for O(1) routing of response events
const serverResponseToThreadMap = new Map<string, string>();

function syncEventToCanvasState(event: string, payload: PrimaryWorkbenchEventPayload): void {
  if (event === 'workbench-open') {
    const path = payload.path as string;
    if (!path) return;
    const title = (payload.title as string) || basename(path);
    const id = `md-${hashPath(path)}`;

    if (!canvasState.getNode(id)) {
      const placement = getMarkdownPlacement();
      canvasState.addNode({
        id,
        type: 'markdown',
        position: placement,
        size: { width: 720, height: 600 },
        zIndex: 1,
        collapsed: false,
        pinned: false,
        dockPosition: null,
        data: { path, title, content: '', rendered: '' },
      });
    } else {
      const existing = canvasState.getNode(id);
      if (!existing) return;
      canvasState.updateNode(id, { data: { ...existing.data, path, title } });
    }

    broadcastWorkbenchEvent('canvas-layout-update', {
      layout: canvasState.getLayout(),
      sessionId: primaryWorkbenchSessionId,
      timestamp: new Date().toISOString(),
    });
  } else if (event === 'ext-app-open') {
    const toolCallId = payload.toolCallId as string;
    if (!toolCallId) return;
    const id = `ext-app-${toolCallId}`;
    const dataPatch = {
      mode: 'ext-app',
      toolCallId,
      ...(typeof payload.title === 'string' && payload.title.trim().length > 0
        ? { title: payload.title.trim() }
        : {}),
      html: payload.html,
      toolInput: payload.toolInput,
      serverName: payload.serverName,
      toolName: payload.toolName,
      appSessionId: payload.appSessionId,
      transportConfig: payload.transportConfig,
      resourceUri: payload.resourceUri,
      toolDefinition: payload.toolDefinition,
      resourceMeta: payload.resourceMeta,
      sessionStatus: payload.sessionStatus,
      sessionError: payload.sessionError,
      hostMode: 'hosted',
      trustedDomain: true,
      ...(payload.chartConfig ? { chartConfig: payload.chartConfig } : {}),
    };
    const existing = canvasState.getNode(id);
    if (existing) {
      const previousSessionId = nodeAppSessionId(existing);
      const nextSessionId = typeof payload.appSessionId === 'string' ? payload.appSessionId : null;
      if (previousSessionId && nextSessionId && previousSessionId !== nextSessionId) {
        closeMcpAppSession(previousSessionId);
      }
      canvasState.updateNode(id, { data: { ...existing.data, ...dataPatch } });
    } else {
      const reusableNodeId =
        typeof payload.serverName === 'string' &&
        typeof payload.toolName === 'string' &&
        payload.serverName &&
        payload.toolName
          ? findReusableCanvasExtAppNodeId(payload.serverName, payload.toolName)
          : null;
      if (reusableNodeId) {
        const reusableNode = canvasState.getNode(reusableNodeId);
        if (!reusableNode) return;
        const previousSessionId = nodeAppSessionId(reusableNode);
        const nextSessionId = typeof payload.appSessionId === 'string' ? payload.appSessionId : null;
        if (previousSessionId && nextSessionId && previousSessionId !== nextSessionId) {
          closeMcpAppSession(previousSessionId);
        }
        canvasState.updateNode(reusableNodeId, {
          data: { ...reusableNode.data, ...dataPatch },
        });
        return;
      }
      const pw = typeof payload.width === 'number' ? payload.width : 720;
      const ph = typeof payload.height === 'number' ? payload.height : 500;
      const autoPos = findOpenCanvasPosition(canvasState.getLayout().nodes, pw, ph);
      const px = typeof payload.x === 'number' ? payload.x : autoPos.x;
      const py = typeof payload.y === 'number' ? payload.y : autoPos.y;
      canvasState.addNode({
        id,
        type: 'mcp-app',
        position: { x: px, y: py },
        size: { width: pw, height: ph },
        zIndex: 1,
        collapsed: false,
        pinned: false,
        dockPosition: null,
        data: dataPatch,
      });
    }
  } else if (event === 'ext-app-update') {
    const toolCallId = payload.toolCallId as string;
    if (!toolCallId) return;
    const id =
      findCanvasExtAppNodeId(toolCallId) ||
      (typeof payload.serverName === 'string' && typeof payload.toolName === 'string'
        ? findOnlyPendingCanvasExtAppNodeId(payload.serverName, payload.toolName)
        : null);
    if (!id) return;
    const existing = canvasState.getNode(id);
    if (existing) {
      canvasState.updateNode(id, { data: { ...existing.data, html: payload.html } });
    }
  } else if (event === 'ext-app-result') {
    const toolCallId = payload.toolCallId as string;
    if (!toolCallId) return;
    const id =
      findCanvasExtAppNodeId(toolCallId) ||
      (typeof payload.serverName === 'string' && typeof payload.toolName === 'string'
        ? findOnlyPendingCanvasExtAppNodeId(payload.serverName, payload.toolName)
        : null);
    if (!id) return;
    if (payload.success === false) {
      closeNodeAppSession(canvasState.getNode(id));
      canvasState.removeNode(id);
      return;
    }
    const existing = canvasState.getNode(id);
    if (existing) {
      canvasState.updateNode(id, {
        data: {
          ...existing.data,
          toolResult: normalizeExtAppToolResult({
            result: payload.result,
            success: typeof payload.success === 'boolean' ? payload.success : undefined,
            error: typeof payload.error === 'string' ? payload.error : undefined,
            content: typeof payload.content === 'string' ? payload.content : undefined,
            detailedContent:
              typeof payload.detailedContent === 'string' ? payload.detailedContent : undefined,
          }),
        },
      });
    }
  } else if (event === 'context-cards') {
    syncContextNodeToCanvasState(
      { cards: Array.isArray(payload.cards) ? payload.cards : [] },
      { forceCreate: true },
    );
  } else if (event === 'context-usage') {
    syncContextNodeToCanvasState({
      currentTokens: payload.currentTokens,
      tokenLimit: payload.tokenLimit,
      messagesLength: payload.messagesLength,
      utilization: payload.utilization,
      nearLimit: payload.nearLimit,
    });
  } else if (event === 'aux-open') {
    const existing = canvasState.getNode('context-main');
    const auxTabs = Array.isArray(existing?.data.auxTabs)
      ? [...(existing.data.auxTabs as Array<Record<string, unknown>>), payload]
      : [payload];
    syncContextNodeToCanvasState({ auxTabs }, { forceCreate: true });
  } else if (event === 'aux-close') {
    const existing = canvasState.getNode('context-main');
    if (!existing) return;
    if (payload.mode === 'all') {
      syncContextNodeToCanvasState({ auxTabs: [] });
      return;
    }
    const auxTabs = Array.isArray(existing.data.auxTabs)
      ? (existing.data.auxTabs as Array<Record<string, unknown>>).filter(
          (tab) => tab.id !== payload.id,
        )
      : [];
    syncContextNodeToCanvasState({ auxTabs });
  } else if (event === 'canvas-status' || event === 'execution-phase') {
    const id = 'status-main';
    if (!canvasState.getNode(id)) {
      canvasState.addNode({
        id,
        type: 'status',
        position: { x: 40, y: 80 },
        size: { width: 300, height: 120 },
        zIndex: 0,
        collapsed: false,
        pinned: false,
        dockPosition: 'left',
        data: { phase: 'idle', message: '', elapsed: 0 },
      });
    }
  } else if (event === 'canvas-response-start') {
    const responseNodeId = payload.responseNodeId as string;
    const promptNodeId = payload.promptNodeId as string;
    if (!responseNodeId) return;

    const promptNode = promptNodeId ? canvasState.getNode(promptNodeId) : null;
    if (promptNode && Array.isArray(promptNode.data.turns)) {
      serverResponseToThreadMap.set(responseNodeId, promptNodeId);
      const currentTurns = [...(promptNode.data.turns as Array<Record<string, unknown>>)];
      currentTurns.push({ role: 'assistant', text: '', status: 'streaming' });
      canvasState.updateNode(promptNodeId, {
        data: {
          ...promptNode.data,
          turns: currentTurns,
          threadStatus: 'streaming',
          _activeResponseId: responseNodeId,
        },
      });
      return;
    }

    const pos = promptNode
      ? { x: promptNode.position.x, y: promptNode.position.y + promptNode.size.height + 24 }
      : { x: 380, y: 1480 };

    canvasState.addNode({
      id: responseNodeId,
      type: 'response',
      position: pos,
      size: { width: 720, height: 400 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      dockPosition: null,
      data: { content: '', status: 'streaming', promptNodeId },
    });

    if (promptNodeId) {
      canvasState.addEdge({
        id: `edge-${promptNodeId}-${responseNodeId}`,
        from: promptNodeId,
        to: responseNodeId,
        type: 'flow',
        animated: true,
      });
    }
  } else if (event === 'canvas-response-delta') {
    const responseNodeId = payload.responseNodeId as string;
    if (!responseNodeId) return;

    const threadId = serverResponseToThreadMap.get(responseNodeId);
    if (threadId) {
      const node = canvasState.getNode(threadId);
      if (node && Array.isArray(node.data.turns)) {
        const currentTurns = [...(node.data.turns as Array<Record<string, unknown>>)];
        const lastTurn = currentTurns[currentTurns.length - 1];
        if (lastTurn && lastTurn.role === 'assistant') {
          lastTurn.text = payload.content as string;
          lastTurn.status = 'streaming';
        }
        canvasState.updateNode(threadId, {
          data: { ...node.data, turns: currentTurns, threadStatus: 'streaming' },
        });
        return;
      }
    }

    const existing = canvasState.getNode(responseNodeId);
    if (existing) {
      canvasState.updateNode(responseNodeId, {
        data: { ...existing.data, content: payload.content, status: 'streaming' },
      });
    }
  } else if (event === 'canvas-response-complete') {
    const responseNodeId = payload.responseNodeId as string;
    if (!responseNodeId) return;

    const threadId = serverResponseToThreadMap.get(responseNodeId);
    if (threadId) {
      const node = canvasState.getNode(threadId);
      if (node && Array.isArray(node.data.turns)) {
        const currentTurns = [...(node.data.turns as Array<Record<string, unknown>>)];
        const lastTurn = currentTurns[currentTurns.length - 1];
        if (lastTurn && lastTurn.role === 'assistant') {
          lastTurn.text = payload.content as string;
          lastTurn.status = 'complete';
        }
        canvasState.updateNode(threadId, {
          data: {
            ...node.data,
            turns: currentTurns,
            threadStatus: 'answered',
            _activeResponseId: undefined,
          },
        });
      }
      serverResponseToThreadMap.delete(responseNodeId);
      return;
    }

    const existing = canvasState.getNode(responseNodeId);
    if (existing) {
      canvasState.updateNode(responseNodeId, {
        data: { ...existing.data, content: payload.content, status: 'complete' },
      });
    }
    const promptNodeId = existing?.data.promptNodeId as string | undefined;
    if (promptNodeId) {
      const edgeId = `edge-${promptNodeId}-${responseNodeId}`;
      const edge = canvasState.getEdges().find((e) => e.id === edgeId);
      if (edge) {
        canvasState.removeEdge(edgeId);
        canvasState.addEdge({ ...edge, animated: false });
      }
    }

    if (promptNodeId) {
      const promptNode = canvasState.getNode(promptNodeId);
      if (promptNode) {
        canvasState.updateNode(promptNodeId, {
          data: { ...promptNode.data, status: 'answered', responseNodeId },
        });
      }
    }
  }
}

export function emitPrimaryWorkbenchEvent(
  event: string,
  payload: PrimaryWorkbenchEventPayload = {},
): void {
  rotatePrimaryWorkbenchSessionIfNeeded();
  const envelope = {
    ...payload,
    sessionId: primaryWorkbenchSessionId,
    timestamp: new Date().toISOString(),
  };
  if (event === 'context-cards') {
    lastWorkbenchContextCardsEnvelope = { ...envelope };
  }
  syncEventToCanvasState(event, envelope);
  if (primaryWorkbenchAutoOpenEnabled && (event === 'workbench-open' || event === 'ext-app-open')) {
    ensureCanvasBrowserOpen();
  }
  broadcastWorkbenchEvent(event, envelope);
}

export function consumePrimaryWorkbenchIntents(limit = 24): PrimaryWorkbenchIntent[] {
  const requested = Number.isFinite(limit) ? Math.floor(limit) : 24;
  const count = Math.max(1, Math.min(100, requested));
  if (pendingWorkbenchIntents.length === 0) return [];
  return pendingWorkbenchIntents.splice(0, count);
}

export function getPrimaryWorkbenchUrl(workspaceRoot = process.cwd()): string | null {
  const base = startCanvasServer({ workspaceRoot });
  if (!base) return null;
  return `${base}/workbench`;
}

// ── Shared "canvas browser opened" flag ─────────────────────────
let canvasBrowserOpened = false;
let canvasBrowserOpening = false;

export function syncCanvasBrowserOpenedFromSubscribers(): void {
  canvasBrowserOpened = workbenchSubscribers.size > 0;
  canvasBrowserOpening = false;
}

export function isCanvasBrowserOpened(): boolean {
  return canvasBrowserOpened;
}

export function isCanvasBrowserOpening(): boolean {
  return canvasBrowserOpening;
}

export function markCanvasBrowserOpened(): void {
  canvasBrowserOpened = true;
  canvasBrowserOpening = false;
}

export function markCanvasBrowserOpening(): void {
  canvasBrowserOpening = true;
}

function ensureCanvasBrowserOpen(): void {
  if (!primaryWorkbenchAutoOpenEnabled) return;
  if (canvasBrowserOpened) return;
  if (canvasBrowserOpening) return;
  if (workbenchSubscribers.size > 0) {
    canvasBrowserOpened = true;
    canvasBrowserOpening = false;
    return;
  }
  const publicUrl = getPrimaryWorkbenchUrl();
  if (!publicUrl || !server || typeof server.port !== 'number') return;

  canvasBrowserOpening = true;
  if (openUrlInExternalBrowser(publicUrl)) {
    canvasBrowserOpened = true;
    canvasBrowserOpening = false;
    return;
  }
  canvasBrowserOpening = false;
}

export function openPrimaryWorkbenchPath(
  pathLike: string,
  workspaceRoot = process.cwd(),
): string | null {
  const safePath = resolve(pathLike);
  if (!isMarkdownFile(safePath)) return null;
  if (!existsSync(safePath)) return null;

  const base = startCanvasServer({ workspaceRoot });
  if (!base) return null;
  setPrimaryWorkbenchPath(safePath, 'open-primary');
  return `${base}/workbench`;
}

// ── Server startup ────────────────────────────────────────────

export interface CanvasServerOptions {
  port?: number;
  workspaceRoot?: string;
  autoOpenBrowser?: boolean;
}

export function startCanvasServer(options: CanvasServerOptions = {}): string | null {
  if (server) {
    return typeof server.port === 'number' ? loopbackBaseUrl(server.port) : null;
  }

  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  activeWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
  if (options.autoOpenBrowser !== undefined) {
    primaryWorkbenchAutoOpenEnabled = options.autoOpenBrowser;
  }

  // Ensure direct HTTP server usage records undo/redo history, not just PmxCanvas.start().
  canvasState.onMutation((info) => {
    mutationHistory.record({
      description: info.description,
      operationType: info.operationType,
      forward: info.forward,
      inverse: info.inverse,
    });
  });

  // ── Canvas persistence: set workspace root and load saved state ──
  canvasState.setWorkspaceRoot(activeWorkspaceRoot);
  const loaded = canvasState.loadFromDisk({ clearExisting: true });
  if (loaded) {
    console.log('  Canvas state restored from .pmx-canvas/state.json');
    primeCanvasRuntimeBackends({ forceRehydrateExtApps: true });
    void syncCanvasRuntimeBackends({ forceRehydrateExtApps: true, alreadyPrimed: true }).finally(() => {
      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    });
  }

  rotatePrimaryWorkbenchSessionIfNeeded();

  const preferredPort = options.port ?? Number(process.env.PMX_WEB_CANVAS_PORT ?? DEFAULT_PORT);
  const portCandidates = buildPortCandidates(preferredPort);

  for (const portCandidate of portCandidates) {
    try {
      server = Bun.serve({
        hostname: DEFAULT_HOST,
        port: portCandidate,
        idleTimeout: 0,
        async fetch(req) {
          const url = new URL(req.url);

          if (url.pathname === '/health') {
            return responseJson({ ok: true, workspace: activeWorkspaceRoot });
          }

          if (url.pathname === '/favicon.ico' || url.pathname === '/favicon.svg') {
            return serveCanvasFavicon();
          }

          if (url.pathname === '/artifact' && url.searchParams.has('path')) {
            return handleArtifactView(url);
          }

          if (url.pathname === '/api/canvas/json-render/view' && req.method === 'GET') {
            return handleJsonRenderView(url);
          }

          if (url.pathname === '/' || url.pathname === '/workbench' || url.pathname === '/artifact') {
            return new Response(canvasSpaHtml(), {
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
              },
            });
          }

          if (url.pathname === '/api/file' && req.method === 'GET') {
            return handleRead(url.searchParams.get('path') ?? '');
          }

          if (url.pathname === '/api/workbench/state' && req.method === 'GET') {
            return handleWorkbenchState();
          }

          if (url.pathname === '/api/workbench/open' && req.method === 'POST') {
            return handleWorkbenchOpen(req);
          }

          if (url.pathname === '/api/workbench/events' && req.method === 'GET') {
            return handleWorkbenchEvents(req);
          }

          if (url.pathname === '/api/workbench/intent' && req.method === 'POST') {
            return handleWorkbenchIntent(req);
          }

          if (url.pathname === '/api/workbench/webview' && req.method === 'GET') {
            return handleWorkbenchWebViewStatus();
          }

          if (url.pathname === '/api/workbench/webview/start' && req.method === 'POST') {
            return handleWorkbenchWebViewStart(req);
          }

          if (url.pathname === '/api/workbench/webview/evaluate' && req.method === 'POST') {
            return handleWorkbenchWebViewEvaluate(req);
          }

          if (url.pathname === '/api/workbench/webview/resize' && req.method === 'POST') {
            return handleWorkbenchWebViewResize(req);
          }

          if (url.pathname === '/api/workbench/webview/screenshot' && req.method === 'POST') {
            return handleWorkbenchWebViewScreenshot(req);
          }

          if (url.pathname === '/api/workbench/webview' && req.method === 'DELETE') {
            return handleWorkbenchWebViewStop();
          }

          if (url.pathname === '/api/file/save' && req.method === 'POST') {
            return handleSave(req);
          }

          if (url.pathname === '/api/render' && req.method === 'POST') {
            return handleRender(req);
          }

          // Canvas state API
          if (url.pathname === '/api/canvas/state' && req.method === 'GET') {
            return responseJson(serializeCanvasLayout(canvasState.getLayout()));
          }

          if (url.pathname === '/api/canvas/summary' && req.method === 'GET') {
            return responseJson(buildCanvasSummary());
          }

          if (url.pathname === '/api/canvas/update' && req.method === 'POST') {
            return handleCanvasUpdate(req);
          }

          if (url.pathname === '/api/canvas/schema' && req.method === 'GET') {
            return handleCanvasDescribeSchema();
          }

          if (url.pathname === '/api/canvas/schema/validate' && req.method === 'POST') {
            return handleCanvasValidateSpec(req);
          }

          if (url.pathname === '/api/canvas/batch' && req.method === 'POST') {
            return handleCanvasBatch(req);
          }

          if (url.pathname === '/api/canvas/viewport' && req.method === 'POST') {
            return handleCanvasViewport(req);
          }

          if (url.pathname === '/api/canvas/node' && req.method === 'POST') {
            return handleCanvasAddNode(req);
          }

          if (url.pathname === '/api/canvas/mcp-app/open' && req.method === 'POST') {
            return handleCanvasOpenMcpApp(req);
          }

          if (url.pathname === '/api/canvas/diagram' && req.method === 'POST') {
            return handleCanvasAddDiagram(req);
          }

          if (url.pathname === '/api/canvas/web-artifact' && req.method === 'POST') {
            return handleCanvasBuildWebArtifact(req);
          }

          // Individual node GET/PATCH/DELETE
          if (url.pathname.startsWith('/api/canvas/node/') && url.pathname.endsWith('/refresh') && req.method === 'POST') {
            const nodeId = url.pathname.slice('/api/canvas/node/'.length, -'/refresh'.length);
            return handleCanvasRefreshWebpageNode(nodeId, req);
          }

          if (url.pathname.startsWith('/api/canvas/node/') && req.method === 'GET') {
            const nodeId = url.pathname.slice('/api/canvas/node/'.length);
            const node = canvasState.getNode(nodeId);
            if (!node) return responseJson({ ok: false, error: `Node "${nodeId}" not found.` }, 404);
            return responseJson(serializeCanvasNode(node));
          }

          if (url.pathname.startsWith('/api/canvas/node/') && req.method === 'PATCH') {
            const nodeId = url.pathname.slice('/api/canvas/node/'.length);
            return handleCanvasUpdateNode(nodeId, req);
          }

          if (url.pathname.startsWith('/api/canvas/node/') && req.method === 'DELETE') {
            const nodeId = url.pathname.slice('/api/canvas/node/'.length);
            closeNodeAppSession(canvasState.getNode(nodeId));
            const result = removeCanvasNode(nodeId);
            if (!result.removed) return responseJson({ ok: false, error: `Node "${nodeId}" not found.` }, 404);
            emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
            if (result.needsCodeGraphRecompute) {
              scheduleCodeGraphRecompute(() => {
                emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
              });
            }
            return responseJson({ ok: true, removed: nodeId });
          }

          if (url.pathname.startsWith('/api/canvas/image/') && req.method === 'GET') {
            return handleCanvasImage(url.pathname);
          }

          if (url.pathname === '/api/canvas/edge' && req.method === 'POST') {
            return handleCanvasAddEdge(req);
          }

          if (url.pathname === '/api/canvas/edge' && req.method === 'DELETE') {
            return handleCanvasRemoveEdge(req);
          }

          // Snapshot API
          if (url.pathname === '/api/canvas/snapshots' && req.method === 'GET') {
            return responseJson(listCanvasSnapshots());
          }

          if (url.pathname === '/api/canvas/snapshots' && req.method === 'POST') {
            return handleSnapshotSave(req);
          }

          if (url.pathname.startsWith('/api/canvas/snapshots/') && url.pathname.endsWith('/diff') && req.method === 'GET') {
            const id = decodeURIComponent(url.pathname.slice('/api/canvas/snapshots/'.length, -'/diff'.length));
            const snapshot = canvasState.getSnapshotData(id);
            if (!snapshot) return responseJson({ ok: false, error: `Snapshot "${id}" not found.` }, 404);
            const diff = diffLayouts(snapshot.name, snapshot, canvasState.getLayout());
            return responseJson({ ok: true, text: formatDiff(diff), diff });
          }

          if (url.pathname.startsWith('/api/canvas/snapshots/') && req.method === 'POST') {
            const id = decodeURIComponent(url.pathname.slice('/api/canvas/snapshots/'.length));
            const result = await restoreCanvasSnapshot(id);
            if (!result.ok) return responseText('Snapshot not found', 404);
            broadcastWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
            return responseJson({ ok: true });
          }

          if (url.pathname.startsWith('/api/canvas/snapshots/') && req.method === 'DELETE') {
            const id = url.pathname.split('/').pop() ?? '';
            const result = deleteCanvasSnapshot(id);
            if (!result.ok) return responseText('Snapshot not found', 404);
            return responseJson({ ok: true });
          }

          // Context pins API
          if (url.pathname === '/api/canvas/context-pins' && req.method === 'POST') {
            return handleContextPinsUpdate(req);
          }

          if (url.pathname === '/api/canvas/pinned-context' && req.method === 'GET') {
            return handleGetPinnedContext();
          }

          // Spatial context API
          if (url.pathname === '/api/canvas/spatial-context' && req.method === 'GET') {
            const layout = canvasState.getLayout();
            const spatial = buildSpatialContext(layout.nodes, layout.edges, canvasState.contextPinnedNodeIds);
            return responseJson(spatial);
          }

          // Search API
          if (url.pathname === '/api/canvas/search' && req.method === 'GET') {
            const q = url.searchParams.get('q') ?? '';
            if (!q.trim()) {
              return responseJson({ results: [], query: q });
            }
            const results = searchNodes(canvasState.getLayout().nodes, q);
            return responseJson({ results, query: q });
          }

          // Group API
          if (url.pathname === '/api/canvas/group' && req.method === 'POST') {
            return handleCanvasCreateGroup(req);
          }

          if (url.pathname === '/api/canvas/group/add' && req.method === 'POST') {
            return handleCanvasGroupNodes(req);
          }

          if (url.pathname === '/api/canvas/group/ungroup' && req.method === 'POST') {
            return handleCanvasUngroupNodes(req);
          }

          // Arrange / Focus / Clear API (for agent CLI)
          if (url.pathname === '/api/canvas/arrange' && req.method === 'POST') {
            return handleCanvasArrange(req);
          }

          if (url.pathname === '/api/canvas/focus' && req.method === 'POST') {
            return handleCanvasFocus(req);
          }

          if (url.pathname === '/api/canvas/clear' && req.method === 'POST') {
            for (const node of canvasState.getLayout().nodes) {
              closeNodeAppSession(node);
            }
            clearCanvas();
            emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
            return responseJson({ ok: true });
          }

          // Code graph API
          if (url.pathname === '/api/canvas/code-graph' && req.method === 'GET') {
            const summary = buildCodeGraphSummary();
            return responseJson(summary);
          }

          if (url.pathname === '/api/canvas/json-render' && req.method === 'POST') {
            return handleCanvasAddJsonRender(req);
          }

          if (url.pathname === '/api/canvas/graph' && req.method === 'POST') {
            return handleCanvasAddGraph(req);
          }

          if (url.pathname === '/api/canvas/prompt' && req.method === 'POST') {
            return handleCanvasPrompt(req);
          }

          // Undo/Redo/History API
          if (url.pathname === '/api/canvas/undo' && req.method === 'POST') {
            const entry = mutationHistory.undo();
            if (!entry) return responseJson({ ok: false, description: 'Nothing to undo' });
            await syncCanvasRuntimeBackends();
            emitPrimaryWorkbenchEvent('canvas-viewport-update', { viewport: canvasState.viewport });
            emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
            return responseJson({ ok: true, description: `Undid: ${entry.description}` });
          }

          if (url.pathname === '/api/canvas/redo' && req.method === 'POST') {
            const entry = mutationHistory.redo();
            if (!entry) return responseJson({ ok: false, description: 'Nothing to redo' });
            await syncCanvasRuntimeBackends();
            emitPrimaryWorkbenchEvent('canvas-viewport-update', { viewport: canvasState.viewport });
            emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
            return responseJson({ ok: true, description: `Redid: ${entry.description}` });
          }

          if (url.pathname === '/api/canvas/history' && req.method === 'GET') {
            return responseJson({
              text: mutationHistory.toHumanReadable(),
              entries: mutationHistory.getSummaries(),
              canUndo: mutationHistory.canUndo(),
              canRedo: mutationHistory.canRedo(),
            });
          }

          if (url.pathname === '/api/canvas/validate' && req.method === 'GET') {
            return handleCanvasValidate();
          }

          if (url.pathname === '/api/ext-app/call-tool' && req.method === 'POST') {
            return handleExtAppCallTool(req);
          }

          if (url.pathname === '/api/ext-app/read-resource' && req.method === 'POST') {
            return handleExtAppReadResource(req);
          }

          if (url.pathname === '/api/ext-app/list-tools' && req.method === 'POST') {
            return handleExtAppListTools(req);
          }

          if (url.pathname === '/api/ext-app/list-resources' && req.method === 'POST') {
            return handleExtAppListResources(req);
          }

          if (url.pathname === '/api/ext-app/list-resource-templates' && req.method === 'POST') {
            return handleExtAppListResourceTemplates(req);
          }

          if (url.pathname === '/api/ext-app/list-prompts' && req.method === 'POST') {
            return handleExtAppListPrompts(req);
          }

          if (url.pathname === '/api/ext-app/model-context' && req.method === 'POST') {
            return handleExtAppModelContext(req);
          }

          // Static files for canvas SPA bundle
          if (url.pathname.startsWith('/canvas/')) {
            const staticResponse = serveCanvasStatic(url.pathname);
            if (staticResponse) return staticResponse;
          }

          return responseText('Not found', 404);
        },
      });
      return typeof server.port === 'number' ? loopbackBaseUrl(server.port) : null;
    } catch (error) {
      logWorkbenchWarning('startCanvasServer candidate failed', error, { portCandidate });
      server = null;
    }
  }
  return null;
}

export function stopCanvasServer(): void {
  canvasState.flushToDisk();
  closeAllMcpAppSessions();
  void closeCanvasAutomationWebViewInternal().catch((error) => {
    logWorkbenchWarning('stopCanvasServer closeCanvasAutomationWebViewInternal', error);
  });
  if (server) {
    server.stop(true);
    server = null;
  }
}

export function getCanvasServerPort(): number | null {
  return server && typeof server.port === 'number' ? server.port : null;
}

// Re-exports
export {
  closeMcpAppHostSession,
  focusMcpAppHostSession,
  getMcpAppHostSnapshot,
  isTrustedMcpAppDomain,
  listMcpAppHostSessions,
  markMcpAppHostSessionOpenedExternally,
  preRegisterKnownMcpAppHostCapabilities,
  registerMcpAppHostCapability,
  routeMcpAppCandidateToHost,
} from './mcp-app-host.js';
export type {
  McpAppCandidateInput,
  McpAppHostCapability,
  McpAppHostCapabilityState,
  McpAppHostRoutingResult,
  McpAppHostSession,
  McpAppHostSnapshot,
} from './mcp-app-host.js';
