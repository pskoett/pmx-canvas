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
import {
  compileContextBrief,
  type ContextBriefLibraryBoard,
  type ContextBriefPinnedBoard,
  type ContextBriefSourceEntry,
} from '../../context-brief.js';
import { summarizeNodeForAgentContext } from '../../../shared/agent-context.js';
import { defineOperation, OperationError, type Operation, type OperationMcpToolHost } from '../types.js';
import { buildSummaryFromLayout, isRecord } from './nodes.js';
import { readTargetBoard } from './boards.js';

// ── pin.set ───────────────────────────────────────────────────

/** Legacy server.ts handleContextPinsUpdate capped the requested list at 20. */
const MAX_PINS = 20;
export const DEFAULT_CONTEXT_BRIEF_BUDGET = 16_000;
export const MAX_CONTEXT_BRIEF_BUDGET = 100_000;

const pinShape = {
  nodeIds: z.unknown().optional().describe('Array of node IDs to pin'),
  mode: z
    .unknown()
    .optional()
    .describe('set: replace all pins, add: add to existing pins, remove: unpin these nodes (default: set)'),
  reason: z.unknown().optional().describe('Why these nodes matter; kept with newly pinned nodes and shown on hover.'),
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
      reason: z
        .string()
        .optional()
        .describe('Why these nodes matter; kept with newly pinned nodes and shown to the human on hover.'),
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
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 280) : undefined;
    const result = setCanvasContextPins(mode === 'set' ? nodeIds.slice(0, MAX_PINS) : nodeIds, mode, reason);
    ctx.emit('context-pins-changed', { count: result.count, nodeIds: result.nodeIds });
    return { ok: true, count: result.count };
  },
});

// ── search ────────────────────────────────────────────────────

const searchShape = {
  q: z.unknown().optional().describe('Search query — matches against node titles, content, and file paths'),
  scope: z.unknown().optional().describe('active (default) or library (all boards)'),
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
      scope: z.enum(['active', 'library']).optional().describe('Search the active board or the full board library'),
    },
    // Map the MCP-facing `query` arg onto the wire's `q`. The handler caps by
    // `limit` on every transport; the MCP tool additionally defaults it to 10.
    buildInput: (input) => ({
      q: typeof input.query === 'string' ? input.query : '',
      ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
      ...(input.scope === 'library' ? { scope: 'library' } : {}),
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
    const library = input.scope === 'library';
    const results = library
      ? canvasState.listBoards().flatMap((board) => {
          const read = canvasState.readBoard(board.id, true);
          if (!read) return [];
          const cards = searchNodes(read.layout.nodes, q).map((result) => ({
            ...result,
            boardId: board.id,
            boardTitle: board.name,
            cardId: result.id,
          }));
          const metadata = `${board.name} ${board.category ?? ''}`.toLocaleLowerCase();
          const readme = read.layout.nodes.find((node) => node.id === board.readmeNodeId);
          const readmeText = typeof readme?.data.content === 'string' ? readme.data.content : '';
          if (`${metadata} ${readmeText.toLocaleLowerCase()}`.includes(q.toLocaleLowerCase())) {
            cards.unshift({
              id: board.id,
              type: 'board',
              title: board.name,
              snippet: readmeText.slice(0, 160) || board.category || board.name,
              score: metadata.includes(q.toLocaleLowerCase()) ? 4 : 2,
              boardId: board.id,
              boardTitle: board.name,
              cardId: readme?.id ?? board.id,
            });
          }
          return cards;
        })
      : searchNodes(canvasState.getLayout().nodes, q).map((result) => ({
          ...result,
          boardId: canvasState.activeBoardId,
          cardId: result.id,
        }));
    results.sort((a, b) => b.score - a.score);
    return {
      results: Number.isFinite(limit) && limit > 0 ? results.slice(0, Math.floor(limit)) : results,
      query: q,
    };
  },
});

// ── context.get ───────────────────────────────────────────────

const contextShape = {
  consumer: z.unknown().optional().describe('Stable consumer id used for the durable board-scoped cursor'),
  since: z.unknown().optional().describe('Explicit content revision; bypasses the durable consumer cursor'),
  budget: z.unknown().optional().describe('Maximum response size in UTF-16 code units'),
};
const contextSchema = z.looseObject(contextShape);

