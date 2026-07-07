/**
 * Ghost Cursor of Intent operations: signal / update / clear a pre-commit
 * intent. Surfaced over HTTP (POST/PATCH/DELETE /api/canvas/ax/intent) and,
 * folded into the `canvas_intent` composite, over MCP.
 *
 * Intents are ephemeral presence — every op is `mutates: false` (NO
 * `canvas-layout-update`; the ghost lives on its own `ax-intent` /
 * `ax-intent-clear` channel, emitted by the IntentRegistry). These ops have no
 * standalone `mcp` block on purpose: the composite reuses `op.inputShape` for
 * advertising and dispatches by op name, so the only new MCP tool is the
 * composite itself.
 *
 * The IntentRegistry is the single trust boundary (zod + per-kind validation);
 * these handlers stay thin. This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import { INTENT_EDGE_TYPES, INTENT_KINDS } from '../../../shared/ax-intent.js';
import { intentRegistry } from '../../intent-registry.js';
import { readJsonValue } from '../http.js';
import { defineOperation, OperationError, type Operation } from '../types.js';

const positionShape = z.object({ x: z.number(), y: z.number() });

// ── intent.signal (canvas_intent action "signal") ─────────────

const intentSignalShape = {
  kind: z
    .enum(INTENT_KINDS)
    .optional()
    .describe('create | move | connect | remove | edit — the move about to be made.'),
  position: positionShape.optional().describe('World coords: where a create forms, or the destination of a move.'),
  nodeId: z.string().optional().describe('The existing node a move/edit/remove targets.'),
  edge: z
    .object({ from: z.string(), to: z.string(), type: z.enum(INTENT_EDGE_TYPES) })
    .optional()
    .describe('connect: the edge about to be drawn (from/to node ids + type).'),
  nodeType: z.string().optional().describe('Node type the ghost renders (icon + type badge).'),
  label: z.string().optional().describe('Short action label shown on the ghost chip ("Add evidence").'),
  reason: z.string().optional().describe('Why — shown beneath the ghost. The legibility payoff.'),
  confidence: z.number().optional().describe('0..1 → ghost opacity/solidity.'),
  seq: z.number().optional().describe('Ordering hint for staged-batch ghosts (numbered previsualization).'),
  ttlMs: z.number().optional().describe('Auto-expire after this many ms (default 8000, max 60000).'),
  id: z.string().optional().describe('Stable id to update/clear/veto later; auto-generated if omitted.'),
  source: z.string().optional().describe('Optional source label of the signalling surface.'),
};

const intentSignalSchema = z.looseObject(intentSignalShape);

const intentSignalOperation = defineOperation<z.infer<typeof intentSignalSchema>, Record<string, unknown>>({
  name: 'intent.signal',
  mutates: false,
  input: intentSignalSchema,
  inputShape: intentSignalShape,
  http: { method: 'POST', path: '/api/canvas/ax/intent' },
  handler: (input) => {
    const intent = intentRegistry.signal(input);
    return { ok: true, intent } as unknown as Record<string, unknown>;
  },
});

// ── intent.update (canvas_intent action "update") ─────────────

const intentUpdateShape = {
  id: z.string().optional().describe('The intent id to update.'),
  position: positionShape.optional().describe('New world coords for the ghost.'),
  nodeType: z.string().optional().describe('New node type for the ghost.'),
  label: z.string().optional().describe('New ghost chip label.'),
  reason: z.string().optional().describe('New rationale shown beneath the ghost.'),
  confidence: z.number().optional().describe('0..1 → ghost opacity/solidity.'),
  seq: z.number().optional().describe('New ordering hint.'),
  ttlMs: z.number().optional().describe('Reset the TTL to this many ms from now.'),
  vetoed: z
    .boolean()
    .optional()
    .describe(
      'Veto the intent: dissolves the ghost AND poisons the id so a later linked settle is rejected (same as clear { vetoed:true }).',
    ),
};

const intentUpdateSchema = z.looseObject(intentUpdateShape);

const intentUpdateOperation = defineOperation<z.infer<typeof intentUpdateSchema>, Record<string, unknown>>({
  name: 'intent.update',
  mutates: false,
  input: intentUpdateSchema,
  inputShape: intentUpdateShape,
  http: { method: 'PATCH', path: '/api/canvas/ax/intent/:id' },
  handler: (input) => {
    const id = typeof input.id === 'string' ? input.id : '';
    if (!id) throw new OperationError('intent update requires an id.');
    const intent = intentRegistry.update(id, input);
    return { ok: true, intent } as unknown as Record<string, unknown>;
  },
});

// ── intent.clear (canvas_intent action "clear") ───────────────

const intentClearShape = {
  id: z.string().optional().describe('The intent id to clear.'),
  settledNodeId: z.string().optional().describe('The real node this intent became — triggers the settle morph.'),
  vetoed: z.boolean().optional().describe('Mark this as a human pre-emptive veto (dissolve).'),
};

const intentClearSchema = z.looseObject(intentClearShape);

const intentClearOperation = defineOperation<z.infer<typeof intentClearSchema>, Record<string, unknown>>({
  name: 'intent.clear',
  mutates: false,
  input: intentClearSchema,
  inputShape: intentClearShape,
  http: {
    method: 'DELETE',
    path: '/api/canvas/ax/intent/:id',
    readInput: async (req, params, url) => {
      const query: Record<string, unknown> = {};
      url.searchParams.forEach((value, key) => {
        // `vetoed` is a boolean in the op schema; query params arrive as strings.
        // Coerce only the literal "true"/"false" forms — anything else passes
        // through and fails validation loudly instead of silently becoming false.
        query[key] = key === 'vetoed' && (value === 'true' || value === 'false') ? value === 'true' : value;
      });
      const body = await readJsonValue(req);
      const record =
        body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
      return { ...query, ...record, ...params };
    },
  },
  handler: (input) => {
    const id = typeof input.id === 'string' ? input.id : '';
    if (!id) throw new OperationError('intent clear requires an id.');
    const cleared = intentRegistry.clear(id, {
      ...(typeof input.settledNodeId === 'string' ? { settledNodeId: input.settledNodeId } : {}),
      ...(input.vetoed === true ? { vetoed: true } : {}),
    });
    return { ok: true, cleared } as unknown as Record<string, unknown>;
  },
});

export const intentOperations: Operation[] = [intentSignalOperation, intentUpdateOperation, intentClearOperation];
