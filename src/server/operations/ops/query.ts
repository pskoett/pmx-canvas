/**
 * Slice 3 operations (plan-005, migration item 4): pin.set / search /
 * history.get / canvas.undo / canvas.redo / spatial.get / summary.get.
 *
 * Event notes (matching the legacy HTTP handlers exactly):
 * - pin.set: legacy POST /api/canvas/context-pins emitted ONLY
 *   context-pins-changed (no canvas-layout-update), so mutates: false with a
 *   manual ctx.emit. The injected emitter adds the sessionId/timestamp fields
 *   the legacy handler set explicitly. (The SDK's setContextPins emits the
 *   same context-pins-changed event — its old layout-update drift was erased
 *   in v0.3.0.)
 * - canvas.undo / canvas.redo: legacy handlers emitted canvas-viewport-update
 *   then canvas-layout-update only after an entry was actually undone/redone,
 *   so mutates: false with conditional manual emits. (The SDK's undo/redo also
 *   emit ax-state-changed; that was never part of the HTTP wire and the SDK
 *   methods are untouched.)
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import { canvasState } from '../../canvas-state.js';
import { setCanvasContextPins, syncCanvasRuntimeBackends } from '../../canvas-operations.js';
import { buildCanvasSummary } from '../../canvas-serialization.js';
import { mutationHistory } from '../../mutation-history.js';
import { buildSpatialContext, searchNodes } from '../../spatial-analysis.js';
import { defineOperation, type Operation, type OperationMcpToolHost } from '../types.js';
import { isRecord } from './nodes.js';

// ── pin.set ───────────────────────────────────────────────────

/** Legacy server.ts handleContextPinsUpdate capped the requested list at 20. */
const MAX_PINS = 20;

const pinShape = {
  nodeIds: z.unknown().optional().describe('Array of node IDs to pin'),
  mode: z
    .unknown()
    .optional()
    .describe('set: replace all pins, add: add to existing pins, remove: unpin these nodes (default: set)'),
};

const pinSchema = z.looseObject(pinShape);

const pinOperation = defineOperation<z.infer<typeof pinSchema>, Record<string, unknown>>({
  name: 'pin.set',
  mutates: false,
  input: pinSchema,
  inputShape: pinShape,
  http: {
    method: 'POST',
    path: '/api/canvas/context-pins',
  },
  mcp: {
    toolName: 'canvas_pin_nodes',
    description:
      'Pin nodes to include them in the agent context. Pinned nodes appear in the canvas://pinned-context resource. The human can also pin nodes by clicking in the browser.',
    extraShape: {
      nodeIds: z.array(z.string()).describe('Array of node IDs to pin'),
      mode: z
        .enum(['set', 'add', 'remove'])
        .optional()
        .describe('set: replace all pins, add: add to existing pins, remove: unpin these nodes (default: set)'),
    },
    // The wire body is { ok, count } (legacy HTTP shape); the tool reports the
    // resulting pin list, so re-read it from the host. (Legacy RemoteCanvasAccess
    // computed the list client-side; the server state is authoritative now.)
    formatResult: async (_result, _input, host) => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ ok: true, pinnedNodeIds: await host.getPinnedNodeIds() }),
        },
      ],
    }),
  },
  handler: (input, ctx) => {
    const body: Record<string, unknown> = input;
    const mode = body.mode === 'add' || body.mode === 'remove' ? body.mode : 'set';
    const nodeIds = Array.isArray(body.nodeIds)
      ? body.nodeIds.filter((id): id is string => typeof id === 'string')
      : [];
    // Legacy 'set' capped at MAX_PINS BEFORE setCanvasContextPins dedupes —
    // replicated as-is. add/remove (formerly client-side in the MCP access
    // layer) pass through; setCanvasContextPins normalizes them.
    const result = setCanvasContextPins(mode === 'set' ? nodeIds.slice(0, MAX_PINS) : nodeIds, mode);
    ctx.emit('context-pins-changed', { count: result.count, nodeIds: result.nodeIds });
    return { ok: true, count: result.count };
  },
});

// ── search ────────────────────────────────────────────────────

const searchShape = {
  q: z.unknown().optional().describe('Search query — matches against node titles, content, and file paths'),
  limit: z.unknown().optional().describe('Max results to return (default: all over HTTP, 10 via the MCP tool).'),
};

const searchSchema = z.looseObject(searchShape);

