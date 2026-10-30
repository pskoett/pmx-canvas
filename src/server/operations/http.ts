/**
 * HTTP dispatch for registered operations.
 *
 * Route matching is segment-count exact, so `/node/:id` never swallows
 * `/node/:id/refresh`. server.ts calls `dispatchOperationRoute` immediately
 * before its legacy `/api/canvas/*` checks; a `null` return falls through to
 * the remaining legacy routes.
 */
import { executeOperation, listOperations } from './registry.js';
import { SOURCE_LABEL_RE } from '../agent-presence.js';
import { OperationError, type OperationExecutionOptions, type OperationProgress } from './types.js';
import { isWorkbenchToken, refuseStaleWorkbenchWrite } from '../workbench-auth.js';

function responseJson(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

/** Opt-in NDJSON; the terminal frame retains the ordinary HTTP status/body. */
export type OperationStreamFrame =
  | { type: 'progress'; progress: OperationProgress }
  | { type: 'result'; status: number; body: unknown };

function operationFailure(name: string, error: unknown, signal: AbortSignal): Response {
  if (signal.aborted) return responseJson({ ok: false, cancelled: true, error: 'Operation cancelled.' }, 499);
  if (error instanceof OperationError) {
    return responseJson({ ok: false, error: error.message, ...(error.details ?? {}) }, error.status);
  }
  // Keep unexpected errors server-side, never leak a Bun development overlay.
  console.error(`[operation] unhandled error dispatching ${name}:`, error);
  return responseJson({ ok: false, error: 'Internal error processing the request.' }, 500);
}

function progressResponse(
  req: Request,
  name: string,
  run: (options: OperationExecutionOptions) => Promise<Response>,
): Response {
  const cancelled = new AbortController();
  const signal = AbortSignal.any([req.signal, cancelled.signal]);
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (frame: OperationStreamFrame): void => {
        if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
      };
      let response: Response;
      try {
        response = await run({ signal, onProgress: (progress) => send({ type: 'progress', progress }) });
      } catch (error) {
        response = operationFailure(name, error, signal);
      }
      if (!closed) {
        send({ type: 'result', status: response.status, body: await response.json() });
        closed = true;
        controller.close();
      }
    },
    cancel() {
      closed = true;
      cancelled.abort();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  });
}

export function matchOperationPath(template: string, pathname: string): Record<string, string> | null {
  const templateSegments = template.split('/');
  const pathSegments = pathname.split('/');
  if (templateSegments.length !== pathSegments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < templateSegments.length; index++) {
    const expected = templateSegments[index]!;
    const actual = pathSegments[index]!;
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

/**
 * Shared body reader: preserves the parsed JSON value as-is (object, array,
 * or primitive) — per-op `readInput` decides what to do with non-object
 * bodies; the shared reader never coerces. A non-empty body that fails to
 * parse is a 400 (OperationError), never a silent empty input.
 */
export async function readJsonValue(req: Request): Promise<unknown> {
  let text = '';
  try {
    text = await req.text();
  } catch {
    return undefined;
  }
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new OperationError('Malformed JSON body.');
  }
}

export async function readOperationInput(
  req: Request,
  params: Record<string, string>,
  url: URL,
): Promise<Record<string, unknown>> {
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  if (req.method === 'GET' || req.method === 'DELETE') {
    return { ...query, ...params };
  }
  const body = await readJsonValue(req);
  const record =
    body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  return { ...query, ...record, ...params };
}

export async function dispatchOperationRoute(req: Request, url: URL): Promise<Response | null> {
  for (const op of listOperations()) {
    const route = op.http;
    if (!route || route.method !== req.method) continue;
    const params = matchOperationPath(route.path, url.pathname);
    if (!params) continue;
    try {
      req.signal.throwIfAborted();
      const input = route.readInput
        ? await route.readInput(req, params, url)
        : await readOperationInput(req, params, url);
      // The workbench marks its own HTTP calls: a human dragging/editing in
      // the browser is not agent activity, so it never synthesizes an
      // auto-ghost. Everything else (CLI, scripts, adapters) counts as agent.
      const workbenchMarked = req.headers.get('x-pmx-workbench') === '1';
      const token = req.headers.get('x-pmx-workbench-token');
      const humanAuthor = isWorkbenchToken(token);
      // Before reconnect delivers the rotated capability, do not silently
      // downgrade an old tab's human save to an agent edit.
      const staleWrite = refuseStaleWorkbenchWrite(req);
      if (staleWrite) return staleWrite;
      // Presence writer label: adapters/CLI may identify themselves; plain
      // HTTP callers read as 'api'.
      const sourceHeader = req.headers.get('x-pmx-source');
      const source = sourceHeader && SOURCE_LABEL_RE.test(sourceHeader) ? sourceHeader : 'api';
      const run = async (options: OperationExecutionOptions): Promise<Response> => {
        const result = await executeOperation(op.name, input, {
          ...options,
          // The legacy marker remains a UI-policy signal (ghost suppression).
          // Only the unguessable boot token classifies authorship as human.
          suppressAutoGhost: workbenchMarked,
          fromWorkbench: workbenchMarked,
          humanAuthor,
          source,
          proxiedRead: req.headers.get('x-pmx-proxied-read') === '1',
        });
        return responseJson(result, route.status ? route.status(result) : 200);
      };
      if (req.headers.get('accept') === 'application/x-ndjson') return progressResponse(req, op.name, run);
      return await run({ signal: req.signal });
    } catch (error) {
      return operationFailure(op.name, error, req.signal);
    }
  }
  return null;
}
