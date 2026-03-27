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
 * - GET  /api/workbench/events   -> SSE event stream
 * - GET  /api/workbench/state    -> workbench state snapshot
 * - POST /api/workbench/intent   -> workbench intents
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { marked } from 'marked';
import { type CanvasEdge, type CanvasNodeState, IMAGE_MIME_MAP, canvasState } from './canvas-state.js';
import { normalizeExtAppToolResult } from './ext-app-tool-result.js';
import { getMcpAppHostSnapshot } from './mcp-app-host.js';
import { findOpenCanvasPosition } from './placement.js';
import { searchNodes, buildSpatialContext } from './spatial-analysis.js';
import { mutationHistory } from './mutation-history.js';
import { buildCodeGraphSummary, formatCodeGraph } from './code-graph.js';
import { traceManager } from './trace-manager.js';

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
  } catch {
    // Optional diagnostics logging only.
  }
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
    } catch {
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
  return req
    .json()
    .then((value) => {
      if (!value || typeof value !== 'object') return {};
      return value as Record<string, unknown>;
    })
    .catch(() => ({}));
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
  try {
    const parsed = new URL(raw);
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
  } catch {
    return raw;
  }
}

function isExcalidrawUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host.includes('excalidraw.com') || host.includes('excalidraw-mcp-app');
  } catch {
    return false;
  }
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
  <link rel="icon" href="/favicon.ico" sizes="any" />
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      background: #081019;
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
        #081019;
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
  <g fill="#4bbcff" fill-rule="evenodd">
    <path d="M6,18 H18 V31 H9 V46 H6Z M9,21 H15 V28 H9Z"/>
    <path d="M21,46 V18 H24 L32,29 L40,18 H43 V46 H40 V23 L32,34 L24,23 V46Z"/>
    <path d="M46,18 H50 L59,46 H55Z"/>
    <path d="M55,18 H59 L50,46 H46Z"/>
  </g>
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
  const safe = updates.filter((u: Record<string, unknown>) => {
    if (u.position) {
      const p = u.position as { x: number; y: number };
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    }
    if (u.size) {
      const s = u.size as { width: number; height: number };
      if (!Number.isFinite(s.width) || !Number.isFinite(s.height)) return false;
      if (s.width <= 0 || s.height <= 0) return false;
    }
    return true;
  });
  const result = canvasState.applyUpdates(safe);
  return responseJson({ ok: true, ...result });
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
const VALID_NODE_TYPES = new Set(['markdown', 'status', 'context', 'ledger', 'trace', 'file', 'image', 'mcp-app']);

