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
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import * as marked from 'marked';
import type {
  CallToolResult,
  ListPromptsResult,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';
import { type CanvasAnnotation, type CanvasLayout, type CanvasNodeState, IMAGE_MIME_MAP, canvasState } from './canvas-state.js';
import { buildAxBridge, buildAxStateBridge, buildContentHeightReporter, buildHtmlSurfaceDocument, HTML_SURFACE_SANDBOX, normalizeSurfaceTheme } from './html-surface.js';
import { findCanvasExtAppNodeId as findCanvasExtAppNodeIdShared } from './ext-app-lookup.js';
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
  readMcpAppResource,
} from './mcp-app-runtime.js';
import { findOpenCanvasPosition, computeGroupBounds } from './placement.js';
import { mutationHistory } from './mutation-history.js';
import { summarizeCanvasAnnotation } from './canvas-serialization.js';
import { buildCodeGraphSummary, formatCodeGraph } from './code-graph.js';
import { buildAgentContextPreamble, serializeNodeForAgentContext } from './agent-context.js';
import { buildCanvasAxContext, buildCanvasAxSurfaceSnapshot } from './ax-context.js';
import { applyAxInteraction, resolveNodeAxCapabilities } from './ax-interaction.js';
import { isAxEvidenceKind, isAxActivityKind } from './ax-state.js';
import type {
  PmxAxEvidenceKind,
  PmxAxPolicy,
  PmxAxReviewAnchorType,
  PmxAxReviewKind,
  PmxAxReviewSeverity,
  PmxAxSource,
  PmxAxWorkItemStatus,
} from './ax-state.js';
import { normalizeCanvasTheme, type CanvasTheme } from './canvas-db.js';
import { validateLocalImageFile } from './image-source.js';
import {
  applyCanvasNodeUpdates,
  refreshCanvasWebpageNode,
  primeCanvasRuntimeBackends,
  setCanvasLayoutUpdateEmitter,
  syncCanvasRuntimeBackends,
} from './canvas-operations.js';
import { dispatchOperationRoute, setOperationEventEmitter } from './operations/index.js';
import { intentRegistry } from './intent-registry.js';
import { setWebviewRunner } from './operations/webview-runner.js';
import {
  closeNodeAppSession,
  nodeAppSessionId,
} from './operations/ops/nodes.js';
import {
  EXCALIDRAW_READ_CHECKPOINT_TOOL,
  EXCALIDRAW_SAVE_CHECKPOINT_TOOL,
  buildExcalidrawCheckpointId,
  buildExcalidrawRestoreCheckpointToolInput,
  ensureExcalidrawCheckpointId,
  getExcalidrawCheckpointIdFromToolResult,
  isExcalidrawCreateView,
} from './diagram-presets.js';
import { traceManager } from './trace-manager.js';
import {
  buildJsonRenderViewerHtml,
} from '../json-render/server.js';
import {
  normalizeWebpageUrl,
} from './webpage-node.js';
import type { JsonRenderSpec } from '../json-render/server.js';

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
const initialCanvasThemeSetting = normalizeCanvasTheme(process.env.PMX_CANVAS_THEME);
let lastWorkbenchContextCardsEnvelope: Record<string, unknown> | null = null;

// Operation-registry SSE wiring (plan-005): the registry never imports this
// module — the workbench event emitter is injected here, mirroring the
// setCanvasLayoutUpdateEmitter pattern. Wired at module top level so local
// (in-process) MCP/SDK invocations emit even without startCanvasServer().
setOperationEventEmitter((event, payload) => {
  emitPrimaryWorkbenchEvent(event, payload);
});

// Ghost Cursor of Intent SSE wiring: the IntentRegistry never imports this
// module — its `ax-intent` / `ax-intent-clear` frames (including the autonomous
// TTL-expiry sweeper) are emitted through the injected workbench emitter, same
// pattern as setOperationEventEmitter. Wired at module top level so in-process
// MCP/SDK intent signals reach the browser without startCanvasServer().
intentRegistry.setEmitter((event, payload) => {
  emitPrimaryWorkbenchEvent(event, payload);
});

// Webview-runner wiring (plan-008 Wave 3): the webview ops never import this
// module — the Bun.WebView automation runner is injected here, mirroring the
// setOperationEventEmitter pattern. The closures call the real automation
// functions (declared below, hoisted) so a webview op resolves to the same
// machinery the legacy hand-written tools/routes used. `screenshot` stays out —
// it returns binary and remains the standalone canvas_screenshot tool.
setWebviewRunner({
  status: () => getCanvasAutomationWebViewStatus(),
  start: async (options) => {
    const url = currentWorkbenchUrl();
    if (!url) {
      // Mirrors the legacy 503 "server not running" branch: no URL → not a
      // start failure but a precondition error. Surface it through the
      // error-shaped result so the op can map it to the same 503 wire body
      // (no webview field, matching the legacy handler).
      return {
        ok: false as const,
        serverNotRunning: true as const,
        error: 'Canvas server is not running.',
      };
    }
    try {
      const webview = await startCanvasAutomationWebView(url, options);
      return { ok: true as const, webview };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
        // 500-vs-501 is read off webview.supported (the status), so no separate field.
        webview: getCanvasAutomationWebViewStatus(),
      };
    }
  },
  stop: () => stopCanvasAutomationWebView(),
  resize: (width, height) => resizeCanvasAutomationWebView(width, height),
  evaluate: (expression) => evaluateCanvasAutomationWebView(expression),
});

function normalizeGraphViewerSpec(
  node: { type: string; data: Record<string, unknown> },
  spec: JsonRenderSpec,
  display: string | null,
): JsonRenderSpec {
  if (node.type !== 'graph') return spec;
  const graphConfig = node.data.graphConfig;
  if (
    display !== 'expanded' &&
    graphConfig &&
    typeof graphConfig === 'object' &&
    typeof (graphConfig as Record<string, unknown>).height === 'number'
  ) {
    return spec;
  }
  const chart = spec.elements.chart;
  if (!chart || typeof chart !== 'object') return spec;
  const chartRecord = chart as Record<string, unknown>;
  const props = chartRecord.props;
  if (!props || typeof props !== 'object' || typeof (props as Record<string, unknown>).height !== 'number') return spec;
  const nextProps = { ...(props as Record<string, unknown>) };
  delete nextProps.height;
  return {
    ...spec,
    elements: {
      ...spec.elements,
      chart: {
        ...chartRecord,
        props: nextProps,
      },
    },
  };
}

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

export function wrapCanvasAutomationScript(script: string): string {
  return `(async () => {\n${script}\n})()`;
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
  return findCanvasExtAppNodeIdShared(toolCallId, {
    getNode: (id) => canvasState.getNode(id),
    listNodes: () => canvasState.getLayout().nodes,
  });
}

function isCheckpointToolName(toolName: string): boolean {
  return toolName === EXCALIDRAW_SAVE_CHECKPOINT_TOOL || toolName === EXCALIDRAW_READ_CHECKPOINT_TOOL;
}

