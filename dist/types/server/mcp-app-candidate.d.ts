/**
 * MCP app candidate detection — standalone version.
 *
 * Removed PMX-specific imports (inferServerNameFromToolName, excalidraw-url helpers).
 * Inlined the necessary URL detection logic.
 */
export interface McpAppToolCompletionInput {
    name: string;
    mcpServerName?: string;
    mcpToolName?: string;
    result: unknown;
    content?: string;
    detailedContent?: string;
}
export interface McpAppToolCandidate {
    url: string;
    inferredType: string;
    keyHint: string;
    sourceServer: string | null;
    sourceTool: string;
}
export declare function inferMcpAppType(url: string): string;
export declare function isLikelyMcpAppWebUrl(url: string): boolean;
export declare function inferMcpAppSourceServer(input: Pick<McpAppToolCompletionInput, 'name' | 'mcpServerName'>, url: string): string | null;
export declare function getMcpAppCandidateFromToolCompletion(data: McpAppToolCompletionInput): McpAppToolCandidate | null;
