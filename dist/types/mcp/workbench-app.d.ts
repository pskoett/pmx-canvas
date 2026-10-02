import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CanvasAccess } from './canvas-access.js';
/** HTTP-shaped replies let the real workbench retain its existing API contracts. */
export declare function registerWorkbenchApp(server: McpServer, ensureCanvas: () => Promise<CanvasAccess>): void;
