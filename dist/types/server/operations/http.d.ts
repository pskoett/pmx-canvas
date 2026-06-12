/**
 * Shared body reader: preserves the parsed JSON value as-is (object, array,
 * or primitive) — per-op `readInput` decides what to do with non-object
 * bodies; the shared reader never coerces.
 */
export declare function readJsonValue(req: Request): Promise<unknown>;
export declare function dispatchOperationRoute(req: Request, url: URL): Promise<Response | null>;
