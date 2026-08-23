/**
 * Operation invokers: both return the canonical wire-shaped result (the same
 * JSON body the HTTP route serves), so MCP/CLI callers format one shape
 * regardless of transport. Failures throw `OperationError`.
 */
import { SOURCE_LABEL_RE } from '../agent-presence.js';
import { executeOperation, getOperation } from './registry.js';
import { OperationError, type OperationErrorStatus } from './types.js';

export interface OperationInvoker {
  invoke(name: string, input: Record<string, unknown>): Promise<unknown>;
}

/**
 * The agent-presence label for a transport: `PMX_CANVAS_AGENT_SOURCE` lets a
 * host name its agent ('codex', 'claude-code', …) so writes, attach and cursor
 * all key on one identity; otherwise the transport's own label.
 */
export function agentSourceLabel(fallback: string): string {
  const raw = process.env.PMX_CANVAS_AGENT_SOURCE?.trim();
  return raw && SOURCE_LABEL_RE.test(raw) ? raw : fallback;
}

/** `ax.presence.set` without an explicit source attaches under the caller's own label. */
function defaultPresenceSource(name: string, input: Record<string, unknown>, source: string): Record<string, unknown> {
  return name === 'ax.presence.set' && typeof input.source !== 'string' ? { ...input, source } : input;
}

/** Runs operations in-process against the shared canvasState singleton. */
export class LocalOperationInvoker implements OperationInvoker {
  private readonly source: string;

  /** `source` labels this caller's agent presence ('mcp', 'sdk', …). */
  constructor(source = 'api') {
    this.source = agentSourceLabel(source);
  }

  async invoke(name: string, input: Record<string, unknown>): Promise<unknown> {
    return await executeOperation(name, defaultPresenceSource(name, input, this.source), { source: this.source });
  }
}

function toOperationErrorStatus(status: number): OperationErrorStatus {
  return status === 404 ? 404 : status === 409 ? 409 : status === 403 ? 403 : 400;
}

/** Builds the HTTP request from the op's route template (`:id` from input, GET flags to query). */
export class HttpOperationInvoker implements OperationInvoker {
  private readonly baseUrl: string;
  private readonly source: string;

  /** `source` labels this caller's agent presence on the server ('cli', 'mcp', …). */
  constructor(baseUrl: string, source = 'api') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.source = agentSourceLabel(source);
  }

  async invoke(name: string, rawInput: Record<string, unknown>): Promise<unknown> {
    const input = defaultPresenceSource(name, rawInput, this.source);
    const op = getOperation(name);
    const route = op.http;
    if (!route) throw new OperationError(`Operation "${name}" has no HTTP route.`, 400);

    const consumed = new Set<string>();
    const path = route.path
      .split('/')
      .map((segment) => {
        if (!segment.startsWith(':')) return segment;
        const key = segment.slice(1);
        consumed.add(key);
        const value = input[key];
        return encodeURIComponent(value === undefined || value === null ? '' : String(value));
      })
      .join('/');

    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (!consumed.has(key) && value !== undefined) rest[key] = value;
    }

    let url = `${this.baseUrl}${path}`;
    const init: RequestInit = { method: route.method, headers: { 'x-pmx-source': this.source } };
    if (route.method === 'GET' || route.method === 'DELETE') {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(rest)) {
        params.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
      const query = params.toString();
      if (query) url += `?${query}`;
    } else {
      init.headers = { 'Content-Type': 'application/json', 'x-pmx-source': this.source };
      init.body = JSON.stringify(rest);
    }

    const response = await fetch(url, init);
    const text = await response.text();
    let parsed: unknown = null;
    let parsedAsJson = false;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text) as unknown;
        parsedAsJson = true;
      } catch {
        parsed = { error: text };
      }
    }
    if (!response.ok) {
      // errorBodyAsResult carries the route's STRUCTURED partial-failure
      // envelope (e.g. canvas_batch { ok:false, failedIndex, ... }) through as
      // a result. A non-JSON error body (an HTML 502 from a proxy, a foreign
      // service) is not that envelope — fall through to the throw path so the
      // caller still fails loudly with a nonzero exit.
      if (route.errorBodyAsResult && parsedAsJson) return parsed;
      const message =
        parsedAsJson && parsed !== null && typeof parsed === 'object' && 'error' in parsed
          ? String((parsed as { error?: unknown }).error)
          : `HTTP ${response.status}${text.length > 0 ? `: ${text.slice(0, 200)}` : ''}`;
      throw new OperationError(message, toOperationErrorStatus(response.status));
    }
    return parsed;
  }
}
