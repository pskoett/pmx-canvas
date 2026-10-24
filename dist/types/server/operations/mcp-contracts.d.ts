/**
 * MCP's output is the FORMATTER projection, never the larger HTTP payload.
 * `result` wraps prose/arrays without pretending they are JSON objects. Each
 * operation validates its stable fields; loose payloads preserve full:true and
 * extensible node/app data. No schema advertises an unconstrained root record.
 */
import { z } from 'zod';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
export declare function operationOutputSchema(operations: string[]): z.ZodObject<{
    result: z.ZodUnion<readonly [...z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>[], z.ZodObject<{
        operation: z.ZodNull;
        outcome: z.ZodLiteral<"error">;
        data: z.ZodObject<{
            message: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>]>;
}, z.core.$strict>;
export declare function structuredOperationResult(operation: string, formatted: CallToolResult): CallToolResult;
export declare function operationToolError(error: unknown): CallToolResult;
export declare function operationToolAnnotations(toolName: string): ToolAnnotations;