async function handleCanvasAddNode(req: Request): Promise<Response> {
  const body = await readJson(req);
  const type = (body.type as string) || 'markdown';

  if (!VALID_NODE_TYPES.has(type)) {
    return responseJson({ ok: false, error: `Invalid node type: "${type}".` }, 400);
  }

  const width = typeof body.width === 'number' ? body.width : 360;
  const height = typeof body.height === 'number' ? body.height : 200;
  const position =
    typeof body.x === 'number' && typeof body.y === 'number'
      ? { x: body.x, y: body.y }
      : findOpenCanvasPosition(canvasState.getLayout().nodes, width, height);

  const id = `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const data: Record<string, unknown> = {};
  if (body.title) data.title = String(body.title);
  if (body.content) data.content = String(body.content);

  // Image nodes: set src from content for the renderer
  if (type === 'image' && body.content) {
    data.src = String(body.content);
  }

  // File nodes dropped from browser: store content for display
  if (type === 'file' && body.content && body.title) {
    data.fileContent = String(body.content);
    data.lineCount = String(body.content).split('\n').length;
  }

  canvasState.addNode({
    id,
    type: type as CanvasNodeState['type'],
    position,
    size: { width, height },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    dockPosition: null,
    data,
  });

  emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  return responseJson({ ok: true, id });
}

const VALID_EDGE_TYPES = new Set(['relation', 'depends-on', 'flow', 'references']);

async function handleCanvasAddEdge(req: Request): Promise<Response> {
  const body = await readJson(req);
  const from = body.from as string;
  const to = body.to as string;
  const type = body.type as string;

  if (!from || !to || !type) {
    return responseJson({ ok: false, error: 'Missing required fields: from, to, type.' }, 400);
  }
  if (!VALID_EDGE_TYPES.has(type)) {
    return responseJson({ ok: false, error: `Invalid edge type: "${type}".` }, 400);
  }
  if (!canvasState.getNode(from)) {
    return responseJson({ ok: false, error: `Source node "${from}" not found.` }, 400);
  }
  if (!canvasState.getNode(to)) {
    return responseJson({ ok: false, error: `Target node "${to}" not found.` }, 400);
  }

  const edge: CanvasEdge = {
    id: `edge-${Date.now().toString(36)}`,
    from,
    to,
    type: type as CanvasEdge['type'],
  };
  if (body.label) edge.label = String(body.label);
  if (body.animated !== undefined) edge.animated = Boolean(body.animated);

  const added = canvasState.addEdge(edge);
  if (!added) {
    return responseJson({ ok: false, error: 'Duplicate or self-edge.' }, 400);
  }

  emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  return responseJson({ ok: true, id: edge.id });
}

async function handleCanvasRemoveEdge(req: Request): Promise<Response> {
  const body = await readJson(req);
  const edgeId = body.edge_id as string;
  if (!edgeId) {
    return responseJson({ ok: false, error: 'Missing edge_id.' }, 400);
  }
  const removed = canvasState.removeEdge(edgeId);
  if (!removed) {
    return responseJson({ ok: false, error: `Edge "${edgeId}" not found.` }, 404);
  }
  emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
  return responseJson({ ok: true, removed: edgeId });
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
      pingTimer = setInterval(() => {
        try {
          controller.enqueue(
            toSseFrame('ping', {
              ts: Date.now(),
              sessionId: primaryWorkbenchSessionId,
            }),
          );
        } catch {
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

/** Build a context preamble from selected canvas node content. */
function buildSelectionContextPreamble(contextNodeIds: string[]): string {
  const sections: string[] = [];
  for (const id of contextNodeIds) {
    const node = canvasState.getNode(id);
    if (!node) continue;
    const title = (node.data.title as string) || node.id;
    let summary = '';

    switch (node.type) {
      case 'markdown': {
        const content = (node.data.rendered as string) || (node.data.content as string) || '';
        summary = content.slice(0, 500);
        break;
      }
      case 'mcp-app': {
        const chartCfg = node.data.chartConfig as Record<string, unknown> | undefined;
        if (chartCfg) {
          const chartTitle = (chartCfg.title as string) || 'Untitled chart';
          const chartType = (chartCfg.type as string) || 'unknown';
          const labels = Array.isArray(chartCfg.labels)
            ? (chartCfg.labels as string[]).join(', ')
            : '';
          summary = `Chart: ${chartTitle} (${chartType}). Labels: ${labels}`;
        } else {
          const url = (node.data.url as string) || '';
          summary = url ? `MCP App: ${url}` : 'MCP App node';
        }
        break;
      }
      case 'prompt':
      case 'response': {
        const text = (node.data.text as string) || (node.data.content as string) || '';
        summary = text.slice(0, 500);
        break;
      }
      default:
        summary = JSON.stringify(node.data).slice(0, 300);
    }

    if (summary) {
      sections.push(`[Context from "${title}" (${node.type})]\n${summary}\n`);
    }
  }
  return sections.length > 0 ? `${sections.join('\n')}\n` : '';
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
  const snapshot = canvasState.saveSnapshot(name);
  if (!snapshot) return responseText('Failed to save snapshot', 500);
  return responseJson({ ok: true, snapshot });
}

async function handleContextPinsUpdate(req: Request): Promise<Response> {
  const body = await readJson(req);
  const MAX_PINS = 20;
  const nodeIds = Array.isArray(body.nodeIds)
    ? (body.nodeIds.filter((id: unknown) => typeof id === 'string') as string[]).slice(0, MAX_PINS)
    : [];
  canvasState.setContextPins(nodeIds);
  broadcastWorkbenchEvent('context-pins-changed', {
    count: canvasState.contextPinnedNodeIds.size,
    nodeIds: Array.from(canvasState.contextPinnedNodeIds),
  });
  return responseJson({ ok: true, count: canvasState.contextPinnedNodeIds.size });
}

function handleGetPinnedContext(): Response {
  const pinnedIds = Array.from(canvasState.contextPinnedNodeIds);
  const preamble = pinnedIds.length > 0 ? buildSelectionContextPreamble(pinnedIds) : '';
  return responseJson({ preamble, nodeIds: pinnedIds, count: pinnedIds.length });
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
        ? spawnSync(browser.exe, [url], { stdio: 'ignore', detached: true })
        : spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
      return !result.error && result.status === 0;
    }
    const result = spawnSync('xdg-open', [url], { stdio: 'ignore' });
    return !result.error && result.status === 0;
  } catch {
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
      hostMode: 'hosted',
      trustedDomain: true,
      ...(payload.chartConfig ? { chartConfig: payload.chartConfig } : {}),
    };
    const existing = canvasState.getNode(id);
    if (existing) {
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
}

export function startCanvasServer(options: CanvasServerOptions = {}): string | null {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  activeWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);

  // ── Canvas persistence: set workspace root and load saved state ──
  canvasState.setWorkspaceRoot(activeWorkspaceRoot);
  const loaded = canvasState.loadFromDisk();
  if (loaded) {
    console.log('  Canvas state restored from .pmx-canvas.json');
  }

  rotatePrimaryWorkbenchSessionIfNeeded();

  if (server) {
    return typeof server.port === 'number' ? loopbackBaseUrl(server.port) : null;
  }

  const preferredPort = options.port ?? Number(process.env.PMX_WEB_CANVAS_PORT ?? DEFAULT_PORT);
  const portCandidates = buildPortCandidates(preferredPort);

  for (const portCandidate of portCandidates) {
    try {
      server = Bun.serve({
        hostname: DEFAULT_HOST,
        port: portCandidate,
        idleTimeout: 0,
        fetch(req) {
          const url = new URL(req.url);

          if (url.pathname === '/health') {
            return responseJson({ ok: true, workspace: activeWorkspaceRoot });
          }

          if (url.pathname === '/favicon.ico') {
            return serveCanvasFavicon();
          }

          if (url.pathname === '/workbench' || url.pathname === '/artifact') {
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

          if (url.pathname === '/api/file/save' && req.method === 'POST') {
            return handleSave(req);
          }

          if (url.pathname === '/api/render' && req.method === 'POST') {
            return handleRender(req);
          }

          // Canvas state API
          if (url.pathname === '/api/canvas/state' && req.method === 'GET') {
            return responseJson(canvasState.getLayout());
          }

          if (url.pathname === '/api/canvas/update' && req.method === 'POST') {
            return handleCanvasUpdate(req);
          }

          if (url.pathname === '/api/canvas/node' && req.method === 'POST') {
            return handleCanvasAddNode(req);
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
            return responseJson(canvasState.listSnapshots());
          }

          if (url.pathname === '/api/canvas/snapshots' && req.method === 'POST') {
            return handleSnapshotSave(req);
          }

          if (url.pathname.startsWith('/api/canvas/snapshots/') && req.method === 'POST') {
            const id = url.pathname.split('/').pop() ?? '';
            const ok = canvasState.restoreSnapshot(id);
            if (!ok) return responseText('Snapshot not found', 404);
            broadcastWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
            return responseJson({ ok: true });
          }

          if (url.pathname.startsWith('/api/canvas/snapshots/') && req.method === 'DELETE') {
            const id = url.pathname.split('/').pop() ?? '';
            const ok = canvasState.deleteSnapshot(id);
            if (!ok) return responseText('Snapshot not found', 404);
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

          // Code graph API
          if (url.pathname === '/api/canvas/code-graph' && req.method === 'GET') {
            const summary = buildCodeGraphSummary();
            return responseJson(summary);
          }

          // Undo/Redo/History API
          if (url.pathname === '/api/canvas/undo' && req.method === 'POST') {
            const entry = mutationHistory.undo();
            if (!entry) return responseJson({ ok: false, description: 'Nothing to undo' });
            emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
            return responseJson({ ok: true, description: `Undid: ${entry.description}` });
          }

          if (url.pathname === '/api/canvas/redo' && req.method === 'POST') {
            const entry = mutationHistory.redo();
            if (!entry) return responseJson({ ok: false, description: 'Nothing to redo' });
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

          // Static files for canvas SPA bundle
          if (url.pathname.startsWith('/canvas/')) {
            const staticResponse = serveCanvasStatic(url.pathname);
            if (staticResponse) return staticResponse;
          }

          return responseText('Not found', 404);
        },
      });
      return typeof server.port === 'number' ? loopbackBaseUrl(server.port) : null;
    } catch {
      server = null;
    }
  }
  return null;
}

export function stopCanvasServer(): void {
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
