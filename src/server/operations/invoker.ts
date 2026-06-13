/**
 * Operation invokers: both return the canonical wire-shaped result (the same
 * JSON body the HTTP route serves), so MCP/CLI callers format one shape
 * regardless of transport. Failures throw `OperationError`.
 */
import { executeOperation, getOperation } from './registry.js';
import { OperationError, type OperationErrorStatus } from './types.js';

export interface OperationInvoker {
  invoke(name: string, input: Record<string, unknown>): Promise<unknown>;
}

/** Runs operations in-process against the shared canvasState singleton. */
export class LocalOperationInvoker implements OperationInvoker {
  async invoke(name: string, input: Record<string, unknown>): Promise<unknown> {
    return await executeOperation(name, input);
  }
}

function toOperationErrorStatus(status: number): OperationErrorStatus {
  return status === 404 ? 404 : status === 409 ? 409 : 400;
}

/** Builds the HTTP request from the op's route template (`:id` from input, GET flags to query). */
export class HttpOperationInvoker implements OperationInvoker {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async invoke(name: string, input: Record<string, unknown>): Promise<unknown> {
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
    const init: RequestInit = { method: route.method };
    if (route.method === 'GET' || route.method === 'DELETE') {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(rest)) {
        params.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
      const query = params.toString();
      if (query) url += `?${query}`;
    } else {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(rest);
    }

    const response = await fetch(url, init);
    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = { error: text };
      }
    }
    if (!response.ok) {
      const message = parsed !== null && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as { error?: unknown }).error)
        : `HTTP ${response.status}`;
      throw new OperationError(message, toOperationErrorStatus(response.status));
    }
    return parsed;
  }
}
