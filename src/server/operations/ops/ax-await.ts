/**
 * Plan-007 Slice B (wave 4) operations: the three long-poll gate READS —
 *   ax.approval.get     / canvas_await_approval
 *   ax.elicitation.get  / canvas_await_elicitation
 *   ax.mode.get         / canvas_await_mode
 *
 * Report primitive D ("gates that actually gate"): each blocks until the gate
 * leaves `pending` or a timeout elapses, then returns `{ <key>, pending }`.
 * These are READS — `mutates: false` and NO `ctx.emit` (resolution events are
 * emitted by the resolve/respond ops in ax-work.ts).
 *
 * The HANDLER performs the wait via `waitForAxResolution` (executeOperation is
 * async). All three legacy `isResolved` predicates are `status !== 'pending'`
 * (HTTP handlers + SDK PmxCanvas await* agree — the elicitation `answered`/
 * `cancelled` and mode `approved`/`rejected` states all satisfy `!= pending`).
 *
 * timeoutMs normalization (one field the handler reads, sourced per surface):
 *  - HTTP: a custom `readInput` parses `?waitMs` (string→number) into `timeoutMs`.
 *    Absent / non-positive ⇒ `0` (a plain immediate read), matching the legacy
 *    `parseAxWaitMs`. waitForAxResolution clamps to [0, 120000].
 *  - MCP: `buildInput` passes `timeoutMs` through, defaulting an OMITTED value to
 *    30000 and clamping to [0, 120000] — byte-identical to the legacy await tools
 *    (`timeoutMs ?? 30000` in PmxCanvas) plus the tool schema's `.min(0).max(120000)`.
 *
 * Missing gate (read returns null): handled WITHOUT throwing. Unlike the wave-2
 * resolve/respond ops, "not found" is a normal await result, not an error — the
 * legacy MCP tools returned a SUCCESS-shaped `{ ok:false, <key>:null, pending:false }`
 * (parsed as JSON by the caller), and the legacy HTTP route returned 404. So:
 *  - The handler always returns `{ ok: value !== null, <key>: value, pending }`.
 *  - `http.status` maps `ok:false` → 404, preserving the legacy 404 STATUS (the
 *    server-api long-poll test asserts `missing.status === 404`).
 *  - MCP `formatResult` re-serializes the same body; an in-process (Local) MCP
 *    call never throws, so `{ <key>:null }` round-trips as JSON, matching legacy.
 *
 * Wire-body reconciliation (one op = one wire body; documented, same class as
 * the wave-1 `ax.get` aggregate / wave-3 delivery broadening):
 *  - HTTP missing body changes from `{ ok:false, error:'<gate> not found.' }` to
 *    `{ ok:false, <key>:null, pending:false }` (status stays 404). No test asserts
 *    the legacy error body — server-api only reads `missing.status`.
 *
 * Documented behavior change (accepted long-poll tradeoff, plan-007 sub-slice):
 *  - The legacy HTTP handler passed `req.signal` to waitForAxResolution, so a
 *    client disconnect aborted the wait early. The registry handler has no access
 *    to the HTTP Request, so the wait now runs to its (≤120s, subscription-based,
 *    cheap) timeout instead of aborting on disconnect. Resolution detection,
 *    timeout, and the `{ value, pending }` result are otherwise identical.
 *  - Remote-MCP only (daemon mode, untested for these reads): the legacy
 *    RemoteCanvasAccess.await* methods special-cased a 404 → `{ <key>:null }`. The
 *    generic HttpOperationInvoker throws on 404, so an await-on-missing over a
 *    remote transport now surfaces as an isError result rather than a null body.
 *    The in-process (Local) MCP path — the only path the await tests exercise —
 *    is unaffected.
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import { canvasState } from '../../canvas-state.js';
import type { PmxAxApprovalGate, PmxAxElicitation, PmxAxModeRequest } from '../../ax-state.js';
import { waitForAxResolution, AX_WAIT_MAX_MS } from '../../ax-wait.js';
import { defineOperation, type Operation } from '../types.js';
import { isRecord } from './nodes.js';

/** Legacy MCP/SDK default block when timeoutMs is omitted (0 = immediate read). */
const AX_AWAIT_DEFAULT_MS = 30000;

/** Coerce a raw timeout (MCP number or HTTP query string) to [0, AX_WAIT_MAX_MS]. */
function clampTimeoutMs(value: unknown): number {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(ms, AX_WAIT_MAX_MS);
}

/** HTTP `?waitMs` → `timeoutMs`; absent/non-positive ⇒ 0 (plain read). Matches parseAxWaitMs. */
function readWaitMsInput(_req: Request, params: Record<string, string>, url: URL): Record<string, unknown> {
  return { ...params, timeoutMs: clampTimeoutMs(url.searchParams.get('waitMs') ?? '') };
}

/** MCP buildInput: forward id + timeoutMs (omitted ⇒ 30000), clamped to [0, max]. */
function buildAwaitInput(input: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(typeof input.id === 'string' ? { id: input.id } : {}),
    timeoutMs: input.timeoutMs === undefined ? AX_AWAIT_DEFAULT_MS : clampTimeoutMs(input.timeoutMs),
  };
}

const awaitInputShape = {
  id: z.string().optional().catch(undefined).describe('The gate id.'),
  timeoutMs: z.unknown().optional().describe('Max ms to block (0 = immediate read; capped at 120000).'),
};