const contextOperation = defineOperation<z.infer<typeof contextSchema>, Record<string, unknown>>({
  name: 'context.get',
  mutates: false,
  input: contextSchema,
  inputShape: contextShape,
  http: { method: 'GET', path: '/api/canvas/context' },
  handler: (input) => {
    const active = canvasState.getActiveBoard();
    if (!active) throw new OperationError('Open a board before requesting its context.', 409);
    const consumer =
      typeof input.consumer === 'string' && input.consumer.trim() ? input.consumer.trim().slice(0, 200) : null;
    const explicitSince = input.since !== undefined;
    const sinceValue = explicitSince
      ? Number(input.since)
      : consumer
        ? canvasState.getContextBriefCursor(active.id, consumer)
        : null;
    const budgetValue = input.budget === undefined ? DEFAULT_CONTEXT_BRIEF_BUDGET : Number(input.budget);
    const budget = Number.isFinite(budgetValue)
      ? Math.min(MAX_CONTEXT_BRIEF_BUDGET, Math.max(0, Math.floor(budgetValue)))
      : DEFAULT_CONTEXT_BRIEF_BUDGET;

    // Capture the active target and revision synchronously. Library boards are
    // read from SQLite and are never opened or made writable by this operation.
    const layout = canvasState.getLayout();
    const revision = canvasState.getContentRevision();
    const pinnedNodeIds = [...canvasState.contextPinnedNodeIds];
    const linkedIds = new Map<string, string[]>();
    for (const node of layout.nodes) {
      if (node.type !== 'board' || typeof node.data.boardId !== 'string') continue;
      const ids = linkedIds.get(node.data.boardId) ?? [];
      ids.push(node.id);
      linkedIds.set(node.data.boardId, ids);
    }
    const libraryBoards: ContextBriefLibraryBoard[] = [];
    for (const board of canvasState.listBoards()) {
      if (board.id === active.id) continue;
      if (!linkedIds.has(board.id) && (!active.category || active.category !== board.category)) continue;
      const read = canvasState.readBoard(board.id, true);
      if (!read) continue;
      const readme = read.layout.nodes.find((node) => node.id === board.readmeNodeId);
      const pins = new Set(read.state.contextPins);
      libraryBoards.push({
        boardId: board.id,
        name: board.name,
        category: board.category,
        ...(readme
          ? {
              readme: {
                nodeId: readme.id,
                title: typeof readme.data.title === 'string' ? readme.data.title : readme.id,
                summary: summarizeNodeForAgentContext(readme, { defaultTextLength: 1_000, webpageTextLength: 1_000 }),
              },
            }
          : {}),
        pinnedTitles: read.layout.nodes
          .filter((node) => pins.has(node.id))
          .map((node) => ({
            nodeId: node.id,
            title: typeof node.data.title === 'string' ? node.data.title : node.id,
          })),
        linkIds: linkedIds.get(board.id) ?? [],
      });
    }
    // The working set (vision move 0a): every pinned board's README and pinned
    // cards in full, read from SQLite without opening the board.
    const title = (node: { id: string; data: Record<string, unknown> }) =>
      typeof node.data.title === 'string' && node.data.title ? node.data.title : node.id;
    const pinnedBoards: ContextBriefPinnedBoard[] = [];
    for (const board of canvasState.listBoards()) {
      if (!board.pin || board.id === active.id) continue;
      const read = canvasState.readBoard(board.id, true);
      if (!read) continue;
      const readme = read.layout.nodes.find((node) => node.id === board.readmeNodeId);
      const pins = new Set(read.state.contextPins);
      pinnedBoards.push({
        boardId: board.id,
        name: board.name,
        ...(readme
          ? {
              readme: {
                nodeId: readme.id,
                title: title(readme),
                text: summarizeNodeForAgentContext(readme, { defaultTextLength: budget, webpageTextLength: budget }),
                summary: summarizeNodeForAgentContext(readme, { defaultTextLength: 1_000, webpageTextLength: 1_000 }),
              },
            }
          : {}),
        cards: read.layout.nodes
          .filter((node) => pins.has(node.id) && node.id !== readme?.id)
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((node) => ({
            nodeId: node.id,
            title: title(node),
            text: summarizeNodeForAgentContext(node, { defaultTextLength: budget, webpageTextLength: budget }),
          })),
      });
    }
    const entries: ContextBriefSourceEntry[] = layout.nodes
      .filter((node) => node.createdBy?.actor === 'human')
      .map((node) => ({
        sourceBoardId: active.id,
        nodeId: node.id,
        reason: 'human' as const,
        title: typeof node.data.title === 'string' ? node.data.title : node.id,
        text: summarizeNodeForAgentContext(node, { defaultTextLength: budget, webpageTextLength: budget }),
      }));
    entries.push(
      ...canvasState
        .getApprovalGates()
        .filter((item) => item.status === 'pending')
        .map((item) => ({
          sourceBoardId: active.id,
          nodeId: `approval:${item.id}`,
          reason: 'ask' as const,
          title: item.title,
          text: item.detail || item.action || 'Approval requested.',
        })),
      ...canvasState
        .getModeRequests()
        .filter((item) => item.status === 'pending')
        .map((item) => ({
          sourceBoardId: active.id,
          nodeId: `mode:${item.id}`,
          reason: 'ask' as const,
          title: `Mode request: ${item.mode}`,
          text: item.reason || 'Mode change requested.',
        })),
      ...canvasState
        .getElicitations()
        .filter((item) => item.status === 'pending')
        .map((item) => ({
          sourceBoardId: active.id,
          nodeId: `elicitation:${item.id}`,
          reason: 'ask' as const,
          title: 'Open question',
          text: item.prompt,
        })),
    );
    entries.push(
      ...canvasState.getPendingSteering({ consumer: consumer ?? undefined, limit: 50 }).map((item) => ({
        sourceBoardId: active.id,
        nodeId: `steering:${item.id}`,
        reason: 'steer' as const,
        title: 'Human steering',
        text: item.message,
      })),
    );
    const result = compileContextBrief({
      activeBoard: { boardId: active.id, name: active.name, category: active.category },
      nodes: layout.nodes,
      pinnedNodeIds,
      contentRevision: revision.revision,
      retentionFloor: revision.retentionFloor,
      tombstones: canvasState.readContentDelta(sinceValue ?? 0).deleted,
      since: explicitSince ? (Number.isSafeInteger(sinceValue) ? sinceValue : Number.NaN) : sinceValue,
      libraryBoards,
      pinnedBoards,
      entries,
      budget,
    });
    if (consumer && !explicitSince && result.document && result.nextCursor !== null && !result.invalidCursor) {
      canvasState.advanceContextBriefCursor(active.id, consumer, result.nextCursor);
    }
    return (result.document ?? {
      version: 1,
      budgetUnit: 'utf16-code-units',
      error: 'Budget is too small for the context envelope.',
    }) as unknown as Record<string, unknown>;
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
    top: mutationHistory.top(),
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

const spatialGetShape = { board: z.unknown().optional().describe('Board id to read without opening it.') };

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
  handler: ({ board }) => {
    const target = readTargetBoard(board);
    const layout = target.layout;
    return buildSpatialContext(
      layout.nodes,
      layout.edges,
      target.pinnedNodeIds,
      layout.annotations,
    ) as unknown as Record<string, unknown>;
  },
});

// ── summary.get (HTTP only — canvas://summary stays a resource) ──

const summaryGetShape = { board: z.unknown().optional().describe('Board id to read without opening it.') };

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
  handler: ({ board }) => {
    if (typeof board !== 'string' || !board.trim()) return buildCanvasSummary() as unknown as Record<string, unknown>;
    const target = readTargetBoard(board);
    return buildSummaryFromLayout(target.layout, [...target.pinnedNodeIds]);
  },
});

export const queryOperations: Operation[] = [
  pinOperation,
  searchOperation,
  contextOperation,
  historyGetOperation,
  undoOperation,
  redoOperation,
  spatialGetOperation,
  summaryGetOperation,
];
