/**
 * Webview (Bun.WebView automation) operations (plan-008 Wave 3).
 *
 * The five browser-automation tools (status / start / stop / resize / evaluate)
 * migrate to the registry. They are SIDE-SURFACE operations: `mutates: false`
 * (no canvas node/edge state changes, so NO canvas-layout-update frame).
 *
 * The automation machinery lives in `../../server.ts`, which `operations/` must
 * NEVER import. Each handler calls the INJECTED runner (`getWebviewRunner()`);
 * server.ts wires the real automation functions via `setWebviewRunner` at module
 * load — the same injection pattern as `setOperationEventEmitter`.
 *
 * Wire + MCP result shapes are byte-identical to the legacy hand-written tools:
 *  - status   GET    /api/workbench/webview          → raw status object
 *  - start    POST   /api/workbench/webview/start    → { ok, webview } (+error: { ok, error, webview })
 *  - stop     DELETE /api/workbench/webview          → { ok, stopped, webview }
 *  - resize   POST   /api/workbench/webview/resize   → { ok, webview }
 *  - evaluate POST   /api/workbench/webview/evaluate → { ok, value }
 *
 * `canvas_screenshot` is NOT migrated — it returns a binary payload and stays a
 * standalone hand-written tool (the POST /api/workbench/webview/screenshot route
 * also stays hand-written in server.ts).
 *
 * This module must never import server.ts or index.ts.
 */
import { resolve, relative, isAbsolute } from 'node:path';
import { z } from 'zod';
import { defineOperation, OperationError, type Operation } from '../types.js';
import {
  getWebviewRunner,
  type WebviewStartOptions,
  type WebviewStartResult,
  type WebviewStatus,
} from '../webview-runner.js';

/**
 * Resolve a workspace-relative path and reject anything escaping the workspace
 * (mirrors the MCP server's `safeWorkspacePath`). Inlined here (pure node:path +
 * process.cwd) so the registry op can enforce the workspace boundary without
 * importing the MCP server. Applied in buildStartOptions for BOTH the MCP and
 * HTTP surfaces (the legacy MCP tool sandboxed it; the HTTP route did not —
 * unified here to the safer behavior).
 */
function safeWorkspacePath(pathLike: string): string {
  const workspace = resolve(process.cwd());
  const resolved = resolve(workspace, pathLike);
  const rel = relative(workspace, resolved);
  const inside = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  if (!inside) {
    throw new OperationError(`Path "${pathLike}" resolves outside workspace.`);
  }
  return resolved;
}

/** Wrap a multi-statement script body in an async IIFE (legacy
 * wrapCanvasAutomationScript). Inlined — it is a pure string template. */
function wrapScript(script: string): string {
  return `(async () => {\n${script}\n})()`;
}

/**
 * Run an injected automation-runner call, converting a runtime failure (e.g. no
 * active session, or a page-side eval error) into the legacy
 * `400 { ok:false, error, webview }` contract. Without this the plain Error the
 * runner throws would escape dispatchOperationRoute (which only maps OperationError)
 * and surface as Bun's default 500 HTML error overlay — a wire regression that also
 * discloses the server source path. Mirrors the legacy resize/evaluate try/catch.
 */
async function runWebviewTask<T>(task: () => Promise<T> | T): Promise<T> {
  try {
    return await task();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let webview: WebviewStatus | undefined;
    try { webview = getWebviewRunner().status(); } catch { /* runner not wired */ }
    throw new OperationError(message, 400, webview ? { webview } : undefined);
  }
}

function statusText(status: WebviewStatus): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }] };
}

// ── webview.status ────────────────────────────────────────────

const statusShape = {};
const statusSchema = z.looseObject(statusShape);

const statusOperation = defineOperation<z.infer<typeof statusSchema>, WebviewStatus>({
  name: 'webview.status',
  mutates: false,
  input: statusSchema,
  inputShape: statusShape,
  http: {
    method: 'GET',
    path: '/api/workbench/webview',
  },
  mcp: {
    toolName: 'canvas_webview_status',
    description:
      'Get the current Bun.WebView automation status for the PMX Canvas workbench. Returns whether Bun.WebView is supported, whether an automation session is active, backend, viewport size, and the current workbench URL if active.',
    formatResult: (result) => statusText(result as WebviewStatus),
  },
  handler: () => getWebviewRunner().status(),
});

// ── webview.start ─────────────────────────────────────────────

const startShape = {
  backend: z.unknown().optional().describe('Automation backend (chrome | webkit)'),
  width: z.unknown().optional().describe('Viewport width in pixels (default: 1280)'),
  height: z.unknown().optional().describe('Viewport height in pixels (default: 800)'),
  chromePath: z.unknown().optional().describe('Optional Chrome/Chromium executable path'),
  chromeArgv: z.unknown().optional().describe('Optional extra Chrome launch args'),
  dataStoreDir: z.unknown().optional().describe('Optional persistent data store directory'),
};
const startSchema = z.looseObject(startShape);

