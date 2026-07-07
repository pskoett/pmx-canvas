/**
 * HTTP dispatch for registered operations.
 *
 * Route matching is segment-count exact, so `/node/:id` never swallows
 * `/node/:id/refresh`. server.ts calls `dispatchOperationRoute` immediately
 * before its legacy `/api/canvas/*` checks; a `null` return falls through to
 * the remaining legacy routes.
 */
import { executeOperation, listOperations } from './registry.js';
import { OperationError } from './types.js';

function responseJson(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

function matchPath(template: string, pathname: string): Record<string, string> | null {
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

async function defaultReadInput(
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
  const record = body !== null && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  return { ...query, ...record, ...params };
}

export async function dispatchOperationRoute(req: Request, url: URL): Promise<Response | null> {
  for (const op of listOperations()) {
    const route = op.http;
    if (!route || route.method !== req.method) continue;
    const params = matchPath(route.path, url.pathname);
    if (!params) continue;
    try {
      const input = route.readInput
        ? await route.readInput(req, params, url)
        : await defaultReadInput(req, params, url);
      const result = await executeOperation(op.name, input);
      return responseJson(result, route.status ? route.status(result) : 200);
    } catch (error) {
      if (error instanceof OperationError) {
        return responseJson({ ok: false, error: error.message, ...(error.details ?? {}) }, error.status);
      }
      // An unexpected (non-OperationError) throw from a handler MUST NOT escape the
      // dispatcher: Bun.serve has no per-request boundary, so an escaped throw renders
      // its dev error overlay (HTTP 500 text/html leaking the absolute server source
      // path + stack). Return a clean JSON 500 with a generic message instead (the
      // real error is logged server-side, never echoed to the client).
      console.error(`[operation] unhandled error dispatching ${op.name}:`, error);
      return responseJson({ ok: false, error: 'Internal error processing the request.' }, 500);
    }
  }
  return null;
}
