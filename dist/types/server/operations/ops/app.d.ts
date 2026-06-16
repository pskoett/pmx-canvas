import { type ExternalMcpTransportConfig } from '../../mcp-app-runtime.js';
import { type Operation, type OperationContext } from '../types.js';
export interface OpenMcpAppCoreInput {
    transport: ExternalMcpTransportConfig;
    toolName: string;
    toolArguments?: Record<string, unknown>;
    nodeId?: string;
    serverName?: string;
    title?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    timeoutMs?: number;
}
export interface OpenMcpAppCoreResult {
    ok: true;
    id?: string;
    nodeId: string | null;
    toolCallId: string;
    sessionId: string;
    resourceUri: string;
}
/**
 * Open an external MCP app: connect + call + read resource (openExternalMcpApp),
 * close any prior session on an in-place node, emit `ext-app-open` +
 * `ext-app-result`, then resolve the resulting canvas node id. This is the exact
 * legacy SDK `openMcpApp` body, relocated; both the mcpapp.open op AND the SDK
 * call it. The diagram.open op delegates here after building the Excalidraw input
 * (the SSE pair fires ONCE — diagram.open does not re-emit).
 */
export declare function openMcpAppCore(input: OpenMcpAppCoreInput, ctx: OperationContext): Promise<OpenMcpAppCoreResult>;
export declare const appOperations: Operation[];
