/**
 * MCP tool registration for registered operations.
 *
 * Iterates the registry, advertises `{ ...op.inputShape, ...extraShape }` as
 * the tool schema, invokes through the host's invoker (local or HTTP), and
 * formats the wire-shaped result with the op's `formatResult`. Errors
 * (including OperationError) become `isError` tool results with the bare
 * message text, matching the legacy hand-written tools.
 */
import { z, type ZodRawShape, type ZodTypeAny } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { getOperation, listOperations } from './registry.js';
import { agentSourceLabel, type OperationInvoker } from './invoker.js';
import { OperationError, type Operation, type OperationMcpToolHost, type OperationExecutionOptions } from './types.js';
import {
  operationOutputSchema,
  operationToolAnnotations,
  operationToolError,
  structuredOperationResult,
} from './mcp-contracts.js';
import {
  CONTEXT_READ_OPS,
  contextReadFromPayload,
  pinnedBoardReads,
  graphReads,
  type ContextReadInput,
} from '../context-reads.js';
import type { MemoryGraph } from '../../shared/memory-graph.js';
import { compositeFoldedOpNames, compositeToolDefinitions, type CompositeToolDefinition } from './composites.js';

export interface OperationToolHost extends OperationMcpToolHost {
  invoker(): OperationInvoker;
  prepareContextRead(board?: string): Promise<{ boardId: string | null; pinnedNodeIds: string[] }>;
  recordContextRead(read: ContextReadInput): Promise<void>;
}

const routingShape = {
  targetBoardId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Execute on this board without changing the shared workbench view. Nested operations retain this target.',
    ),
  agentId: z.string().min(1).optional().describe('Stable agent/thread identity for attribution and scope fences.'),
};

function executionOptions(extra: RequestHandlerExtra<ServerRequest, ServerNotification>): OperationExecutionOptions {
  const progressToken = extra._meta?.progressToken;
  return {
    signal: extra.signal,
    ...(progressToken !== undefined
      ? {
          onProgress: (progress: Parameters<NonNullable<OperationExecutionOptions['onProgress']>>[0]) =>
            extra.sendNotification({ method: 'notifications/progress', params: { ...progress, progressToken } }),
        }
      : {}),
  };
}

async function invokeMcpOperation(
  host: OperationToolHost,
  op: Operation,
  opInput: Record<string, unknown>,
  formatInput: Record<string, unknown>,
  consumer: string | null,
  options: OperationExecutionOptions,
) {
  options.signal?.throwIfAborted();
  // buildInput may project operation-specific fields; routing belongs to the
  // invocation and must also cover formatter follow-up reads and accounting.
  const routing = {
    ...(formatInput.targetBoardId !== undefined ? { targetBoardId: formatInput.targetBoardId } : {}),
    ...(formatInput.agentId !== undefined ? { agentId: formatInput.agentId } : {}),
  };
  opInput = { ...opInput, ...routing };
  if (typeof routing.agentId === 'string') consumer = routing.agentId;
  const board =
    typeof routing.targetBoardId === 'string'
      ? routing.targetBoardId
      : typeof opInput.board === 'string' && opInput.board.trim()
        ? opInput.board.trim()
        : undefined;
  const preparesContext = op.name === 'context.get' && opInput.contextDelivery === false;
  const readTarget = CONTEXT_READ_OPS.has(op.name) && !preparesContext ? await host.prepareContextRead(board) : null;
  if (readTarget?.boardId && 'board' in op.inputShape && opInput.board === undefined) {
    opInput = { ...opInput, board: readTarget.boardId };
    formatInput = { ...formatInput, board: readTarget.boardId };
  }
  options.signal?.throwIfAborted();
  const invoker = host.invoker();
  const result = await invoker.invoke(op.name, opInput, options);
  // Preserve the host receiver, and bind options to formatter follow-up reads
  // (history flags, snapshot summary, streaming node metadata).
  const formatterHost: OperationMcpToolHost = {
    getPinnedNodeIds: (target) => host.getPinnedNodeIds(target ?? board),
    invoker: () => ({
      invoke: (name, input, followUp) => invoker.invoke(name, { ...input, ...routing }, { ...options, ...followUp }),
    }),
  };
  const formatted = structuredOperationResult(
    op.name,
    op.mcp?.formatResult
      ? await op.mcp.formatResult(result, formatInput, formatterHost)
      : { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] },
  );
  // Do not throwIfAborted here: batch may already have returned a partial
  // outcome, and cancellation must never erase completed work from the reply.
  if (readTarget) {
    const text = formatted.content
      .filter((item): item is Extract<(typeof formatted.content)[number], { type: 'text' }> => item.type === 'text')
      .map((item) => item.text)
      .join('');
    if (op.name === 'node.get') {
      // Compact responses can still deliver text. Metadata without text or
      // data must not mark unseen content read.
      const node = JSON.parse(text) as { data?: unknown; content?: string | null };
      if (node.data === undefined && !node.content) return formatted;
    }
    try {
      if (op.name === 'memory-graph.get') {
        for (const read of graphReads(
          { channel: 'operation', resource: op.name, source: agentSourceLabel('mcp'), consumer, agentId: null },
          JSON.parse(text) as MemoryGraph,
        ))
          await host.recordContextRead(read);
        return formatted;
      }
      await host.recordContextRead(
        contextReadFromPayload(
          {
            channel: 'operation',
            resource: op.name,
            source: agentSourceLabel('mcp'),
            consumer,
            agentId: null,
            pinnedNodeIds: readTarget.pinnedNodeIds,
            boardId: readTarget.boardId,
          },
          text,
        ),
      );
      if (op.name === 'context.get') {
        const base = {
          channel: 'operation' as const,
          resource: op.name,
          source: agentSourceLabel('mcp'),
          consumer,
          agentId: null,
        };
        for (const read of pinnedBoardReads(base, text)) await host.recordContextRead(read);
      }
    } catch (error) {
      console.error('[pmx-canvas mcp] recording a context read failed:', error);
    }
  }
  return formatted;
}

