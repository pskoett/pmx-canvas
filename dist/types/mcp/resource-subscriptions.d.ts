import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CanvasAccess } from './canvas-access.js';
/** One subscription set and event source per MCP connection. Notifications are not reads. */
export declare function registerResourceSubscriptions(server: McpServer, getCanvas: () => Promise<CanvasAccess>): {
    attach: (canvas: CanvasAccess) => void;
    dispose: () => void;
};
