/**
 * MCP's output is the FORMATTER projection, never the larger HTTP payload.
 * `result` wraps prose/arrays without pretending they are JSON objects. Each
 * operation validates its stable fields; loose payloads preserve full:true and
 * extensible node/app data. No schema advertises an unconstrained root record.
 */
import { z, type ZodType } from 'zod';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { tourSchema, tourStopSchema } from '../../shared/tour.js';

const id = z.string().min(1);
const count = z.number().int().nonnegative();
const ok = z.looseObject({ ok: z.boolean() });
const identified = z.looseObject({ id });
const message = z.strictObject({ message: z.string() });
const node = z.looseObject({
  id,
  type: z.string(),
  contentRevision: count.optional(),
  linksRevision: count.optional(),
});
const created = z.looseObject({
  ok: z.boolean(),
  id,
  nodeId: id.optional(),
  node: node.optional(),
  contentRevision: count.optional(),
});
const edge = z.looseObject({ id, from: id, to: id, type: z.string() });
const boards = z.looseObject({ ok: z.boolean(), activeBoardId: id.nullable(), boards: z.array(identified) });
const board = z.looseObject({ ok: z.boolean(), board: identified });
const viewport = z.object({ x: z.number(), y: z.number(), scale: z.number().positive() });
const webview = z.looseObject({ supported: z.boolean(), active: z.boolean() });
const entity = (key: string) => z.looseObject({ ok: z.boolean(), [key]: identified });
const gate = (key: string) =>
  z.looseObject({ ok: z.boolean(), [key]: identified.nullable(), pending: z.boolean().optional() });
const history = z.looseObject({ ok: z.boolean(), description: z.string(), canUndo: z.boolean(), canRedo: z.boolean() });
const batchEntry = z.looseObject({
  ok: z.boolean(),
  id: id.optional(),
  nodeId: id.optional(),
  contentRevision: count.optional(),
});
const batch = z.discriminatedUnion('ok', [
  z.looseObject({ ok: z.literal(true), results: z.array(batchEntry), refs: z.record(z.string(), batchEntry) }),
  z.looseObject({
    ok: z.literal(false),
    failedIndex: count,
    error: z.string(),
    cancelled: z.boolean().optional(),
    results: z.array(batchEntry),
    refs: z.record(z.string(), batchEntry),
  }),
]);

