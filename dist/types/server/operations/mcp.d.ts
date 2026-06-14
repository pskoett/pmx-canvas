import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OperationInvoker } from './invoker.js';
import { type OperationMcpToolHost } from './types.js';
import { type CompositeToolDefinition } from './composites.js';
export interface OperationToolHost extends OperationMcpToolHost {
    invoker(): OperationInvoker;
}
export declare function registerOperationTools(server: McpServer, getHost: () => Promise<OperationToolHost>): void;
/**
 * Register composite (action-discriminated) MCP tools (plan-006). Each action
 * dispatches to a registered operation, reusing that op's `mcp.buildInput` and
 * `mcp.formatResult` so the composite action is byte-identical to the standalone
 * tool it folds. Defaults to `compositeToolDefinitions`.
 */
export declare function registerCompositeTools(server: McpServer, getHost: () => Promise<OperationToolHost>, definitions?: CompositeToolDefinition[]): void;
