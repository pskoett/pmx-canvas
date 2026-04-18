import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
export interface NormalizeExtAppToolResultInput {
    result: unknown;
    success?: boolean;
    error?: string;
    content?: string;
    detailedContent?: string;
}
export declare function normalizeExtAppToolResult(input: NormalizeExtAppToolResultInput): CallToolResult;
