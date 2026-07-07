/**
 * Batch meta-operation (plan-005 item 9, the last registry slice).
 *
 * `canvas.batch` dispatches each entry through `executeOperation` — the same
 * single execution path every other surface uses — instead of the former
 * ~290-line hand-written switch in canvas-operations.ts.
 *
 * Frame-count parity (operation-parity counts SSE frames): the legacy batch
 * called the core functions directly and emitted NOTHING per entry; the HTTP
 * handler / SDK fired exactly ONE final `canvas-layout-update`. Routing entries
 * through `executeOperation` would instead fire each op's auto layout emit plus
 * each handler's `ctx.emit`. To preserve the single-final-frame behavior we run
 * the whole loop inside `runWithSuppressedEmits` (registry-level depth-counted
 * suppression) and emit ONE `canvas-layout-update` manually after the loop.
 *
 * Result-shape parity (tests assert results[i].id/url/data/etc.): each op's
 * HTTP `serialize` is the WIRE shape, which differs from what the legacy switch
 * pushed (the legacy switch compact-serialized created nodes and shaped each
 * entry by hand). `shapeBatchEntry` re-derives the byte-identical legacy shape
 * from the produced node + the op result's non-node extras, so HTTP/CLI/MCP
 * batch results are unchanged.
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import { canvasState } from '../../canvas-state.js';
import { serializeCanvasNode, serializeCanvasNodeCompact } from '../../canvas-serialization.js';
import { addCanvasNode } from '../../canvas-operations.js';
import { executeOperation, runWithSuppressedEmits } from '../registry.js';
import { defineOperation, type Operation, type OperationContext } from '../types.js';
import { readJsonValue } from '../http.js';
import { isRecord } from './nodes.js';

interface BatchEntry {
  op: string;
  assign?: string;
  args: Record<string, unknown>;
}

export interface BatchEnvelope {
  ok: boolean;
  results: Array<Record<string, unknown>>;
  refs: Record<string, unknown>;
  failedIndex?: number;
  error?: string;
}

const SUPPORTED_BATCH_OPS = new Set([
  'node.add',
  'node.update',
  'node.remove',
  'graph.add',
  'edge.add',
  'edge.remove',
  'group.create',
  'group.add',
  'group.remove',
  'pin.set',
  'pin.add',
  'pin.remove',
  'snapshot.save',
  'arrange',
]);

/**
 * Resolve `$ref` / `$ref.path` placeholders in batch args against the running
 * refs map. Identical to the legacy resolveBatchRefs: a bare `$name` resolves to
 * the assigned result's `id`; `$name.path.to.field` walks the stored object.
 */
function resolveBatchRefs(value: unknown, refs: Record<string, unknown>): unknown {
  if (typeof value === 'string' && value.startsWith('$')) {
    const path = value.slice(1).split('.');
    let current: unknown = refs[path[0] ?? ''];
    if (path.length === 1 && isRecord(current) && typeof current.id === 'string') return current.id;
    for (const segment of path.slice(1)) {
      if (!isRecord(current) && !Array.isArray(current)) return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }
  if (Array.isArray(value)) return value.map((item) => resolveBatchRefs(item, refs));
  if (isRecord(value)) {
    const resolved: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      resolved[key] = resolveBatchRefs(child, refs);
    }
    return resolved;
  }
  return value;
}

/** Normalize raw operations (legacy handleCanvasBatch normalization). */
function normalizeOperations(raw: unknown): BatchEntry[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((operation): operation is Record<string, unknown> => isRecord(operation))
    .map((operation) => ({
      op: String(operation.op ?? ''),
      ...(typeof operation.assign === 'string' ? { assign: operation.assign } : {}),
      args: isRecord(operation.args) ? operation.args : {},
    }));
}

/**
 * Map a batch op-name + args onto the registered op name + invocation args.
 * The legacy switch accepted `pin.add` / `pin.remove` as op-name aliases (the
 * mode was derived from the name); the registry has a single `pin.set` op with
 * a `mode` arg, so inject the mode here before dispatch.
 */
function resolveDispatch(op: string, args: Record<string, unknown>): { name: string; args: Record<string, unknown> } {
  if (op === 'pin.add') return { name: 'pin.set', args: { ...args, mode: 'add' } };
  if (op === 'pin.remove') return { name: 'pin.set', args: { ...args, mode: 'remove' } };
  if (op === 'pin.set') return { name: 'pin.set', args: { ...args, mode: 'set' } };
  return { name: op, args };
}

// Ops that create/return a node and whose batch entry is the compact node payload
// + op-specific extras (url/spec/fetch). Keep this to the legacy batch allowlist;
// accepting arbitrary registered node-producing ops would expand the batch
// contract and can bypass the single-final-SSE invariant.
const NODE_PRODUCING_OPS = new Set(['node.add', 'node.update', 'group.create', 'graph.add']);

function isInternalBatchNodeType(type: string): type is 'prompt' | 'response' {
  return type === 'prompt' || type === 'response';
}