export function registerOperationTools(server: McpServer, getHost: () => Promise<OperationToolHost>): void {
  // Ops folded by a composite are NOT registered standalone: their legacy
  // single-purpose tools were removed in v0.3.0 (docs/api-stability.md). The op
  // itself is untouched — it stays reachable via its composite and canvas_batch.
  const foldedOpNames = compositeFoldedOpNames();
  for (const op of listOperations()) {
    if (foldedOpNames.has(op.name)) continue;
    const tool = op.mcp;
    if (!tool) continue;
    server.registerTool(
      tool.toolName,
      {
        description: tool.description,
        // A LOOSE object, not a raw shape: the SDK wraps raw shapes in a
        // stripping z.object, which silently dropped unknown args before the
        // op layer could reject them — a removed field (dockPosition) looked
        // successful over MCP while the same HTTP call 400'd (0.5.1 Amp
        // finding A). Loose parsing forwards unknown keys to the op layer,
        // the single authority on dead-field rejection, HTTP and MCP alike.
        inputSchema: z.looseObject({ ...op.inputShape, ...(tool.extraShape ?? {}), ...routingShape }),
        outputSchema: operationOutputSchema([op.name]),
        annotations: operationToolAnnotations(tool.toolName),
      },
      async (input: Record<string, unknown>, extra) => {
        try {
          const host = await getHost();
          extra.signal.throwIfAborted();
          const opInput = tool.buildInput ? tool.buildInput(input) : input;
          return await invokeMcpOperation(
            host,
            op,
            opInput,
            input,
            server.server.getClientVersion()?.name ?? null,
            executionOptions(extra),
          );
        } catch (error) {
          return operationToolError(error);
        }
      },
    );
  }
}

/**
 * Member op names a composite folds: the flat `actions` map values for a
 * single-discriminator composite, or the explicit `memberOps` for a
 * two-discriminator one (canvas_ax_gate).
 */
function compositeMemberOps(def: CompositeToolDefinition): string[] {
  return def.memberOps ?? Object.values(def.actions);
}

