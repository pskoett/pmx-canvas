import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
export interface NormalizeExtAppToolResultInput {
    result: unknown;
    success?: boolean;
    error?: string;
    content?: string;
    detailedContent?: string;
}
export declare function normalizeExtAppToolResult(input: NormalizeExtAppToolResultInput): CallToolResult;
/**
 * Structural equality between two `CallToolResult` values, used by the host
 * ExtAppFrame to suppress echo-back re-renders when an SSE layout update
 * mints a new object reference for an otherwise-unchanged tool result.
 *
 * JSON-stringify is adequate here: tool results are strictly JSON (no
 * functions, symbols, or cycles), typically small, and on the hot path we
 * only hit this when references already differ. For very large payloads
 * (> ~2MB) an early length check skips the stringify to avoid a user-visible
 * stall — such results are treated as "changed" and forwarded to the widget.
 */
export declare function extAppToolResultsMatch(a: CallToolResult, b: CallToolResult): boolean;