const searchOperation = defineOperation<z.infer<typeof searchSchema>, Record<string, unknown>>({
  name: 'search',
  mutates: false,
  input: searchSchema,
  inputShape: searchShape,
  http: {
    method: 'GET',
    path: '/api/canvas/search',
  },
  mcp: {
    toolName: 'canvas_search',
    description:
      'Search for nodes by title or content keywords. Returns matching nodes ranked by relevance with snippets. Much faster than reading the full layout when you need to find specific nodes.',
    extraShape: {
      query: z.string().describe('Search query — matches against node titles, content, and file paths'),
      limit: z.number().optional().describe('Max results to return (default: 10)'),
    },
    // Map the MCP-facing `query` arg onto the wire's `q`. The handler caps by
    // `limit` on every transport; the MCP tool additionally defaults it to 10.
    buildInput: (input) => ({
      q: typeof input.query === 'string' ? input.query : '',
      ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
    }),
    formatResult: (result, input) => {
      const body = isRecord(result) ? result : {};
      const results = Array.isArray(body.results) ? body.results : [];
      const limit = typeof input.limit === 'number' ? input.limit : 10;
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                query: input.query,
                resultCount: results.length,
                results: results.slice(0, limit),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },
  handler: (input) => {
    const q = typeof input.q === 'string' ? input.q : '';
    if (!q.trim()) {
      return { results: [], query: q };
    }
    const rawLimit = input.limit;
    const limit =
      typeof rawLimit === 'number'
        ? rawLimit
        : typeof rawLimit === 'string' && rawLimit.trim() !== ''
          ? Number(rawLimit)
          : Number.NaN;
    const results = searchNodes(canvasState.getLayout().nodes, q);
    return {
      results: Number.isFinite(limit) && limit > 0 ? results.slice(0, Math.floor(limit)) : results,
      query: q,
    };
  },
});

// ── history.get (HTTP/CLI only — canvas://history stays a resource) ──

const historyGetShape = {};

const historyGetSchema = z.looseObject(historyGetShape);

const historyGetOperation = defineOperation<z.infer<typeof historyGetSchema>, Record<string, unknown>>({
  name: 'history.get',
  mutates: false,
  input: historyGetSchema,
  inputShape: historyGetShape,
  http: {
    method: 'GET',
    path: '/api/canvas/history',
  },
  handler: () => ({
    text: mutationHistory.toHumanReadable(),
    entries: mutationHistory.getSummaries(),
    canUndo: mutationHistory.canUndo(),
    canRedo: mutationHistory.canRedo(),
  }),
});

// ── canvas.undo / canvas.redo ─────────────────────────────────

async function formatUndoRedoResult(result: unknown, host: OperationMcpToolHost) {
  // Legacy MCP tools appended canUndo/canRedo from a follow-up history read.
  const history = await host.invoker().invoke('history.get', {});
  const historyBody = isRecord(history) ? history : {};
  const body = isRecord(result) ? result : {};
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ ...body, canUndo: historyBody.canUndo, canRedo: historyBody.canRedo }),
      },
    ],
  };
}

const undoRedoShape = {};

const undoRedoSchema = z.looseObject(undoRedoShape);

const undoOperation = defineOperation<z.infer<typeof undoRedoSchema>, Record<string, unknown>>({
  name: 'canvas.undo',
  mutates: false,
  input: undoRedoSchema,
  inputShape: undoRedoShape,
  http: {
    method: 'POST',
    path: '/api/canvas/undo',
  },
  mcp: {
    toolName: 'canvas_undo',
    description:
      'Undo the last canvas mutation. Returns a description of what was undone. Use this to backtrack when an approach is wrong — explore without fear.',
    formatResult: (result, _input, host) => formatUndoRedoResult(result, host),
  },
  handler: async (_input, ctx) => {
    const entry = mutationHistory.undo();
    if (!entry) return { ok: false, description: 'Nothing to undo' };
    await syncCanvasRuntimeBackends();
    ctx.emit('canvas-viewport-update', { viewport: canvasState.viewport });
    ctx.emit('canvas-layout-update', { layout: canvasState.getLayout() });
    return { ok: true, description: `Undid: ${entry.description}` };
  },
});

const redoOperation = defineOperation<z.infer<typeof undoRedoSchema>, Record<string, unknown>>({
  name: 'canvas.redo',
  mutates: false,
  input: undoRedoSchema,
  inputShape: undoRedoShape,
  http: {
    method: 'POST',
    path: '/api/canvas/redo',
  },
  mcp: {
    toolName: 'canvas_redo',
    description: 'Redo the last undone canvas mutation. Use after undo to re-apply a change.',
    formatResult: (result, _input, host) => formatUndoRedoResult(result, host),
  },
  handler: async (_input, ctx) => {
    const entry = mutationHistory.redo();
    if (!entry) return { ok: false, description: 'Nothing to redo' };
    await syncCanvasRuntimeBackends();
    ctx.emit('canvas-viewport-update', { viewport: canvasState.viewport });
    ctx.emit('canvas-layout-update', { layout: canvasState.getLayout() });
    return { ok: true, description: `Redid: ${entry.description}` };
  },
});

// ── spatial.get (HTTP only — canvas://spatial-context stays a resource) ──

const spatialGetShape = {};

const spatialGetSchema = z.looseObject(spatialGetShape);

const spatialGetOperation = defineOperation<z.infer<typeof spatialGetSchema>, Record<string, unknown>>({
  name: 'spatial.get',
  mutates: false,
  input: spatialGetSchema,
  inputShape: spatialGetShape,
  http: {
    method: 'GET',
    path: '/api/canvas/spatial-context',
  },
  handler: () => {
    const layout = canvasState.getLayout();
    return buildSpatialContext(
      layout.nodes,
      layout.edges,
      canvasState.contextPinnedNodeIds,
      layout.annotations,
    ) as unknown as Record<string, unknown>;
  },
});

// ── summary.get (HTTP only — canvas://summary stays a resource) ──

const summaryGetShape = {};

const summaryGetSchema = z.looseObject(summaryGetShape);

const summaryGetOperation = defineOperation<z.infer<typeof summaryGetSchema>, Record<string, unknown>>({
  name: 'summary.get',
  mutates: false,
  input: summaryGetSchema,
  inputShape: summaryGetShape,
  http: {
    method: 'GET',
    path: '/api/canvas/summary',
  },
  handler: () => buildCanvasSummary() as unknown as Record<string, unknown>,
});

export const queryOperations: Operation[] = [
  pinOperation,
  searchOperation,
  historyGetOperation,
  undoOperation,
  redoOperation,
  spatialGetOperation,
  summaryGetOperation,
];