function buildStartOptions(input: Record<string, unknown>): WebviewStartOptions {
  const backend = input.backend === 'chrome' || input.backend === 'webkit' ? input.backend : undefined;
  const width = typeof input.width === 'number' ? input.width : undefined;
  const height = typeof input.height === 'number' ? input.height : undefined;
  const chromePath = typeof input.chromePath === 'string' ? input.chromePath : undefined;
  // Sandbox dataStoreDir to the workspace on BOTH surfaces. The legacy MCP tool
  // sandboxed it (the HTTP route passed it raw — a cross-surface asymmetry);
  // unify to the safer behavior here in the shared option builder so an
  // out-of-workspace data store is a 400 over HTTP and MCP alike.
  const dataStoreDir = typeof input.dataStoreDir === 'string' ? safeWorkspacePath(input.dataStoreDir) : undefined;
  const chromeArgv = Array.isArray(input.chromeArgv)
    ? input.chromeArgv.filter((value): value is string => typeof value === 'string')
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

const startOperation = defineOperation<z.infer<typeof startSchema>, WebviewStartResult>({
  name: 'webview.start',
  mutates: false,
  input: startSchema,
  inputShape: startShape,
  http: {
    method: 'POST',
    path: '/api/workbench/webview/start',
    errorBodyAsResult: true,
    // Mirror the legacy handler status codes from the SERIALIZED wire body
    // (`status` receives the serialized result): 200 ok; 503 server-not-running
    // ({ ok:false, error } — no webview); else 501 when the runtime is
    // unsupported (webview.supported === false) vs 500 for a supported failure.
    status: (result) => {
      const body = result as { ok?: boolean; webview?: WebviewStatus };
      if (body.ok) return 200;
      if (!body.webview) return 503;
      return body.webview.supported ? 500 : 501;
    },
  },
  mcp: {
    toolName: 'canvas_webview_start',
    description:
      'Start or replace the headless Bun.WebView automation session for the current PMX Canvas workbench. Use this before screenshot, evaluate, or resize when no automation session is active.',
    extraShape: {
      backend: z.enum(['chrome', 'webkit']).optional()
        .describe('Automation backend. Default: webkit on macOS, chrome elsewhere.'),
      width: z.number().optional().describe('Viewport width in pixels (default: 1280)'),
      height: z.number().optional().describe('Viewport height in pixels (default: 800)'),
      chromePath: z.string().optional().describe('Optional Chrome/Chromium executable path'),
      chromeArgv: z.array(z.string()).optional().describe('Optional extra Chrome launch args'),
      dataStoreDir: z.string().optional().describe('Optional persistent data store directory'),
    },
    // dataStoreDir is sandboxed to the workspace in buildStartOptions (both the
    // MCP and HTTP surfaces), so no MCP-only buildInput is needed.
    // formatResult receives the SERIALIZED wire body. On success JSON-stringifies the
    // webview status. On failure return parseable JSON ({ ok:false, error, webview })
    // — NOT a bare message string — so MCP clients can reliably tell a failure/timeout
    // apart from valid tool content instead of choking on non-JSON text (report #66).
    // isError still flags the tool-call failure. (The legacy tool returned a bare
    // message here; the composite + standalone now share this structured shape.)
    formatResult: (result) => {
      const body = result as { ok?: boolean; webview?: WebviewStatus; error?: string };
      if (body.ok && body.webview) return statusText(body.webview);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            ok: false,
            error: body.error ?? 'WebView start failed.',
            ...(body.webview ? { webview: body.webview } : {}),
          }, null, 2),
        }],
        isError: true,
      };
    },
  },
  handler: (input) => getWebviewRunner().start(buildStartOptions(input)),
  serialize: (output) => {
    // HTTP wire body: { ok, webview } on success; { ok:false, error } (503,
    // no webview) when the server is not running; { ok:false, error, webview }
    // otherwise — byte-identical to the legacy handler bodies.
    if (output.ok) return { ok: true, webview: output.webview };
    if (output.serverNotRunning) return { ok: false, error: output.error };
    return { ok: false, error: output.error, webview: output.webview };
  },
});

// ── webview.stop ──────────────────────────────────────────────

const stopShape = {};
const stopSchema = z.looseObject(stopShape);

const stopOperation = defineOperation<z.infer<typeof stopSchema>, { stopped: boolean; webview: WebviewStatus }>({
  name: 'webview.stop',
  mutates: false,
  input: stopSchema,
  inputShape: stopShape,
  http: {
    method: 'DELETE',
    path: '/api/workbench/webview',
  },
  mcp: {
    toolName: 'canvas_webview_stop',
    description: 'Stop the current Bun.WebView automation session if one is active.',
    // formatResult receives the SERIALIZED wire body { ok, stopped, webview }.
    formatResult: (result) => {
      const body = result as { ok: boolean; stopped: boolean; webview: WebviewStatus };
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ok: true, stopped: body.stopped, webview: body.webview }, null, 2),
        }],
      };
    },
  },
  handler: async () => {
    const runner = getWebviewRunner();
    const stopped = await runner.stop();
    return { stopped, webview: runner.status() };
  },
  serialize: (output) => ({ ok: true, stopped: output.stopped, webview: output.webview }),
});

