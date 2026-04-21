import type { ExternalMcpTransportConfig } from './mcp-app-runtime.js';
export declare const EXCALIDRAW_MCP_URL = "https://mcp.excalidraw.com/mcp";
export declare const EXCALIDRAW_SERVER_NAME = "Excalidraw";
export declare const EXCALIDRAW_CREATE_VIEW_TOOL = "create_view";
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
export declare function normalizeExcalidrawElements(elements: unknown): string;
export declare function buildExcalidrawOpenMcpAppInput(input: DiagramPresetOpenInput): ExcalidrawOpenMcpAppInput;