/**
 * Derive a composite tool's advertised schema from its member operations: the
 * union of every member op's `inputShape` + `extraShape`, each made optional
 * (not every action uses every field), plus the `action` discriminator (and, for
 * two-discriminator composites, the extra `kind` discriminator). Deriving it
 * (instead of hand-listing fields) keeps the composite schema in lockstep with
 * the operations it folds — no drift.
 *
 * Collision handling (`fieldRemap`): a member-op field whose name equals a
 * discriminator (e.g. `ax.approval.request`'s own `action`) is advertised under
 * its remapped public name (`approvalAction`) so the discriminator stays clean;
 * dispatch maps it back before invoking the op.
 *
 * Shared-field widening: a field contributed by ONE member op is advertised with
 * that op's strict MCP schema (best agent ergonomics). A field contributed by
 * MULTIPLE member ops is advertised with the loose `inputShape` schema instead —
 * those ops may disagree on the strict type (e.g. `canvas_ax_timeline`'s `kind`
 * is the event-kind enum for `ax.event.record` but the evidence-kind enum for
 * `ax.evidence.add`), and a first-write-wins strict enum would wrongly reject a
 * value valid for another action. The loose shape never over-rejects; each op
 * still validates its own input against that same loose shape + its handler.
 */
function buildCompositeShape(def: CompositeToolDefinition): ZodRawShape {
  // The action discriminator: explicit `actionEnum` (two-discriminator path) or
  // the flat `actions` map keys (single-discriminator path).
  const actionKeys = (def.actionEnum ?? Object.keys(def.actions)) as [string, ...string[]];
  const shape: Record<string, ZodTypeAny> = {
    action: z.enum(actionKeys).describe(`Operation to perform: ${def.actionSummary}.`),
    ...(def.extraDiscriminatorShape ?? {}),
  };
  // Reserve discriminator names so a colliding member field never overwrites them.
  const discriminators = new Set(Object.keys(shape));
  // op-field-name → public-field-name (inverse of fieldRemap), so a colliding
  // op field is advertised under its namespaced public name.
  const opToPublic = new Map<string, string>();
  for (const [publicName, opField] of Object.entries(def.fieldRemap ?? {})) {
    opToPublic.set(opField, publicName);
  }
  // First pass: count how many member ops contribute each public field, and
  // capture both the strict (extraShape-preferred) and loose (inputShape) schema.
  const fields = new Map<string, { count: number; strict: ZodTypeAny; loose: ZodTypeAny }>();
  for (const opName of new Set(compositeMemberOps(def))) {
    const op = getOperation(opName);
    const looseShape = op.inputShape;
    const strictShape = { ...op.inputShape, ...(op.mcp?.extraShape ?? {}) };
    for (const [key, schema] of Object.entries(strictShape)) {
      const publicKey = opToPublic.get(key) ?? key;
      if (discriminators.has(publicKey)) continue; // discriminator wins; drop the field.
      const entry = fields.get(publicKey);
      if (entry) {
        entry.count += 1;
      } else {
        fields.set(publicKey, {
          count: 1,
          strict: schema as ZodTypeAny,
          loose: (looseShape[key] ?? schema) as ZodTypeAny,
        });
      }
    }
  }
  for (const [publicKey, entry] of fields) {
    // Multi-op fields widen to the loose shape (ops may disagree on the strict
    // type); single-op fields keep the strict schema.
    const schema = entry.count > 1 ? entry.loose : entry.strict;
    shape[publicKey] = schema.optional();
  }
  return shape;
}

/**
 * Resolve the registry op a composite invocation dispatches to. Two-discriminator
 * composites (canvas_ax_gate) use `resolveOp(kind, action)`; single-discriminator
 * composites use the flat `actions` map. An unknown action / invalid combo is a
 * loud OperationError (never a silent no-op).
 */
function resolveCompositeOp(def: CompositeToolDefinition, input: Record<string, unknown>): string {
  const action = typeof input.action === 'string' ? input.action : '';
  if (def.resolveOp) {
    const kind = typeof input.kind === 'string' ? input.kind : '';
    const opName = def.resolveOp({ kind, action });
    if (!opName) {
      throw new OperationError(
        `Invalid kind/action combination (kind "${kind}", action "${action}") for ${def.toolName}.`,
      );
    }
    return opName;
  }
  const opName = def.actions[action];
  if (!opName) {
    throw new OperationError(
      `Unknown action "${action}" for ${def.toolName}. Valid actions: ${Object.keys(def.actions).join(', ')}.`,
    );
  }
  return opName;
}

