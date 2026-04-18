/** @internal — exported for testing */
export declare function hashPath(path: string): string;
/** @internal — exported for testing */
export declare const EVENT_HANDLERS: Record<string, (data: Record<string, unknown>) => void>;
export declare function connectSSE(): () => void;
