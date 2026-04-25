import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ExternalMcpTransportConfig } from './mcp-app-runtime.js';
export declare const EXCALIDRAW_MCP_URL = "https://mcp.excalidraw.com/mcp";
export declare const EXCALIDRAW_SERVER_NAME = "Excalidraw";
export declare const EXCALIDRAW_CREATE_VIEW_TOOL = "create_view";
export declare const EXCALIDRAW_SAVE_CHECKPOINT_TOOL = "save_checkpoint";
export declare const EXCALIDRAW_READ_CHECKPOINT_TOOL = "read_checkpoint";
export declare const DEFAULT_EXCALIDRAW_ELEMENTS: ReadonlyArray<Record<string, unknown>>;
export declare const EXCALIDRAW_MCP_TRANSPORT: ExternalMcpTransportConfig;
export interface DiagramPresetOpenInput {
    elements: unknown;
    title?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
}
export interface ExcalidrawOpenMcpAppInput {
    transport: ExternalMcpTransportConfig;
    toolName: string;
    serverName: string;
    toolArguments: {
        elements: string;
    };
    title?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
}
export declare function inferExcalidrawCameraUpdate(elements: Array<Record<string, unknown>>): Record<string, unknown> | null;
export declare function normalizeExcalidrawElements(elements: unknown): string;
export declare function normalizeExcalidrawElementsForToolInput(elements: unknown): string;
export declare function normalizeExcalidrawCheckpointDataForToolInput(data: unknown): string | null;
export declare function buildExcalidrawRestoreCheckpointToolInput(checkpointId: string, data?: unknown): string;
export declare function isExcalidrawCreateView(serverName: unknown, toolName: unknown): boolean;
export declare function buildExcalidrawCheckpointId(seed: string): string;
export declare function getExcalidrawCheckpointIdFromToolResult(result: unknown): string | null;
export declare function withExcalidrawCheckpointId(result: CallToolResult, checkpointId: string): CallToolResult;
export declare function ensureExcalidrawCheckpointId(result: CallToolResult, seed: string, checkpointId?: string | null): CallToolResult;
export declare function buildExcalidrawOpenMcpAppInput(input: DiagramPresetOpenInput): ExcalidrawOpenMcpAppInput;