/**
 * Strip the composite discriminators (`action` plus any `extraDiscriminatorShape`
 * keys such as `kind`) and undo the field remap (public field name → op field
 * name, e.g. `approvalAction` → `action`). The result is the raw MCP arg object
 * the standalone tool would receive.
 */
function stripCompositeDiscriminators(
  def: CompositeToolDefinition,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const discriminators = new Set<string>(['action', ...Object.keys(def.extraDiscriminatorShape ?? {})]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (discriminators.has(key)) continue;
    const opField = def.fieldRemap?.[key] ?? key;
    out[opField] = value;
  }
  return out;
}

/**
 * Per-op cache of the MCP arg names its extraShape marks REQUIRED (a schema
 * that rejects `undefined`). These are the standalone tools' old contracts,
 * which buildCompositeShape flattens to all-optional — the composite handler
 * re-enforces them at dispatch so a missing required field fails loudly and
 * names the field, instead of failing deep in the handler or silently
 * no-oping (the `q`-vs-`query` zero-results trap from the 0.3.1 test report).
 */
const requiredFieldsCache = new WeakMap<object, string[]>();

// Advertised input aliases that satisfy a required extraShape field: the op's
// handler accepts either name, so the pre-dispatch check must too. (The only
// such collision across all 15 composites — edges.ts advertises `edge_id` as a
// legacy alias for `id` and its handler reads `edge_id ?? id`.)
const REQUIRED_FIELD_ALIASES: Record<string, Record<string, readonly string[]>> = {
  'edge.remove': { id: ['edge_id'] },
};

function requiredFieldSatisfied(opName: string, field: string, rest: Record<string, unknown>): boolean {
  if (rest[field] !== undefined) return true;
  const aliases = REQUIRED_FIELD_ALIASES[opName]?.[field] ?? [];
  return aliases.some((alias) => rest[alias] !== undefined);
}

function requiredMcpFields(op: Operation): string[] {
  const tool = op.mcp;
  if (!tool?.extraShape) return [];
  let keys = requiredFieldsCache.get(tool);
  if (!keys) {
    keys = Object.entries(tool.extraShape)
      .filter(([, schema]) => !(schema as ZodTypeAny).safeParse(undefined).success)
      .map(([key]) => key);
    requiredFieldsCache.set(tool, keys);
  }
  return keys;
}