/**
 * Decide whether a fresh `callServerTool` result should *replace* the
 * canvas node's bootstrap-replay `toolResult`.
 *
 * The bootstrap-replay toolResult is what the server re-sends to the
 * widget on reload to restore visible state. We only want to overwrite
 * it when the new result genuinely carries widget state — `isError` or
 * `structuredContent`. A plain-text result (e.g. `read_checkpoint`
 * returning a string status, or any informational message) updates
 * `appModelContext` for the agent's record but should *not* clobber the
 * bootstrap entry, because doing so would replace the widget's restored
 * state with conversational noise on the next reload.
 *
 * This separation is exercised by:
 *   - tests/unit/server-api.test.ts "keeps ext-app model context
 *     separate from the replayed tool result" (text-only result preserves
 *     bootstrap replay)
 *   - tests/unit/server-api.test.ts "app-only text tool results update
 *     model context without replacing bootstrap replay"
 *   - tests/unit/server-api.test.ts "rehydrates Excalidraw checkpoint
 *     replay after server restart" (structured-content result becomes
 *     the new bootstrap replay)
 */
function shouldReplayAppToolResult(toolName: string, result: CallToolResult): boolean {
  void toolName;
  return Boolean(result.isError || result.structuredContent);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getExtAppNodeCheckpointId(node: CanvasNodeState): string {
  const appCheckpoint = isRecord(node.data.appCheckpoint) ? node.data.appCheckpoint : null;
  const storedCheckpointId = appCheckpoint?.id;
  if (typeof storedCheckpointId === 'string' && storedCheckpointId.trim().length > 0) {
    return storedCheckpointId.trim();
  }
  return getExcalidrawCheckpointIdFromToolResult(node.data.toolResult) ?? buildExcalidrawCheckpointId(node.id);
}

function getLocalExcalidrawCheckpointData(
  node: CanvasNodeState,
  args: Record<string, unknown> | undefined,
): string | null {
  if (!isExcalidrawCreateView(node.data.serverName, node.data.toolName)) return null;
  if (!isRecord(args) || typeof args.id !== 'string') return null;
  if (args.id.trim() !== getExtAppNodeCheckpointId(node)) return null;
  const appCheckpoint = isRecord(node.data.appCheckpoint) ? node.data.appCheckpoint : null;
  const data = appCheckpoint?.data;
  return typeof data === 'string' ? data : '';
}

function persistExcalidrawCheckpointToNode(
  nodeId: string,
  node: CanvasNodeState,
  args: Record<string, unknown> | undefined,
): boolean {
  if (!isExcalidrawCreateView(node.data.serverName, node.data.toolName)) return false;
  if (!isRecord(args) || typeof args.id !== 'string') return false;
  const checkpointId = getExtAppNodeCheckpointId(node);
  if (args.id.trim() !== checkpointId) return false;

  const currentToolInput = isRecord(node.data.toolInput) ? node.data.toolInput : {};
  const nextToolInput = {
    ...currentToolInput,
    elements: buildExcalidrawRestoreCheckpointToolInput(checkpointId, args.data),
  };
  const currentToolResult = isRecord(node.data.toolResult)
    ? ensureExcalidrawCheckpointId(node.data.toolResult as CallToolResult, node.id, checkpointId)
    : undefined;

  canvasState.updateNode(nodeId, {
    data: {
      ...node.data,
      toolInput: nextToolInput,
      ...(currentToolResult ? { toolResult: currentToolResult } : {}),
      appCheckpoint: {
        toolName: EXCALIDRAW_SAVE_CHECKPOINT_TOOL,
        id: checkpointId,
        ...(typeof args.data === 'string' ? { data: args.data } : {}),
        updatedAt: new Date().toISOString(),
      },
    },
  });
  return true;
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

function extAppEventGeometryPatch(
  node: CanvasNodeState,
  payload: PrimaryWorkbenchEventPayload,
): Partial<Pick<CanvasNodeState, 'position' | 'size'>> {
  const x = typeof payload.x === 'number' ? payload.x : undefined;
  const y = typeof payload.y === 'number' ? payload.y : undefined;
  const width = typeof payload.width === 'number' ? payload.width : undefined;
  const height = typeof payload.height === 'number' ? payload.height : undefined;
  return {
    ...(x !== undefined || y !== undefined
      ? { position: { x: x ?? node.position.x, y: y ?? node.position.y } }
      : {}),
    ...(width !== undefined || height !== undefined
      ? { size: { width: width ?? node.size.width, height: height ?? node.size.height } }
      : {}),
  };
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

async function readJson(req: Request): Promise<Record<string, unknown>> {
  let text = '';
  try {
    text = await req.text();
  } catch (error) {
    logWorkbenchWarning('readJson', error);
    return {};
  }

  if (!text.trim()) return {};

  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  } catch (error) {
    logWorkbenchWarning('readJson', error);
    return {};
  }
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

const CANVAS_ASSET_VERSION = Date.now().toString(36);
const MAX_FRAME_DOCUMENTS = 128;
const MAX_FRAME_DOCUMENT_BYTES = 5 * 1024 * 1024;
const DEFAULT_FRAME_DOCUMENT_SANDBOX = 'allow-scripts';
const SAFE_FRAME_DOCUMENT_SANDBOX_TOKENS = new Set([
  'allow-downloads',
  'allow-forms',
  'allow-modals',
  'allow-orientation-lock',
  'allow-pointer-lock',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-presentation',
  'allow-scripts',
  'allow-storage-access-by-user-activation',
]);
const frameDocuments = new Map<string, { html: string; sandbox: string }>();

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
  <link rel="stylesheet" href="/canvas/global.css?v=${CANVAS_ASSET_VERSION}" />
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
  <script type="module" src="/canvas/index.js?v=${CANVAS_ASSET_VERSION}"></script>
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

function normalizeFrameDocumentSandbox(value: unknown): string | null {
  if (value === undefined || value === null) return DEFAULT_FRAME_DOCUMENT_SANDBOX;
  if (typeof value !== 'string') return null;
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return DEFAULT_FRAME_DOCUMENT_SANDBOX;
  const uniqueTokens: string[] = [];
  for (const token of tokens) {
    if (!SAFE_FRAME_DOCUMENT_SANDBOX_TOKENS.has(token)) return null;
    if (!uniqueTokens.includes(token)) uniqueTokens.push(token);
  }
  return uniqueTokens.join(' ');
}

function addFrameDocument(html: string, sandbox: string): string {
  const id = randomUUID();
  frameDocuments.set(id, { html, sandbox });
  while (frameDocuments.size > MAX_FRAME_DOCUMENTS) {
    const firstKey = frameDocuments.keys().next().value;
    if (typeof firstKey !== 'string') break;
    frameDocuments.delete(firstKey);
  }
  return `/api/canvas/frame-documents/${id}`;
}

async function handleCreateFrameDocument(req: Request): Promise<Response> {
  const body = await readJson(req);
  const html = body.html;
  if (typeof html !== 'string' || !html) {
    return responseJson({ ok: false, error: 'Frame document requires non-empty html.' }, 400);
  }
  if (new TextEncoder().encode(html).byteLength > MAX_FRAME_DOCUMENT_BYTES) {
    return responseJson({ ok: false, error: 'Frame document is too large.' }, 413);
  }
  const sandbox = normalizeFrameDocumentSandbox(body.sandbox);
  if (!sandbox) {
    return responseJson({ ok: false, error: 'Frame document sandbox contains unsupported tokens.' }, 400);
  }
  return responseJson({ ok: true, url: addFrameDocument(html, sandbox) });
}

function handleFrameDocument(pathname: string): Response {
  const id = decodeURIComponent(pathname.slice('/api/canvas/frame-documents/'.length));
  const document = frameDocuments.get(id);
  if (!document) return responseText('Frame document not found.', 404);
  return new Response(document.html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `sandbox ${document.sandbox}`,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// ── Node surfaces ("Open as site") ─────────────────────────────
//
// One stable, node-addressable URL — /api/canvas/surface/:nodeId — that serves
// (or redirects to) the exact same rendered surface a node shows in the canvas.
// The in-canvas html iframe points at this URL too, so there is one render path.
//
// Served document types (html / ext-app) carry the same opaque-origin posture as
// frame documents: `Content-Security-Policy: sandbox <tokens>` (no
// allow-same-origin) means author scripts cannot reach the PMX origin even when
// the page is opened top-level in a browser tab. Other types redirect to the
// route that already renders them standalone.

function surfaceHtmlResponse(html: string, sandbox: string): Response {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `sandbox ${sandbox}`,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function surfaceRedirect(target: string): Response {
  return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store' } });
}

// Permit only absolute http(s) URLs and root-relative same-origin paths. Blocks
// `javascript:`/`data:` and protocol-relative `//host` open-redirects.
function isSafeSurfaceRedirect(target: string): boolean {
  if (/^https?:\/\//i.test(target)) return true;
  if (/^\/(?!\/)/.test(target)) return true;
  return false;
}

function handleNodeSurface(pathname: string, url: URL): Response {
  const nodeId = decodeURIComponent(pathname.slice('/api/canvas/surface/'.length));
  if (!nodeId) return responseText('Missing node id', 400);
  const node = canvasState.getNode(nodeId);
  if (!node) return responseText('Node not found', 404);

  const theme = normalizeSurfaceTheme(url.searchParams.get('theme'));

  if (node.type === 'html') {
    const html = typeof node.data.html === 'string'
      ? node.data.html
      : typeof node.data.content === 'string'
        ? node.data.content
        : '';
    if (!html) return responseText('HTML node has no content', 404);
    const present = url.searchParams.get('present') === '1';
    const axCaps = resolveNodeAxCapabilities(node);
    const axEnabled = axCaps.enabled && axCaps.allowed.length > 0;
    const surfaceTitle = typeof node.data.title === 'string' && node.data.title.trim()
      ? node.data.title
      : node.id;
    const doc = buildHtmlSurfaceDocument(html, {
      theme,
      title: surfaceTitle,
      themeToken: url.searchParams.get('themeToken') ?? undefined,
      presentation: present,
      presentationExitToken: url.searchParams.get('presentToken') ?? undefined,
      axBridge: axEnabled,
      axToken: url.searchParams.get('axToken') ?? undefined,
      nodeId: node.id,
      // Seed the read-side bridge with the current AX state (only for AX surfaces).
      ...(axEnabled ? { axState: buildCanvasAxSurfaceSnapshot() } : {}),
      // Content-height reporter nonce (lets an html node grow to fit its content).
      ...(url.searchParams.get('frameToken') ? { contentHeightToken: url.searchParams.get('frameToken') as string } : {}),
    });
    return surfaceHtmlResponse(doc, HTML_SURFACE_SANDBOX);
  }

  if (node.type === 'json-render' || node.type === 'graph') {
    const params = new URLSearchParams({ nodeId, theme });
    const display = url.searchParams.get('display');
    if (display === 'expanded') params.set('display', 'expanded');
    return surfaceRedirect(`/api/canvas/json-render/view?${params.toString()}`);
  }

  if (node.type === 'mcp-app') {
    // Bundled web artifact — same standalone page the canvas iframe already loads.
    if (node.data.viewerType === 'web-artifact' && typeof node.data.path === 'string' && node.data.path) {
      return surfaceRedirect(`/artifact?path=${encodeURIComponent(node.data.path)}`);
    }
    // Hosted ext-app — serve the same prepared HTML the in-canvas frame receives.
    // The app's host bridge has no peer in a standalone tab, so interactive
    // tool-calls won't function there; the UI still renders. Served TOP-LEVEL with
    // a tighter sandbox than the in-canvas iframe (no allow-popups-to-escape-sandbox)
    // since this is untrusted third-party HTML opened as its own page.
    if (node.data.mode === 'ext-app' && typeof node.data.html === 'string' && node.data.html) {
      return surfaceHtmlResponse(node.data.html, HTML_SURFACE_SANDBOX);
    }
    // URL-backed viewer — hand off to its own origin.
    if (typeof node.data.url === 'string' && isSafeSurfaceRedirect(node.data.url)) {
      return surfaceRedirect(node.data.url);
    }
    return responseText('MCP app node has no openable surface', 404);
  }

  if (node.type === 'webpage') {
    if (typeof node.data.url === 'string' && isSafeSurfaceRedirect(node.data.url)) {
      return surfaceRedirect(node.data.url);
    }
    return responseText('Webpage node has no url', 404);
  }

  return responseText('Node type cannot be opened as a site', 404);
}

async function handleCanvasUpdate(req: Request): Promise<Response> {
  const body = await readJson(req);
  const updates = Array.isArray(body.updates) ? body.updates : [];
  const result = body.recordHistory === false
    ? (() => {
        let suppressedResult: ReturnType<typeof applyCanvasNodeUpdates> = { applied: 0, skipped: updates.length };
        canvasState.withSuppressedRecording(() => {
          suppressedResult = applyCanvasNodeUpdates(updates);
        });
        return suppressedResult;
      })()
    : applyCanvasNodeUpdates(updates);
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
  if (body.recordHistory === false) {
    canvasState.withSuppressedRecording(() => {
      canvasState.setViewport(next);
    });
  } else {
    canvasState.setViewport(next);
  }
  emitPrimaryWorkbenchEvent('canvas-viewport-update', { viewport: canvasState.viewport });
  return responseJson({ ok: true });
}

function annotationBounds(points: CanvasAnnotation['points']): CanvasAnnotation['bounds'] {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function textAnnotationBounds(point: CanvasAnnotation['points'][number], text: string, width: number): CanvasAnnotation['bounds'] {
  return {
    x: point.x,
    y: point.y - width,
    width: Math.max(width, text.length * width * 0.62),
    height: width * 1.2,
  };
}

function parseAnnotationPoints(value: unknown): CanvasAnnotation['points'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((point) => {
      if (!point || typeof point !== 'object' || Array.isArray(point)) return null;
      const record = point as Record<string, unknown>;
      if (typeof record.x !== 'number' || typeof record.y !== 'number') return null;
      if (!Number.isFinite(record.x) || !Number.isFinite(record.y)) return null;
      return { x: record.x, y: record.y };
    })
    .filter((point): point is CanvasAnnotation['points'][number] => point !== null);
}

async function handleCanvasAddAnnotation(req: Request): Promise<Response> {
  const body = await readJson(req);
  const type = body.type === 'text' ? 'text' : 'freehand';
  const points = parseAnnotationPoints(body.points);
  if (points.length < (type === 'text' ? 1 : 2)) {
    return responseJson({ ok: false, error: type === 'text' ? 'Text annotation requires a valid point.' : 'Annotation requires at least two valid points.' }, 400);
  }

  const defaultWidth = type === 'text' ? 24 : 4;
  const maxWidth = type === 'text' ? 96 : 24;
  const width = typeof body.width === 'number' && Number.isFinite(body.width)
    ? Math.min(maxWidth, Math.max(1, body.width))
    : defaultWidth;
  const color = typeof body.color === 'string' && (body.color === 'currentColor' || /^#[0-9a-fA-F]{6}$/.test(body.color))
    ? body.color
    : 'currentColor';
  const label = typeof body.label === 'string' && body.label.trim().length > 0
    ? body.label.trim().slice(0, 160)
    : undefined;
  const text = type === 'text' && typeof body.text === 'string' && body.text.trim().length > 0
    ? body.text.trim().slice(0, 240)
    : undefined;
  if (type === 'text' && !text) {
    return responseJson({ ok: false, error: 'Text annotation requires text.' }, 400);
  }
  const id = typeof body.id === 'string' && body.id.trim().length > 0
    ? body.id.trim().slice(0, 120)
    : `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const annotation: CanvasAnnotation = {
    id,
    type,
    points,
    bounds: type === 'text' ? textAnnotationBounds(points[0]!, text!, width) : annotationBounds(points),
    color,
    width,
    ...(text ? { text } : {}),
    ...(label ?? text ? { label: label ?? text } : {}),
    createdAt: new Date().toISOString(),
  };

  canvasState.addAnnotation(annotation);
  emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  return responseJson({ ok: true, annotation: summarizeCanvasAnnotation(annotation) });
}

// ── Serve image file for image nodes ─────────────────────────
async function handleCanvasImage(pathname: string): Promise<Response> {
  const nodeId = pathname.replace('/api/canvas/image/', '');
  const node = canvasState.getNode(nodeId);
  if (!node || node.type !== 'image') {
    return responseText('Image node not found', 404);
  }
  const src = (node.data.path as string) || (node.data.src as string) || '';
  if (!src || src.startsWith('data:') || src.startsWith('http')) {
    return responseText('Not a file-based image', 400);
  }
  // Contain the file read to the active workspace. `src` comes from node data,
  // which any unauthenticated local caller can set — without this guard the
  // image route serves arbitrary host files (e.g. ../../etc/passwd).
  const safePath = resolveWorkspaceArtifactPath(src);
  if (!safePath) {
    return responseText('Image path is outside the workspace', 403);
  }
  if (!existsSync(safePath)) {
    return responseText('Image file not found', 404);
  }
  let contentType: string;
  try {
    contentType = validateLocalImageFile(safePath).mimeType;
  } catch (error) {
    return responseText(error instanceof Error ? error.message : 'Invalid image file', 400);
  }
  const data = await readFile(safePath);
  return new Response(data, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    },
  });
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

// handleCanvasBuildWebArtifact migrated to the operation registry
// (plan-008 Wave 4): src/server/operations/ops/app.ts (webartifact.build).

async function handleCanvasThemeUpdate(req: Request): Promise<Response> {
  const body = await readJson(req);
  const theme = normalizeCanvasTheme(body.theme, canvasState.theme);
  const next = canvasState.setTheme(theme);
  broadcastWorkbenchEvent('theme-changed', {
    theme: next,
    sessionId: primaryWorkbenchSessionId,
    timestamp: new Date().toISOString(),
  });
  return responseJson({ ok: true, theme: next });
}

async function handleJsonRenderView(url: URL): Promise<Response> {
  const nodeId = url.searchParams.get('nodeId') ?? '';
  if (!nodeId) return responseText('Missing nodeId', 400);
  const node = canvasState.getNode(nodeId);
  if (!node || (node.type !== 'json-render' && node.type !== 'graph')) {
    return responseText('json-render node not found', 404);
  }

  const rawSpec = node.data.spec;
  if (!rawSpec || typeof rawSpec !== 'object') {
    return responseText('json-render spec missing', 404);
  }
  const spec = normalizeGraphViewerSpec(
    { type: node.type, data: node.data },
    rawSpec as { root: string; elements: Record<string, unknown>; state?: Record<string, unknown> },
    url.searchParams.get('display'),
  );

  const themeValue = url.searchParams.get('theme');
  const theme =
    themeValue === 'dark' || themeValue === 'light' || themeValue === 'high-contrast'
      ? themeValue
      : undefined;
  const title = (node.data.title as string) || node.id;
  // Devtools panel is double-gated: the operator must opt in via the env flag
  // AND the request must carry ?devtools=1. Off by default in all normal runs.
  const devtoolsEnabled =
    process.env.PMX_CANVAS_JSON_RENDER_DEVTOOLS === '1' &&
    url.searchParams.get('devtools') === '1';
  const axToken = url.searchParams.get('axToken');
  const axEnabled = resolveNodeAxCapabilities(node).enabled;
  const frameToken = url.searchParams.get('frameToken');
  const fitContent = url.searchParams.get('fit') === 'content';
  const html = await buildJsonRenderViewerHtml({
    title,
    spec,
    ...(theme ? { theme } : {}),
    ...(url.searchParams.get('display') === 'expanded' ? { display: 'expanded' as const } : {}),
    ...(devtoolsEnabled ? { devtools: true } : {}),
    ...(axToken ? { nodeId, axToken } : {}),
    // Seed the read-side AX state (only for AX-enabled nodes) so specs can bind /ax.
    ...(axToken && axEnabled ? { axState: buildCanvasAxSurfaceSnapshot() } : {}),
    // Content-fit: report natural height (charts render intrinsic) so the node grows.
    ...(frameToken ? { frameToken } : {}),
    ...(fitContent ? { fitContent: true } : {}),
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
    let content = readFileSync(safePath, 'utf-8');
    // AX bridge for web-artifacts (same opaque-origin postMessage bridge as html
    // surfaces — a sandboxed artifact can't fetch the API directly). The viewer
    // appends axToken + axNodeId only for AX-enabled artifacts; the server still
    // re-validates every interaction.
    const axToken = url.searchParams.get('axToken');
    const axNodeId = url.searchParams.get('axNodeId');
    if (axToken && axNodeId) {
      const node = canvasState.getNode(axNodeId);
      if (node && resolveNodeAxCapabilities(node).enabled) {
        const safeToken = axToken.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
        // Use the canonical node.id (server-generated [a-z0-9-]) rather than the raw
        // query param so nothing untrusted reaches the inline bridge script.
        const safeNodeId = node.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
        const stateJson = JSON.stringify(buildCanvasAxSurfaceSnapshot()).replace(/</g, '\\u003c');
        const bridge = `${buildAxBridge(safeToken, safeNodeId)}${buildAxStateBridge(safeToken, stateJson)}`;
        content = content.includes('</head>')
          ? content.replace('</head>', `${bridge}</head>`)
          : `${bridge}${content}`;
      }
    }
    // Content-height reporter so a web-artifact node grows to fit its app (#48).
    const frameToken = url.searchParams.get('frameToken');
    if (frameToken) {
      const reporter = buildContentHeightReporter(frameToken.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80));
      content = content.includes('</head>')
        ? content.replace('</head>', `${reporter}</head>`)
        : `${reporter}${content}`;
    }
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
    const requestedNode = nodeId ? canvasState.getNode(nodeId) : undefined;
    const canReadLocalCheckpoint =
      requestedNode?.type === 'mcp-app' &&
      requestedNode.data.mode === 'ext-app' &&
      requestedNode.data.appSessionId === sessionId;
    const localCheckpointData = canReadLocalCheckpoint && toolName === EXCALIDRAW_READ_CHECKPOINT_TOOL
      ? getLocalExcalidrawCheckpointData(requestedNode, args)
      : null;
    const result = localCheckpointData === null
      ? await callMcpAppTool(sessionId, toolName, args)
      : { content: [{ type: 'text', text: localCheckpointData }] } satisfies CallToolResult;
    if (nodeId) {
      const node = canvasState.getNode(nodeId);
      if (node?.type === 'mcp-app' && node.data.mode === 'ext-app' && node.data.appSessionId === sessionId) {
        let changed = false;
        if (toolName === EXCALIDRAW_SAVE_CHECKPOINT_TOOL && persistExcalidrawCheckpointToNode(nodeId, node, args)) {
          // Checkpoint saves are replayed through toolInput.elements instead of
          // replacing the original create_view result with a generic "ok".
          changed = true;
        } else if (!(isExcalidrawCreateView(node.data.serverName, node.data.toolName) && isCheckpointToolName(toolName))) {
          const nextData: Record<string, unknown> = { ...node.data };
          if (shouldReplayAppToolResult(toolName, result)) nextData.toolResult = result;
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
          changed = true;
        }
        if (changed) {
          broadcastWorkbenchEvent('canvas-layout-update', {
            layout: canvasState.getLayout(),
            sessionId: primaryWorkbenchSessionId,
            timestamp: new Date().toISOString(),
          });
        }
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

// Webview status / start / stop / evaluate / resize HTTP routes migrated to the
// operation registry (plan-008 Wave 3): src/server/operations/ops/webview.ts,
// dispatched in the fetch handler. The screenshot route + handler below stay
// hand-written (binary response). `currentWorkbenchUrl` is still used by the
// injected webview runner's start closure (see setWebviewRunner above).
function currentWorkbenchUrl(): string | null {
  return server && typeof server.port === 'number' ? `${loopbackBaseUrl(server.port)}/workbench` : null;
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
          theme: canvasState.theme,
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
      for (const intent of intentRegistry.list()) {
        controller.enqueue(
          toSseFrame('ax-intent', {
            intent,
            reason: 'connect-snapshot',
            sessionId: primaryWorkbenchSessionId,
            timestamp: new Date().toISOString(),
          }),
        );
      }
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

function normalizeAxNodeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string');
}

function normalizeAxSource(value: unknown, fallback: PmxAxSource): PmxAxSource {
  return value === 'agent' ||
    value === 'api' ||
    value === 'browser' ||
    value === 'cli' ||
    value === 'codex' ||
    value === 'copilot' ||
    value === 'mcp' ||
    value === 'sdk' ||
    value === 'system'
    ? value
    : fallback;
}

function handleGetAxContext(url: URL): Response {
  // Optional ?consumer= filters the compact `delivery` lead block (loop-safe — a
  // consumer never sees steering/activity it originated), so a host adapter can
  // inject its own un-truncated pending block per turn (report #54 hardening).
  const consumer = url.searchParams.get('consumer') ?? undefined;
  return responseJson(buildCanvasAxContext(consumer));
}

function isReviewSeverity(v: unknown): v is PmxAxReviewSeverity {
  return v === 'info' || v === 'warning' || v === 'error';
}
function isReviewKind(v: unknown): v is PmxAxReviewKind {
  return v === 'comment' || v === 'finding';
}
function isReviewAnchor(v: unknown): v is PmxAxReviewAnchorType {
  return v === 'node' || v === 'file' || v === 'region';
}

// Validate untrusted activity `reactions` from an HTTP body into the typed override
// shape ingestActivity expects. `false` suppresses a default reaction; an object
// overrides its fields (invalid fields are dropped, not stored raw).
function normalizeActivityReactions(input: Record<string, unknown>): {
  workItem?: false | { status?: PmxAxWorkItemStatus; detail?: string | null };
  evidence?: false | { kind?: PmxAxEvidenceKind; body?: string | null };
  review?: false | { severity?: PmxAxReviewSeverity; kind?: PmxAxReviewKind; anchorType?: PmxAxReviewAnchorType; nodeId?: string | null };
} {
  const out: ReturnType<typeof normalizeActivityReactions> = {};
  if (input.workItem === false) out.workItem = false;
  else if (isRecord(input.workItem)) {
    const status = normalizeAxWorkItemStatus(input.workItem.status);
    out.workItem = {
      ...(status ? { status } : {}),
      ...(typeof input.workItem.detail === 'string' ? { detail: input.workItem.detail } : {}),
    };
  }
  if (input.evidence === false) out.evidence = false;
  else if (isRecord(input.evidence)) {
    out.evidence = {
      ...(isAxEvidenceKind(input.evidence.kind) ? { kind: input.evidence.kind } : {}),
      ...(typeof input.evidence.body === 'string' ? { body: input.evidence.body } : {}),
    };
  }
  if (input.review === false) out.review = false;
  else if (isRecord(input.review)) {
    out.review = {
      ...(isReviewSeverity(input.review.severity) ? { severity: input.review.severity } : {}),
      ...(isReviewKind(input.review.kind) ? { kind: input.review.kind } : {}),
      ...(isReviewAnchor(input.review.anchorType) ? { anchorType: input.review.anchorType } : {}),
      ...(typeof input.review.nodeId === 'string' ? { nodeId: input.review.nodeId } : {}),
    };
  }
  return out;
}

// Report primitive A: ingest a harness-forwarded agent activity; the board auto-reacts.
async function handleAxActivityIngest(req: Request): Promise<Response> {
  const body = await readJson(req);
  if (!isAxActivityKind(body.kind)) {
    return responseJson({ ok: false, error: "activity requires a valid 'kind': one of tool-start, tool-result, failure, error, session-start, session-end, command, note." }, 400);
  }
  if (typeof body.title !== 'string' || !body.title.trim()) {
    return responseJson({ ok: false, error: 'activity requires a title.' }, 400);
  }
  const result = canvasState.ingestActivity(
    {
      kind: body.kind,
      title: body.title,
      ...(typeof body.summary === 'string' ? { summary: body.summary } : {}),
      ...(body.outcome === 'success' || body.outcome === 'failure' ? { outcome: body.outcome } : {}),
      ...(typeof body.ref === 'string' ? { ref: body.ref } : {}),
      ...(Array.isArray(body.nodeIds) ? { nodeIds: normalizeAxNodeIds(body.nodeIds) } : {}),
      ...(isRecord(body.data) ? { data: body.data } : {}),
      ...(isRecord(body.reactions) ? { reactions: normalizeActivityReactions(body.reactions) } : {}),
    },
    { source: normalizeAxSource(body.source, 'api') },
  );
  const meta = { sessionId: primaryWorkbenchSessionId, timestamp: new Date().toISOString() };
  broadcastWorkbenchEvent('ax-event-created', { event: result.event, ...meta });
  if (result.workItem) broadcastWorkbenchEvent('ax-state-changed', { workItem: result.workItem, ...meta });
  if (result.evidence) broadcastWorkbenchEvent('ax-event-created', { evidence: result.evidence, ...meta });
  if (result.review) broadcastWorkbenchEvent('ax-state-changed', { reviewAnnotation: result.review, ...meta });
  return responseJson({ ok: true, ...result });
}

// Report primitive D single-item gate reads (GET /api/canvas/ax/{approval,
// elicitation,mode}/:id) with the optional ?waitMs= long-poll migrated to the
// operation registry (plan-007 Slice B wave 4):
// src/server/operations/ops/ax-await.ts.

// Compact AX state for surfaces (the same shape seeded into AX-enabled iframes).
// The client fetches this and pushes it to surfaces over the ax-update channel.
function handleGetAxSurfaceSnapshot(): Response {
  return responseJson(buildCanvasAxSurfaceSnapshot());
}

// Open a node's surface in the user's real system browser (for hosts whose
// embedded browser makes window.open('_blank') feel in-place, e.g. Codex).
// Accepts ONLY { nodeId, url? } and opens this server's own surface URL — never
// an arbitrary URL — so it can't be used to launch external sites (no SSRF).
// The optional URL is limited to the same node surface route so callers can keep
// safe presentation query params like the current theme.
async function handleOpenExternalSurface(req: Request): Promise<Response> {
  const body = await readJson(req);
  const nodeId = typeof body.nodeId === 'string' ? body.nodeId : '';
  if (!nodeId) return responseJson({ ok: false, error: 'nodeId is required.' }, 400);
  const node = canvasState.getNode(nodeId);
  if (!node) return responseJson({ ok: false, error: `Node "${nodeId}" not found.` }, 404);
  const port = getCanvasServerPort();
  if (!port) return responseJson({ ok: false, opened: false, error: 'Server port unavailable.' }, 503);
  const defaultSurfacePath = `/api/canvas/surface/${encodeURIComponent(nodeId)}`;
  const rawUrl = typeof body.url === 'string' ? body.url : defaultSurfacePath;
  const parsedUrl = new URL(rawUrl, `http://localhost:${port}`);
  if (parsedUrl.origin !== `http://localhost:${port}` || parsedUrl.pathname !== defaultSurfacePath) {
    return responseJson({ ok: false, error: 'url must target the requested node surface.' }, 400);
  }
  const theme = normalizeSurfaceTheme(parsedUrl.searchParams.get('theme'));
  const surfacePath = `${defaultSurfacePath}?theme=${encodeURIComponent(theme)}`;
  const opened = openUrlInExternalBrowser(`http://localhost:${port}${surfacePath}`);
  return responseJson({ ok: true, opened, url: surfacePath });
}

async function handleAxInteraction(req: Request): Promise<Response> {
  const body = await readJson(req);
  const { result, events } = applyAxInteraction(canvasState, body, normalizeAxSource(body.source, 'api'));
  for (const e of events) {
    broadcastWorkbenchEvent(e.event, {
      ...e.payload,
      sessionId: primaryWorkbenchSessionId,
      timestamp: new Date().toISOString(),
    });
  }
  return responseJson(result, result.ok ? 200 : result.status);
}

// handleAxDeliveryPending / handleAxDeliveryMark migrated to the operation
// registry (plan-007 Slice B wave 3): src/server/operations/ops/ax-timeline.ts.

function handleAxElicitationList(): Response {
  return responseJson({ ok: true, elicitations: canvasState.getElicitations() });
}

// handleAxElicitationRequest / handleAxElicitationRespond migrated to the
// operation registry (plan-007 Slice B wave 2): src/server/operations/ops/ax-work.ts.

function handleAxModeList(): Response {
  return responseJson({ ok: true, modeRequests: canvasState.getModeRequests() });
}

// handleAxModeRequest / handleAxModeResolve migrated to the operation registry
// (plan-007 Slice B wave 2): src/server/operations/ops/ax-work.ts.

function handleAxCommandList(): Response {
  return responseJson({ ok: true, commands: canvasState.getCommandRegistry() });
}

// handleAxCommandInvoke migrated to the operation registry (plan-007 Slice B
// wave 3): src/server/operations/ops/ax-timeline.ts.

function handleAxPolicyGet(): Response {
  return responseJson({ ok: true, policy: canvasState.getPolicy() });
}

async function handleAxStatePatch(req: Request): Promise<Response> {
  const body = await readJson(req);
  if (!body.focus || typeof body.focus !== 'object' || Array.isArray(body.focus)) {
    return responseJson({ ok: false, error: 'PATCH /api/canvas/ax currently requires a focus object.' }, 400);
  }
  const focusInput = body.focus as Record<string, unknown>;
  const focus = canvasState.setAxFocus(normalizeAxNodeIds(focusInput.nodeIds), {
    source: normalizeAxSource(focusInput.source, 'api'),
  });
  broadcastWorkbenchEvent('ax-state-changed', {
    focus,
    sessionId: primaryWorkbenchSessionId,
    timestamp: new Date().toISOString(),
  });
  return responseJson({ ok: true, state: canvasState.getAxState() });
}

// handleAxEventAdd / handleAxSteer / handleAxTimelineGet migrated to the
// operation registry (plan-007 Slice B wave 3): src/server/operations/ops/ax-timeline.ts.

const AX_WORK_STATUSES = new Set(['todo', 'in-progress', 'blocked', 'done', 'cancelled']);

function normalizeAxWorkItemStatus(value: unknown): 'todo' | 'in-progress' | 'blocked' | 'done' | 'cancelled' | undefined {
  return typeof value === 'string' && AX_WORK_STATUSES.has(value)
    ? value as 'todo' | 'in-progress' | 'blocked' | 'done' | 'cancelled'
    : undefined;
}

function handleAxWorkList(): Response {
  return responseJson({ ok: true, workItems: canvasState.getWorkItems() });
}

// handleAxWorkAdd / handleAxWorkUpdate migrated to the operation registry
// (plan-007 Slice B wave 2): src/server/operations/ops/ax-work.ts.

function handleAxApprovalList(): Response {
  return responseJson({ ok: true, approvalGates: canvasState.getApprovalGates() });
}

// handleAxApprovalRequest / handleAxApprovalResolve migrated to the operation
// registry (plan-007 Slice B wave 2): src/server/operations/ops/ax-work.ts.

// handleAxEvidenceAdd migrated to the operation registry (plan-007 Slice B
// wave 3): src/server/operations/ops/ax-timeline.ts.

// The AX review normalize helpers + their constant sets moved with the
// migrated handlers (plan-007 Slice B wave 2): src/server/operations/ops/ax-work.ts.

function handleAxReviewList(): Response {
  return responseJson({ ok: true, reviewAnnotations: canvasState.getReviewAnnotations() });
}

// handleAxReviewAdd / handleAxReviewUpdate migrated to the operation registry
// (plan-007 Slice B wave 2): src/server/operations/ops/ax-work.ts.

function handleAxHostCapabilityGet(): Response {
  return responseJson({ ok: true, host: canvasState.getHostCapability() });
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
      collapsed: true,
      pinned: false,
      dockPosition: 'right',
      data: mergedData,
    });
    return;
  }

  canvasState.updateNode(id, { data: mergedData });
}

/**
 * Seed the docked status (left) + context (right) widgets so a freshly opened
 * canvas shows them by default — the same nodes the agent-event path creates on
 * demand (`status-main`, `context-main`), just present from the start.
 *
 * First-run only: we bail if the workspace canvas already has persisted state,
 * so we never add them to a board with content, and — because first-run state is
 * persisted on save — deleting or undocking them later is respected (they are
 * not re-seeded). Create-if-missing keeps it idempotent if the agent path
 * already made one. Returns true if anything was seeded.
 */
export function ensureDefaultDockedNodes(): boolean {
  if (canvasState.hasPersistedState()) return false;
  let seeded = false;
  // NOTE: these node specs mirror the agent-event create paths below
  // (`canvas-status` for status-main, `syncContextNodeToCanvasState` for
  // context-main) — keep geometry/dock defaults in sync if you change them.
  if (!canvasState.getNode('status-main')) {
    canvasState.addNode({
      id: 'status-main',
      type: 'status',
      position: { x: 40, y: 80 },
      size: { width: 300, height: 120 },
      zIndex: 0,
      collapsed: true,
      pinned: false,
      dockPosition: 'left',
      data: { phase: 'idle', message: '', elapsed: 0 },
    });
    seeded = true;
  }
  if (!canvasState.getNode('context-main')) {
    canvasState.addNode({
      id: 'context-main',
      type: 'context',
      position: { x: 1130, y: 80 },
      size: { width: 320, height: 400 },
      zIndex: 1,
      collapsed: true,
      pinned: false,
      dockPosition: 'right',
      data: { cards: [], auxTabs: [] },
    });
    seeded = true;
  }
  if (seeded) {
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  }
  return seeded;
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
    const id = typeof payload.nodeId === 'string' && payload.nodeId.length > 0
      ? payload.nodeId
      : toolCallId.startsWith('ext-app-') ? toolCallId : `ext-app-${toolCallId}`;
    const dataPatch = {
      mode: 'ext-app',
      toolCallId,
      nodeId: id,
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
      canvasState.updateNode(id, {
        data: { ...existing.data, ...dataPatch },
        ...extAppEventGeometryPatch(existing, payload),
      });
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
          ...extAppEventGeometryPatch(reusableNode, payload),
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
    canvasState.withSuppressedRecording(() => {
      const toolCallId = payload.toolCallId as string;
      if (!toolCallId) return;
      const payloadNodeId = typeof payload.nodeId === 'string' ? payload.nodeId : '';
      const id =
        (payloadNodeId && canvasState.getNode(payloadNodeId) ? payloadNodeId : null) ||
        findCanvasExtAppNodeId(toolCallId) ||
        (typeof payload.serverName === 'string' && typeof payload.toolName === 'string'
          ? findOnlyPendingCanvasExtAppNodeId(payload.serverName, payload.toolName)
          : null);
      if (!id) return;
      const existing = canvasState.getNode(id);
      if (existing) {
        canvasState.updateNode(id, { data: { ...existing.data, html: payload.html } });
      }
    });
  } else if (event === 'ext-app-result') {
    canvasState.withSuppressedRecording(() => {
      const toolCallId = payload.toolCallId as string;
      if (!toolCallId) return;
      const payloadNodeId = typeof payload.nodeId === 'string' ? payload.nodeId : '';
      const id =
        (payloadNodeId && canvasState.getNode(payloadNodeId) ? payloadNodeId : null) ||
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
    });
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
  allowPortFallback?: boolean;
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
  canvasState.setTheme(initialCanvasThemeSetting as CanvasTheme);
  const loaded = canvasState.loadFromDisk({ clearExisting: true });
  setCanvasLayoutUpdateEmitter(() => {
    emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  });
  if (loaded) {
    console.log('  Canvas state restored from .pmx-canvas/canvas.db');
    primeCanvasRuntimeBackends({ forceRehydrateExtApps: true });
    void syncCanvasRuntimeBackends({ forceRehydrateExtApps: true, alreadyPrimed: true }).finally(() => {
      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
    });
  }

  rotatePrimaryWorkbenchSessionIfNeeded();

  const preferredPort = options.port ?? Number(process.env.PMX_WEB_CANVAS_PORT ?? DEFAULT_PORT);
  const portCandidates = options.port === 0
    ? [0]
    : options.allowPortFallback === false
    ? [preferredPort > 0 ? Math.floor(preferredPort) : DEFAULT_PORT]
    : buildPortCandidates(preferredPort);

  for (const portCandidate of portCandidates) {
    try {
      server = Bun.serve({
        hostname: DEFAULT_HOST,
        port: portCandidate,
        idleTimeout: 0,
        // Last-resort boundary: any throw that escapes the fetch handler must NOT
        // render Bun's default dev error overlay (HTTP 500 text/html disclosing the
        // absolute server source path + stack). Return a clean JSON 500 and log the
        // real error server-side only. Operation dispatch has its own catch
        // (operations/http.ts); this covers the hand-written routes too.
        error(error) {
          logWorkbenchWarning('serverFetch', error);
          return responseJson({ ok: false, error: 'Internal server error.' }, 500);
        },
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

          if (url.pathname === '/api/canvas/frame-documents' && req.method === 'POST') {
            return handleCreateFrameDocument(req);
          }

          if (url.pathname.startsWith('/api/canvas/frame-documents/') && req.method === 'GET') {
            return handleFrameDocument(url.pathname);
          }

          if (url.pathname.startsWith('/api/canvas/surface/') && req.method === 'GET') {
            return handleNodeSurface(url.pathname, url);
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

          // Webview automation routes (plan-008 Wave 3): status / start /
          // evaluate / resize / stop are now registered operations served by the
          // registry. A null return falls through (e.g. the screenshot route
          // below, which stays hand-written — it returns a binary image, not a
          // JSON wire body).
          if (url.pathname.startsWith('/api/workbench/webview')) {
            const webviewResponse = await dispatchOperationRoute(req, url);
            if (webviewResponse) return webviewResponse;
          }

          if (url.pathname === '/api/workbench/webview/screenshot' && req.method === 'POST') {
            return handleWorkbenchWebViewScreenshot(req);
          }

          if (url.pathname === '/api/file/save' && req.method === 'POST') {
            return handleSave(req);
          }

          if (url.pathname === '/api/render' && req.method === 'POST') {
            return handleRender(req);
          }

          // Operation registry routes (plan-005): registered operations are
          // dispatched here; a null return falls through to the legacy routes.
          if (url.pathname.startsWith('/api/canvas/')) {
            const operationResponse = await dispatchOperationRoute(req, url);
            if (operationResponse) return operationResponse;
          }

          if (url.pathname === '/api/canvas/theme' && req.method === 'GET') {
            return responseJson({ ok: true, theme: canvasState.theme });
          }

          if (url.pathname === '/api/canvas/theme' && req.method === 'POST') {
            return handleCanvasThemeUpdate(req);
          }

          if (url.pathname === '/api/canvas/update' && req.method === 'POST') {
            return handleCanvasUpdate(req);
          }

          // POST /api/canvas/batch migrated to the operation registry
          // (plan-008 Wave 2): src/server/operations/ops/batch.ts.

          if (url.pathname === '/api/canvas/viewport' && req.method === 'POST') {
            return handleCanvasViewport(req);
          }

          if (url.pathname === '/api/canvas/annotation' && req.method === 'POST') {
            return handleCanvasAddAnnotation(req);
          }

          // POST /api/canvas/mcp-app/open, /api/canvas/diagram, and
          // /api/canvas/web-artifact migrated to the operation registry
          // (plan-008 Wave 4): src/server/operations/ops/app.ts.

          // Individual node GET/PATCH/DELETE
          if (url.pathname.startsWith('/api/canvas/node/') && url.pathname.endsWith('/refresh') && req.method === 'POST') {
            const nodeId = url.pathname.slice('/api/canvas/node/'.length, -'/refresh'.length);
            return handleCanvasRefreshWebpageNode(nodeId, req);
          }

          if (url.pathname.startsWith('/api/canvas/image/') && req.method === 'GET') {
            return await handleCanvasImage(url.pathname);
          }

          if (url.pathname === '/api/canvas/pinned-context' && req.method === 'GET') {
            return handleGetPinnedContext();
          }

          // GET /api/canvas/ax migrated to the operation registry (plan-007 Slice B.1).

          if (url.pathname === '/api/canvas/ax' && req.method === 'PATCH') {
            return handleAxStatePatch(req);
          }

          if (url.pathname === '/api/canvas/ax/context' && req.method === 'GET') {
            return handleGetAxContext(url);
          }

          if (url.pathname === '/api/canvas/ax/activity' && req.method === 'POST') {
            return handleAxActivityIngest(req);
          }

          if (url.pathname === '/api/canvas/ax/surface-snapshot' && req.method === 'GET') {
            return handleGetAxSurfaceSnapshot();
          }

          if (url.pathname === '/api/canvas/open-external' && req.method === 'POST') {
            return handleOpenExternalSurface(req);
          }

          // POST /api/canvas/ax/focus migrated to the operation registry (plan-007 Slice B.1).

          // POST /api/canvas/ax/event + POST /api/canvas/ax/steer + GET
          // /api/canvas/ax/timeline migrated to the operation registry
          // (plan-007 Slice B wave 3): src/server/operations/ops/ax-timeline.ts.

          if (url.pathname === '/api/canvas/ax/work' && req.method === 'GET') {
            return handleAxWorkList();
          }

          // POST /api/canvas/ax/work + PATCH /api/canvas/ax/work/:id migrated to
          // the operation registry (plan-007 Slice B wave 2).

          if (url.pathname === '/api/canvas/ax/approval' && req.method === 'GET') {
            return handleAxApprovalList();
          }

          // POST /api/canvas/ax/approval + POST /api/canvas/ax/approval/:id/resolve
          // migrated to the operation registry (plan-007 Slice B wave 2).

          // GET /api/canvas/ax/approval/:id (single-item read + ?waitMs long-poll)
          // migrated to the operation registry (plan-007 Slice B wave 4).

          // POST /api/canvas/ax/evidence migrated to the operation registry
          // (plan-007 Slice B wave 3): src/server/operations/ops/ax-timeline.ts.

          if (url.pathname === '/api/canvas/ax/review' && req.method === 'GET') {
            return handleAxReviewList();
          }

          // POST /api/canvas/ax/review + PATCH /api/canvas/ax/review/:id migrated
          // to the operation registry (plan-007 Slice B wave 2).

          if (url.pathname === '/api/canvas/ax/host-capability' && req.method === 'GET') {
            return handleAxHostCapabilityGet();
          }

          // PUT /api/canvas/ax/host-capability migrated to the operation registry (plan-007 Slice B.1).

          if (url.pathname === '/api/canvas/ax/interaction' && req.method === 'POST') {
            return handleAxInteraction(req);
          }

          // GET /api/canvas/ax/delivery/pending + POST /api/canvas/ax/delivery/:id/mark
          // migrated to the operation registry (plan-007 Slice B wave 3):
          // src/server/operations/ops/ax-timeline.ts.

          if (url.pathname === '/api/canvas/ax/elicitation' && req.method === 'GET') {
            return handleAxElicitationList();
          }

          // POST /api/canvas/ax/elicitation + POST /api/canvas/ax/elicitation/:id/respond
          // migrated to the operation registry (plan-007 Slice B wave 2).

          // GET /api/canvas/ax/elicitation/:id (single-item read + ?waitMs long-poll)
          // migrated to the operation registry (plan-007 Slice B wave 4).

          if (url.pathname === '/api/canvas/ax/mode' && req.method === 'GET') {
            return handleAxModeList();
          }

          // POST /api/canvas/ax/mode + POST /api/canvas/ax/mode/:id/resolve migrated
          // to the operation registry (plan-007 Slice B wave 2).

          // GET /api/canvas/ax/mode/:id (single-item read + ?waitMs long-poll)
          // migrated to the operation registry (plan-007 Slice B wave 4).

          if (url.pathname === '/api/canvas/ax/command' && req.method === 'GET') {
            return handleAxCommandList();
          }

          // POST /api/canvas/ax/command migrated to the operation registry
          // (plan-007 Slice B wave 3): src/server/operations/ops/ax-timeline.ts.

          if (url.pathname === '/api/canvas/ax/policy' && req.method === 'GET') {
            return handleAxPolicyGet();
          }

          // POST /api/canvas/ax/policy migrated to the operation registry (plan-007 Slice B.1).

          // Code graph API
          if (url.pathname === '/api/canvas/code-graph' && req.method === 'GET') {
            const summary = buildCodeGraphSummary();
            return responseJson(summary);
          }

          if (url.pathname === '/api/canvas/prompt' && req.method === 'POST') {
            return handleCanvasPrompt(req);
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
  intentRegistry.reset();
  canvasState.close();
  closeAllMcpAppSessions();
  setCanvasLayoutUpdateEmitter(null);
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