const awaitInputSchema = z.looseObject(awaitInputShape);

const awaitMcpExtraShape = {
  id: z.string(),
  timeoutMs: z
    .number()
    .int()
    .min(0)
    .max(120000)
    .optional()
    .describe('Max ms to block (default 30000; 0 = immediate read; capped at 120000).'),
};

// ── ax.approval.get (canvas_await_approval) ───────────────────

const axApprovalGetOperation = defineOperation<z.infer<typeof awaitInputSchema>, Record<string, unknown>>({
  name: 'ax.approval.get',
  mutates: false,
  input: awaitInputSchema,
  inputShape: awaitInputShape,
  http: {
    method: 'GET',
    path: '/api/canvas/ax/approval/:id',
    readInput: readWaitMsInput,
    status: (result) => (isRecord(result) && result.ok === false ? 404 : 200),
  },
  mcp: {
    toolName: 'canvas_await_approval',
    description:
      'Block until an approval gate resolves (the human approves/rejects it in the browser) or the timeout elapses — primitive D, gates that actually gate. timeoutMs 0 = read immediately without waiting. Returns { approvalGate, pending } (pending=true → still unresolved after the wait).',
    extraShape: awaitMcpExtraShape,
    buildInput: buildAwaitInput,
    formatResult: (result) => {
      const body = isRecord(result) ? result : {};
      const approvalGate = (body.approvalGate ?? null) as PmxAxApprovalGate | null;
      const pending = body.pending === true;
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ ok: approvalGate !== null, approvalGate, pending }) },
        ],
      };
    },
  },
  handler: async (input) => {
    const id = typeof input.id === 'string' ? input.id : '';
    const { value, pending } = await waitForAxResolution<PmxAxApprovalGate>({
      read: () => canvasState.getApproval(id),
      isResolved: (g) => g.status !== 'pending',
      timeoutMs: clampTimeoutMs(input.timeoutMs),
    });
    return { ok: value !== null, approvalGate: value, pending } as unknown as Record<string, unknown>;
  },
});

// ── ax.elicitation.get (canvas_await_elicitation) ─────────────

const axElicitationGetOperation = defineOperation<z.infer<typeof awaitInputSchema>, Record<string, unknown>>({
  name: 'ax.elicitation.get',
  mutates: false,
  input: awaitInputSchema,
  inputShape: awaitInputShape,
  http: {
    method: 'GET',
    path: '/api/canvas/ax/elicitation/:id',
    readInput: readWaitMsInput,
    status: (result) => (isRecord(result) && result.ok === false ? 404 : 200),
  },
  mcp: {
    toolName: 'canvas_await_elicitation',
    description:
      'Block until an elicitation is answered (the human responds in the browser) or the timeout elapses — primitive D. timeoutMs 0 = read immediately. Returns { elicitation, pending }.',
    extraShape: awaitMcpExtraShape,
    buildInput: buildAwaitInput,
    formatResult: (result) => {
      const body = isRecord(result) ? result : {};
      const elicitation = (body.elicitation ?? null) as PmxAxElicitation | null;
      const pending = body.pending === true;
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: elicitation !== null, elicitation, pending }) }],
      };
    },
  },
  handler: async (input) => {
    const id = typeof input.id === 'string' ? input.id : '';
    const { value, pending } = await waitForAxResolution<PmxAxElicitation>({
      read: () => canvasState.getElicitation(id),
      isResolved: (e) => e.status !== 'pending',
      timeoutMs: clampTimeoutMs(input.timeoutMs),
    });
    return { ok: value !== null, elicitation: value, pending } as unknown as Record<string, unknown>;
  },
});

// ── ax.mode.get (canvas_await_mode) ───────────────────────────

const axModeGetOperation = defineOperation<z.infer<typeof awaitInputSchema>, Record<string, unknown>>({
  name: 'ax.mode.get',
  mutates: false,
  input: awaitInputSchema,
  inputShape: awaitInputShape,
  http: {
    method: 'GET',
    path: '/api/canvas/ax/mode/:id',
    readInput: readWaitMsInput,
    status: (result) => (isRecord(result) && result.ok === false ? 404 : 200),
  },
  mcp: {
    toolName: 'canvas_await_mode',
    description:
      'Block until a mode request resolves (approved/rejected in the browser) or the timeout elapses — primitive D. timeoutMs 0 = read immediately. Returns { modeRequest, pending }.',
    extraShape: awaitMcpExtraShape,
    buildInput: buildAwaitInput,
    formatResult: (result) => {
      const body = isRecord(result) ? result : {};
      const modeRequest = (body.modeRequest ?? null) as PmxAxModeRequest | null;
      const pending = body.pending === true;
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: modeRequest !== null, modeRequest, pending }) }],
      };
    },
  },
  handler: async (input) => {
    const id = typeof input.id === 'string' ? input.id : '';
    const { value, pending } = await waitForAxResolution<PmxAxModeRequest>({
      read: () => canvasState.getModeRequest(id),
      isResolved: (m) => m.status !== 'pending',
      timeoutMs: clampTimeoutMs(input.timeoutMs),
    });
    return { ok: value !== null, modeRequest: value, pending } as unknown as Record<string, unknown>;
  },
});

export const axAwaitOperations: Operation[] = [axApprovalGetOperation, axElicitationGetOperation, axModeGetOperation];