/** Registry metadata only: never boots a canvas or records a content read. */
export function registerOperationHelpTool(server: McpServer): void {
  const folded = compositeFoldedOpNames();
  server.registerTool(
    'canvas_help',
    {
      description:
        'Look up an MCP operation by registry name (e.g. node.add, ax.approval.request). Returns its public tool, argument schema and guidance. Omit op to list operation names. Does not execute operations or read canvas content.',
      inputSchema: z.object({ op: z.string().min(1).optional() }),
      outputSchema: z.object({
        result: z.union([
          z.strictObject({ operations: z.array(z.string()) }),
          z.strictObject({
            operation: z.string(),
            tool: z.string(),
            description: z.string(),
            inputSchema: z.record(z.string(), z.unknown()),
          }),
        ]),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ op: name }) => {
      const operations = listOperations().filter((op) => op.mcp || folded.has(op.name));
      if (name === undefined) {
        const result = { operations: operations.map((op) => op.name).sort() };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: { result } };
      }
      const op = operations.find((op) => op.name === name);
      if (!op) {
        return {
          content: [{ type: 'text', text: `Unknown MCP operation "${name}". Omit op to list available operations.` }],
          isError: true,
        };
      }
      const composite = compositeToolDefinitions.find((def) => compositeMemberOps(def).includes(name));
      const publicName = (field: string) =>
        Object.entries(composite?.fieldRemap ?? {}).find(([, original]) => original === field)?.[0] ?? field;
      const shape: Record<string, ZodTypeAny> = Object.fromEntries(
        Object.entries({ ...op.inputShape, ...op.mcp?.extraShape, ...routingShape }).map(([field, schema]) => [
          publicName(field),
          schema,
        ]),
      );
      if (composite?.resolveOp) {
        // Resolve the same kind/action matrix used by composite dispatch.
        const kinds = composite.extraDiscriminatorShape?.kind;
        if (!(kinds instanceof z.ZodEnum)) throw new Error(`Missing kind enum for ${composite.toolName}.`);
        for (const kind of kinds.options) {
          for (const action of composite.actionEnum ?? []) {
            if (composite.resolveOp({ kind: String(kind), action }) === name) {
              shape.kind = z.literal(kind);
              shape.action = z.literal(action);
            }
          }
        }
      } else if (composite) {
        const action = Object.entries(composite.actions).find(([, operation]) => operation === name)![0];
        shape.action = z.literal(action);
      }
      const inputSchema = z.toJSONSchema(z.looseObject(shape), { target: 'draft-7', io: 'input' });
      // Mirror dispatch's required-name alternatives rather than demanding both names.
      for (const [field, aliases] of Object.entries(REQUIRED_FIELD_ALIASES[name] ?? {})) {
        const key = publicName(field);
        if (!inputSchema.required?.includes(key)) continue;
        inputSchema.required = inputSchema.required.filter((required) => required !== key);
        inputSchema.allOf = [
          ...(inputSchema.allOf ?? []),
          { anyOf: [key, ...aliases.map(publicName)].map((alternative) => ({ required: [alternative] })) },
        ];
      }
      const result = {
        operation: name,
        tool: composite?.toolName ?? op.mcp!.toolName,
        description: op.mcp?.description ?? composite!.description,
        inputSchema,
      };
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: { result } };
    },
  );
}

/**
 * Register composite (action-discriminated) MCP tools (plan-006). Each action
 * dispatches to a registered operation, reusing that op's `mcp.buildInput` and
 * `mcp.formatResult` so the composite action is byte-identical to the standalone
 * tool it folds. Defaults to `compositeToolDefinitions`.
 */
export function registerCompositeTools(
  server: McpServer,
  getHost: () => Promise<OperationToolHost>,
  definitions: CompositeToolDefinition[] = compositeToolDefinitions,
): void {
  for (const def of definitions) {
    // Public composite name for each op field (inverse of fieldRemap), so
    // required-field errors name the argument the agent actually sends.
    const publicFieldName = new Map<string, string>();
    for (const [publicKey, opField] of Object.entries(def.fieldRemap ?? {})) {
      publicFieldName.set(opField, publicKey);
    }
    // Loose for the same reason as registerOperationTools above: unknown args
    // must reach the op layer's dead-field rejection instead of being stripped.
    server.registerTool(
      def.toolName,
      {
        description: def.description,
        inputSchema: z.looseObject({ ...buildCompositeShape(def), ...routingShape }),
        outputSchema: operationOutputSchema(compositeMemberOps(def)),
        annotations: operationToolAnnotations(def.toolName),
      },
      async (input: Record<string, unknown>, extra) => {
        try {
          const host = await getHost();
          extra.signal.throwIfAborted();
          const opName = resolveCompositeOp(def, input);
          const op = getOperation(opName);
          // Strip the composite discriminators (action + any extra, e.g. `kind`)
          // and undo any field remap; the rest is the op's raw MCP args — the same
          // value the standalone tool would receive.
          const rest = stripCompositeDiscriminators(def, input);
          const missing = requiredMcpFields(op).filter((field) => !requiredFieldSatisfied(opName, field, rest));
          if (missing.length > 0) {
            const named = missing.map((field) => `"${publicFieldName.get(field) ?? field}"`).join(', ');
            throw new OperationError(
              `${def.toolName} action "${String(input.action)}" requires ${named}. Unknown parameters are ignored — check the argument names.`,
            );
          }
          const opInput = op.mcp?.buildInput ? op.mcp.buildInput(rest) : rest;
          return await invokeMcpOperation(
            host,
            op,
            opInput,
            rest,
            server.server.getClientVersion()?.name ?? null,
            executionOptions(extra),
          );
        } catch (error) {
          return operationToolError(error);
        }
      },
    );
  }
}