function createInternalBatchNode(args: Record<string, unknown>): Record<string, unknown> {
  const type = typeof args.type === 'string' ? args.type : '';
  if (!isInternalBatchNodeType(type)) {
    throw new Error(`Unsupported internal canvas_batch node type "${type}".`);
  }

  const data = isRecord(args.data) ? args.data : {};
  const created = addCanvasNode({
    type,
    ...(typeof args.title === 'string' ? { title: args.title } : {}),
    ...(typeof args.content === 'string' ? { content: args.content } : {}),
    ...(Object.keys(data).length > 0 ? { data } : {}),
    ...(typeof args.x === 'number' ? { x: args.x } : {}),
    ...(typeof args.y === 'number' ? { y: args.y } : {}),
    ...(typeof args.width === 'number' ? { width: args.width } : {}),
    ...(typeof args.height === 'number' ? { height: args.height } : {}),
    ...(args.strictSize === true ? { strictSize: true } : {}),
    defaultWidth: 360,
    defaultHeight: 200,
  });

  return { ok: true, ...serializeCanvasNodeCompact(created.node) };
}

/**
 * Re-shape an `executeOperation` result into the byte-identical legacy batch
 * entry shape. Most ops match the wire shape verbatim; the cases below diverge
 * because the legacy switch shaped them by hand.
 */
function shapeBatchEntry(op: string, result: unknown): Record<string, unknown> {
  const body = isRecord(result) ? result : {};

  // node.add / node.update / group.create / graph.add: the legacy switch pushed
  // { ok:true, ...serializeCanvasNodeCompact(node), <extras> }. The wire shape
  // adds `node` / `nodeId` and uses the FULL (non-compact) serialization. Re-derive
  // the compact node payload from state and merge the op-specific non-node extras
  // (webpage fetch/error, graph url/spec) the wire shape carries alongside it.
  if (NODE_PRODUCING_OPS.has(op)) {
    const id = typeof body.id === 'string' ? body.id : '';
    const node = id ? canvasState.getNode(id) : undefined;
    const extras: Record<string, unknown> = {};
    for (const key of ['fetch', 'error', 'url', 'spec']) {
      if (body[key] !== undefined) extras[key] = body[key];
    }
    if (node) return { ok: true, ...serializeCanvasNodeCompact(node), ...extras };
    // node.update of a now-missing node fell back to { ok:true, id } in the legacy switch.
    return op === 'node.update' && id ? { ok: true, id } : body;
  }

  // node.remove: legacy pushed { ok:true, id, removed:true }; wire shape is { ok:true, removed:<id> }.
  if (op === 'node.remove') {
    const id = typeof body.removed === 'string' ? body.removed : '';
    return { ok: true, id, removed: true };
  }

  // group.add: legacy pushed the serialized group node; wire shape is { ok:true, groupId }.
  if (op === 'group.add') {
    const groupId = typeof body.groupId === 'string' ? body.groupId : '';
    const group = groupId ? canvasState.getNode(groupId) : undefined;
    return { ok: true, ...(group ? serializeCanvasNode(group) : { id: groupId }) };
  }

  // pin.set/add/remove: legacy pushed { ok:true, ...{ count, nodeIds } }; wire shape drops nodeIds.
  if (op === 'pin.set' || op === 'pin.add' || op === 'pin.remove') {
    return {
      ok: true,
      count: canvasState.contextPinnedNodeIds.size,
      nodeIds: Array.from(canvasState.contextPinnedNodeIds),
    };
  }

  // snapshot.save: legacy pushed { ok:true, snapshot }; wire shape adds `id`.
  if (op === 'snapshot.save') {
    return { ok: true, snapshot: body.snapshot };
  }

  // arrange: legacy pushed { ok:true, ...{ arranged, layout } } and never validated.
  if (op === 'arrange') {
    return { ok: true, arranged: body.arranged, layout: body.layout };
  }

  // edge.add / edge.remove / group.remove: wire shape matches the push verbatim.
  return body;
}

async function runBatch(operations: BatchEntry[]): Promise<BatchEnvelope> {
  const refs: Record<string, unknown> = {};
  const results: Array<Record<string, unknown>> = [];

  for (let index = 0; index < operations.length; index++) {
    const operation = operations[index]!;
    const args = resolveBatchRefs(operation.args, refs);
    if (!isRecord(args)) {
      return { ok: false, failedIndex: index, error: `Operation ${index} has invalid args.`, results, refs };
    }
    try {
      if (!SUPPORTED_BATCH_OPS.has(operation.op)) {
        return {
          ok: false,
          failedIndex: index,
          error: `Unsupported canvas_batch operation "${operation.op}".`,
          results,
          refs,
        };
      }
      if (operation.op === 'node.add' && typeof args.type === 'string' && isInternalBatchNodeType(args.type)) {
        const result = createInternalBatchNode(args);
        results.push(result);
        if (typeof operation.assign === 'string' && operation.assign.trim().length > 0) {
          refs[operation.assign] = result;
        }
        continue;
      }
      const dispatch = resolveDispatch(operation.op, args);
      const raw = await executeOperation(dispatch.name, dispatch.args);
      const result = shapeBatchEntry(operation.op, raw);
      results.push(result);
      if (typeof operation.assign === 'string' && operation.assign.trim().length > 0) {
        refs[operation.assign] = result;
      }
    } catch (error) {
      return {
        ok: false,
        failedIndex: index,
        error: error instanceof Error ? error.message : String(error),
        results,
        refs,
      };
    }
  }

  return { ok: true, results, refs };
}

