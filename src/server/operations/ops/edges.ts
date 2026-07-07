/**
 * Slice 2 operations (plan-005): edge.add / edge.remove.
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import type { CanvasEdge } from '../../canvas-state.js';
import { addCanvasEdge, removeCanvasEdge } from '../../canvas-operations.js';
import { readJsonValue } from '../http.js';
import { defineOperation, OperationError, type Operation } from '../types.js';
import { isRecord } from './nodes.js';

const VALID_EDGE_TYPES = new Set(['relation', 'depends-on', 'flow', 'references']);
const VALID_EDGE_STYLES = new Set(['solid', 'dashed', 'dotted']);

// ── edge.add ──────────────────────────────────────────────────

const edgeAddShape = {
  intentId: z
    .string()
    .optional()
    .catch(undefined)
    .describe('Ghost intent id returned by canvas_intent signal. A vetoed or expired intent blocks this mutation.'),
  from: z.string().optional().catch(undefined).describe('Source node ID'),
  to: z.string().optional().catch(undefined).describe('Target node ID'),
  fromSearch: z
    .string()
    .optional()
    .catch(undefined)
    .describe('Resolve the source node by exact or fuzzy title/content search'),
  toSearch: z
    .string()
    .optional()
    .catch(undefined)
    .describe('Resolve the target node by exact or fuzzy title/content search'),
  type: z.unknown().optional().describe('Edge type: flow, depends-on, relation, or references'),
  label: z.unknown().optional().describe('Edge label text'),
  style: z.unknown().optional().describe('Optional edge stroke style: solid, dashed, or dotted'),
  animated: z.unknown().optional().describe('Animate the edge stroke'),
};

const edgeAddSchema = z.looseObject(edgeAddShape);

const edgeAddOperation = defineOperation<z.infer<typeof edgeAddSchema>, CanvasEdge>({
  name: 'edge.add',
  mutates: true,
  input: edgeAddSchema,
  inputShape: edgeAddShape,
  http: {
    method: 'POST',
    path: '/api/canvas/edge',
  },
  mcp: {
    toolName: 'canvas_add_edge',
    description:
      'Add an edge (connection) between two nodes. Edge types: flow (sequential), depends-on (dependency), relation (general), references (cross-reference).',
    extraShape: {
      type: z.enum(['flow', 'depends-on', 'relation', 'references']).describe('Edge type'),
      label: z.string().optional().describe('Edge label text'),
      style: z.enum(['solid', 'dashed', 'dotted']).optional().describe('Optional edge stroke style'),
      animated: z.boolean().optional().describe('Animate the edge stroke'),
    },
    buildInput: (input) => {
      if (!input.from && !input.fromSearch) {
        throw new OperationError('Provide either "from" or "fromSearch".');
      }
      if (!input.to && !input.toSearch) {
        throw new OperationError('Provide either "to" or "toSearch".');
      }
      return input;
    },
    formatResult: (result) => {
      const body = isRecord(result) ? result : {};
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                id: body.id,
                from: body.from,
                to: body.to,
                type: body.type,
                label: body.label,
                style: body.style,
                animated: body.animated,
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
    const body: Record<string, unknown> = input;
    const rawType = body.type;
    const style = typeof body.style === 'string' ? body.style : undefined;
    if (!rawType || (!body.from && !body.fromSearch) || (!body.to && !body.toSearch)) {
      throw new OperationError('Missing required fields: type plus from/fromSearch and to/toSearch.');
    }
    if (typeof rawType !== 'string' || !VALID_EDGE_TYPES.has(rawType)) {
      throw new OperationError(`Invalid edge type: "${String(rawType)}".`);
    }
    if (style && !VALID_EDGE_STYLES.has(style)) {
      throw new OperationError(`Invalid edge style: "${style}". Use solid, dashed, or dotted.`);
    }
    try {
      return addCanvasEdge({
        ...(typeof body.from === 'string' ? { from: body.from } : {}),
        ...(typeof body.to === 'string' ? { to: body.to } : {}),
        ...(typeof body.fromSearch === 'string' ? { fromSearch: body.fromSearch } : {}),
        ...(typeof body.toSearch === 'string' ? { toSearch: body.toSearch } : {}),
        type: rawType as CanvasEdge['type'],
        ...(body.label ? { label: String(body.label) } : {}),
        ...(style ? { style: style as CanvasEdge['style'] } : {}),
        ...(body.animated !== undefined ? { animated: Boolean(body.animated) } : {}),
      });
    } catch (error) {
      throw new OperationError(error instanceof Error ? error.message : 'Duplicate or self-edge.');
    }
  },
  serialize: (edge) => ({ ok: true, ...edge }),
});

// ── edge.remove ───────────────────────────────────────────────

const edgeRemoveShape = {
  id: z.string().optional().catch(undefined).describe('Edge ID to remove'),
  edge_id: z.string().optional().catch(undefined).describe('Alias for id (legacy HTTP body field)'),
};

const edgeRemoveSchema = z.looseObject(edgeRemoveShape);

const edgeRemoveOperation = defineOperation<z.infer<typeof edgeRemoveSchema>, Record<string, unknown>>({
  name: 'edge.remove',
  mutates: true,
  input: edgeRemoveSchema,
  inputShape: edgeRemoveShape,
  http: {
    method: 'DELETE',
    path: '/api/canvas/edge',
    // Legacy clients send `{ edge_id }` in the DELETE body (RemoteCanvasAccess
    // did); the invoker sends it as a query param — accept both.
    readInput: async (req, params, url) => {
      const query: Record<string, string> = {};
      url.searchParams.forEach((value, key) => {
        query[key] = value;
      });
      const body = await readJsonValue(req);
      const record = isRecord(body) ? body : {};
      return { ...query, ...record, ...params };
    },
  },
  mcp: {
    toolName: 'canvas_remove_edge',
    description: 'Remove an edge from the canvas.',
    extraShape: {
      id: z.string().describe('Edge ID to remove'),
    },
    formatResult: (result) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    }),
  },
  handler: ({ edge_id, id }) => {
    const edgeId = edge_id ?? id ?? '';
    if (!edgeId) {
      throw new OperationError('Missing edge_id.');
    }
    const { removed } = removeCanvasEdge(edgeId);
    if (!removed) {
      throw new OperationError(`Edge "${edgeId}" not found.`, 404);
    }
    return { ok: true, removed: edgeId };
  },
});

export const edgeOperations: Operation[] = [edgeAddOperation, edgeRemoveOperation];
