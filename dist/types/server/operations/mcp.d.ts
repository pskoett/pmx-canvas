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
import type { OperationInvoker } from './invoker.js';
import type { OperationMcpToolHost } from './types.js';
export interface OperationToolHost extends OperationMcpToolHost {
    invoker(): OperationInvoker;
}
export declare function registerOperationTools(server: McpServer, getHost: () => Promise<OperationToolHost>): void;
