/**
 * MCP tool registration for registered operations.
 *
 * Iterates the registry, advertises `{ ...op.inputShape, ...extraShape }` as
 * the tool schema, invokes through the host's invoker (local or HTTP), and
 * formats the wire-shaped result with the op's `formatResult`. Errors
 * (including OperationError) become `isError` tool results with the bare
 * message text, matching the legacy hand-written tools.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listOperations } from './registry.js';
import type { OperationInvoker } from './invoker.js';
import type { OperationMcpToolHost } from './types.js';

export interface OperationToolHost extends OperationMcpToolHost {
  invoker(): OperationInvoker;
}

export function registerOperationTools(
  server: McpServer,
  getHost: () => Promise<OperationToolHost>,
): void {
  for (const op of listOperations()) {
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
