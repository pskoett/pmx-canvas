/**
 * Operation registry core types (plan-005).
 *
 * One `Operation` describes a canvas operation once: input schema, the single
 * handler implementation, and how the operation surfaces over HTTP and MCP.
 * `defineOperation` wraps the typed pieces into a transport-agnostic record.
 *
 * Modules in `operations/` must never import `../server.ts` or `../index.ts`
 * (the SSE emitter is injected via `setOperationEventEmitter`; the SDK imports
 * the operation cores directly).
 */
import type { ZodRawShape } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type OperationErrorStatus = 400 | 404 | 409;

/** Operation failure that maps to an HTTP status + `{ ok:false, error }` body and MCP `isError`. */
export class OperationError extends Error {
  readonly status: OperationErrorStatus;
  /** Extra fields merged into the HTTP `{ ok:false, error }` body (e.g. the legacy
   *  webview-failure `webview` status snapshot). Omit for the plain envelope. */
  readonly details?: Record<string, unknown>;

  constructor(message: string, status: OperationErrorStatus = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = 'OperationError';
    this.status = status;
    if (details) this.details = details;
  }
}

export interface OperationContext {
  /** Emit a workbench SSE event (e.g. extra `canvas-layout-update` frames, focus, viewport). */
  emit(event: string, payload?: Record<string, unknown>): void;
}

export interface OperationHttpRoute {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** EXACT legacy path; `:param` segments capture path parameters. */
  path: string;
  /**
   * Per-op input reader. The default merges query params, a JSON object body
   * (arrays/primitives are preserved by the shared reader — a per-op reader
   * decides how to use them), and path params (params win).
   */
  readInput?: (
    req: Request,
    params: Record<string, string>,
    url: URL,
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** HTTP status for a successful result. Defaults to 200. */
  status?: (result: unknown) => number;
  /**
   * Return parsed non-2xx JSON bodies to operation callers instead of throwing.
   * Use only for operations whose MCP contract formats structured failure bodies
   * itself (for example canvas.batch partial failures).
   */
  errorBodyAsResult?: boolean;
}

/** Host capabilities available to MCP result formatters. */
export interface OperationMcpToolHost {
  getPinnedNodeIds(): Promise<string[]>;
  /**
   * Invoke another registered operation over the host's transport (local or
   * HTTP) — structural subset of OperationInvoker to avoid an import cycle.
   * Used by formatters that need a follow-up read (undo/redo history flags,
   * restore summary).
   */
  invoker(): { invoke(name: string, input: Record<string, unknown>): Promise<unknown> };
}

export interface OperationMcpTool {
  /** Frozen legacy tool name (see tests/unit/mcp-tool-freeze.test.ts). */
  toolName: string;
  description: string;
  /**
   * MCP-only presentation flags and typed overrides merged over the operation
   * input shape when advertising the tool schema (e.g. `full` / `verbose`).
   */
  extraShape?: ZodRawShape;
  /** Map raw MCP args onto operation input. May throw OperationError. */
  buildInput?: (input: Record<string, unknown>) => Record<string, unknown>;
  /** Format the wire-shaped operation result into a tool result. */
  formatResult?: (
    result: unknown,
    input: Record<string, unknown>,
    host: OperationMcpToolHost,
  ) => Promise<CallToolResult> | CallToolResult;
}

/** Registered, transport-agnostic operation record. */
export interface Operation {
  name: string;
  /** true → the registry emits one `canvas-layout-update` after success. */
  mutates: boolean;
  /** Raw zod shape (for MCP tool schemas). */
  inputShape: ZodRawShape;
  http: OperationHttpRoute | null;
  mcp: OperationMcpTool | null;
  /** Validate raw input, run the handler, serialize to the canonical wire shape. */
  execute(rawInput: unknown, ctx: OperationContext): Promise<unknown>;
}

/**
 * Structural view of a zod schema (avoids fighting zod's generic variance).
 * Any `z.looseObject(...)` satisfies this.
 */
export interface OperationInputSchema<I> {
  safeParse(value: unknown):
    | { success: true; data: I }
    | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
}

export interface OperationDefinition<I extends Record<string, unknown>, O> {
  name: string;
  mutates: boolean;
  /** MUST be loose (z.looseObject / .passthrough()) — legacy ignores unknown keys. */
  input: OperationInputSchema<I>;
  inputShape: ZodRawShape;
  http?: OperationHttpRoute;
  mcp?: OperationMcpTool;
  /** The single implementation. Mutate via canvasState/canvas-operations so history records. */
  handler: (input: I, ctx: OperationContext) => O | Promise<O>;
  /** Map handler output to the HTTP wire body. Defaults to identity. */
  serialize?: (output: O) => unknown;
}

export function defineOperation<I extends Record<string, unknown>, O>(
  def: OperationDefinition<I, O>,
): Operation {
  return {
    name: def.name,
    mutates: def.mutates,
    inputShape: def.inputShape,
    http: def.http ?? null,
    mcp: def.mcp ?? null,
    async execute(rawInput: unknown, ctx: OperationContext): Promise<unknown> {
      const parsed = def.input.safeParse(rawInput ?? {});
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((issue) => (issue.path.length > 0 ? `${issue.path.map(String).join('.')}: ${issue.message}` : issue.message))
          .join('; ');
        throw new OperationError(`Invalid input for ${def.name}: ${detail}`, 400);
      }
      const output = await def.handler(parsed.data, ctx);
      return def.serialize ? def.serialize(output) : output;
    },
  };
}
