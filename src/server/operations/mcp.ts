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
import { buildCompositeDeprecationNotes, compositeToolDefinitions, type CompositeToolDefinition } from './composites.js';

export interface OperationToolHost extends OperationMcpToolHost {
  invoker(): OperationInvoker;
}

export function registerOperationTools(
  server: McpServer,
  getHost: () => Promise<OperationToolHost>,
): void {
  // Legacy tools folded by a composite get a "Deprecated: use canvas_x …" prefix
  // (plan-006 step 2) so agents migrate during the v0.2 overlap window.
  const deprecations = buildCompositeDeprecationNotes();
  for (const op of listOperations()) {
    const tool = op.mcp;
    if (!tool) continue;
    const note = deprecations.get(op.name);
    server.tool(
      tool.toolName,
      note ? note + tool.description : tool.description,
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
 * Derive a composite tool's advertised schema from its member operations: the
 * union of every member op's `inputShape` + `extraShape`, each made optional
 * (not every action uses every field), plus the `action` discriminator. Deriving
 * it (instead of hand-listing fields) keeps the composite schema in lockstep
 * with the operations it folds — no drift.
 */
function buildCompositeShape(def: CompositeToolDefinition): ZodRawShape {
  const actionKeys = Object.keys(def.actions) as [string, ...string[]];
  const shape: Record<string, ZodTypeAny> = {
    action: z.enum(actionKeys).describe(`Operation to perform: ${def.actionSummary}.`),
  };
  for (const opName of new Set(Object.values(def.actions))) {
    const op = getOperation(opName);
    const merged = { ...op.inputShape, ...(op.mcp?.extraShape ?? {}) };
    for (const [key, schema] of Object.entries(merged)) {
      if (key === 'action' || key in shape) continue;
      shape[key] = (schema as ZodTypeAny).optional();
    }
  }
  return shape;
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
    server.tool(
      def.toolName,
      def.description,
      buildCompositeShape(def),
      async (input: Record<string, unknown>) => {
        try {
          const host = await getHost();
          const action = typeof input.action === 'string' ? input.action : '';
          const opName = def.actions[action];
          if (!opName) {
            throw new OperationError(
              `Unknown action "${action}" for ${def.toolName}. Valid actions: ${Object.keys(def.actions).join(', ')}.`,
            );
          }
          const op = getOperation(opName);
          // Strip the composite discriminator; the rest is the op's raw MCP args
          // (the same value the standalone tool would receive).
          const { action: _action, ...rest } = input;
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
      },
    );
  }
}