const batchShape = {
  operations: z
    .array(
      z.object({
        op: z.string().describe('Operation name, e.g. "node.add" or "edge.add"'),
        assign: z.string().optional().describe('Optional reference name for later operations'),
        args: z.record(z.string(), z.unknown()).optional().describe('Operation arguments'),
      }),
    )
    .describe('Ordered array of batch operations'),
  full: z
    .boolean()
    .optional()
    .describe('Return full batch operation results. Default false compacts node-like payloads.'),
  verbose: z.boolean().optional().describe('Alias for full:true.'),
};

const batchSchema = z.looseObject({
  operations: z.unknown().optional(),
});

function wantsFullBatch(input: { full?: boolean; verbose?: boolean } = {}): boolean {
  return input.full === true || input.verbose === true;
}

/**
 * MCP compaction (moved verbatim from mcp/server.ts): drop verbose node fields
 * from node-like batch entries unless `full`/`verbose` is set.
 */
function compactBatchValue(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const nodeLike = typeof record.id === 'string' && typeof record.type === 'string';
  const compact: Record<string, unknown> = {};
  for (const key of [
    'ok',
    'id',
    'type',
    'kind',
    'title',
    'content',
    'position',
    'size',
    'fetch',
    'error',
    'from',
    'to',
    'groupId',
    'nodeIds',
    'snapshot',
    'arranged',
    'layout',
  ]) {
    if (record[key] !== undefined) compact[key] = record[key];
  }
  if (nodeLike) return compact;
  return record;
}

function compactBatchResult(result: BatchEnvelope): Record<string, unknown> {
  return {
    ok: result.ok,
    ...(result.failedIndex !== undefined ? { failedIndex: result.failedIndex } : {}),
    ...(result.error ? { error: result.error } : {}),
    results: result.results.map((entry) => compactBatchValue(entry)),
    refs: Object.fromEntries(Object.entries(result.refs).map(([key, value]) => [key, compactBatchValue(value)])),
  };
}

const batchOperation = defineOperation<z.infer<typeof batchSchema>, BatchEnvelope>({
  name: 'canvas.batch',
  // mutates:false — the registry must NOT auto-emit. The handler emits ONE final
  // canvas-layout-update via ctx.emit (outside the per-entry suppression window)
  // so the frame fires once whether or not any entry mutated.
  mutates: false,
  input: batchSchema,
  inputShape: batchShape,
  http: {
    method: 'POST',
    path: '/api/canvas/batch',
    status: (result) => (isRecord(result) && result.ok === false ? 400 : 200),
    // Remote MCP callers still need the structured partial-failure envelope so
    // the canvas_batch formatter can return JSON with isError=true.
    errorBodyAsResult: true,
    // Preserve BOTH documented body shapes: { operations:[...] } and a bare
    // [...] array (the array-preserving reader never coerces — see plan-005).
    readInput: async (req) => {
      const body = await readJsonValue(req);
      const operations = Array.isArray(body)
        ? body
        : isRecord(body) && Array.isArray(body.operations)
          ? body.operations
          : [];
      return { operations };
    },
  },
  mcp: {
    toolName: 'canvas_batch',
    description:
      'Run a non-atomic batch of canvas operations with optional assigned references. Use assign to name a result, then reference it later as "$name" for the created node id or "$name.id" for a specific result field. On failure, earlier successful operations remain applied and the response includes ok:false, failedIndex, error, results, and refs. Supports node.add, node.update, node.remove, graph.add, edge.add, edge.remove, group.create, group.add, group.remove, pin.set/add/remove, snapshot.save, and arrange.',
    formatResult: (result, input) => {
      const envelope = result as BatchEnvelope;
      const payload = wantsFullBatch(input) ? envelope : compactBatchResult(envelope);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
        ...(envelope.ok ? {} : { isError: true }),
      };
    },
  },
  handler: async (input, ctx: OperationContext) => {
    const operations = normalizeOperations(input.operations);
    // Suppress every per-entry SSE frame (auto layout emit + each handler's
    // ctx.emit). After the loop completes, emit ONE final canvas-layout-update.
    const envelope = await runWithSuppressedEmits(() => runBatch(operations));
    ctx.emit('canvas-layout-update', { layout: canvasState.getLayout() });
    return envelope;
  },
});

export const batchOperations: Operation[] = [batchOperation];

/**
 * Typed SDK entry point: run a batch through the registry's single execution
 * path (`executeOperation('canvas.batch')`). The op emits the one final
 * canvas-layout-update itself, so callers must NOT emit again.
 */
export async function runCanvasBatchOperation(
  operations: Array<{ op: string; assign?: string; args?: Record<string, unknown> }>,
): Promise<BatchEnvelope> {
  return (await executeOperation('canvas.batch', { operations })) as BatchEnvelope;
}
