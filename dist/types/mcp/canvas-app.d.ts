import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CanvasAccess } from './canvas-access.js';
/** Focused app profile; deliberately does not register the general-purpose composites. */
export declare function registerCanvasApp(server: McpServer, ensureCanvas: () => Promise<CanvasAccess>): void;