/** Required stable fields, keyed by dispatched operation (including every composite action). */
const payloads: Record<string, ZodType> = {
  'pin.set': z.looseObject({ ok: z.boolean(), pinnedNodeIds: z.array(id) }),
  'ax.command.invoke': entity('event'),
  'canvas.batch': batch,
  'import.list': z.looseObject({ ok: z.boolean(), imports: z.array(identified) }),
  'import.read': z.looseObject({
    ok: z.boolean(),
    import: identified,
    attachment: identified,
    downloadPath: z.string(),
  }),
  'import.submit': entity('import'),
  'import.unavailable': entity('import'),
  'snapshot.save': z.looseObject({ ok: z.boolean(), id, snapshot: identified }),
  'snapshot.list': z.looseObject({ snapshots: z.array(identified) }),
  'snapshot.restore': z.looseObject({
    ok: z.boolean(),
    restored: id,
    summary: z.looseObject({ nodeCount: count, edgeCount: count }),
  }),
  'snapshot.restore-node': z.looseObject({ ok: z.boolean(), id, restored: z.boolean() }),
  'snapshot.delete': z.looseObject({ ok: z.boolean(), deleted: id }),
  'snapshot.gc': ok,
  'snapshot.diff': message,
  'board.list': boards,
  'board.get': board,
  'board.create': board,
  'board.create-from': z.union([
    board,
    z.looseObject({ ok: z.boolean(), sourceBoardId: id, cards: z.array(node), edges: z.array(edge) }),
  ]),
  'board.open': boards,
  'board.update': boards,
  'board.pin': boards,
  'board.unpin': boards,
  'knowledge.list': z.looseObject({
    ok: z.boolean(),
    categories: z.array(identified),
    folders: z.array(z.looseObject({ path: z.string() })),
  }),
  'knowledge.category-set': entity('category'),
  'knowledge.category-remove': z.looseObject({ ok: z.boolean(), id }),
  'knowledge.relation-preset-set': entity('preset'),
  'knowledge.relation-preset-remove': z.looseObject({ ok: z.boolean(), id }),
  'knowledge.folder-set': z.looseObject({ ok: z.boolean(), folder: z.looseObject({ path: z.string() }) }),
  'node.add': created,
  'node.get': node,
  'node.update': created,
  'node.remove': z.looseObject({ ok: z.boolean(), removed: id }),
  'node.lifecycle-get': z.looseObject({ ok: z.boolean(), boardId: id, nodeId: id, contentRevision: count }),
  'node.lifecycle-set': ok,
  'node.review': entity('record'),
  'node.lifecycle-restore': entity('record'),
  'schema.describe': z.looseObject({ ok: z.boolean(), nodeTypes: z.array(z.looseObject({ type: z.string() })) }),
  'spec.validate': ok,
  'jsonrender.add': created,
  'jsonrender.stream': created.extend({ specVersion: count, applied: count, skipped: count }),
  'graph.add': created,
  'render.workboard': z.looseObject({ ok: z.boolean(), id }),
  'edge.add': edge,
  'edge.update': z.looseObject({ id, type: z.string() }),
  'edge.remove': z.looseObject({ ok: z.boolean(), removed: id }),
  'group.create': created,
  'group.add': z.looseObject({ ok: z.boolean(), groupId: id }),
  'group.remove': z.looseObject({ ok: z.boolean(), groupId: id }),
  'canvas.undo': history,
  'canvas.redo': history,
  'tour.get': z.looseObject({ tour: tourSchema, derived: z.boolean(), position: count.nullable() }),
  'tour.set': ok,
  'tour.go': z.looseObject({ ok: z.boolean(), index: count, total: count, stop: tourStopSchema }),
  'tour.exit': ok,
  'camera.move': z.looseObject({ ok: z.boolean(), stop: tourStopSchema, viewport }),
  arrange: z.looseObject({ ok: z.boolean(), layout: z.enum(['grid', 'column', 'flow']) }),
  'node.focus': z.looseObject({ ok: z.boolean(), focused: id, panned: z.boolean() }),
  'view.fit': z.looseObject({ ok: z.boolean(), viewport }),
  'canvas.clear': z.looseObject({ ok: z.boolean(), cleared: z.literal(true) }),
  'annotation.remove': ok,
  'context.get': z.looseObject({ version: z.literal(1), budgetUnit: z.literal('utf16-code-units') }),
  'memory-graph.get': z.looseObject({
    nodes: z.array(z.looseObject({ key: id, boardId: id, kind: z.enum(['board', 'card']) })),
    edges: z.array(z.looseObject({ id, from: id, to: id })),
    depth: count,
  }),
  search: z.looseObject({ query: z.string(), resultCount: count, results: z.array(node) }),
  'layout.get': z.looseObject({ nodes: z.array(node), edges: z.array(edge), viewport }),
  'validate.get': ok,
  'mcpapp.open': z.looseObject({
    ok: z.boolean(),
    nodeId: id.nullable(),
    sessionId: id,
    toolCallId: id,
    resourceUri: z.string(),
  }),
  'diagram.open': z.looseObject({
    ok: z.boolean(),
    nodeId: id.nullable(),
    sessionId: id,
    toolCallId: id,
    resourceUri: z.string(),
  }),
  'webartifact.build': z.looseObject({
    ok: z.boolean(),
    path: z.string(),
    bytes: count,
    openedInCanvas: z.boolean(),
    id: id.optional(),
    nodeId: id.nullable().optional(),
  }),
  'webview.status': webview,
  'webview.start': webview,
  'webview.stop': z.looseObject({ ok: z.boolean(), stopped: z.boolean(), webview }),
  'webview.resize': webview,
  // Evaluation deliberately returns arbitrary page values, including undefined
  // (serialized as an absent value). This is the one untyped leaf, not a root contract.
  'webview.evaluate': z.strictObject({ value: z.unknown().optional() }),
  'ax.get': ok,
  'ax.focus.set': z.looseObject({ ok: z.boolean(), focus: z.looseObject({ nodeIds: z.array(id) }) }),
  'ax.policy.set': ok,
  'ax.host-capability.report': ok,
  'ax.presence.get': ok,
  'ax.presence.set': ok,
  'ax.work.create': entity('workItem'),
  'ax.work.update': entity('workItem'),
  'ax.review.add': entity('reviewAnnotation'),
  'ax.approval.request': gate('approvalGate'),
  'ax.approval.resolve': gate('approvalGate'),
  'ax.approval.get': gate('approvalGate'),
  'ax.elicitation.request': gate('elicitation'),
  'ax.elicitation.respond': gate('elicitation'),
  'ax.elicitation.get': gate('elicitation'),
  'ax.mode.request': gate('modeRequest'),
  'ax.mode.resolve': gate('modeRequest'),
  'ax.mode.get': gate('modeRequest'),
  'ax.timeline.get': ok,
  'ax.event.record': entity('event'),
  'ax.evidence.add': entity('evidence'),
  'ax.steer': entity('steering'),
  'ax.reads.list': ok,
  'ax.reads.status': z.looseObject({ ok: z.boolean(), boardId: id.nullable() }),
  'ax.delivery.pending': z.looseObject({ ok: z.boolean(), pending: z.array(identified) }),
  'ax.delivery.mark': z.looseObject({ ok: z.boolean(), delivered: z.boolean() }),
  'intent.signal': entity('intent'),
  'intent.update': entity('intent'),
  'intent.clear': z.looseObject({ ok: z.boolean(), cleared: z.boolean() }),
};

