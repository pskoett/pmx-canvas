/** Hard ceiling on a single blocking wait, regardless of the requested timeout. */
export declare const AX_WAIT_MAX_MS = 120000;
export interface AxWaitResult<T> {
    /** Latest value, or null if the item does not exist / vanished mid-wait. */
    value: T | null;
    /** True only when the item still exists and is still pending after the wait. */
    pending: boolean;
}
/**
 * Block until a canvas-bound AX item resolves (its status leaves `pending`), the
 * timeout elapses, or the request aborts — the server side of report primitive D
 * ("gates that actually gate"). Resolves immediately when the item is already
 * resolved, missing, or `timeoutMs <= 0` (a plain single read). Subscribes to the
 * `ax` change channel and always disposes the listener + timer.
 */
export declare function waitForAxResolution<T extends {
    status: string;
}>(opts: {
    read: () => T | null;
    isResolved: (value: T) => boolean;
    timeoutMs: number;
    signal?: AbortSignal;
}): Promise<AxWaitResult<T>>;
