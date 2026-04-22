import type { CallToolResult, ListPromptsResult, ListResourcesResult, ListResourceTemplatesResult, ListToolsResult, ReadResourceResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpUiResourceMeta } from '@modelcontextprotocol/ext-apps';
export interface ExternalMcpHttpTransportConfig {
    type: 'http';
    url: string;
    headers?: Record<string, string>;
}
export interface ExternalMcpStdioTransportConfig {
    type: 'stdio';
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
}
export type ExternalMcpTransportConfig = ExternalMcpHttpTransportConfig | ExternalMcpStdioTransportConfig;
export interface OpenMcpAppInput {
    transport: ExternalMcpTransportConfig;
    toolName: string;
    toolArguments?: Record<string, unknown>;
    serverName?: string;
}
export interface OpenMcpAppResult {
    sessionId: string;
    serverName: string;
    toolName: string;
    tool: Tool;
    toolInput: Record<string, unknown>;
    toolResult: CallToolResult;
    resourceUri: string;
    html: string;
    resourceMeta?: McpUiResourceMeta;
}
export interface ExtAppModelContextUpdateInput {
    content?: unknown[];
    structuredContent?: Record<string, unknown>;
}
export declare function openMcpApp(input: OpenMcpAppInput): Promise<OpenMcpAppResult>;
export declare function callMcpAppTool(sessionId: string, toolName: string, args?: Record<string, unknown>): Promise<CallToolResult>;
export declare function readMcpAppResource(sessionId: string, uri: string): Promise<ReadResourceResult>;
export declare function listMcpAppTools(sessionId: string): Promise<ListToolsResult>;
export declare function listMcpAppResources(sessionId: string): Promise<ListResourcesResult>;
export declare function listMcpAppResourceTemplates(sessionId: string): Promise<ListResourceTemplatesResult>;
export declare function listMcpAppPrompts(sessionId: string): Promise<ListPromptsResult>;
export declare function closeMcpAppSession(sessionId: string): void;
export declare function closeAllMcpAppSessions(): void;