function payloadSchema(operation: string): ZodType {
  const schema = payloads[operation];
  if (!schema) throw new Error(`Missing MCP output contract for ${operation}.`);
  return schema;
}

const errorData = z.strictObject({ message: z.string() });
const formattedErrorData = z.looseObject({ ok: z.literal(false), error: z.string() });

export function operationOutputSchema(operations: string[]) {
  const variants: ZodType[] = operations.flatMap((operation): ZodType[] => {
    if (operation === 'canvas.batch')
      return [
        z.strictObject({ operation: z.literal(operation), outcome: z.literal('success'), data: batch.options[0] }),
        z.strictObject({
          operation: z.literal(operation),
          outcome: z.literal('error'),
          data: batch.options[1].extend({ results: z.array(batchEntry).length(0) }),
        }),
        z.strictObject({
          operation: z.literal(operation),
          outcome: z.literal('partial'),
          data: batch.options[1].extend({ results: z.array(batchEntry).min(1) }),
        }),
      ];
    return [
      z.strictObject({
        operation: z.literal(operation),
        outcome: z.literal('success'),
        data: payloadSchema(operation),
      }),
    ];
  });
  const formattedErrors = operations.filter((operation) => operation !== 'canvas.batch');
  if (formattedErrors.length)
    variants.push(
      z.strictObject({
        operation: z.enum(formattedErrors),
        outcome: z.literal('error'),
        data: z.union([errorData, formattedErrorData]),
      }),
    );
  // null identifies an exception rather than a formatted operation result;
  // it does NOT promise that no writes occurred before the exception.
  return z.strictObject({
    result: z.union([
      ...variants,
      z.strictObject({ operation: z.null(), outcome: z.literal('error'), data: errorData }),
    ]),
  });
}

export function structuredOperationResult(operation: string, formatted: CallToolResult): CallToolResult {
  const text = formatted.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text };
  }
  // Error payloads can contain meaningful partial state. Never replace them
  // with the thrown-error message shape, or lose batch results/refs.
  if (!formatted.isError || operation === 'canvas.batch') payloadSchema(operation).parse(data);
  else z.union([errorData, formattedErrorData]).parse(data);
  const partial =
    operation === 'canvas.batch' &&
    formatted.isError &&
    typeof data === 'object' &&
    data !== null &&
    'results' in data &&
    Array.isArray(data.results) &&
    data.results.length > 0;
  return {
    ...formatted,
    structuredContent: {
      result: { operation, outcome: partial ? 'partial' : formatted.isError ? 'error' : 'success', data },
    },
  };
}

export function operationToolError(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
    structuredContent: { result: { operation: null, outcome: 'error', data: { message } } },
  };
}

/**
 * Explicit worst-case audit of all 21 generated tools. `mutates` only controls
 * layout events and is intentionally absent here. Tuple = destructive,
 * idempotent, open-world. All tools have a write action, including query's
 * durable consumer cursor. Read logging alone would not make a tool a write.
 */
const annotations: Record<string, readonly [boolean, boolean, boolean]> = {
  canvas_pin_nodes: [true, true, false], // set/remove can replace the human's pins
  canvas_invoke_command: [false, false, false], // appends an allowlisted intent, not arbitrary execution
  canvas_batch: [true, false, true], // remove/replace; webpage creation can fetch
  canvas_import: [false, false, false], // submit/unavailable transition a requested job
  canvas_snapshot: [true, false, true], // restore/delete/gc; restoring apps can reconnect
  canvas_board: [true, false, true], // category/template removal; open can rehydrate apps
  canvas_node: [true, false, true], // remove/update; webpage fetching and file nodes
  canvas_render: [true, false, false], // stream/workboard can replace an existing spec
  canvas_edge: [true, false, false],
  canvas_group: [true, false, false],
  canvas_history: [true, false, true], // undo/redo can restore and reconnect app sessions
  canvas_view: [true, false, false], // clear/remove annotation; tour next is not idempotent
  canvas_query: [false, false, false], // context advances a durable consumer cursor
  canvas_app: [true, false, true], // arbitrary external tools/build processes; existing-node replacement
  canvas_webview: [true, false, true], // evaluate is arbitrary page JavaScript, not a read
  canvas_ax_state: [true, false, false], // replaces policy/focus; presence can append sessions
  canvas_ax_work: [true, false, false], // update replaces existing work-item fields
  canvas_ax_gate: [true, false, false], // resolve changes pending gates; request creates IDs
  canvas_ax_timeline: [false, false, false], // appends events/evidence/steering
  canvas_ax_delivery: [false, false, false], // claim/mark consume delivery state
  canvas_intent: [true, false, false], // update/clear; signal generates an ID and TTL
};

export function operationToolAnnotations(toolName: string): ToolAnnotations {
  const flags = annotations[toolName];
  if (!flags) throw new Error(`Missing MCP annotation audit for ${toolName}.`);
  const [destructiveHint, idempotentHint, openWorldHint] = flags;
  return { readOnlyHint: false, destructiveHint, idempotentHint, openWorldHint };
}
