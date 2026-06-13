export interface OperationInvoker {
    invoke(name: string, input: Record<string, unknown>): Promise<unknown>;
}
/** Runs operations in-process against the shared canvasState singleton. */
export declare class LocalOperationInvoker implements OperationInvoker {
    invoke(name: string, input: Record<string, unknown>): Promise<unknown>;
}
/** Builds the HTTP request from the op's route template (`:id` from input, GET flags to query). */
export declare class HttpOperationInvoker implements OperationInvoker {
    private readonly baseUrl;
    constructor(baseUrl: string);
    invoke(name: string, input: Record<string, unknown>): Promise<unknown>;
}