// ── webview.resize ────────────────────────────────────────────

const resizeShape = {
  width: z.unknown().optional().describe('Viewport width in pixels'),
  height: z.unknown().optional().describe('Viewport height in pixels'),
};
const resizeSchema = z.looseObject(resizeShape);

const resizeOperation = defineOperation<z.infer<typeof resizeSchema>, WebviewStatus>({
  name: 'webview.resize',
  mutates: false,
  input: resizeSchema,
  inputShape: resizeShape,
  http: {
    method: 'POST',
    path: '/api/workbench/webview/resize',
  },
  mcp: {
    toolName: 'canvas_resize',
    description: 'Resize the active Bun.WebView automation viewport. Requires an active automation session started via canvas_webview_start.',
    extraShape: {
      width: z.number().describe('Viewport width in pixels'),
      height: z.number().describe('Viewport height in pixels'),
    },
    // formatResult receives the SERIALIZED wire body { ok, webview }; legacy
    // canvas_resize JSON-stringifies just the webview status.
    formatResult: (result) => statusText((result as { webview: WebviewStatus }).webview),
  },
  handler: async (input) => {
    const width = typeof input.width === 'number' ? input.width : NaN;
    const height = typeof input.height === 'number' ? input.height : NaN;
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      throw new OperationError('Missing required positive numeric fields: width, height.');
    }
    return runWebviewTask(() => getWebviewRunner().resize(width, height));
  },
  // HTTP wire body matches the legacy handler: { ok:true, webview }.
  serialize: (output) => ({ ok: true, webview: output }),
});

// ── webview.evaluate ──────────────────────────────────────────

const evaluateShape = {
  expression: z.unknown().optional().describe('JavaScript expression to evaluate in the page context'),
  script: z.unknown().optional().describe('Multi-statement JavaScript body. The MCP server wraps it in an async IIFE and evaluates the resolved return value.'),
};
const evaluateSchema = z.looseObject(evaluateShape);

const evaluateOperation = defineOperation<z.infer<typeof evaluateSchema>, { value: unknown }>({
  name: 'webview.evaluate',
  mutates: false,
  input: evaluateSchema,
  inputShape: evaluateShape,
  http: {
    method: 'POST',
    path: '/api/workbench/webview/evaluate',
  },
  mcp: {
    toolName: 'canvas_evaluate',
    description: 'Evaluate JavaScript in the active Bun.WebView automation session for the workbench page. Use this to inspect rendered browser state. Requires an active automation session started via canvas_webview_start.',
    extraShape: {
      expression: z.string().optional().describe('JavaScript expression to evaluate in the page context'),
      script: z.string().optional().describe('Multi-statement JavaScript body. The MCP server wraps it in an async IIFE and evaluates the resolved return value.'),
    },
    // Legacy canvas_evaluate validation: exactly one of expression/script (its
    // own message). Validate here so the MCP tool throws the legacy message
    // before dispatch; the handler re-validates with the HTTP-style message for
    // the remote path.
    buildInput: (input) => {
      const hasExpression = typeof input.expression === 'string' && input.expression.length > 0;
      const hasScript = typeof input.script === 'string' && input.script.length > 0;
      if ((hasExpression ? 1 : 0) + (hasScript ? 1 : 0) !== 1) {
        throw new OperationError('Pass exactly one of "expression" or "script".');
      }
      return input;
    },
    // Legacy canvas_evaluate JSON-stringifies { value }.
    formatResult: (result) => {
      const r = result as { value: unknown };
      return { content: [{ type: 'text' as const, text: JSON.stringify({ value: r.value }, null, 2) }] };
    },
  },
  handler: async (input) => {
    const expression = typeof input.expression === 'string' ? input.expression.trim() : '';
    const script = typeof input.script === 'string' ? input.script.trim() : '';
    if ((expression ? 1 : 0) + (script ? 1 : 0) !== 1) {
      throw new OperationError(
        'Pass exactly one of "expression" (single JS expression) or "script" (multi-statement body, wrapped in an async IIFE).',
      );
    }
    const source = script ? wrapScript(script) : expression;
    const value = await runWebviewTask(() => getWebviewRunner().evaluate(source));
    return { value };
  },
  // HTTP wire body matches the legacy handler: { ok:true, value }.
  serialize: (output) => ({ ok: true, value: output.value }),
});

export const webviewOperations: Operation[] = [
  statusOperation,
  startOperation,
  stopOperation,
  resizeOperation,
  evaluateOperation,
];
