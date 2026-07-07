/**
 * Shared body reader: preserves the parsed JSON value as-is (object, array,
 * or primitive) — per-op `readInput` decides what to do with non-object
 * bodies; the shared reader never coerces. A non-empty body that fails to
 * parse is a 400 (OperationError), never a silent empty input.
 */
export declare function readJsonValue(req: Request): Promise<unknown>;
export declare function dispatchOperationRoute(req: Request, url: URL): Promise<Response | null>;
