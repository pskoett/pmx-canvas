export interface OperationInvoker {
    invoke(name: string, input: Record<string, unknown>): Promise<unknown>;
}
/**
 * The agent-presence label for a transport: `PMX_CANVAS_AGENT_SOURCE` lets a
 * host name its agent ('codex', 'claude-code', …) so writes, attach and cursor
 * all key on one identity; otherwise the transport's own label.
 */
export declare function agentSourceLabel(fallback: string): string;
/** Runs operations in-process against the shared canvasState singleton. */
export declare class LocalOperationInvoker implements OperationInvoker {
    private readonly source;
    /** `source` labels this caller's agent presence ('mcp', 'sdk', …). */
    constructor(source?: string);
    invoke(name: string, input: Record<string, unknown>): Promise<unknown>;
}
/** Builds the HTTP request from the op's route template (`:id` from input, GET flags to query). */
export declare class HttpOperationInvoker implements OperationInvoker {
    private readonly baseUrl;
    private readonly source;
    /** `source` labels this caller's agent presence on the server ('cli', 'mcp', …). */
    constructor(baseUrl: string, source?: string);
    invoke(name: string, rawInput: Record<string, unknown>): Promise<unknown>;
}
