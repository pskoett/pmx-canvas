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
import { getOperation, listOperations } from './registry.js';
import type { OperationInvoker } from './invoker.js';
import { OperationError, type OperationMcpToolHost } from './types.js';
import { compositeFoldedOpNames, compositeToolDefinitions, type CompositeToolDefinition } from './composites.js';

export interface OperationToolHost extends OperationMcpToolHost {
  invoker(): OperationInvoker;
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
    server.tool(
      tool.toolName,
      tool.description,
      { ...op.inputShape, ...(tool.extraShape ?? {}) },
      async (input: Record<string, unknown>) => {
        try {
          const host = await getHost();
          const opInput = tool.buildInput ? tool.buildInput(input) : input;
          const result = await host.invoker().invoke(op.name, opInput);
          if (tool.formatResult) {
            return await tool.formatResult(result, input, host);
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
            isError: true,
          };
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
    server.tool(def.toolName, def.description, buildCompositeShape(def), async (input: Record<string, unknown>) => {
      try {
        const host = await getHost();
        const opName = resolveCompositeOp(def, input);
        const op = getOperation(opName);
        // Strip the composite discriminators (action + any extra, e.g. `kind`)
        // and undo any field remap; the rest is the op's raw MCP args — the same
        // value the standalone tool would receive.
        const rest = stripCompositeDiscriminators(def, input);
        const opInput = op.mcp?.buildInput ? op.mcp.buildInput(rest) : rest;
        const result = await host.invoker().invoke(opName, opInput);
        if (op.mcp?.formatResult) {
          return await op.mcp.formatResult(result, rest, host);
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    });
  }
}
